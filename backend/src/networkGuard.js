import { createServer } from "node:http";
import { request as httpRequest } from "node:http";
import { connect as tcpConnect } from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import ipaddr from "ipaddr.js";

const MAX_PROXY_REQUESTS = 100;
const MAX_PROXY_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const BLOCKED_HOSTNAMES = new Set([
  "metadata",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data.ec2.internal",
]);

export class ScanError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = "ScanError";
    this.code = code;
    this.status = status;
  }
}

function logProxyFailure(requestId, phase, error) {
  const message = String(error?.message ?? "").replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[address redacted]").slice(0, 300);
  console.error("Accessibility scanner proxy connection failed:", {
    requestId,
    phase,
    errorName: error?.name ?? "Error",
    errorCode: error?.code ?? null,
    errorMessage: message,
  });
}

function isPublicAddress(address) {
  try {
    let parsed = ipaddr.parse(address);
    if (parsed.kind() === "ipv6" && parsed.isIPv4MappedAddress()) {
      parsed = parsed.toIPv4Address();
    }
    return parsed.range() === "unicast";
  } catch {
    return false;
  }
}

function normalizeHostname(hostname) {
  return hostname.toLowerCase().replace(/\.$/, "").replace(/^\[(.*)\]$/, "$1");
}

export async function resolvePublicAddress(hostname, resolver = dnsLookup) {
  const normalizedHostname = normalizeHostname(hostname);
  if (
    !normalizedHostname
    || BLOCKED_HOSTNAMES.has(normalizedHostname)
    || normalizedHostname.endsWith(".localhost")
    || normalizedHostname.endsWith(".local")
    || normalizedHostname.endsWith(".internal")
  ) {
    throw new ScanError("DESTINATION_BLOCKED", "This host is not available to the audit scanner.");
  }

  const literalVersion = ipaddr.isValid(normalizedHostname);
  if (literalVersion) {
    if (!isPublicAddress(normalizedHostname)) {
      throw new ScanError("DESTINATION_BLOCKED", "This host is not available to the audit scanner.");
    }
    const parsed = ipaddr.parse(normalizedHostname);
    return { address: normalizedHostname, family: parsed.kind() === "ipv4" ? 4 : 6 };
  }

  if (!normalizedHostname.includes(".")) {
    throw new ScanError("DESTINATION_BLOCKED", "Single-label hostnames are not allowed.");
  }

  let answers;
  try {
    answers = await resolver(normalizedHostname, { all: true, verbatim: true });
  } catch {
    throw new ScanError("DNS_LOOKUP_FAILED", "The page host could not be resolved.", 400);
  }

  if (!answers.length || answers.some(({ address }) => !isPublicAddress(address))) {
    throw new ScanError("DESTINATION_BLOCKED", "This host resolves to a restricted network.");
  }

  return {
    address: answers[0].address,
    family: answers[0].family,
  };
}

export async function validatePublicUrl(value, resolver = dnsLookup) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new ScanError("INVALID_URL", "Enter a valid public HTTP or HTTPS URL.");
  }

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new ScanError("DISALLOWED_SCHEME", "Only HTTP and HTTPS pages can be audited.");
  }
  if (url.username || url.password) {
    throw new ScanError("URL_CREDENTIALS_NOT_ALLOWED", "URLs containing credentials are not allowed.");
  }
  if (url.port && url.port !== (url.protocol === "https:" ? "443" : "80")) {
    throw new ScanError("DISALLOWED_PORT", "Only the standard HTTP and HTTPS ports are allowed.");
  }
  if (url.hash) url.hash = "";

  const pinnedAddress = await resolvePublicAddress(url.hostname, resolver);
  return { url, pinnedAddress };
}

function safeProxyError(response, status = 502) {
  if (!response.headersSent) response.writeHead(status, { "content-type": "text/plain", connection: "close" });
  response.end("The audit network request was blocked.");
}

export async function createPinnedProxy({ requestId } = {}) {
  const sockets = new Set();
  let requestCount = 0;
  let transferredBytes = 0;
  let closed = false;

  function useRequestBudget() {
    requestCount += 1;
    if (requestCount > MAX_PROXY_REQUESTS) {
      throw new ScanError("REQUEST_LIMIT_EXCEEDED", "The page made too many network requests.", 429);
    }
  }

  function countBytes(amount, response) {
    transferredBytes += amount;
    if (transferredBytes > MAX_PROXY_BYTES) {
      response.destroy();
      return false;
    }
    return true;
  }

  const server = createServer(async (incoming, outgoing) => {
    try {
      useRequestBudget();
      if (!["GET", "HEAD"].includes(incoming.method)) {
        return safeProxyError(outgoing, 405);
      }

      const target = new URL(incoming.url);
      if (target.protocol !== "http:") {
        return safeProxyError(outgoing, 400);
      }
      const { pinnedAddress } = await validatePublicUrl(target.href);
      const port = Number(target.port || (target.protocol === "https:" ? 443 : 80));
      const headers = { ...incoming.headers };
      delete headers["proxy-authorization"];
      delete headers["proxy-connection"];
      delete headers.connection;
      headers.host = target.host;

      const upstream = httpRequest({
        host: pinnedAddress.address,
        family: pinnedAddress.family,
        port,
        method: incoming.method,
        path: `${target.pathname}${target.search}`,
        headers,
        agent: false,
        timeout: 5000,
      });

      upstream.on("response", (response) => {
        const contentLength = Number(response.headers["content-length"]);
        if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
          response.destroy();
          return safeProxyError(outgoing, 413);
        }

        outgoing.writeHead(response.statusCode ?? 502, response.headers);
        response.on("data", (chunk) => {
          if (!countBytes(chunk.length, outgoing)) response.destroy();
        });
        response.pipe(outgoing);
        response.on("error", () => outgoing.destroy());
      });
      upstream.on("timeout", () => upstream.destroy(new Error("upstream timeout")));
      upstream.on("error", (error) => {
        logProxyFailure(requestId, "http_upstream", error);
        safeProxyError(outgoing);
      });
      incoming.pipe(upstream);
    } catch (error) {
      safeProxyError(outgoing, error instanceof ScanError ? error.status : 502);
    }
  });

  server.on("connect", async (incoming, client, head) => {
    let upstream;
    try {
      useRequestBudget();

      const target = new URL(`http://${incoming.url}`);
      if (!target.port || Number(target.port) !== 443 || target.username || target.password) {
        throw new ScanError("DISALLOWED_PORT", "Only standard HTTPS connections are allowed.");
      }
      const { pinnedAddress } = await validatePublicUrl(`https://${target.hostname}/`);
      upstream = tcpConnect({
        host: pinnedAddress.address,
        family: pinnedAddress.family,
        port: 443,
      });
      sockets.add(client);
      sockets.add(upstream);
      client.on("close", () => sockets.delete(client));
      upstream.on("close", () => sockets.delete(upstream));

      upstream.setTimeout(8000, () => upstream.destroy());
      upstream.once("connect", () => {
        client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
        if (head.length) upstream.write(head);

        for (const [source, destination] of [[client, upstream], [upstream, client]]) {
          source.on("data", (chunk) => {
            transferredBytes += chunk.length;
            if (transferredBytes > MAX_PROXY_BYTES) {
              client.destroy();
              upstream.destroy();
            } else {
              destination.write(chunk);
            }
          });
        }
        client.on("error", () => upstream.destroy());
        upstream.on("error", () => client.destroy());
      });
      upstream.on("error", (error) => {
        logProxyFailure(requestId, "https_tunnel", error);
        client.end("HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\n\r\n");
      });
    } catch (error) {
      logProxyFailure(requestId, "https_tunnel_setup", error);
      client.end(`HTTP/1.1 ${error instanceof ScanError ? error.status : 502} Request Blocked\r\nConnection: close\r\n\r\n`);
      upstream?.destroy();
    }
  });

  server.headersTimeout = 4000;
  server.requestTimeout = 6000;
  server.keepAliveTimeout = 1000;
  server.maxHeadersCount = 64;

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    server: `http://127.0.0.1:${server.address().port}`,
    close: async () => {
      if (closed) return;
      closed = true;
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

export const scannerLimits = Object.freeze({
  maxHtmlBytes: 300_000,
  maxPageRequests: MAX_PROXY_REQUESTS,
  maxNetworkBytes: MAX_PROXY_BYTES,
  maxResponseBytes: MAX_RESPONSE_BYTES,
});

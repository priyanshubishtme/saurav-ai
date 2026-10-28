import { randomBytes, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import { JSDOM } from "jsdom";
import createDOMPurify from "dompurify";
import AxeBuilder from "@axe-core/playwright";
import { chromium } from "playwright";
import { createPinnedProxy, ScanError, scannerLimits, validatePublicUrl } from "./networkGuard.js";
import { normalizeAxeResults } from "./results.js";
import { calculateA11yScore } from "./scoring.js";

function boundedEnvironmentInteger(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

const SCAN_TIMEOUT_MS = boundedEnvironmentInteger("SCAN_TIMEOUT_MS", 35_000, 1_000, 45_000);
const NAVIGATION_TIMEOUT_MS = boundedEnvironmentInteger("NAVIGATION_TIMEOUT_MS", 10_000, 1_000, 15_000);
const MAX_ACTIVE_SCANS = 2;
const MAX_QUEUED_SCANS = 4;
const MAX_STORED_AUDITS = 25;
const MAX_TAB_STEPS = 15;
const MAX_CAPTURED_SOURCE_BYTES = 300_000;
const MAX_CAPTURED_CSS_BYTES = 100_000;
const require = createRequire(import.meta.url);
const WCAG_TAGS = Object.freeze({
  A: ["wcag2a", "wcag21a"],
  AA: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
  AAA: ["wcag2a", "wcag2aa", "wcag2aaa", "wcag21a", "wcag21aa", "wcag21aaa", "wcag22aa"],
});
const BEST_PRACTICE_TAGS = ["best-practice"];
const axeScriptPath = require.resolve("axe-core/axe.min.js");
const purify = createDOMPurify(new JSDOM("").window);
const runtime = { activeBrowsers: 0, activePreviews: 0, activeProxies: 0 };

class ScanQueue {
  active = 0;
  waiting = [];

  acquire(signal) {
    if (signal?.aborted) return Promise.reject(new ScanError("SCAN_CANCELLED", "The audit was cancelled.", 499));
    if (this.active < MAX_ACTIVE_SCANS) {
      this.active += 1;
      return Promise.resolve(() => this.release());
    }
    if (this.waiting.length >= MAX_QUEUED_SCANS) {
      return Promise.reject(new ScanError("SCAN_CAPACITY_EXCEEDED", "The scanner is busy. Please retry in a moment.", 429));
    }

    return new Promise((resolve, reject) => {
      const entry = { resolve, reject, signal, onAbort: null };
      entry.onAbort = () => {
        this.waiting = this.waiting.filter((item) => item !== entry);
        reject(new ScanError("SCAN_CANCELLED", "The audit was cancelled.", 499));
      };
      signal?.addEventListener("abort", entry.onAbort, { once: true });
      this.waiting.push(entry);
    });
  }

  release() {
    const next = this.waiting.shift();
    if (!next) {
      this.active -= 1;
      return;
    }
    next.signal?.removeEventListener("abort", next.onAbort);
    if (next.signal?.aborted) {
      next.reject(new ScanError("SCAN_CANCELLED", "The audit was cancelled.", 499));
      this.release();
      return;
    }
    next.resolve(() => this.release());
  }
}

const queue = new ScanQueue();

function throwIfAborted(signal) {
  if (signal?.aborted) throw new ScanError("SCAN_CANCELLED", "The audit was cancelled.", 499);
}

function safeProjectName(name) {
  const cleanName = name?.trim().split("").filter((character) => {
    const code = character.charCodeAt(0);
    return code >= 32 && code !== 127;
  }).join("").slice(0, 100);
  return cleanName || "Pasted HTML";
}

function sanitizeHtml(html) {
  const parsedHtml = new JSDOM(`<!doctype html>${html}`);
  const sanitizedDocument = purify.sanitize(parsedHtml.window.document.documentElement.outerHTML, {
    FORBID_TAGS: ["base", "embed", "form", "frame", "frameset", "iframe", "link", "meta", "object", "script"],
    FORBID_ATTR: ["action", "formaction", "href", "srcdoc", "srcset", "target", "xlink:href"],
    ALLOW_DATA_ATTR: false,
    WHOLE_DOCUMENT: true,
  });
  parsedHtml.window.close();
  return `<!doctype html>${sanitizedDocument}`;
}

async function startHtmlPreview(html, additionalCss = "") {
  const token = randomBytes(24).toString("hex");
  let safeHtml = sanitizeHtml(html);
  if (additionalCss) {
    const parsedHtml = new JSDOM(safeHtml);
    const styleElement = parsedHtml.window.document.createElement("style");
    styleElement.setAttribute("data-accessz-additional-css", "");
    styleElement.textContent = additionalCss;
    parsedHtml.window.document.head.append(styleElement);
    safeHtml = `<!doctype html>${parsedHtml.window.document.documentElement.outerHTML}`;
    parsedHtml.window.close();
  }
  const document = safeHtml.replace(
    /<head(?:\s[^>]*)?>/i,
    (headTag) => `${headTag}<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Isolated AccessZ audit preview</title>`,
  );
  const server = createServer((request, response) => {
    if (request.method !== "GET" || request.url !== `/${token}`) {
      response.writeHead(404, { "content-type": "text/plain", "cache-control": "no-store" }).end("Not found");
      return;
    }
    response.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
      "content-security-policy": "default-src 'none'; script-src 'none'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    });
    response.end(document);
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    html: safeHtml,
    url: `${origin}/${token}`,
    origin,
    close: () => new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    }),
  };
}

function wcagTags(level, includeBestPractices) {
  return [
    ...WCAG_TAGS[level],
    ...(includeBestPractices ? BEST_PRACTICE_TAGS : []),
  ];
}

async function captureContrastEvidence(page, violations) {
  for (const violation of violations) {
    if (violation.id !== "color-contrast") continue;
    for (const node of violation.nodes) {
      try {
        node.styleEvidence = await page.locator(node.selector).evaluate((element) => {
          const colorIsOpaque = (value) => {
            const match = value.match(/^rgba?\((.+)\)$/i);
            if (!match) return false;
            const parts = match[1].split(",").map((part) => part.trim());
            return parts.length === 3 || Number(parts[3]) === 1;
          };
          const declarations = [];
          let inaccessibleStylesheets = 0;
          const collectRules = (rules, source) => {
            for (const rule of rules) {
              if (rule.selectorText && rule.style) {
                try {
                  const matchedElement = element.closest(rule.selectorText);
                  if (matchedElement) {
                    const values = ["color", "background-color", "font-size", "font-weight"]
                      .map((property) => [property, rule.style.getPropertyValue(property)])
                      .filter(([, value]) => value);
                    if (values.length) declarations.push({
                      selector: rule.selectorText.slice(0, 300),
                      scope: matchedElement === element ? "element" : "ancestor",
                      source,
                      declarations: Object.fromEntries(values),
                    });
                  }
                } catch {
                  continue;
                }
              } else if (rule.cssRules) {
                collectRules(rule.cssRules, source);
              }
            }
          };
          for (const sheet of element.ownerDocument.styleSheets) {
            try {
              collectRules(sheet.cssRules, sheet.href ? "external stylesheet" : "inline stylesheet");
            } catch {
              inaccessibleStylesheets += 1;
            }
          }

          const style = element.ownerDocument.defaultView.getComputedStyle(element);
          let effectiveBackground = null;
          let backgroundUncertain = false;
          let ancestor = element;
          while (ancestor && ancestor.nodeType === 1) {
            const computed = element.ownerDocument.defaultView.getComputedStyle(ancestor);
            if ((computed.backgroundImage && computed.backgroundImage !== "none")
              || (computed.opacity && Number(computed.opacity) < 1)) {
              backgroundUncertain = true;
            }
            if (!effectiveBackground && colorIsOpaque(computed.backgroundColor)) {
              effectiveBackground = computed.backgroundColor;
            }
            ancestor = ancestor.parentElement;
          }

          return {
            color: style.color,
            backgroundColor: style.backgroundColor,
            effectiveBackground: backgroundUncertain ? null : effectiveBackground,
            backgroundUncertain,
            fontSize: style.fontSize,
            fontWeight: style.fontWeight,
            inlineStyle: element.getAttribute("style") ?? "",
            matchedRules: declarations.slice(0, 12),
            inaccessibleStylesheets,
          };
        });
      } catch {
        node.styleEvidence = {
          status: "unavailable",
          effectiveBackground: null,
          matchedRules: [],
          inaccessibleStylesheets: 0,
        };
      }
    }
  }
}

async function captureRenderedSource(page) {
  try {
    const html = await page.content();
    const styles = await page.evaluate((cssLimit) => {
      const pageDocument = globalThis.document;
      const accessible = [];
      const inaccessible = [];
      const authenticationLikely = Boolean(pageDocument.querySelector('input[type="password"], form[action*="login" i], form[action*="signin" i]'))
        || /(?:sign in|log in|authentication required)/i.test(pageDocument.title);
      let totalBytes = 0;
      for (const sheet of pageDocument.styleSheets) {
        const href = sheet.href || "inline style";
        try {
          const css = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
          const bytes = new TextEncoder().encode(css).length;
          if (totalBytes + bytes > cssLimit) {
            inaccessible.push({ url: href, reason: "capture-size-limit" });
            continue;
          }
          totalBytes += bytes;
          if (css.trim()) accessible.push({ url: href, css });
        } catch {
          inaccessible.push({ url: href, reason: "cross-origin-or-unavailable" });
        }
      }
      return { accessible, inaccessible, authenticationLikely };
    }, MAX_CAPTURED_CSS_BYTES - 5_000);
    if (Buffer.byteLength(html, "utf8") > MAX_CAPTURED_SOURCE_BYTES) {
      return {
        available: false,
        reason: "The rendered HTML exceeds the 300 KB source-capture limit; it was not truncated.",
        inaccessibleStylesheets: styles.inaccessible,
        capturedStylesheets: styles.accessible.length,
        authenticationLikely: styles.authenticationLikely,
      };
    }
    return {
      available: true,
      renderedHtml: html,
      capturedCss: styles.accessible.map((sheet) => sheet.css).join("\\n\\n"),
      inaccessibleStylesheets: styles.inaccessible,
      capturedStylesheets: styles.accessible.length,
      accessibleStylesheetUrls: styles.accessible.map((sheet) => sheet.url),
      authenticationLikely: styles.authenticationLikely,
    };
  } catch {
    return {
      available: false,
      reason: "Rendered source capture failed; the live page was scanned but cannot be safely edited as a controlled candidate.",
      inaccessibleStylesheets: [],
      capturedStylesheets: 0,
    };
  }
}

async function runKeyboardReview(page, signal) {
  const candidates = [];
  const capturedFocus = [];
  const positiveTabIndex = await page.locator("[tabindex]").evaluateAll((elements) => elements
    .filter((element) => Number(element.getAttribute("tabindex")) > 0)
    .map((element) => ({ html: element.outerHTML.slice(0, 200), tabIndex: Number(element.getAttribute("tabindex")) })));

  for (const element of positiveTabIndex) {
    candidates.push({
      type: "positive-tabindex",
      classification: "review_candidate",
      selector: "",
      html: element.html,
      explanation: `tabindex="${element.tabIndex}" may create an unexpected keyboard focus order; review manually.`,
    });
  }

  try {
    for (const [direction, key] of [["forward", "Tab"], ["backward", "Shift+Tab"]]) {
      await page.evaluate(() => globalThis.document.activeElement?.blur());
      let lastFingerprint = "";
      for (let step = 0; step < MAX_TAB_STEPS; step += 1) {
        throwIfAborted(signal);
        await page.keyboard.press(key);
        const focused = await page.evaluate((focusDirection) => {
          const element = globalThis.document.activeElement;
          if (!element || element === globalThis.document.body || element === globalThis.document.documentElement) return null;
          const style = globalThis.getComputedStyle(element);
          const outlineVisible = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
          const shadowVisible = style.boxShadow !== "none";
          const rect = element.getBoundingClientRect();
          const visible = rect.width > 0 && rect.height > 0
            && style.visibility !== "hidden"
            && style.display !== "none";
          return {
            selector: element.id ? `#${globalThis.CSS.escape(element.id)}` : element.tagName.toLowerCase(),
            html: element.outerHTML.slice(0, 200),
            text: (element.textContent ?? "").trim().slice(0, 80),
            index: [...globalThis.document.querySelectorAll("body *")].indexOf(element),
            focusVisible: outlineVisible || shadowVisible,
            visible,
            direction: focusDirection,
          };
        }, direction);

        if (!focused) break;
        const fingerprint = `${focused.selector}|${focused.html}`;
        if (fingerprint === lastFingerprint) break;
        lastFingerprint = fingerprint;
        capturedFocus.push(focused);
      }
    }
  } catch {
    if (signal?.aborted) throw new ScanError("SCAN_CANCELLED", "The audit was cancelled.", 499);
    candidates.push({
      type: "keyboard-review-interrupted",
      classification: "review_candidate",
      selector: "",
      html: "",
      explanation: "Keyboard focus could not be fully reviewed; verify focus behavior manually.",
    });
  }

  for (let index = 0; index < capturedFocus.length; index += 1) {
    const focused = capturedFocus[index];
    if (focused.visible && !focused.focusVisible) {
      candidates.push({
        type: "focus-indicator-review",
        classification: "review_candidate",
        selector: focused.selector,
        html: focused.html,
        explanation: "No outline or box shadow was detected on this focused element. Confirm visible keyboard focus manually; other indicators may exist.",
      });
    }
    const previous = capturedFocus[index - 1];
    if (index && focused.direction === previous.direction
      && ((focused.direction === "forward" && focused.index < previous.index)
        || (focused.direction === "backward" && focused.index > previous.index))) {
      candidates.push({
        type: "focus-order-review",
        classification: "review_candidate",
        selector: focused.selector,
        html: focused.html,
        explanation: "Keyboard focus moved backwards in DOM order. Confirm that the resulting focus order remains understandable.",
      });
    }
  }

  return {
    status: "review_candidates_only",
    capturedFocus: capturedFocus.map(({ selector, html, text, visible, focusVisible, direction }) => ({
      selector, html, text, visible, focusVisible, direction,
    })),
    candidates,
  };
}

function getScanLimitations({ sourceType, blockedRequests }) {
  const limitations = [
    "Automated axe-core checks do not prove full WCAG conformance; manual assessment is still required.",
    "The score is an internal weighted indicator, not an official WCAG compliance score.",
    "This scan used an isolated, credential-free browser context and did not interact with authenticated application states.",
  ];
  if (sourceType === "html") {
    limitations.push("Pasted HTML is sanitized and scanned in a unique, network-isolated preview. Scripts, forms, frames, and active content are not executed.");
    limitations.push("Keyboard interactions are heuristics for manual review, not definitive WCAG failures.");
  }
  if (blockedRequests.length) {
    limitations.push(`${blockedRequests.length} browser request(s) were blocked by the scanner network policy; check whether affected resources alter the rendered page.`);
  }
  return limitations;
}

function browserExecutablePath() {
  return process.env.CHROMIUM_EXECUTABLE_PATH || undefined;
}

function safeDiagnosticMessage(message) {
  return String(message ?? "")
    .replace(/\bhttps?:\/\/[^\s"'<>]+/gi, (value) => {
      try {
        const url = new URL(value);
        return `${url.protocol}//${url.host}/[redacted]`;
      } catch {
        return "[URL redacted]";
      }
    })
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
}

function logScannerFailure(requestId, phase, error) {
  const browserErrorCode = String(error?.message ?? "").match(/net::([A-Z0-9_]+)/)?.[1];
  console.error("Accessibility scanner operation failed:", {
    requestId,
    phase,
    errorName: error?.name ?? "Error",
    errorCode: error?.code ?? browserErrorCode ?? null,
    errorMessage: safeDiagnosticMessage(error?.message),
  });
}

async function verifyAxeInstallation() {
  await access(axeScriptPath, fsConstants.R_OK);
}

async function performScan(input, { signal, requestId }) {
  let browser;
  let context;
  let page;
  let proxy;
  let preview;
  let phase = "initialization";
  const blockedRequests = [];
  const abortCleanup = () => {
    void page?.close().catch(() => {});
    void context?.close().catch(() => {});
    void browser?.close().catch(() => {});
    void proxy?.close().catch(() => {});
    void preview?.close().catch(() => {});
  };
  signal?.addEventListener("abort", abortCleanup, { once: true });

  try {
    throwIfAborted(signal);
    await verifyAxeInstallation();

    if (input.sourceType === "url") {
      await validatePublicUrl(input.url);
      proxy = await createPinnedProxy({ requestId });
      runtime.activeProxies += 1;
    } else {
      preview = await startHtmlPreview(input.html, input.additionalCss);
      runtime.activePreviews += 1;
    }

    throwIfAborted(signal);
    const launchOptions = {
      headless: true,
      executablePath: browserExecutablePath(),
      args: [
        "--proxy-bypass-list=<-loopback>",
        "--disable-background-networking",
        "--disable-component-update",
        "--disable-default-apps",
        "--disable-extensions",
        "--disable-sync",
        "--no-first-run",
        "--js-flags=--max-old-space-size=256",
      ],
      ...(proxy ? { proxy: { server: proxy.server } } : {}),
    };
    phase = "browser_launch";
    browser = await chromium.launch(launchOptions);
    runtime.activeBrowsers += 1;
    throwIfAborted(signal);
    context = await browser.newContext({
      acceptDownloads: false,
      bypassCSP: input.sourceType === "html",
      ignoreHTTPSErrors: false,
      javaScriptEnabled: true,
      serviceWorkers: "block",
      viewport: { width: 1280, height: 900 },
    });
    context.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    context.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);
    page = await context.newPage();
    page.setDefaultNavigationTimeout(NAVIGATION_TIMEOUT_MS);
    page.setDefaultTimeout(NAVIGATION_TIMEOUT_MS);

    let requestCount = 0;
    let blockedNavigation = false;
    await context.route("**/*", async (route) => {
      const request = route.request();
      requestCount += 1;

      if (requestCount > 85) {
        blockedRequests.push({ url: request.url(), reason: "request-limit" });
        if (request.isNavigationRequest()) blockedNavigation = true;
        await route.abort("blockedbyclient");
        return;
      }

      if (!["GET", "HEAD"].includes(request.method())) {
        blockedRequests.push({ url: request.url(), reason: "method-blocked" });
        await route.abort("blockedbyclient");
        return;
      }

      if (preview) {
        if (request.url() === preview.url) {
          await route.continue();
          return;
        }
        blockedRequests.push({ url: request.url(), reason: "html-network-disabled" });
        await route.abort("blockedbyclient");
        return;
      }

      try {
        await validatePublicUrl(request.url());
        await route.continue();
      } catch (error) {
        blockedRequests.push({
          url: request.url(),
          reason: error instanceof ScanError ? error.code : "destination-blocked",
        });
        if (request.isNavigationRequest()) blockedNavigation = true;
        await route.abort("blockedbyclient");
      }
    });

    throwIfAborted(signal);
    const targetUrl = preview?.url ?? input.url;
    let response;
    phase = "navigation";
    try {
      response = await page.goto(targetUrl, { waitUntil: "domcontentloaded" });
    } catch (error) {
      throwIfAborted(signal);
      logScannerFailure(requestId, phase, error);
      if (blockedNavigation) {
        throw new ScanError("DESTINATION_BLOCKED", "A navigation or redirect was blocked by the scanner network policy.");
      }
      if (error.name === "TimeoutError") {
        throw new ScanError("TARGET_TIMEOUT", "The page did not finish loading before the scan timeout.", 504);
      }
      if (String(error.message).includes("ERR_PROXY_AUTH_UNSUPPORTED")) {
        throw new ScanError("SCANNER_PROXY_FAILED", "The isolated browser could not establish its restricted network connection. Retry the scan, and contact support if the problem continues.", 502);
      }
      throw new ScanError("TARGET_UNAVAILABLE", "The page could not be reached by the isolated scanner. Confirm it is publicly reachable and allows automated requests, then retry.", 502);
    }

    if (response && response.status() >= 400) {
      if ([401, 403].includes(response.status())) {
        throw new ScanError("TARGET_AUTH_REQUIRED", `The page returned HTTP ${response.status()} and may require authentication. The scanner does not log in or bypass access controls.`, 502);
      }
      throw new ScanError("TARGET_HTTP_ERROR", `The page returned HTTP ${response.status()}; only successful page responses can be scanned.`, 502);
    }
    throwIfAborted(signal);

    const tags = wcagTags(input.wcagLevel, input.includeBestPractices);
    let rawResults;
    phase = "axe_analysis";
    try {
      rawResults = await new AxeBuilder({ page }).withTags(tags).analyze();
    } catch (error) {
      throwIfAborted(signal);
      logScannerFailure(requestId, phase, error);
      if (error.name === "TimeoutError") {
        throw new ScanError("AXE_TIMEOUT", "Accessibility checks exceeded their time limit.", 504);
      }
      throw new ScanError("SCANNER_FAILED", "The accessibility engine could not complete its checks.", 502);
    }
    throwIfAborted(signal);

    const results = normalizeAxeResults(rawResults);
    await captureContrastEvidence(page, results.violations);
    const sourceCapture = input.sourceType === "url" ? await captureRenderedSource(page) : null;
    const keyboardAudit = preview
      ? await runKeyboardReview(page, signal)
      : { status: "not_run", capturedFocus: [], candidates: [] };
    const createdAt = new Date(input.startedAt).toISOString();
    const score = calculateA11yScore(results);
    const source = preview ? safeProjectName(input.projectName) : input.url;
    const finalUrl = preview ? null : page.url();
    if (sourceCapture) sourceCapture.httpStatus = response?.status() ?? null;

    return {
      id: randomUUID(),
      sourceType: input.sourceType,
      source,
      projectName: preview ? source : null,
      requestedUrl: preview ? null : input.url,
      finalUrl,
      status: "completed",
      createdAt,
      durationMs: Date.now() - input.startedAt,
      wcagLevel: input.wcagLevel,
      includeBestPractices: input.includeBestPractices,
      engine: { name: "Playwright + Chromium + axe-core", axeVersion: results.axeVersion, tags },
      summary: {
        score: score.score,
        scoreLabel: "AccessZ weighted rule indicator — not WCAG conformance",
        scoreBreakdown: score,
        violations: results.violations.length,
        violationNodes: results.violations.reduce((count, violation) => count + violation.nodeCount, 0),
        passes: results.passes.length,
        incomplete: results.incomplete.length,
        inapplicable: results.inapplicable.length,
        rulesEvaluated: results.rulesEvaluated,
      },
      violations: results.violations,
      passes: results.passes,
      incomplete: results.incomplete,
      inapplicable: results.inapplicable,
      keyboardAudit,
      ...(preview ? { previewHtml: preview.html, previewOrigin: preview.origin } : {}),
      ...(input.additionalCss ? { additionalCss: input.additionalCss } : {}),
      ...(sourceCapture ? { sourceCapture } : {}),
      ...(sourceCapture?.available ? {
        renderedHtml: sourceCapture.renderedHtml,
        capturedCss: sourceCapture.capturedCss,
      } : {}),
      blockedRequests: blockedRequests.slice(0, 25),
      scanLimitations: getScanLimitations({ sourceType: input.sourceType, blockedRequests }),
    };
  } catch (error) {
    if (signal?.aborted && !(error instanceof ScanError)) {
      throw new ScanError("SCAN_CANCELLED", "The audit was cancelled.", 499);
    }
    if (error instanceof ScanError) throw error;
    logScannerFailure(requestId, phase, error);
    if (error.message?.includes("Executable doesn't exist")) {
      const message = process.env.CHROMIUM_EXECUTABLE_PATH
        ? "CHROMIUM_EXECUTABLE_PATH points to a missing Chromium executable. Clear it or set it to a valid executable."
        : "Playwright cannot find its Chromium executable. Rebuild the backend Docker image so Chromium is installed into the runtime image.";
      throw new ScanError("CHROMIUM_UNAVAILABLE", message, 503);
    }
    if (phase === "browser_launch") {
      const message = error.code === "ENOENT"
        ? "Chromium is installed but could not start; a required Linux shared library may be missing. Build the backend with Playwright's --with-deps Chromium install."
        : "Chromium is installed but could not start. Check the executable permissions and server logs.";
      throw new ScanError("CHROMIUM_LAUNCH_FAILED", message, 503);
    }
    throw new ScanError("SCANNER_FAILED", "The accessibility engine could not complete the scan.", 502);
  } finally {
    signal?.removeEventListener("abort", abortCleanup);
    await page?.close().catch(() => {});
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
    await proxy?.close().catch(() => {});
    await preview?.close().catch(() => {});
    if (browser) runtime.activeBrowsers -= 1;
    if (proxy) runtime.activeProxies -= 1;
    if (preview) runtime.activePreviews -= 1;
  }
}

export async function scanAudit(input, { signal, requestId } = {}) {
  const release = await queue.acquire(signal);
  const startedAt = Date.now();
  const innerController = new AbortController();
  let timeout;
  let abortHandler;

  const scanPromise = performScan({ ...input, startedAt }, { signal: innerController.signal, requestId });
  const timeoutPromise = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      innerController.abort();
      reject(new ScanError("SCAN_TIMEOUT", "The audit exceeded its time limit and was stopped.", 504));
    }, SCAN_TIMEOUT_MS);
  });
  const cancellationPromise = new Promise((_, reject) => {
    abortHandler = () => {
      innerController.abort();
      reject(new ScanError("SCAN_CANCELLED", "The audit was cancelled.", 499));
    };
    if (signal?.aborted) abortHandler();
    else signal?.addEventListener("abort", abortHandler, { once: true });
  });

  try {
    return await Promise.race([scanPromise, timeoutPromise, cancellationPromise]);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abortHandler);
    await scanPromise.catch(() => {});
    release();
  }
}

export function sanitizePreviewHtml(html) {
  return sanitizeHtml(html);
}

export async function getScannerDiagnostics() {
  try {
    await verifyAxeInstallation();
  } catch {
    return {
      status: "unavailable",
      message: "axe-core is unavailable. Confirm the backend production dependencies were installed from the lockfile.",
    };
  }

  const customExecutable = browserExecutablePath();
  const executable = customExecutable ?? chromium.executablePath();
  const accessMode = fsConstants.R_OK | (process.platform === "win32" ? 0 : fsConstants.X_OK);
  try {
    await access(executable, accessMode);
    return { status: "available", message: null };
  } catch {
    return {
      status: "unavailable",
      message: customExecutable
        ? "CHROMIUM_EXECUTABLE_PATH does not point to a readable, executable Chromium binary. Clear it to use Playwright's bundled browser."
        : "Playwright cannot find its Chromium executable. Build the backend from the repository Dockerfile so the matching browser is included in the runtime image.",
    };
  }
}

export async function getScannerStatus() {
  return (await getScannerDiagnostics()).status;
}

export function getScannerRuntime() {
  return { ...runtime, activeScans: queue.active, queuedScans: queue.waiting.length };
}

export const scannerConfiguration = Object.freeze({
  timeoutMs: SCAN_TIMEOUT_MS,
  navigationTimeoutMs: NAVIGATION_TIMEOUT_MS,
  activeScans: MAX_ACTIVE_SCANS,
  queuedScans: MAX_QUEUED_SCANS,
  storedAudits: MAX_STORED_AUDITS,
  tags: WCAG_TAGS,
  limits: scannerLimits,
});

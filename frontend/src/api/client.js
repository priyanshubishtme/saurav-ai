const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? "/api";

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    credentials: "include",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = new Error(body?.error?.message ?? `The API returned ${response.status}.`);
    error.code = body?.error?.code ?? "REQUEST_FAILED";
    error.status = response.status;
    error.requestId = body?.error?.requestId ?? body?.requestId ?? response.headers.get("X-Request-Id");
    error.data = body;
    throw error;
  }

  return body;
}

export function getHealth(options) {
  return request("/health", options);
}

export function getCurrentUser(options) {
  return request("/auth/me", options);
}

export function registerAccount(payload, options = {}) {
  return request("/auth/register", { ...options, method: "POST", body: JSON.stringify(payload) });
}

export function loginAccount(payload, options = {}) {
  return request("/auth/login", { ...options, method: "POST", body: JSON.stringify(payload) });
}

export function logoutAccount(options = {}) {
  return request("/auth/logout", { ...options, method: "POST" });
}

function postAudit(path, payload, options = {}) {
  return request(path, { ...options, method: "POST", body: JSON.stringify(payload) });
}

export function createUrlAudit(payload, options = {}) {
  return postAudit("/audits/url", payload, options);
}

export function createHtmlAudit(payload, options = {}) {
  return postAudit("/audits/html", payload, options);
}

export function getAudits(options = {}) {
  const limit = options.limit ?? 25;
  return request(`/audits/?limit=${limit}`, options);
}

export function getAudit(id, options) {
  return request(`/audits/${encodeURIComponent(id)}`, options);
}

export function getAuditRepairs(id, options) {
  return request(`/audits/${encodeURIComponent(id)}/repairs`, options);
}

export function getControlledArtifacts(options) {
  return request("/artifacts/", options);
}

export function createControlledArtifact(payload, options = {}) {
  return request("/artifacts/", { ...options, method: "POST", body: JSON.stringify(payload) });
}

export function getControlledArtifact(id, options) {
  return request(`/artifacts/${encodeURIComponent(id)}`, options);
}

export async function downloadControlledArtifact(id, options = {}) {
  const response = await fetch(`${API_BASE_URL}/artifacts/${encodeURIComponent(id)}/download`, {
    ...options,
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message ?? `The API returned ${response.status}.`);
  }
  const downloadUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `accessz-${id}.html`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

export function getVerifications(id, options) {
  return request(`/audits/${encodeURIComponent(id)}/verifications`, options);
}

export function verifyAudit(id, options = {}) {
  return request(`/audits/${encodeURIComponent(id)}/verify`, { ...options, method: "POST" });
}

export function verifyRepair(id, options = {}) {
  return request(`/repairs/${encodeURIComponent(id)}/verify`, { ...options, method: "POST" });
}

export async function downloadAuditReport(id, format, options = {}) {
  if (!["json", "html"].includes(format)) throw new Error("Unsupported report format.");
  const response = await fetch(`${API_BASE_URL}/audits/${encodeURIComponent(id)}/report.${format}`, {
    ...options,
    credentials: "include",
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    const error = new Error(body?.error?.message ?? `The API returned ${response.status}.`);
    error.code = body?.error?.code ?? "REQUEST_FAILED";
    throw error;
  }
  const downloadUrl = URL.createObjectURL(await response.blob());
  const anchor = document.createElement("a");
  anchor.href = downloadUrl;
  anchor.download = `accessz-audit-${id}.${format}`;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(downloadUrl), 0);
}

export function suggestRepair(payload, options = {}) {
  return request("/repairs/suggest", { ...options, method: "POST", body: JSON.stringify(payload) });
}

export function applyRepair(id, manualReviewConfirmed, review, options = {}) {
  return request(`/repairs/${encodeURIComponent(id)}/apply`, {
    ...options,
    method: "POST",
    body: JSON.stringify({ manualReviewConfirmed, ...review }),
  });
}

export function rejectRepair(id, options = {}) {
  return request(`/repairs/${encodeURIComponent(id)}/reject`, { ...options, method: "POST" });
}

export function rollbackRepair(id, options = {}) {
  return request(`/repairs/${encodeURIComponent(id)}/rollback`, { ...options, method: "POST" });
}

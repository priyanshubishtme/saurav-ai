const STORAGE_KEY = "a11ypilot-audit-history-v1";
const MAX_HISTORY_RECORDS = 20;

function getLocalStorage() {
  try {
    return { storage: globalThis.localStorage, warning: "" };
  } catch {
    return { storage: null, warning: "Browser-local history is unavailable in this browser session." };
  }
}

function readRecords() {
  const { storage, warning } = getLocalStorage();
  if (!storage) return { storage: null, records: [], warning };

  try {
    const stored = storage.getItem(STORAGE_KEY);
    if (!stored) return { storage, records: [], warning: "" };
    const parsed = JSON.parse(stored);
    if (!Array.isArray(parsed)) {
      return { storage, records: [], warning: "Browser-local history is unavailable or could not be read." };
    }

    const records = parsed.filter((record) =>
      record && typeof record.id === "string" && typeof record.createdAt === "string"
      && record.summary && Array.isArray(record.violations));
    const hasInvalidRecords = records.length !== parsed.length;
    return {
      storage,
      records,
      warning: hasInvalidRecords ? "Some invalid browser history entries were skipped." : "",
    };
  } catch {
    return { storage, records: [], warning: "Browser-local history is unavailable or could not be read." };
  }
}

function newestFirst(records) {
  return records.sort((left, right) => right.createdAt.localeCompare(left.createdAt));
}

export function getLocalAuditHistory(limit = MAX_HISTORY_RECORDS) {
  const { records, warning } = readRecords();
  return {
    audits: newestFirst(records).slice(0, limit).map((audit) => ({ ...audit, historyStorage: "browser_local" })),
    warning,
  };
}

export function getLocalAudit(id) {
  const { records, warning } = readRecords();
  const audit = records.find((record) => record.id === id);
  return {
    audit: audit ? { ...audit, historyStorage: "browser_local" } : null,
    warning,
  };
}

export function saveAuditToLocalHistory(audit) {
  if (!audit || typeof audit.id !== "string" || typeof audit.createdAt !== "string"
    || !audit.summary || !Array.isArray(audit.violations)) {
    return { saved: false, warning: "This audit result could not be saved to browser-local history." };
  }

  const { storage, records, warning: readWarning } = readRecords();
  if (!storage) return { saved: false, warning: readWarning };

  const nextRecords = [audit, ...records.filter((record) => record.id !== audit.id)];
  while (nextRecords.length > MAX_HISTORY_RECORDS) nextRecords.pop();

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
    return { saved: true, warning: readWarning };
  } catch {
    while (nextRecords.length > 1) {
      nextRecords.pop();
      try {
        storage.setItem(STORAGE_KEY, JSON.stringify(nextRecords));
        return {
          saved: true,
          warning: "Browser storage is nearly full; older local audits were removed to save this result.",
        };
      } catch {
        continue;
      }
    }
    return {
      saved: false,
      warning: "Browser storage is full or unavailable. The scan completed, but its result was not saved locally.",
    };
  }
}

export function mergeAuditHistory(serverAudits, localAudits, limit = 25) {
  const byId = new Map();
  for (const audit of localAudits) byId.set(audit.id, { ...audit, historyStorage: "browser_local" });
  for (const audit of serverAudits) {
    const localAudit = byId.get(audit.id);
    byId.set(audit.id, localAudit
      ? { ...audit, ...localAudit, historyStorage: "browser_local" }
      : audit);
  }
  return newestFirst([...byId.values()]).slice(0, limit);
}

export function clearLocalAuditHistory() {
  const { storage } = getLocalStorage();
  if (!storage) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

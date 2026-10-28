import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getLocalAudit,
  getLocalAuditHistory,
  mergeAuditHistory,
  saveAuditToLocalHistory,
} from "./auditHistory.js";
import {
  readThemePreference,
  savePreferences,
  saveThemePreference,
} from "./preferences.js";

const createAudit = (id, createdAt = "2026-10-27T12:00:00.000Z") => ({
  id,
  createdAt,
  summary: { score: 80 },
  violations: [],
  previewHtml: "<main>Saved locally</main>",
});

describe("browser-local audit history", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("persists full audit results and exposes them as browser-local", () => {
    const audit = createAudit("audit-1");

    expect(saveAuditToLocalHistory(audit)).toMatchObject({ saved: true });
    expect(getLocalAudit("audit-1").audit).toMatchObject({
      ...audit,
      historyStorage: "browser_local",
    });
    expect(getLocalAuditHistory().audits).toHaveLength(1);
  });

  it("keeps the newest 20 records and puts the newest audit first", () => {
    for (let index = 0; index < 23; index += 1) {
      saveAuditToLocalHistory(createAudit(`audit-${index}`, `2026-10-${String(index + 1).padStart(2, "0")}T12:00:00.000Z`));
    }

    const history = getLocalAuditHistory();
    expect(history.audits).toHaveLength(20);
    expect(history.audits[0].id).toBe("audit-22");
    expect(history.audits.at(-1).id).toBe("audit-3");
  });

  it("merges browser history with API history without duplicate audit IDs", () => {
    const serverAudit = { ...createAudit("audit-1"), summary: { score: 77 } };
    const localAudit = { ...createAudit("audit-1"), previewHtml: "<main>Full result</main>" };
    const merged = mergeAuditHistory([serverAudit], [localAudit, createAudit("audit-2")]);

    expect(merged).toHaveLength(2);
    expect(merged.find((audit) => audit.id === "audit-1")).toMatchObject({
      summary: { score: 80 },
      previewHtml: "<main>Full result</main>",
      historyStorage: "browser_local",
    });
  });

  it("returns a warning instead of throwing when browser storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("Storage denied", "SecurityError");
    });

    expect(saveAuditToLocalHistory(createAudit("audit-denied"))).toMatchObject({
      saved: false,
      warning: expect.stringContaining("unavailable"),
    });
    expect(getLocalAuditHistory()).toMatchObject({ audits: [], warning: expect.stringContaining("unavailable") });
    expect(readThemePreference()).toBe("light");
    expect(savePreferences({ defaultLevel: "AA" })).toBe(false);
    expect(saveThemePreference("dark")).toBe(false);
  });

  it("recovers from quota errors by dropping older local records first", () => {
    const originalSetItem = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
      const records = JSON.parse(value);
      if (records.length > 1) throw new DOMException("Quota exceeded", "QuotaExceededError");
      return originalSetItem.call(this, key, value);
    });

    saveAuditToLocalHistory(createAudit("older"));
    expect(saveAuditToLocalHistory(createAudit("newer"))).toMatchObject({
      saved: true,
      warning: expect.stringContaining("older local audits were removed"),
    });
    expect(getLocalAuditHistory().audits.map(({ id }) => id)).toEqual(["newer"]);
  });
});

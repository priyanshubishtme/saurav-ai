import { afterEach, describe, expect, it, vi } from "vitest";

const { launchChromium } = vi.hoisted(() => ({ launchChromium: vi.fn() }));

vi.mock("playwright", () => ({ chromium: { launch: launchChromium } }));

const { getScannerRuntime, scanAudit } = await import("./scanner.js");

describe("scanner Chromium launch failures", () => {
  afterEach(() => {
    launchChromium.mockReset();
    vi.restoreAllMocks();
  });

  it("returns a production-safe launch error and logs diagnostics without leaking URLs", async () => {
    launchChromium.mockRejectedValue(Object.assign(
      new Error("browser process failed for https://user:secret@example.test/path"),
      { code: "ENOENT" },
    ));
    const logFailure = vi.spyOn(console, "error").mockImplementation(() => {});

    await expect(scanAudit({
      sourceType: "html",
      html: "<main><h1>Launch failure fixture</h1></main>",
      projectName: "Launch failure fixture",
      wcagLevel: "AA",
      includeBestPractices: false,
    })).rejects.toMatchObject({
      code: "CHROMIUM_LAUNCH_FAILED",
      status: 503,
      message: expect.stringContaining("required Linux shared library may be missing"),
    });

    expect(logFailure).toHaveBeenCalledWith("Accessibility scanner operation failed:", expect.objectContaining({
      phase: "browser_launch",
      errorCode: "ENOENT",
      errorMessage: "browser process failed for https://example.test/[redacted]",
    }));
    expect(getScannerRuntime()).toMatchObject({ activeBrowsers: 0, activePreviews: 0, activeScans: 0 });
  });
});

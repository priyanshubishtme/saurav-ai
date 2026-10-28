import { describe, expect, it } from "vitest";
import { scanAudit } from "./scanner.js";
import { GroqProvider } from "./ai/groqProvider.js";
import { BulkRepairService } from "./repairs/bulkRepairService.js";
import { RepairService } from "./repairs/repairService.js";

const fixture = `<!doctype html><html lang="en"><head><title>Repair fixture</title></head><body><main>
  <h1>Account</h1>
  <button id="menu" type="button"><svg aria-hidden="true"><path d="M0 0"></path></svg></button>
  <img id="photo" src="unknown.png">
  <input id="email" type="email" name="email">
</main></body></html>`;

async function scan(html) {
  return scanAudit({ sourceType: "html", html, projectName: "Bulk repair test", wcagLevel: "AA", includeBestPractices: false });
}

describe("bulk repair candidate workflow", () => {
  it("combines safe button, image, and form-label repairs and rescans the real combined source", async () => {
    const baseline = await scan(fixture);
    const artifact = {
      id: "9b48f6ba-c40c-4f48-a3ae-d544d21fe530",
      auditId: baseline.id,
      name: "bulk-fixture.html",
      html: fixture,
      additionalCss: "",
      version: 1,
    };
    const repairs = new RepairService({ provider: new GroqProvider({ apiKey: "" }) });
    const bulk = new BulkRepairService({ repairService: repairs, scan });
    const draft = await bulk.propose({ audit: baseline, artifact, userId: "tester" });

    expect(draft.changes.map(({ violationId }) => violationId)).toEqual(expect.arrayContaining(["button-name", "image-alt", "label"]));
    expect(draft.repairedHtml).toContain("Open Menu");
    expect(draft.repairedHtml).toContain('alt="Demo image description"');
    expect(draft.repairedHtml).toContain('<label for="email">Email');
    expect(draft.after.findings.some((finding) => ["button-name", "image-alt", "label"].includes(finding.id))).toBe(false);
    expect(draft.comparison.counts.resolved).toBeGreaterThanOrEqual(3);
    expect(draft.changes.every((change) => change.manualReviewRequired)).toBe(true);
    expect(artifact.html).toBe(fixture);
  }, 30_000);

  it("refuses to combine overlapping nested button-name and image-alt patches", async () => {
    const html = '<!doctype html><html lang="en"><head><title>Overlap test</title></head><body><button id="menu"><img id="icon" src="icon.svg"></button></body></html>';
    const baseline = await scan(html);
    const artifact = {
      id: "5010a739-1493-4b12-ae29-fcc909e755ec",
      auditId: baseline.id,
      name: "overlap.html",
      html,
      additionalCss: "",
      version: 1,
    };
    const repairs = new RepairService({ provider: new GroqProvider({ apiKey: "" }) });
    const bulk = new BulkRepairService({ repairService: repairs, scan });
    const draft = await bulk.propose({ audit: baseline, artifact, userId: "tester" });

    expect(draft.changes).toHaveLength(0);
    expect(draft.skipped.filter(({ reason }) => /overlaps another selected element/i.test(reason))).toHaveLength(2);
    expect(draft.repairedHtml).toBe(html);
  }, 30_000);
});

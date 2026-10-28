import { randomUUID } from "node:crypto";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";
import { BulkRepairService } from "./repairs/bulkRepairService.js";

const userId = "000000000000000000000001";
const original = '<!doctype html><html lang="en"><head><title>API test</title></head><body><main><button id="menu"></button></main></body></html>';
const fixedButton = '<button id="menu" aria-label="Open menu">Open Menu</button>';

const auth = {
  ready: () => true,
  sessionMiddleware: () => (_request, _response, next) => next(),
  requireReady: (_request, _response, next) => next(),
  requireOrigin: (_request, _response, next) => next(),
  requireUser: (request, _response, next) => { request.user = { id: userId }; next(); },
  loginLimiter: (_request, _response, next) => next(),
  register: (_request, response) => response.status(501).end(),
  login: (_request, response) => response.status(501).end(),
  logout: (_request, response) => response.status(501).end(),
  me: (_request, response) => response.status(501).end(),
};

function createFixture() {
  const auditId = randomUUID();
  const artifactId = randomUUID();
  const buttonFinding = {
    id: "button-name",
    impact: "serious",
    description: "Buttons require names.",
    help: "Buttons must have discernible text.",
    helpUrl: "https://example.test/button-name",
    wcagCriteria: ["WCAG 4.1.2"],
    nodeCount: 1,
    nodes: [{ selector: "#menu", targets: ["#menu"], html: '<button id="menu"></button>', failureSummary: "Add a name.", any: [], all: [], none: [], relatedNodes: [] }],
  };
  const audit = {
    id: auditId,
    sourceType: "html",
    source: "API bulk fixture",
    projectName: "API bulk fixture",
    status: "completed",
    createdAt: new Date().toISOString(),
    durationMs: 1,
    wcagLevel: "AA",
    includeBestPractices: false,
    summary: { score: 90, violations: 1, passes: 1, incomplete: 0, inapplicable: 0 },
    violations: [buttonFinding],
    passes: [],
    incomplete: [],
    inapplicable: [],
    scanLimitations: [],
  };
  const artifact = { id: artifactId, auditId, name: "api.html", html: original, additionalCss: "", version: 1 };
  const repairs = {
    getStatus: () => ({ provider: "groq", status: "not_configured" }),
    suggest: async () => ({
      id: randomUUID(),
      violationId: "button-name",
      selector: "#menu",
      originalCode: '<button id="menu"></button>',
      proposedCode: fixedButton,
      explanation: "Add an action label based on explicit evidence.",
      accessibilityRationale: "A button needs an accessible name.",
      assumptions: ["Confirm the action wording."],
      manualReviewRequired: true,
      applicable: true,
      source: "deterministic",
    }),
  };
  const scan = async (input) => {
    const fixed = input.html.includes("Open Menu");
    return {
      id: randomUUID(),
      sourceType: "html",
      source: "API bulk fixture",
      projectName: "API bulk fixture",
      status: "completed",
      createdAt: new Date().toISOString(),
      durationMs: 1,
      wcagLevel: "AA",
      includeBestPractices: false,
      summary: { score: fixed ? 100 : 90, violations: fixed ? 0 : 1, passes: 1, incomplete: 0, inapplicable: 0 },
      violations: fixed ? [] : [buttonFinding],
      passes: [],
      incomplete: [],
      inapplicable: [],
      scanLimitations: [],
    };
  };
  const bulkRepairs = new BulkRepairService({ repairService: repairs, scan });
  const app = createApp({ auth, scan, repairs, bulkRepairs, repository: null, auditStore: new Map([[auditId, audit]]), controlledArtifactStore: new Map([[artifactId, artifact]]) });
  return { app, audit, artifact };
}

describe("bulk repair API", () => {
  it("validates, applies to a controlled artifact, rescans, and restores the saved original", async () => {
    const { app, audit, artifact } = createFixture();
    const invalid = await request(app).post("/api/repairs/bulk/suggest").send({ auditId: "bad", artifactId: artifact.id });
    expect(invalid.status).toBe(400);

    const generated = await request(app).post("/api/repairs/bulk/suggest").send({ auditId: audit.id, artifactId: artifact.id });
    expect(generated.status).toBe(201);
    expect(generated.body.draft.changes).toHaveLength(1);
    expect(generated.body.draft.after.violationCount).toBe(0);
    const draft = generated.body.draft;

    const applied = await request(app).post("/api/repairs/bulk/apply").send({ draftId: draft.id, patchHash: draft.patchHash, artifactVersion: 1, confirmed: true });
    expect(applied.status).toBe(200);
    expect(applied.body.artifact.html).toContain("Open Menu");
    expect(applied.body.artifact.version).toBe(2);

    const verified = await request(app).post(`/api/repairs/bulk/${draft.id}/verify`);
    expect(verified.status).toBe(200);
    expect(verified.body.verification.status).toBe("verified");

    const rolledBack = await request(app).post(`/api/artifacts/${artifact.id}/bulk-rollback`).send({ draftId: draft.id });
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.artifact.html).toBe(original);
    expect(rolledBack.body.artifact.version).toBe(3);
  });
});

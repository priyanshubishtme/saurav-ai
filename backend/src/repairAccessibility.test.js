import { describe, expect, it, vi } from "vitest";
import { RepairService } from "./repairs/repairService.js";
import { scanAudit } from "./scanner.js";
import {
  applyScopedReplacement,
  deterministicProposal,
  normalizeProposal,
  prepareFindingContext,
} from "./repairs/repairEngine.js";

const proposal = (proposedCode) => ({
  proposedCode,
  explanation: "Apply the selected accessibility correction.",
  accessibilityRationale: "Users need a clear accessible name.",
  expectedVerificationCriteria: ["Confirm the correction with a real controlled-artifact rescan."],
  assumptions: [],
  manualReviewRequired: true,
});

describe("evidence-based accessibility repair templates", () => {
  it("adds visible demo text and aria-label to an unnamed icon button without changing its icon", () => {
    const original = '<button type="button" class="icon"><svg aria-hidden="true"><path d="M0 0"></path></svg></button>';
    const result = deterministicProposal({ ruleId: "button-name", originalCode: original });

    expect(result.proposedCode).toBe('<button type="button" class="icon" aria-label="Demo menu button"><svg aria-hidden="true"><path d="M0 0"></path></svg>Demo Menu</button>');
    expect(result).toMatchObject({ applicable: true, manualReviewRequired: true, demoContent: true });
  });

  it("uses explicit menu evidence and does not duplicate text on already named controls", () => {
    const menu = deterministicProposal({
      ruleId: "button-name",
      originalCode: '<button type="button" aria-controls="main-menu" aria-expanded="false"><svg aria-hidden="true"></svg></button>',
    });
    expect(menu.proposedCode).toContain('aria-label="Open menu"');
    expect(menu.proposedCode).toContain(">Open Menu</button>");
    expect(menu.demoContent).toBe(false);
    expect(menu.assumptions.join(" ")).toMatch(/human must confirm/i);

    const existing = '<button type="button">Save changes</button>';
    expect(deterministicProposal({ ruleId: "button-name", originalCode: existing })).toMatchObject({
      proposedCode: existing,
      applicable: false,
    });
    const namedLink = '<a href="/profile">Profile</a>';
    expect(deterministicProposal({ ruleId: "link-name", originalCode: namedLink })).toMatchObject({
      proposedCode: namedLink,
      applicable: false,
    });
    const labeledField = '<input id="email" type="email" aria-label="Email">';
    expect(deterministicProposal({ ruleId: "label", originalCode: labeledField })).toMatchObject({
      proposedCode: labeledField,
      applicable: false,
    });
    const describedImage = '<img src="diagram.png" alt="Process diagram">';
    expect(deterministicProposal({ ruleId: "image-alt", originalCode: describedImage })).toMatchObject({
      proposedCode: describedImage,
      applicable: false,
    });
  });

  it("repairs explicitly role-based button and link controls", () => {
    const button = deterministicProposal({
      ruleId: "button-name",
      originalCode: '<div role="button" data-action="open-menu"><svg aria-hidden="true"></svg></div>',
    });
    expect(button.proposedCode).toContain('aria-label="Open menu"');
    expect(button.proposedCode).toContain(">Open Menu</div>");
    expect(() => normalizeProposal(proposal(button.proposedCode), '<div role="button" data-action="open-menu"><svg aria-hidden="true"></svg></div>', "button-name"))
      .not.toThrow();

    const link = deterministicProposal({ ruleId: "link-name", originalCode: '<span role="link"></span>' });
    expect(link.proposedCode).toContain('aria-label="Demo link"');
    expect(link.proposedCode).toContain(">Demo link</span>");
  });

  it("adds conservative alternative text and preserves explicit decorative intent", () => {
    const unknown = deterministicProposal({ ruleId: "image-alt", originalCode: '<img id="hero" src="image.png">' });
    expect(unknown.proposedCode).toBe('<img id="hero" src="image.png" alt="Demo image description">');
    expect(unknown).toMatchObject({ demoContent: true, manualReviewRequired: true, applicable: true });

    const captioned = prepareFindingContext({
      sourceType: "html",
      previewHtml: '<figure><img id="photo" src="image.png"><figcaption>AccessZ team at the launch</figcaption></figure>',
    }, {
      id: "image-alt",
      description: "Images require alternative text.",
      nodes: [{ selector: "#photo", html: '<img id="photo" src="image.png">', failureSummary: "Add alternative text." }],
    }, 0);
    expect(deterministicProposal({ ruleId: "image-alt", originalCode: captioned.targetCode, context: captioned.context }).proposedCode)
      .toContain('alt="AccessZ team at the launch"');

    const decorative = deterministicProposal({ ruleId: "image-alt", originalCode: '<img role="presentation" src="ornament.svg">' });
    expect(decorative.proposedCode).toContain('alt=""');
    expect(decorative.demoContent).toBe(false);
  });

  it("adds a visible associated label around an unchanged input, including inputs without IDs", () => {
    const original = '<input id="username" type="text" name="username" autocomplete="username">';
    const result = deterministicProposal({ ruleId: "label", originalCode: original });
    expect(result.proposedCode).toBe('<label for="username">Username <input id="username" type="text" name="username" autocomplete="username"></label>');
    expect(result.proposedCode).not.toContain("aria-label");
    expect(result.manualReviewRequired).toBe(true);

    const source = `<!doctype html><html><body><main>${original}</main></body></html>`;
    const applied = applyScopedReplacement(source, "#username", original, result.proposedCode, "label");
    expect(applied).toContain(result.proposedCode);

    const noId = deterministicProposal({ ruleId: "label", originalCode: '<input type="text">' });
    expect(noId.proposedCode).toBe('<label>Demo form label <input type="text"></label>');
    expect(noId).toMatchObject({ demoContent: true, applicable: true });
  });

  it("reuses visible nearby label text without adding duplicate visible wording", () => {
    const audit = {
      sourceType: "html",
      previewHtml: '<main><label>Contact</label><input id="email" type="email"></main>',
    };
    const violation = {
      id: "label",
      description: "Form elements need labels.",
      nodes: [{ selector: "#email", html: '<input id="email" type="email">', failureSummary: "Add a label." }],
    };
    const finding = prepareFindingContext(audit, violation, 0);
    const suggestion = deterministicProposal({ ruleId: "label", originalCode: finding.targetCode, nearbyLabelText: finding.nearbyLabelText });
    expect(suggestion.proposedCode).toContain('aria-label="Contact"');
    expect(suggestion.proposedCode).not.toContain("<label");
    expect(applyScopedReplacement(audit.previewHtml, finding.repairSelector, finding.targetCode, suggestion.proposedCode, "label", {
      nearbyLabelText: finding.nearbyLabelText,
    })).toContain('aria-label="Contact"');
  });

  it("repairs nameless links, leaves named links alone, and flags demo language", () => {
    const inferred = deterministicProposal({ ruleId: "link-name", originalCode: '<a href="/account/settings"></a>' });
    expect(inferred.proposedCode).toContain(">Settings</a>");
    expect(inferred.proposedCode).toContain('aria-label="Settings"');
    expect(inferred.demoContent).toBe(false);

    const demoLink = deterministicProposal({ ruleId: "link-name", originalCode: '<a href="#"></a>' });
    expect(demoLink.proposedCode).toContain("Demo link");
    expect(demoLink.demoContent).toBe(true);

    const named = '<a href="/about">About us</a>';
    expect(deterministicProposal({ ruleId: "link-name", originalCode: named })).toMatchObject({ proposedCode: named, applicable: false });

    const language = deterministicProposal({ ruleId: "html-has-lang", originalCode: "<html><head></head><body></body></html>" });
    expect(language.proposedCode).toContain('lang="en"');
    expect(language).toMatchObject({ demoContent: true, manualReviewRequired: true, applicable: true });
  });

  it("patches only the html start tag when axe truncated a long document-language finding", () => {
    const source = `<!doctype html><html><head></head><body><main>${"x".repeat(2_500)}</main></body></html>`;
    const audit = {
      sourceType: "html",
      previewHtml: source,
    };
    const violation = {
      id: "html-has-lang",
      description: "The html element must have a lang attribute.",
      nodes: [{ selector: "html", html: source.replace(/^<!doctype html>/i, "").slice(0, 2_000), failureSummary: "Add lang." }],
    };
    const finding = prepareFindingContext(audit, violation, 0);
    const suggestion = deterministicProposal({ ruleId: violation.id, originalCode: finding.targetCode });
    expect(finding.targetCode).toBe("<html>");
    expect(suggestion.proposedCode).toBe('<html lang="en">');
    const applied = applyScopedReplacement(source, finding.repairSelector, finding.targetCode, suggestion.proposedCode, violation.id);
    expect(applied).toContain('<html lang="en">');
    expect(applied).toContain("x".repeat(2_500));
  });

  it("confirms the visible form-label patch with an actual post-repair accessibility scan", async () => {
    const baseline = await scanAudit({
      sourceType: "html",
      html: '<!doctype html><html><body><main><h1>Account</h1><input id="username" name="username" type="text"></main></body></html>',
      projectName: "Form-label repair fixture",
      wcagLevel: "AA",
      includeBestPractices: false,
    });
    const labelViolation = baseline.violations.find((item) => item.id === "label");
    expect(labelViolation).toBeTruthy();
    const finding = prepareFindingContext(baseline, labelViolation, 0);
    const suggestion = deterministicProposal({
      ruleId: labelViolation.id,
      originalCode: finding.targetCode,
      nearbyLabelText: finding.nearbyLabelText,
      context: finding.context,
    });
    const updatedHtml = applyScopedReplacement(
      baseline.previewHtml,
      finding.repairSelector,
      finding.targetCode,
      suggestion.proposedCode,
      labelViolation.id,
    );
    const followUp = await scanAudit({
      sourceType: "html",
      html: updatedHtml,
      projectName: "Form-label repair fixture",
      wcagLevel: "AA",
      includeBestPractices: false,
    });
    const remaining = followUp.violations.find((item) => item.id === "label");
    expect(remaining?.nodes.some((node) => node.selector.includes("username")) ?? false).toBe(false);
    expect(updatedHtml).toContain('<label for="username">Username <input id="username" name="username" type="text"></label>');
  }, 90_000);

  it("rejects unsupported image guesses and falls back when Groq returns malformed data", async () => {
    const rejected = normalizeProposal(proposal('<img src="image.png" alt="A golden retriever on a beach">'), '<img src="image.png">', "image-alt");
    expect(rejected).toMatchObject({ applicable: false, rejectionReason: "UNSUPPORTED_REPAIR_TEXT" });
    expect(rejected.proposedCode).toBe('<img src="image.png">');

    const audit = {
      id: "bf0a7f10-8f81-47e1-a21d-c4d7a170003e",
      sourceType: "html",
      previewHtml: '<main><button><svg aria-hidden="true"></svg></button></main>',
      violations: [{
        id: "button-name",
        impact: "serious",
        description: "Buttons need accessible names.",
        wcagCriteria: ["WCAG 2.1 A"],
        nodes: [{ selector: "button", html: '<button><svg aria-hidden="true"></svg></button>', failureSummary: "Add a name." }],
      }],
    };
    const artifact = { id: "da52ac2d-a62c-4c36-aeb1-13b843a2e3bc", name: "fixture.html", auditId: audit.id, html: audit.previewHtml, version: 1 };
    const provider = {
      getStatus: () => ({ provider: "groq", status: "configured", model: "test-model" }),
      suggest: vi.fn().mockResolvedValue({ invalid: "not the required response" }),
    };
    const service = new RepairService({ provider });
    const repair = await service.suggest({
      auditStore: new Map([[audit.id, audit]]),
      repairStore: new Map(),
      controlledArtifacts: new Map([[artifact.id, artifact]]),
      input: { auditId: audit.id, artifactId: artifact.id, violationId: "button-name", nodeIndex: 0 },
    });
    expect(repair).toMatchObject({ source: "deterministic", applicable: true, demoContent: true });
    expect(repair.proposedCode).toContain("Demo Menu");
    expect(repair.fallbackReason).toMatch(/invalid suggestion/i);
  });
});

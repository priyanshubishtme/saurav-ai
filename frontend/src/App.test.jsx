import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App from "./App.jsx";
import { saveAuditToLocalHistory } from "./utils/auditHistory.js";

const audit = {
  id: "audit-123",
  sourceType: "html",
  source: "Regression fixture",
  projectName: "Regression fixture",
  createdAt: "2026-03-01T12:00:00.000Z",
  durationMs: 1200,
  wcagLevel: "AA",
  engine: { name: "Playwright + Chromium + axe-core", axeVersion: "4.10.3" },
  summary: {
    score: 80,
    scoreBreakdown: {
      failedRuleCount: 1,
      formula: "100 × (tested rule weight − failing rule weight) ÷ tested rule weight.",
    },
    violations: 1,
    violationNodes: 1,
    passes: 2,
    incomplete: 1,
    inapplicable: 0,
  },
  violations: [
    {
      id: "image-alt",
      impact: "serious",
      description: "Images must have alternative text.",
      help: "Images must have alternate text",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/image-alt",
      wcagCriteria: ["WCAG 2.1 A"],
      nodeCount: 1,
      nodesTruncated: false,
      nodes: [{
        selector: "#sample-image",
        targets: ["#sample-image"],
        html: '<img id="sample-image" src="sample.png">',
        failureSummary: "Add an accessible name.",
        relatedNodes: [],
      }],
    },
    {
      id: "label",
      impact: "serious",
      description: "Form elements must have labels.",
      help: "Form elements must have labels",
      helpUrl: "https://dequeuniversity.com/rules/axe/4.10/label",
      wcagCriteria: ["WCAG 2.1 A"],
      nodeCount: 1,
      nodesTruncated: false,
      nodes: [{
        selector: "#email",
        targets: ["#email"],
        html: '<input id="email" type="email">',
        failureSummary: "Add a label.",
        relatedNodes: [],
      }],
    },
  ],
  passes: [],
  incomplete: [],
  inapplicable: [],
  keyboardAudit: { status: "review_candidates_only", capturedFocus: [], candidates: [] },
  previewHtml: "<main><h1>Regression fixture</h1><img id='sample-image' src='data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs='><label>Contact</label><input id='email' type='email'></main>",
  scanLimitations: ["Manual assessment is still required."],
  blockedRequests: [],
};
const contrastAudit = {
  ...audit,
  violations: [...audit.violations, {
    id: "color-contrast",
    impact: "serious",
    description: "Text may not have sufficient contrast.",
    help: "Ensure the contrast ratio is sufficient",
    helpUrl: "https://example.test/color-contrast",
    wcagCriteria: ["WCAG 2.1 AA"],
    nodeCount: 1,
    nodesTruncated: false,
    nodes: [{
      selector: "#contrast-copy",
      targets: ["#contrast-copy"],
      html: '<p id="contrast-copy" class="copy">Readable text</p>',
      failureSummary: "Contrast is insufficient.",
      relatedNodes: [],
    }],
  }],
};

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: async () => payload,
  };
}

function mockApi({
  audits = [],
  failScans = 0,
  failHistory = false,
  unavailableAuditIds = [],
  pendingScan,
  repairs = [],
  suggestionSource = "deterministic",
  includeCssPatch = false,
  verifications = [],
  verificationResult,
  unauthenticated = false,
} = {}) {
  let failures = failScans;
  const savedAudits = new Map(audits.map((record) => [record.id, record]));
  vi.stubGlobal("fetch", vi.fn((input, options = {}) => {
    const path = new URL(String(input), "http://localhost").pathname;
    const method = options.method ?? "GET";

    if (path.endsWith("/health")) {
      return Promise.resolve(response({
        status: "ok",
        service: "accessz-api",
        capabilities: { aiSuggestions: { provider: "groq", status: "not_configured", model: null } },
        scanner: { status: "available", engine: "Playwright + Chromium + axe-core" },
      }));
    }
    if (path.endsWith("/artifacts/") && method === "GET") {
      return Promise.resolve(response({ artifacts: [{
        id: "artifact-123",
        name: "Regression fixture",
        auditId: audit.id,
        version: 1,
        createdAt: audit.createdAt,
      }] }));
    }
    if (path.endsWith("/auth/me")) {
      if (unauthenticated) return Promise.resolve(response({ error: { code: "AUTH_REQUIRED", message: "Sign in to access this resource." } }, 401));
      return Promise.resolve(response({ user: { id: "user-1", name: "Test User", email: "test@example.com", username: "testuser" } }));
    }
    if (path.endsWith("/auth/login") && method === "POST") {
      return Promise.resolve(response({ user: { id: "user-1", name: "Test User", email: "test@example.com", username: "testuser" } }));
    }
    if (path.endsWith("/auth/register") && method === "POST") {
      return Promise.resolve(response({ user: { id: "user-1", name: "Test User", email: "test@example.com", username: "testuser" } }, 201));
    }
    if (path.endsWith("/auth/logout") && method === "POST") return Promise.resolve(response({ status: "logged_out" }));
    if (path.endsWith("/audits/html") && method === "POST") {
      const requestPayload = JSON.parse(options.body);
      if (pendingScan) return pendingScan(options.signal);
      if (failures > 0) {
        failures -= 1;
        return Promise.resolve(response({
          error: { code: "TARGET_TIMEOUT", message: "The page did not finish loading before the scan timeout.", requestId: "request-123" },
        }, 504));
      }
      return Promise.resolve(response({ audit: { ...audit, additionalCss: requestPayload.additionalCss } }));
    }
    if (path.endsWith("/audits/url") && method === "POST") {
      const requestPayload = JSON.parse(options.body);
      return Promise.resolve(response({ audit: { ...audit, additionalCss: requestPayload.additionalCss } }));
    }
    const auditRepairsMatch = path.match(/\/audits\/([^/]+)\/repairs$/);
    if (auditRepairsMatch) return Promise.resolve(response({ repairs: auditRepairsMatch[1] === audit.id ? repairs : [] }));
    const verificationsMatch = path.match(/\/audits\/([^/]+)\/verifications$/);
    if (verificationsMatch) return Promise.resolve(response({ verifications: verificationsMatch[1] === audit.id ? verifications : [] }));
    if (path.endsWith("/repairs/repair-123/verify") && method === "POST") {
      return Promise.resolve(response({ verification: verificationResult ?? { ...verifications[0], status: "verified" } }));
    }
    if (path.endsWith("/audits/audit-123/verify") && method === "POST") {
      return Promise.resolve(response({ verification: verificationResult }));
    }
    const auditId = path.match(/\/audits\/([^/]+)$/)?.[1];
    if (auditId && auditId !== "url" && auditId !== "html") {
      if (unavailableAuditIds.includes(auditId)) {
        return Promise.resolve(response({ error: { code: "AUDIT_NOT_FOUND", message: "This audit is no longer available." } }, 404));
      }
      return Promise.resolve(response({ audit: savedAudits.get(auditId) ?? audit }));
    }
    if (path.endsWith("/audits/")) {
      if (failHistory) return Promise.resolve(response({ error: { code: "API_OFFLINE", message: "History API unavailable." } }, 503));
      return Promise.resolve(response({ audits, count: audits.length, storage: "in_memory" }));
    }
    if (path.endsWith("/repairs/suggest") && method === "POST") {
      const requestPayload = JSON.parse(options.body);
      const isContrast = requestPayload.violationId === "color-contrast";
      const repair = {
        id: "repair-123",
        artifactId: "artifact-123",
        artifactVersion: 1,
        patchHash: "a".repeat(64),
        auditId: audit.id,
        violationId: requestPayload.violationId,
        nodeIndex: 0,
        selector: isContrast ? "#contrast-copy" : "#email",
        originalCode: isContrast ? '<p id="contrast-copy" class="copy">Readable text</p>' : '<input id="email" type="email">',
        proposedCode: isContrast
          ? '<p id="contrast-copy" class="copy" style="color: rgb(0, 0, 0);">Readable text</p>'
          : '<input id="email" type="email" aria-label="Contact">',
        explanation: isContrast ? "Add a calculated text-color override." : "Use the adjacent visible label.",
        accessibilityRationale: isContrast ? "The rendered text needs a higher contrast ratio." : "Provide an accessible name.",
        assumptions: isContrast ? ["The override applies only to the controlled artifact."] : ["The adjacent visible label accurately describes the field."],
        manualReviewRequired: true,
        applicable: true,
        source: suggestionSource,
        status: "proposed",
        ...(includeCssPatch && isContrast ? {
          cssPatch: {
            targetSelector: "#contrast-copy",
            originalDeclaration: ".copy { color: #888; }",
            proposedDeclaration: "color: rgb(0, 0, 0);",
            application: "inline CSS override applies only to this controlled artifact; source stylesheet remains unchanged",
            contrastCheck: { ratio: 21, requiredRatio: 4.5, status: "candidate_pass_not_verified", passes: true },
          },
        } : {}),
      };
      return Promise.resolve(response({ repair }));
    }
    if (path.endsWith("/repairs/repair-123/apply") && method === "POST") {
      expect(JSON.parse(options.body)).toMatchObject({
        manualReviewConfirmed: true,
        reviewedPatchHash: "a".repeat(64),
        artifactVersion: 1,
      });
      return Promise.resolve(response({ repair: {
        id: "repair-123",
        source: "deterministic",
        status: "applied",
        applicable: true,
        manualReviewRequired: true,
        originalCode: '<input id="email" type="email">',
        proposedCode: '<input id="email" type="email" aria-label="Contact">',
        explanation: "Use the adjacent visible label.",
        accessibilityRationale: "Provide an accessible name.",
        assumptions: [],
        updatedArtifact: audit.previewHtml.replace('<input id="email" type="email">', '<input id="email" type="email" aria-label="Contact">'),
      } }));
    }
    if (path.endsWith("/repairs/repair-123/rollback") && method === "POST") {
      return Promise.resolve(response({ repair: {
        id: "repair-123",
        source: "deterministic",
        status: "rolled_back",
        applicable: true,
        manualReviewRequired: true,
        originalCode: '<input id="email" type="email">',
        proposedCode: '<input id="email" type="email" aria-label="Contact">',
        explanation: "Use the adjacent visible label.",
        accessibilityRationale: "Provide an accessible name.",
        assumptions: [],
        updatedArtifact: audit.previewHtml,
      } }));
    }
    if (path.endsWith("/repairs/repair-123/reject") && method === "POST") {
      return Promise.resolve(response({ repair: { ...audit.violations[1], id: "repair-123", status: "rejected" } }));
    }
    return Promise.resolve(response({ error: { message: "Not found" } }, 404));
  }));
}

describe("AccessZ audit workflow", () => {
  beforeEach(() => {
    localStorage.clear();
    mockApi();
  });

  it("signs in and signs out through the server-backed session API", async () => {
    const user = userEvent.setup();
    mockApi({ unauthenticated: true });
    window.history.replaceState({}, "", "/login");
    render(<App />);

    await user.type(await screen.findByLabelText("Email or username"), "testuser");
    await user.type(screen.getByLabelText("Password"), "A11yStrongPass123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));
    expect(await screen.findByRole("link", { name: "AccessZ home" })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, options]) => String(url).endsWith("/auth/login")
      && options.credentials === "include")).toBe(true);

    await user.click(screen.getByRole("button", { name: "Sign out" }));
    expect(await screen.findByRole("heading", { name: "Welcome back" })).toBeInTheDocument();
  }, 15_000);

  it("validates and submits account creation to the registration API", async () => {
    const user = userEvent.setup();
    mockApi({ unauthenticated: true });
    window.history.replaceState({}, "", "/signup");
    render(<App />);

    await user.type(await screen.findByLabelText("Full name"), "Test User");
    await user.type(screen.getByLabelText("Username"), "testuser");
    await user.type(screen.getByLabelText("Email address"), "test@example.com");
    await user.type(screen.getByLabelText("Password"), "A11yStrongPass123");
    await user.type(screen.getByLabelText("Confirm password"), "A11yStrongPass123");
    await user.click(screen.getByRole("button", { name: /create account/i }));

    expect(await screen.findByRole("link", { name: "AccessZ home" })).toBeInTheDocument();
    const registration = fetch.mock.calls.find(([url]) => String(url).endsWith("/auth/register"));
    expect(JSON.parse(registration[1].body)).toMatchObject({
      name: "Test User",
      email: "test@example.com",
      username: "testuser",
      confirmPassword: "A11yStrongPass123",
    });
  }, 15_000);

  it("navigates to settings and saves the chosen theme", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Settings" }));
    await user.click(screen.getByRole("radio", { name: /light/i }));

    expect(document.documentElement).toHaveAttribute("data-theme", "light");
    expect(localStorage.getItem("a11ypilot-theme")).toBe("light");
  });

  it("validates a URL locally without sending an audit request", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "New audit" }));
    await user.type(screen.getByRole("textbox", { name: /page url/i }), "not a url");
    await user.click(screen.getByRole("button", { name: /run accessibility scan/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Enter a public URL beginning with https:// or http://");
    expect(fetch.mock.calls.some(([url]) => String(url).includes("/audits/url"))).toBe(false);
  });

  it("scans the intentionally inaccessible sample and renders real API evidence", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "New audit" }));
    await user.click(screen.getByRole("button", { name: /scan the built-in sample/i }));

    expect(await screen.findByText("Images must have alternate text")).toBeInTheDocument();
    expect(screen.getByText(/Assistive technology may not be able to communicate this image's purpose/)).toBeInTheDocument();
    expect(screen.getAllByText("Suggested next step").length).toBeGreaterThan(0);
    expect(screen.getByText("ACCESSZ SCORE · NOT WCAG COMPLIANCE")).toBeInTheDocument();
    expect(screen.getByTitle(/Isolated preview/)).toBeInTheDocument();

    const scanCall = fetch.mock.calls.find(([url]) => String(url).includes("/audits/html"));
    expect(JSON.parse(scanCall[1].body).html).toContain("Sample account form");
    expect(screen.getByText("1 affected nodes")).toBeInTheDocument();

    await user.click(screen.getAllByText("Evidence & failure summary")[0]);
    expect(screen.getByText("Add an accessible name.")).toBeInTheDocument();

    await user.click(screen.getAllByRole("link", { name: /issue details/i })[0]);
    expect(await screen.findByText("AFFECTED ELEMENT 1")).toBeInTheDocument();
    await user.click(screen.getByRole("link", { name: /back to results/i }));
    expect(await screen.findByText("Images must have alternate text")).toBeInTheDocument();
  });

  it("shows a real scan failure and retries the same request", async () => {
    const user = userEvent.setup();
    mockApi({ failScans: 1 });
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "New audit" }));
    await user.click(screen.getByRole("button", { name: /scan the built-in sample/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The page did not finish loading");
    await user.click(screen.getByRole("button", { name: /retry scan/i }));
    expect(await screen.findByText("Images must have alternate text")).toBeInTheDocument();
    expect(fetch.mock.calls.filter(([url]) => String(url).includes("/audits/html"))).toHaveLength(2);
  });

  it("cancels a pending scan and reports that no result was saved", async () => {
    const user = userEvent.setup();
    mockApi({
      pendingScan: (signal) => new Promise((_resolve, reject) => {
        signal.addEventListener("abort", () => {
          const error = new Error("Aborted");
          error.name = "AbortError";
          reject(error);
        }, { once: true });
      }),
    });
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "New audit" }));
    await user.click(screen.getByRole("button", { name: /scan the built-in sample/i }));
    await user.click(await screen.findByRole("button", { name: /cancel scan/i }));

    expect(screen.getByRole("alert")).toHaveTextContent("Audit cancelled. No results were saved.");
    expect(screen.queryByText("Images must have alternate text")).not.toBeInTheDocument();
  });

  it("loads the selected historical audit rather than the newest audit", async () => {
    const user = userEvent.setup();
    const older = { ...audit, id: "audit-old", projectName: "Selected historical audit" };
    const newer = { ...audit, id: "audit-new", projectName: "Newest audit" };
    mockApi({ audits: [newer, older] });
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Reports & history" }));
    await user.click(screen.getByRole("link", { name: "View results for Selected historical audit" }));

    expect(await screen.findByText("Selected historical audit")).toBeInTheDocument();
    expect(screen.queryByText("Newest audit")).not.toBeInTheDocument();
    await waitFor(() => {
      expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/audits/audit-old"))).toBe(true);
    });
  });

  it("does not expose legacy browser-local history in an authenticated workspace", async () => {
    const user = userEvent.setup();
    saveAuditToLocalHistory(audit);
    mockApi({ failHistory: true, unavailableAuditIds: [audit.id] });
    render(<App />);

    await user.click(await screen.findByRole("link", { name: "Reports & history" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("History API unavailable");
    expect(screen.queryByText("Regression fixture")).not.toBeInTheDocument();
    expect(localStorage.getItem("a11ypilot-audit-history-v1")).toBeNull();
  });

  it("reviews, accepts, previews, and rolls back a repair from an actual finding", async () => {
    const user = userEvent.setup();
    const auditSummary = { ...audit, summary: { ...audit.summary } };
    mockApi({ audits: [auditSummary], suggestionSource: "groq" });
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Audit results" }));

    const labelIssueLink = screen.getAllByRole("link", { name: /issue details/i })
      .find((element) => element.getAttribute("href")?.endsWith("/issues/label"));
    await user.click(labelIssueLink);
    await user.click(await screen.findByRole("link", { name: /prepare repair/i }));
    expect(screen.queryByText("Controlled HTML artifact")).not.toBeInTheDocument();
    expect(screen.queryByText("Upload HTML")).not.toBeInTheDocument();
    expect(screen.queryByText("Use pasted HTML")).not.toBeInTheDocument();
    expect(screen.queryByText("Download artifact")).not.toBeInTheDocument();
    expect(document.querySelector("#repair-html-upload")).toBeNull();
    expect(screen.getByText("WCAG 2.1 A")).toBeInTheDocument();
    expect(document.querySelector(".evidence-html").textContent).toContain('id="email"');
    await user.click(await screen.findByRole("button", { name: /generate fix suggestion/i }));

    expect(await screen.findByText("Groq-generated suggestion")).toBeInTheDocument();
    expect(document.querySelector(".repair-code-proposed").textContent).toContain('aria-label="Contact"');
    await user.click(screen.getByRole("button", { name: /review patch/i }));
    const confirmation = screen.getByRole("dialog");
    const confirmButton = within(confirmation).getByRole("button", { name: "Approve & Apply Fix" });
    expect(confirmButton).toBeDisabled();
    await user.click(within(confirmation).getByRole("checkbox"));
    await user.click(confirmButton);

    expect(await screen.findByText(/Applied to controlled artifact/)).toBeInTheDocument();
    expect(screen.getByTitle("Applied repair artifact preview")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /roll back patch/i }));
    await user.click(within(screen.getByRole("dialog")).getByRole("button", { name: "Roll back" }));
    expect(await screen.findByText(/Original source restored/)).toBeInTheDocument();
  }, 15_000);

  it("submits optional CSS with the audit and keeps it off the Repair Copilot page", async () => {
    const user = userEvent.setup();
    mockApi({ audits: [contrastAudit], suggestionSource: "groq", includeCssPatch: true });
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "New audit" }));
    await user.type(screen.getByRole("textbox", { name: /page url/i }), "https://example.com");
    fireEvent.change(screen.getByRole("textbox", { name: /additional css \(optional\)/i }), {
      target: { value: ".copy { color: #888; background-color: #fff; }" },
    });
    await user.click(screen.getByRole("button", { name: /run accessibility scan/i }));

    await waitFor(() => {
      const auditCall = fetch.mock.calls.find(([url]) => String(url).endsWith("/audits/url"));
      expect(JSON.parse(auditCall[1].body).additionalCss).toBe(".copy { color: #888; background-color: #fff; }");
    });

    await user.click(await screen.findByRole("link", { name: "Repair workspace" }));
    expect(screen.queryByRole("textbox", { name: /relevant stylesheet/i })).not.toBeInTheDocument();
  });

  it("verifies an applied repair only after a successful follow-up comparison", async () => {
    const user = userEvent.setup();
    const repair = {
      id: "repair-123",
      auditId: audit.id,
      violationId: "label",
      status: "applied",
      updatedArtifact: audit.previewHtml,
    };
    const verification = {
      id: "verification-123",
      status: "verified",
      scope: "controlled_html_snapshot",
      scanStatus: "completed",
      createdAt: "2026-03-01T12:05:00.000Z",
      baselineScore: 80,
      finalScore: 100,
      scoreDifference: 20,
      comparison: {
        resolved: [{ ruleId: "label", selector: "#email", failureSummary: "Add a label.", html: "<input>" }],
        remaining: [],
        newlyIntroduced: [],
        changed: [],
        manualReview: [],
        counts: { resolved: 1, remaining: 0, newlyIntroduced: 0, changed: 0, manualReview: 0, baselineDistinctFindings: 1, followUpDistinctFindings: 0 },
      },
    };
    mockApi({ audits: [audit], repairs: [repair], verificationResult: verification });
    render(<App />);
    await user.click(await screen.findByRole("link", { name: "Verification" }));
    await user.click(await screen.findByRole("button", { name: /verify selected repair/i }));

    expect(await screen.findByText("Finding confirmed resolved")).toBeInTheDocument();
    expect(screen.getByText("100")).toBeInTheDocument();
    expect(screen.getByText("label")).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url]) => String(url).endsWith("/repairs/repair-123/verify"))).toBe(true);
  }, 15_000);
});

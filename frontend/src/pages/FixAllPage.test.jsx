import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { FixAllPage } from "./FixAllPage.jsx";
import * as api from "../api/client.js";

vi.mock("../api/client.js", () => ({
  createHtmlAudit: vi.fn(),
  createUrlAudit: vi.fn(),
  getControlledArtifact: vi.fn(),
  getControlledArtifacts: vi.fn(),
  applyBulkRepair: vi.fn(),
  proposeBulkRepair: vi.fn(),
  rollbackBulkRepair: vi.fn(),
  verifyBulkRepair: vi.fn(),
}));

const originalHtml = '<!doctype html><html lang="en"><body><button id="menu"></button></body></html>';
const repairedHtml = '<!DOCTYPE html><html lang="en"><head></head><body><button id="menu" aria-label="Demo menu button">Demo Menu</button></body></html>';
const audit = {
  id: "audit-1",
  sourceType: "html",
  projectName: "Fixture",
  violations: [{ id: "button-name", help: "Buttons need names", nodeCount: 1, nodes: [] }],
  incomplete: [],
  summary: { violations: 1 },
  scanLimitations: [],
};
const artifact = { id: "artifact-1", auditId: audit.id, version: 1, html: originalHtml, additionalCss: ".menu { color: navy; }" };
const draft = {
  id: "draft-1",
  status: "proposed",
  patchHash: "a".repeat(64),
  artifactVersion: 1,
  originalHtml,
  repairedHtml,
  originalCss: artifact.additionalCss,
  repairedCss: artifact.additionalCss,
  before: { violationCount: 1, findings: audit.violations },
  after: { violationCount: 0, findings: [], incomplete: [] },
  comparison: { counts: { resolved: 1, remaining: 0, newlyIntroduced: 0, changed: 0 } },
  changes: [{ violationId: "button-name", selector: "#menu", originalCode: '<button id="menu"></button>', proposedCode: '<button id="menu" aria-label="Demo menu button">Demo Menu</button>', explanation: "Adds reviewable demo text.", assumptions: ["Replace demo wording after review."], manualReviewRequired: true }],
  skipped: [],
  scanLimitations: [],
};

describe("Fix All repair workspace", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.createHtmlAudit.mockResolvedValue({ audit });
    api.createUrlAudit.mockResolvedValue({ audit: {
      ...audit,
      sourceType: "url",
      source: "https://example.test",
      finalUrl: "https://example.test/",
      renderedHtml: originalHtml,
      capturedCss: "",
      sourceCapture: { available: true, httpStatus: 200, capturedStylesheets: 1, inaccessibleStylesheets: [], authenticationLikely: false },
      blockedRequests: [],
    } });
    api.getControlledArtifacts.mockResolvedValue({ artifacts: [{ id: artifact.id, auditId: audit.id }] });
    api.getControlledArtifact.mockResolvedValue({ artifact });
    api.proposeBulkRepair.mockResolvedValue({ draft });
    api.applyBulkRepair.mockResolvedValue({ draft: { id: draft.id, status: "applied", appliedVersion: 2 }, artifact: { ...artifact, html: repairedHtml, version: 2 } });
    api.verifyBulkRepair.mockResolvedValue({ verification: { status: "verified", resolvedFindings: 1, remainingFindings: 0, newFindings: 0, changedFindings: 0, manualReview: 0 }, comparison: {}, audit: { violations: [] } });
    api.rollbackBulkRepair.mockResolvedValue({ artifact: { ...artifact, version: 3 }, draft: { status: "rolled_back" } });
  });

  it("scans pasted HTML/CSS, reviews the real candidate, applies, verifies, and reverts it", async () => {
    const user = userEvent.setup();
    render(<MemoryRouter><FixAllPage /></MemoryRouter>);
    await user.type(screen.getByLabelText(/Original HTML/i), originalHtml);
    fireEvent.change(screen.getByLabelText(/Separate CSS/i), { target: { value: ".menu { color: navy; }" } });
    await user.click(screen.getByRole("button", { name: "Scan Code" }));

    expect(await screen.findByText(/REAL AXE-CORE RESULTS/)).toBeInTheDocument();
    expect(api.createHtmlAudit).toHaveBeenCalledWith(expect.objectContaining({ html: originalHtml, additionalCss: ".menu { color: navy; }" }));
    await user.click(screen.getByRole("button", { name: "Fix All Issues" }));
    expect(await screen.findByText("Change-by-change diff")).toBeInTheDocument();
    expect(screen.getByText(/Automated findings before and after candidate scan/)).toBeInTheDocument();
    expect(screen.getByTitle("Fix all original HTML preview")).toBeInTheDocument();
    expect(screen.getByTitle("Fix all repaired HTML preview")).toBeInTheDocument();
    expect(screen.getByText("− <button id=\"menu\"></button>")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Apply All Fixes" }));
    await user.click(screen.getByRole("checkbox", { name: /reviewed the complete diff/i }));
    await user.click(screen.getByRole("button", { name: "Confirm Apply All" }));
    await waitFor(() => expect(api.applyBulkRepair).toHaveBeenCalledWith(expect.objectContaining({ confirmed: true, draftId: draft.id })));
    await user.click(await screen.findByRole("button", { name: "Run Verification Again" }));
    expect(await screen.findByText(/Post-apply verification · verified/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Revert All Changes" }));
    expect(api.rollbackBulkRepair).toHaveBeenCalledWith(artifact.id, draft.id);
  });

  it("fetches URLs through the API and reports inaccessible styles without claiming a full capture", async () => {
    const user = userEvent.setup();
    api.createUrlAudit.mockResolvedValueOnce({ audit: {
      ...audit,
      sourceType: "url",
      finalUrl: "https://example.test/",
      renderedHtml: originalHtml,
      capturedCss: "",
      sourceCapture: { available: true, httpStatus: 200, capturedStylesheets: 0, inaccessibleStylesheets: [{ url: "https://cdn.example.test/site.css", reason: "cross-origin-or-unavailable" }], authenticationLikely: true },
      blockedRequests: [{ url: "https://private.example.test", reason: "DESTINATION_BLOCKED" }],
    } });
    render(<MemoryRouter><FixAllPage /></MemoryRouter>);
    await user.click(screen.getByRole("button", { name: "Scan public URL" }));
    await user.type(screen.getByLabelText(/Public page URL/), "https://example.test");
    await user.click(screen.getByRole("button", { name: "Fetch and Scan" }));

    expect(await screen.findByText(/Authentication or access control may be required/)).toBeInTheDocument();
    expect(screen.getByText(/Stylesheet unavailable: https:\/\/cdn.example.test\/site.css/)).toBeInTheDocument();
    expect(screen.getByText(/Request blocked: https:\/\/private.example.test/)).toBeInTheDocument();
    expect(api.createUrlAudit).toHaveBeenCalledWith({ url: "https://example.test/" });
  });
});

import { createHash, randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { GroqProvider, ProviderError } from "../ai/groqProvider.js";
import { freezeSnapshot } from "../verification/engine.js";
import {
  applyScopedReplacement,
  deterministicProposal,
  normalizeProposal,
  prepareFindingContext,
  RepairError,
  validateContrastCandidate,
} from "./repairEngine.js";

function safeFallbackReason(error) {
  if (error.code === "GROQ_RATE_LIMITED") return "Groq rate limit reached; showing a deterministic or manual fallback.";
  if (error.code === "GROQ_MODEL_UNAVAILABLE" || error.code === "GROQ_MODEL_INVALID") return "The configured Groq model is unavailable; showing a deterministic or manual fallback.";
  return "Groq is temporarily unavailable; showing a deterministic or manual fallback.";
}

function cssDeclarationDiff(originalCode, proposedCode) {
  const originalDocument = new JSDOM(`<!doctype html><body>${originalCode}</body>`);
  const proposedDocument = new JSDOM(`<!doctype html><body>${proposedCode}</body>`);
  const original = originalDocument.window.document.body.firstElementChild;
  const proposed = proposedDocument.window.document.body.firstElementChild;
  const changes = ["color", "background-color"].filter(
    (property) => original?.style.getPropertyValue(property) !== proposed?.style.getPropertyValue(property),
  );
  const declaration = changes.map((property) => `${property}: ${proposed?.style.getPropertyValue(property)};`).join(" ");
  originalDocument.window.close();
  proposedDocument.window.close();
  return declaration;
}

export class RepairService {
  constructor({ provider = new GroqProvider() } = {}) {
    this.provider = provider;
    this.providerState = provider.getStatus();
  }

  getStatus() {
    return { ...this.providerState };
  }

  async suggest({ auditStore, repairStore, controlledArtifacts, input }) {
    const audit = auditStore.get(input.auditId);
    if (!audit) throw new RepairError("AUDIT_NOT_FOUND", "This audit is no longer available.", 404);
    const artifact = controlledArtifacts.get(input.artifactId);
    if (!artifact) throw new RepairError("ARTIFACT_NOT_FOUND", "Upload or create an owned HTML artifact before suggesting a repair.", 404);
    if (artifact.auditId && artifact.auditId !== audit.id) throw new RepairError("ARTIFACT_AUDIT_MISMATCH", "This controlled artifact is not associated with the selected audit.", 409);
    const violation = audit.violations.find((item) => item.id === input.violationId);
    if (!violation) throw new RepairError("FINDING_NOT_FOUND", "This accessibility finding is not part of the selected audit.", 404);
    const artifactAudit = { ...audit, sourceType: "html", previewHtml: artifact.html };
    const cssSource = input.cssSource ?? (audit.sourceType === "url" ? audit.additionalCss ?? "" : "");
    const finding = prepareFindingContext(artifactAudit, violation, input.nodeIndex, cssSource);
    const deterministic = () => deterministicProposal({
      ruleId: violation.id,
      originalCode: finding.targetCode,
      nearbyLabelText: finding.nearbyLabelText,
      styleEvidence: finding.context.styleEvidence,
      cssEvidence: finding.context.cssEvidence,
    });

    let proposal;
    let source = "deterministic";
    let fallbackReason = null;
    if (violation.id === "color-contrast" && !finding.context.cssEvidence?.sourceKnown) {
      proposal = deterministic();
      source = "manual";
    } else if (this.provider.getStatus().status === "not_configured") {
      proposal = deterministic();
    } else {
      try {
        const generated = await this.provider.suggest(finding.context);
        proposal = normalizeProposal(generated, finding.targetCode, violation.id);
        if (violation.id === "color-contrast" && proposal.applicable) {
          proposal = validateContrastCandidate(proposal, finding.targetCode, finding.context.styleEvidence);
          if (!proposal.applicable) {
            const fallback = deterministic();
            proposal = fallback;
            source = fallback.applicable ? "deterministic" : "manual";
            fallbackReason = "The generated CSS did not meet the calculated contrast threshold; showing a safe calculated fallback or manual guidance.";
          }
        }
        if (!proposal.applicable && violation.id === "color-contrast") {
          source = "manual";
        }
        if (proposal.applicable) source = "groq";
        this.providerState = { ...this.provider.getStatus(), status: "available", lastErrorCode: null };
      } catch (error) {
        if (error instanceof RepairError && error.code === "INVALID_SUGGESTION") {
          console.warn("Groq repair suggestion rejected:", { requestId: input.requestId ?? null, code: error.code });
          this.providerState = { ...this.provider.getStatus(), status: "temporarily_unavailable", lastErrorCode: error.code };
          proposal = deterministic();
          fallbackReason = "Groq returned an invalid suggestion; showing a deterministic or manual fallback.";
        } else if (error instanceof ProviderError) {
          console.warn("Groq repair suggestion failed:", { requestId: input.requestId ?? null, code: error.code });
          this.providerState = {
            ...this.provider.getStatus(),
            status: error.code === "GROQ_MODEL_INVALID" ? "misconfigured" : "temporarily_unavailable",
            lastErrorCode: error.code,
          };
          proposal = deterministic();
          fallbackReason = safeFallbackReason(error);
        } else {
          throw error;
        }
      }
    }

    const repair = {
      id: randomUUID(),
      auditId: audit.id,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      artifactContentHash: createHash("sha256").update(artifact.html).digest("hex"),
      baselineAuditId: audit.id,
      baselineSnapshot: freezeSnapshot(audit),
      violationId: violation.id,
      nodeIndex: input.nodeIndex,
      selector: finding.repairSelector,
      originalCode: finding.targetCode,
      proposedCode: proposal.proposedCode,
      patchHash: createHash("sha256").update(JSON.stringify({
        artifactId: artifact.id,
        artifactVersion: artifact.version,
        selector: finding.repairSelector,
        originalCode: finding.targetCode,
        proposedCode: proposal.proposedCode,
      })).digest("hex"),
      ...(violation.id === "color-contrast" ? {
        cssPatch: {
          targetSelector: finding.context.cssEvidence?.targetSelector ?? finding.repairSelector,
          originalDeclaration: finding.context.cssEvidence?.originalDeclaration ?? "",
          proposedDeclaration: cssDeclarationDiff(finding.targetCode, proposal.proposedCode),
          application: !proposal.applicable
            ? "No CSS patch proposed; provide or confirm the relevant source and rendered-style evidence."
            : finding.context.cssEvidence?.originalDeclaration?.includes('element style="')
              ? "color values update only this controlled artifact's inline style attribute"
              : "inline CSS override applies only to this controlled artifact; source stylesheet remains unchanged",
          suppliedStylesheet: Boolean(cssSource),
          evidence: {
            foreground: finding.context.styleEvidence?.color ?? null,
            effectiveBackground: finding.context.styleEvidence?.effectiveBackground ?? null,
            fontSize: finding.context.styleEvidence?.fontSize ?? null,
            fontWeight: finding.context.styleEvidence?.fontWeight ?? null,
          },
          contrastCheck: proposal.contrastCheck ?? null,
        },
      } : {}),
      explanation: proposal.explanation,
      accessibilityRationale: proposal.accessibilityRationale,
      expectedVerificationCriteria: proposal.expectedVerificationCriteria,
      assumptions: proposal.assumptions,
      manualReviewRequired: proposal.manualReviewRequired,
      applicable: proposal.applicable,
      source,
      providerStatus: this.getStatus(),
      status: "proposed",
      fallbackReason,
      createdAt: new Date().toISOString(),
      rollbackArtifact: null,
      sourceArtifact: null,
      updatedArtifact: null,
    };
    repairStore.set(repair.id, repair);
    return repair;
  }

  apply({ auditStore, repairStore, artifactStore = new Map(), controlledArtifacts = new Map(), repairId, manualReviewConfirmed, reviewedPatchHash, artifactVersion, approvedBy }) {
    const repair = repairStore.get(repairId);
    if (!repair) throw new RepairError("REPAIR_NOT_FOUND", "This repair suggestion is no longer available.", 404);
    if (repair.status !== "proposed") throw new RepairError("REPAIR_NOT_PENDING", "Only a proposed repair can be applied.", 409);
    if (!repair.applicable) throw new RepairError("NO_SAFE_PATCH", "This suggestion is guidance only; there is no safe automatic patch to apply.", 422);
    if (repair.manualReviewRequired && manualReviewConfirmed !== true) {
      throw new RepairError("MANUAL_REVIEW_REQUIRED", "Confirm that you reviewed this content before applying the repair.", 400);
    }

    const audit = auditStore.get(repair.auditId);
    if (!audit) throw new RepairError("AUDIT_NOT_FOUND", "This audit is no longer available.", 404);
    const artifact = controlledArtifacts.get(repair.artifactId);
    if (!artifact) throw new RepairError("ARTIFACT_NOT_FOUND", "The controlled HTML artifact is unavailable.", 404);
    if (artifact.version !== artifactVersion || artifactVersion !== repair.artifactVersion) {
      throw new RepairError("ARTIFACT_VERSION_CONFLICT", "The artifact changed after review. Generate and review a new suggestion before applying it.", 409);
    }
    if (reviewedPatchHash !== repair.patchHash) {
      throw new RepairError("PATCH_REVIEW_MISMATCH", "The reviewed patch does not match this suggestion. Review the current patch before applying it.", 409);
    }
    const source = artifact.html;
    if (createHash("sha256").update(source).digest("hex") !== repair.artifactContentHash) {
      throw new RepairError("ARTIFACT_VERSION_CONFLICT", "The artifact content changed after review. Generate and review a new suggestion before applying it.", 409);
    }
    const rollbackArtifact = source;
    const updatedArtifact = applyScopedReplacement(
      source,
      repair.selector,
      repair.originalCode,
      repair.proposedCode,
      repair.violationId,
    );
    repair.rollbackArtifact = rollbackArtifact;
    repair.sourceArtifact = source;
    repair.updatedArtifact = updatedArtifact;
    repair.appliedArtifact = updatedArtifact;
    artifact.html = updatedArtifact;
    artifact.version += 1;
    artifact.updatedAt = new Date().toISOString();
    artifactStore.set(audit.id, updatedArtifact);
    repair.appliedArtifactVersion = artifact.version;
    repair.approvedBy = approvedBy;
    repair.approvedAt = repair.acceptedAt;
    repair.acceptedAt = new Date().toISOString();
    repair.appliedAt = repair.acceptedAt;
    repair.status = "applied";
    return repair;
  }

  reject({ repairStore, repairId }) {
    const repair = repairStore.get(repairId);
    if (!repair) throw new RepairError("REPAIR_NOT_FOUND", "This repair suggestion is no longer available.", 404);
    if (repair.status !== "proposed") throw new RepairError("REPAIR_NOT_PENDING", "Only a proposed repair can be rejected.", 409);
    repair.status = "rejected";
    repair.rejectedAt = new Date().toISOString();
    return repair;
  }

  rollback({ repairStore, artifactStore = new Map(), controlledArtifacts = new Map(), repairId }) {
    const repair = repairStore.get(repairId);
    if (!repair) throw new RepairError("REPAIR_NOT_FOUND", "This repair suggestion is no longer available.", 404);
    if (!["applied", "needs_review", "verified"].includes(repair.status) || !repair.rollbackArtifact) {
      throw new RepairError("REPAIR_NOT_APPLIED", "Only an applied repair can be rolled back.", 409);
    }
    const artifact = controlledArtifacts.get(repair.artifactId);
    if (!artifact || artifact.html !== repair.appliedArtifact || artifact.version !== repair.appliedArtifactVersion) {
      throw new RepairError("ARTIFACT_CHANGED", "The controlled artifact has changed since this patch was applied; rollback it from the latest repair instead.", 409);
    }
    repair.updatedArtifact = repair.rollbackArtifact;
    artifact.html = repair.rollbackArtifact;
    artifact.version += 1;
    artifact.updatedAt = new Date().toISOString();
    artifactStore.set(repair.auditId, repair.rollbackArtifact);
    repair.status = "rolled_back";
    repair.rolledBackAt = new Date().toISOString();
    return repair;
  }
}

export const repairService = new RepairService();

import { createHash, randomUUID } from "node:crypto";
import { JSDOM } from "jsdom";
import { z } from "zod";
import { applyScopedReplacement } from "./repairEngine.js";
import { compareAudits } from "../verification/engine.js";

const MAX_BULK_PATCHES = 20;
const REPAIRABLE_RULES = new Set([
  "button-name", "link-name", "image-alt", "label", "html-has-lang", "html-lang-valid", "color-contrast",
]);

function hashDraft({ artifactId, artifactVersion, html, css }) {
  return createHash("sha256").update(JSON.stringify({ artifactId, artifactVersion, html, css })).digest("hex");
}

function sourceByteLength(html, css) {
  return Buffer.byteLength(html, "utf8") + Buffer.byteLength(css, "utf8");
}

function findOverlaps(sourceHtml, proposals) {
  const document = new JSDOM(sourceHtml).window.document;
  const targets = proposals.map((proposal) => {
    try {
      const matches = document.querySelectorAll(proposal.selector);
      return matches.length === 1 ? matches[0] : null;
    } catch {
      return null;
    }
  });
  const conflictIndexes = new Set();
  for (let left = 0; left < targets.length; left += 1) {
    for (let right = left + 1; right < targets.length; right += 1) {
      if (targets[left] && targets[right]
        && (targets[left] === targets[right] || targets[left].contains(targets[right]) || targets[right].contains(targets[left]))) {
        const leftIsRootLanguage = ["html-has-lang", "html-lang-valid"].includes(proposals[left].violationId) && targets[left].tagName === "HTML";
        const rightIsRootLanguage = ["html-has-lang", "html-lang-valid"].includes(proposals[right].violationId) && targets[right].tagName === "HTML";
        if (leftIsRootLanguage || rightIsRootLanguage) continue;
        conflictIndexes.add(left);
        conflictIndexes.add(right);
      }
    }
  }
  document.defaultView.close();
  return conflictIndexes;
}

export class BulkRepairService {
  constructor({ repairService, scan }) {
    this.repairService = repairService;
    this.scan = scan;
    this.drafts = new Map();
  }

  async propose({ audit, artifact, userId, signal, requestId }) {
    if (sourceByteLength(artifact.html, artifact.additionalCss ?? "") > 300_000) {
      throw Object.assign(new Error("The combined HTML and CSS source exceeds the 300 KB repair limit; no source was truncated."), { code: "SOURCE_TOO_LARGE", status: 413 });
    }

    const candidates = [];
    const skipped = [];
    let examined = 0;
    let truncated = false;
    const temporaryRepairs = new Map();
    const auditStore = new Map([[audit.id, audit]]);
    const controlledArtifacts = new Map([[artifact.id, { ...artifact }]]);
    for (const violation of audit.violations ?? []) {
      if (!REPAIRABLE_RULES.has(violation.id)) {
        skipped.push({ violationId: violation.id, selector: "", reason: "This finding requires a manual or specialized repair." });
        continue;
      }
      for (let nodeIndex = 0; nodeIndex < (violation.nodes ?? []).length; nodeIndex += 1) {
        if (examined >= MAX_BULK_PATCHES) {
          truncated = true;
          break;
        }
        examined += 1;
        try {
          const proposal = await this.repairService.suggest({
            auditStore,
            repairStore: temporaryRepairs,
            controlledArtifacts,
            input: { auditId: audit.id, artifactId: artifact.id, violationId: violation.id, nodeIndex },
          });
          if (!proposal.applicable || proposal.originalCode === proposal.proposedCode) {
            skipped.push({ violationId: violation.id, selector: proposal.selector, reason: proposal.explanation || "No safe patch could be generated." });
          } else {
            candidates.push({
              repairId: proposal.id,
              violationId: proposal.violationId,
              selector: proposal.selector,
              originalCode: proposal.originalCode,
              proposedCode: proposal.proposedCode,
              explanation: proposal.explanation,
              accessibilityRationale: proposal.accessibilityRationale,
              assumptions: proposal.assumptions,
              manualReviewRequired: proposal.manualReviewRequired,
              demoContent: proposal.demoContent,
              source: proposal.source,
              applicable: true,
            });
          }
        } catch (error) {
          skipped.push({ violationId: violation.id, selector: violation.nodes[nodeIndex]?.selector ?? "", reason: error?.message ?? "This finding could not be repaired safely." });
        }
      }
      if (truncated) break;
    }

    const conflicts = findOverlaps(artifact.html, candidates);
    const changes = [];
    let repairedHtml = artifact.html;
    for (const [index, candidate] of candidates.entries()) {
      if (conflicts.has(index)) {
        skipped.push({ violationId: candidate.violationId, selector: candidate.selector, reason: "This patch overlaps another selected element; review and repair the conflicting findings individually." });
        continue;
      }
      try {
        repairedHtml = applyScopedReplacement(
          repairedHtml,
          candidate.selector,
          candidate.originalCode,
          candidate.proposedCode,
          candidate.violationId,
          { nearbyLabelText: candidate.nearbyLabelText },
        );
        changes.push(candidate);
      } catch (error) {
        skipped.push({ violationId: candidate.violationId, selector: candidate.selector, reason: error?.message ?? "The combined patch could not be safely applied." });
      }
    }

    if (sourceByteLength(repairedHtml, artifact.additionalCss ?? "") > 300_000) {
      throw Object.assign(new Error("The combined repaired source exceeds the 300 KB limit; the original artifact was left unchanged."), { code: "REPAIRED_SOURCE_TOO_LARGE", status: 413 });
    }
    const afterAudit = await this.scan({
      sourceType: "html",
      html: repairedHtml,
      ...(artifact.additionalCss ? { additionalCss: artifact.additionalCss } : {}),
      projectName: `${audit.projectName ?? audit.source} · bulk repair candidate`,
      wcagLevel: audit.wcagLevel ?? "AA",
      includeBestPractices: audit.includeBestPractices ?? true,
    }, { signal, requestId });
    const comparison = compareAudits(audit, afterAudit);
    const draft = {
      id: randomUUID(),
      userId,
      auditId: audit.id,
      artifactId: artifact.id,
      artifactVersion: artifact.version,
      baselineAudit: audit,
      sourceHash: hashDraft({ artifactId: artifact.id, artifactVersion: artifact.version, html: artifact.html, css: artifact.additionalCss ?? "" }),
      patchHash: hashDraft({ artifactId: artifact.id, artifactVersion: artifact.version, html: repairedHtml, css: artifact.additionalCss ?? "" }),
      status: "proposed",
      originalHtml: artifact.html,
      originalCss: artifact.additionalCss ?? "",
      repairedHtml,
      repairedCss: artifact.additionalCss ?? "",
      changes,
      skipped,
      truncated,
      examined,
      before: {
        violationCount: audit.summary.violations,
        findings: audit.violations,
      },
      after: {
        violationCount: afterAudit.summary.violations,
        findings: afterAudit.violations,
        incomplete: afterAudit.incomplete,
      },
      comparison,
      scanLimitations: afterAudit.scanLimitations,
      sourceCapture: audit.sourceCapture ?? null,
      createdAt: new Date().toISOString(),
    };
    this.drafts.set(draft.id, draft);
    while (this.drafts.size > 50) this.drafts.delete(this.drafts.keys().next().value);
    return draft;
  }

  get(draftId, userId) {
    const draft = this.drafts.get(draftId);
    return draft?.userId === userId ? draft : null;
  }
}

export const bulkRepairInputSchema = z.object({
  auditId: z.string().uuid(),
  artifactId: z.string().uuid(),
}).strict();

export const bulkApplySchema = z.object({
  draftId: z.string().uuid(),
  patchHash: z.string().regex(/^[a-f0-9]{64}$/),
  artifactVersion: z.number().int().positive(),
  confirmed: z.literal(true),
}).strict();

export function bulkDraftHash(artifact) {
  return hashDraft({ artifactId: artifact.id, artifactVersion: artifact.version, html: artifact.html, css: artifact.additionalCss ?? "" });
}

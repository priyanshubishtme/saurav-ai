import { randomUUID } from "node:crypto";
import { findingFingerprint } from "../scoring.js";

function normalizeText(value = "") {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function targetContext(rule, node) {
  const targets = [...new Set((node.targets ?? [node.selector]).map(normalizeText).filter(Boolean))].sort();
  return JSON.stringify([rule.id, targets]);
}

function collectFindings(audit) {
  const findings = new Map();
  for (const rule of audit.violations ?? []) {
    for (const node of rule.nodes ?? []) {
      const fingerprint = findingFingerprint(rule.id, node);
      if (!findings.has(fingerprint)) {
        findings.set(fingerprint, {
          fingerprint,
          targetContext: targetContext(rule, node),
          ruleId: rule.id,
          impact: rule.impact,
          wcagCriteria: rule.wcagCriteria ?? [],
          description: rule.description,
          help: rule.help,
          helpUrl: rule.helpUrl,
          selector: node.selector ?? node.targets?.[0] ?? "",
          targets: node.targets ?? [],
          html: node.html ?? "",
          failureSummary: node.failureSummary ?? "",
        });
      }
    }
  }
  return [...findings.values()];
}

function collectIncomplete(audit) {
  const pending = new Map();
  for (const rule of audit.incomplete ?? []) {
    if (!rule.nodes.length) {
      pending.set(`${rule.id}:unknown`, { ruleId: rule.id, selector: "", help: rule.help });
      continue;
    }
    for (const node of rule.nodes) {
      const item = {
        ruleId: rule.id,
        selector: node.selector ?? node.targets?.[0] ?? "",
        targets: node.targets ?? [],
        help: rule.help,
        failureSummary: node.failureSummary ?? "",
        html: node.html ?? "",
      };
      pending.set(`${rule.id}:${normalizeText(item.selector)}:${normalizeText(item.failureSummary)}`, item);
    }
  }
  return [...pending.values()];
}

function targetMatchesRepair(item, repair) {
  if (item.ruleId !== repair.violationId) return false;
  const selector = normalizeText(repair.selector);
  return normalizeText(item.selector) === selector
    || (item.targets ?? []).some((target) => normalizeText(target) === selector);
}

export function compareAudits(baseline, followUp) {
  const before = collectFindings(baseline);
  const after = collectFindings(followUp);
  const remaining = [];
  const changed = [];
  const resolved = [];
  const introduced = [];
  const unmatchedAfter = new Set(after);
  const afterByTarget = new Map();
  for (const finding of after) {
    const group = afterByTarget.get(finding.targetContext) ?? [];
    group.push(finding);
    afterByTarget.set(finding.targetContext, group);
  }

  for (const prior of before) {
    const exact = after.find((item) => item.fingerprint === prior.fingerprint && unmatchedAfter.has(item));
    if (exact) {
      remaining.push(exact);
      unmatchedAfter.delete(exact);
      continue;
    }
    const sameTarget = (afterByTarget.get(prior.targetContext) ?? []).find((item) => unmatchedAfter.has(item));
    if (sameTarget) {
      changed.push({ before: prior, after: sameTarget });
      unmatchedAfter.delete(sameTarget);
    } else {
      resolved.push(prior);
    }
  }
  introduced.push(...unmatchedAfter);
  const incomplete = collectIncomplete(followUp);

  return {
    resolved,
    remaining,
    newlyIntroduced: introduced,
    changed,
    manualReview: incomplete,
    regressions: introduced,
    counts: {
      resolved: resolved.length,
      remaining: remaining.length,
      newlyIntroduced: introduced.length,
      changed: changed.length,
      manualReview: incomplete.length,
      baselineDistinctFindings: before.length,
      followUpDistinctFindings: after.length,
    },
  };
}

export function createVerificationRecord({
  baseline,
  followUp = null,
  scanError = null,
  startedAt = new Date().toISOString(),
  baselineAuditId = baseline.id,
  sourceAuditScore = null,
  baselineScanStatus = "not_run",
  scope,
  repair = null,
  repairId = null,
  environmentalChange = false,
}) {
  const completedAt = new Date().toISOString();
  const createdAt = startedAt;
  if (!followUp || followUp.status !== "completed") {
    const failedError = scanError ?? { code: "SCAN_NOT_COMPLETED", message: "The follow-up scan did not complete successfully." };
    return {
      id: randomUUID(),
      repairId,
      baselineAuditId,
      comparisonBaselineAuditId: baseline.id,
      followUpAuditId: null,
      createdAt,
      completedAt,
      status: "failed",
      outcome: "failed",
      scope,
      environmentalChange,
      error: { code: failedError.code, message: failedError.message },
      durationMs: scanError?.durationMs ?? null,
      engine: baseline.engine,
      configuration: {
        wcagLevel: baseline.wcagLevel,
        includeBestPractices: baseline.includeBestPractices,
        axeTags: baseline.engine?.tags ?? [],
      },
      baselineScore: baseline.summary.score,
      finalScore: null,
      scoreDifference: null,
      comparison: null,
      scanStatus: "failed",
      baselineScanStatus,
      sourceAuditScore,
    };
  }

  const comparison = compareAudits(baseline, followUp);
  const regressionDetected = comparison.newlyIntroduced.length > 0 || comparison.changed.length > 0;
  const unresolvedRepairFinding = repair && (
    comparison.remaining.some((finding) => targetMatchesRepair(finding, repair))
    || comparison.changed.some(({ before, after }) => targetMatchesRepair(before, repair) || targetMatchesRepair(after, repair))
    || comparison.manualReview.some((finding) => targetMatchesRepair(finding, repair))
  );
  const status = environmentalChange
    ? "environmental_change"
    : regressionDetected
      ? "needs_review"
      : repair
        ? unresolvedRepairFinding ? "needs_review" : "verified"
        : comparison.remaining.length || comparison.manualReview.length
          ? "needs_review"
          : "verified";
  return {
    id: randomUUID(),
    repairId,
    baselineAuditId,
    comparisonBaselineAuditId: baseline.id,
    followUpAuditId: followUp.id,
    createdAt,
    completedAt,
    scanStartedAt: followUp.createdAt,
    status,
    outcome: status,
    scope,
    environmentalChange,
    error: null,
    durationMs: followUp.durationMs,
    engine: followUp.engine,
    configuration: {
      wcagLevel: followUp.wcagLevel,
      includeBestPractices: followUp.includeBestPractices,
      axeTags: followUp.engine?.tags ?? [],
    },
    scanStatus: followUp.status,
    baselineScanStatus,
    sourceAuditScore,
    baselineScore: baseline.summary.score,
    finalScore: followUp.summary.score,
    scoreDifference: baseline.summary.score === null || followUp.summary.score === null
      ? null
      : followUp.summary.score - baseline.summary.score,
    summary: followUp.summary,
    comparison,
  };
}

export function freezeSnapshot(value) {
  const snapshot = structuredClone(value);
  const freeze = (object) => {
    if (object && typeof object === "object" && !Object.isFrozen(object)) {
      Object.freeze(object);
      Object.values(object).forEach(freeze);
    }
    return object;
  };
  return freeze(snapshot);
}

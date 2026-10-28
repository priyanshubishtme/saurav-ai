import { createHash } from "node:crypto";

const impactWeights = Object.freeze({
  critical: 5,
  serious: 4,
  moderate: 2,
  minor: 1,
});

function normalizeText(value = "") {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

export function findingFingerprint(ruleId, node) {
  const targets = [...new Set((node.targets ?? [node.selector]).map(normalizeText).filter(Boolean))].sort();
  const failure = normalizeText(node.failureSummary);
  const stableValue = JSON.stringify([ruleId, targets, failure]);
  return createHash("sha256").update(stableValue).digest("hex");
}

function uniqueFindings(violations) {
  const findings = new Map();
  for (const violation of violations) {
    for (const node of violation.nodes ?? []) {
      const fingerprint = findingFingerprint(violation.id, node);
      if (!findings.has(fingerprint)) {
        findings.set(fingerprint, {
          fingerprint,
          ruleId: violation.id,
          impact: violation.impact ?? "moderate",
          wcagCriteria: violation.wcagCriteria ?? [],
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

export function calculateA11yScore({ violations = [], passes = [], incomplete = [], inapplicable = [] }) {
  const testedRules = new Map();
  for (const result of passes) {
    if (!testedRules.has(result.id)) testedRules.set(result.id, { passed: true, impact: "minor" });
  }
  for (const result of violations) {
    testedRules.set(result.id, { passed: false, impact: result.impact ?? "moderate" });
  }
  for (const result of incomplete) {
    if (!violations.some((violation) => violation.id === result.id)) {
      testedRules.delete(result.id);
    }
  }
  for (const result of inapplicable) testedRules.delete(result.id);

  let totalWeight = 0;
  let failedWeight = 0;
  let passedRuleCount = 0;
  let failedRuleCount = 0;
  let denominatorRules = 0;

  for (const result of testedRules.values()) {
    denominatorRules += 1;
    const weight = result.passed ? 1 : impactWeights[result.impact] ?? impactWeights.moderate;
    totalWeight += weight;
    if (result.passed) passedRuleCount += 1;
    else {
      failedRuleCount += 1;
      failedWeight += weight;
    }
  }

  return {
    score: totalWeight === 0 ? null : Math.round(((totalWeight - failedWeight) / totalWeight) * 100),
    denominatorRules,
    passedRuleCount,
    failedRuleCount,
    incompleteRuleCount: new Set(incomplete.map((result) => result.id)).size,
    inapplicableRuleCount: new Set(inapplicable.map((result) => result.id)).size,
    failedFindingCount: uniqueFindings(violations).length,
    severityCounts: uniqueFindings(violations).reduce((counts, finding) => {
      counts[finding.impact] = (counts[finding.impact] ?? 0) + 1;
      return counts;
    }, { critical: 0, serious: 0, moderate: 0, minor: 0 }),
    weights: { ...impactWeights },
    formula: "100 × passing applicable rule weight ÷ total passing and failing applicable rule weight; incomplete, inapplicable, and untested checks are excluded.",
  };
}

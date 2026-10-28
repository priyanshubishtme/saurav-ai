const MAX_NODES_PER_RULE = 40;
const wcagTagPattern = /^wcag(2|21|22)(a{1,3})$/i;

function normalizeWcagTag(tag) {
  const match = tag.match(wcagTagPattern);
  if (!match) return null;
  const version = match[1] === "2" ? "2.0" : `2.${match[1].slice(1)}`;
  const level = match[2].toUpperCase();
  return `WCAG ${version} ${level}`;
}

function normalizeNode(node) {
  return {
    targets: node.target ?? [],
    selector: node.target?.[0] ?? "",
    html: (node.html ?? "").slice(0, 2000),
    failureSummary: node.failureSummary ?? "",
    any: node.any ?? [],
    all: node.all ?? [],
    none: node.none ?? [],
    relatedNodes: (node.relatedNodes ?? []).map((relatedNode) => ({
      targets: relatedNode.target ?? [],
      html: (relatedNode.html ?? "").slice(0, 2000),
      failureSummary: relatedNode.failureSummary ?? "",
    })),
  };
}

function normalizeRule(rule) {
  return {
    id: rule.id,
    impact: rule.impact ?? null,
    description: rule.description,
    help: rule.help,
    helpUrl: rule.helpUrl,
    tags: rule.tags ?? [],
    wcagCriteria: [...new Set((rule.tags ?? []).map(normalizeWcagTag).filter(Boolean))],
    nodeCount: rule.nodes.length,
    nodesTruncated: rule.nodes.length > MAX_NODES_PER_RULE,
    nodes: rule.nodes.slice(0, MAX_NODES_PER_RULE).map(normalizeNode),
  };
}

export function normalizeAxeResults(results) {
  return {
    violations: results.violations.map(normalizeRule),
    passes: results.passes.map(normalizeRule),
    incomplete: results.incomplete.map(normalizeRule),
    inapplicable: results.inapplicable.map(normalizeRule),
    axeVersion: results.testEngine?.version ?? null,
    rulesEvaluated: results.passes.length
      + results.violations.length
      + results.incomplete.length
      + results.inapplicable.length,
  };
}

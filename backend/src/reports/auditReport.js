function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character]);
}

function getFindingRecommendation(ruleId) {
  const recommendations = {
    "image-alt": "Describe the image’s purpose in alt text. If it is decorative, use empty alt text; do not infer an image description without context.",
    label: "Associate a visible label with the form control using matching for/id attributes, or another appropriate accessible-name technique.",
    "button-name": "Give the button visible text or an accessible name that clearly describes its action.",
    "link-name": "Use link text that describes its destination, and provide text alternatives for image-only links.",
    "color-contrast": "Check the actual rendered foreground and background colors, then adjust them to meet the applicable contrast threshold.",
    "heading-order": "Review the content hierarchy and use heading levels that reflect the document structure rather than visual size.",
  };
  return recommendations[ruleId] ?? "Inspect the affected element in context and follow the axe-core rule guidance. Automated findings may need human review.";
}

function findingRows(audit) {
  return (audit.violations ?? []).flatMap((rule) => (rule.nodes ?? []).map((node) => `
    <article class="finding">
      <h3>${escapeHtml(rule.help)} <span>${escapeHtml(rule.impact ?? "unrated")}</span></h3>
      <h4>What this means</h4><p>${escapeHtml(rule.description)}</p>
      <p class="muted"><strong>Why it may matter:</strong> ${escapeHtml(rule.impact ? `axe-core rated this finding ${rule.impact}; the effect depends on the element and page context.` : "Review the page context to understand the user impact.")}</p>
      <h4>Recommended next step</h4><p>${escapeHtml(getFindingRecommendation(rule.id))}</p>
      <p><strong>Rule:</strong> ${escapeHtml(rule.id)} · <strong>WCAG:</strong> ${escapeHtml((rule.wcagCriteria ?? []).join(", ") || "Not tagged")}</p>
      <p><strong>Target:</strong> ${escapeHtml(node.selector || (node.targets ?? []).join(", "))}</p>
      <pre>${escapeHtml(node.html)}</pre>
      <p>${escapeHtml(node.failureSummary)}</p>
      ${typeof rule.helpUrl === "string" && rule.helpUrl.startsWith("https://") ? `<p><a href="${escapeHtml(rule.helpUrl)}" rel="noopener noreferrer">Read axe-core rule guidance</a></p>` : ""}
    </article>`)).join("");
}

export function buildAuditReport({ audit, repairs = [], verifications = [] }) {
  return {
    reportVersion: 1,
    generatedAt: new Date().toISOString(),
    audit: structuredClone(audit),
    repairs: structuredClone(repairs),
    verifications: structuredClone(verifications),
    limitations: [
      "Automated checks and scores do not establish legal compliance or full WCAG conformance.",
      "Manual accessibility review remains necessary.",
      "Audit, repair, and verification records are held in memory and may not survive a backend restart.",
    ],
  };
}

export function renderAuditReportHtml(report) {
  const audit = report.audit;
  const title = escapeHtml(audit.projectName ?? audit.source ?? "Accessibility audit");
  const wcag = audit.wcagLevel ? `WCAG ${escapeHtml(audit.wcagLevel)}` : "WCAG level unavailable";
  const scoreBreakdown = audit.summary.scoreBreakdown ?? {};
  const violationCount = audit.summary.violations ?? audit.violations?.length ?? 0;
  const affectedCount = audit.summary.violationNodes ?? "—";
  const executiveSummary = violationCount
    ? `The automated scan found ${violationCount} failing ${violationCount === 1 ? "rule" : "rules"} affecting ${affectedCount} reported elements. Review each finding and verify repairs with a follow-up scan.`
    : "The automated scan returned no axe-core violations. Review incomplete checks and assess the page manually; an empty violation list does not establish accessibility.";
  const repairs = report.repairs.map((repair) => `
    <article class="finding">
      <h3>${escapeHtml(repair.violationId)} · ${escapeHtml(repair.status)}</h3>
      <p>${escapeHtml(repair.explanation)}</p>
      <h4>Original</h4><pre>${escapeHtml(repair.originalCode)}</pre>
      <h4>Proposed patch</h4><pre>${escapeHtml(repair.proposedCode)}</pre>
    </article>`).join("");
  const verificationFindings = (verification) => {
    if (!verification.comparison) return "";
    const categories = [
      ["Resolved", verification.comparison.resolved ?? []],
      ["Still present", verification.comparison.remaining ?? []],
      ["New regressions", verification.comparison.newlyIntroduced ?? []],
      ["Changed", verification.comparison.changed ?? []],
      ["Manual review", verification.comparison.manualReview ?? []],
    ];
    return categories.map(([label, findings]) => `
      <h4>${escapeHtml(label)} (${findings.length})</h4>
      ${findings.map((item) => {
        const finding = item.after ?? item;
        const prior = item.before;
        return `<div class="finding-detail"><strong>${escapeHtml(finding.ruleId)} · ${escapeHtml(finding.selector)}</strong>
          ${prior ? `<p><strong>Before:</strong> ${escapeHtml(prior.failureSummary)}</p>` : ""}
          <p>${escapeHtml(finding.failureSummary ?? finding.help ?? "Review the affected target.")}</p>
          <pre>${escapeHtml(finding.html)}</pre></div>`;
      }).join("") || "<p>None recorded.</p>"}`).join("");
  };
  const verificationRows = report.verifications.map((verification) => `
    <article class="finding">
      <h3>${escapeHtml(verification.status)} · ${escapeHtml(verification.scope)}</h3>
      <p>Baseline ${escapeHtml(verification.baselineScore ?? "—")} → final ${escapeHtml(verification.finalScore ?? "—")} · difference ${escapeHtml(verification.scoreDifference ?? "—")}</p>
      <p>Source audit ${escapeHtml(verification.baselineAuditId)} · comparison baseline ${escapeHtml(verification.comparisonBaselineAuditId)} · original score ${escapeHtml(verification.sourceAuditScore ?? "—")}</p>
      <p>${escapeHtml(verification.comparison?.counts?.resolved ?? 0)} resolved · ${escapeHtml(verification.comparison?.counts?.remaining ?? 0)} remaining · ${escapeHtml(verification.comparison?.counts?.newlyIntroduced ?? 0)} regressions · ${escapeHtml(verification.comparison?.counts?.manualReview ?? 0)} incomplete/manual review</p>
      <p>Engine: ${escapeHtml(verification.engine?.name)} · configuration: WCAG ${escapeHtml(verification.configuration?.wcagLevel ?? "—")} · tags ${escapeHtml((verification.configuration?.axeTags ?? []).join(", "))}</p>
      ${verification.error ? `<p>${escapeHtml(verification.error.message)}</p>` : ""}
      ${verificationFindings(verification)}
    </article>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title} · AccessZ audit report</title><style>
    :root{color-scheme:light;font-family:system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#202638;background:#fff}
    *{box-sizing:border-box}
    body{max-width:960px;margin:36px auto;padding:0 28px;color:#202638;font-size:14px;line-height:1.65}
    header{padding:0 0 20px;border-bottom:2px solid #28334a}
    header .brand{margin:0 0 10px;color:#4e438e;font-size:11px;font-weight:750;letter-spacing:.13em}
    h1,h2,h3,h4{line-height:1.3;break-after:avoid-page;page-break-after:avoid}
    h1{max-width:780px;margin:0 0 12px;font-size:clamp(28px,5vw,38px);letter-spacing:-.04em;overflow-wrap:anywhere}
    h2{margin:30px 0 12px;padding-bottom:8px;border-bottom:1px solid #d5d9e2;font-size:20px}
    h3{margin:0 0 8px;font-size:16px}
    h4{margin:18px 0 7px;font-size:13px}
    p{margin:8px 0}
    code{overflow-wrap:anywhere}
    small,.muted{color:#586174}
    .report-meta{display:flex;flex-wrap:wrap;gap:6px 16px;color:#586174;font-size:12px}
    .screen-only{display:inline-flex;min-height:38px;align-items:center;margin:18px 0 0;padding:0 13px;border:0;border-radius:7px;background:#51459d;color:#fff;font:600 13px system-ui,sans-serif;cursor:pointer}
    .executive-summary{margin:20px 0;padding:15px 17px;border:1px solid #d5d9e2;border-left:4px solid #51459d;border-radius:8px;background:#f7f8fb}
    .executive-summary h2{margin:0 0 5px;padding:0;border:0;font-size:15px}
    .executive-summary p{margin:0;color:#3d4659}
    .summary{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
    .tile,.finding{padding:14px;border:1px solid #d5d9e2;border-radius:8px;background:#fff}
    .tile{min-height:82px}
    .tile strong{display:block;color:#586174;font-size:11px;font-weight:650}
    .tile .value{display:block;margin-top:5px;font-size:23px;font-weight:700;line-height:1.2}
    .finding{margin:12px 0}
    .finding h3 span{display:inline-block;margin-left:5px;font-size:11px;font-weight:650;text-transform:uppercase}
    .finding pre,.finding-detail pre{max-width:100%;margin:8px 0;padding:12px;overflow-wrap:anywhere;word-break:break-word;white-space:pre-wrap;background:#f3f5f8;border:1px solid #e2e5eb;border-radius:5px;font:12px/1.55 ui-monospace,SFMono-Regular,Consolas,monospace}
    .finding-detail{padding:10px;border-top:1px solid #d5d9e2;overflow-wrap:anywhere}
    .finding-detail strong{overflow-wrap:anywhere}
    .limits{padding-left:20px}
    .method-note{color:#3d4659}
    @page{size:auto;margin:16mm}
    @media(max-width:640px){body{margin:20px auto;padding:0 15px}.summary{grid-template-columns:repeat(2,minmax(0,1fr))}}
    @media print{
      :root,body{background:#fff!important;color:#111!important}
      body{max-width:none;margin:0;padding:0;font-size:10pt;line-height:1.45}
      .screen-only{display:none!important}
      h1{font-size:24pt}h2{margin-top:20pt;font-size:15pt}
      a{color:inherit;text-decoration:none}
      .tile,.finding,.executive-summary{break-inside:avoid-page;page-break-inside:avoid;box-shadow:none;background:#fff}
      .finding-detail{break-inside:avoid-page;page-break-inside:avoid}
      pre{white-space:pre-wrap!important;overflow:visible!important}
      header{border-color:#555}
    }
  </style></head><body>
    <header><p class="brand">ACCESSZ · ACCESSIBILITY AUDIT</p><h1>${title}</h1>
    <div class="report-meta"><span>Audit ID: <code>${escapeHtml(audit.id)}</code></span><span>Scanned: ${escapeHtml(new Date(audit.createdAt).toISOString())}</span><span>Status: Completed</span><span>${wcag}</span></div>
    <p><strong>Scope:</strong> ${escapeHtml(audit.sourceType)} · ${escapeHtml(audit.finalUrl ?? audit.projectName ?? "Controlled HTML snapshot")}</p>
    <button class="screen-only" type="button" onclick="window.print()">Print or save as PDF</button></header>
    <section class="executive-summary"><h2>Executive summary</h2><p>${escapeHtml(executiveSummary)}</p></section>
    <section class="summary" aria-label="Audit summary">
      <div class="tile"><strong>AccessZ score · not WCAG compliance</strong><span class="value">${escapeHtml(audit.summary.score ?? "—")} / 100</span></div>
      <div class="tile"><strong>Failing rules</strong><span class="value">${escapeHtml(violationCount)}</span></div>
      <div class="tile"><strong>Affected elements</strong><span class="value">${escapeHtml(affectedCount)}</span></div>
      <div class="tile"><strong>Passing checks</strong><span class="value">${escapeHtml(audit.summary.passes)}</span></div>
      <div class="tile"><strong>Incomplete · review needed</strong><span class="value">${escapeHtml(audit.summary.incomplete)}</span></div>
      <div class="tile"><strong>Inapplicable</strong><span class="value">${escapeHtml(audit.summary.inapplicable)}</span></div>
      <div class="tile"><strong>Duration</strong><span class="value">${escapeHtml(audit.durationMs)} ms</span></div>
    </section>
    <p><strong>Distinct affected findings:</strong> ${escapeHtml(scoreBreakdown.failedFindingCount ?? "—")} · <strong>Severity counts:</strong> ${escapeHtml(JSON.stringify(scoreBreakdown.severityCounts ?? {}))}</p>
    <p><strong>Engine:</strong> ${escapeHtml(audit.engine?.name)} · axe-core ${escapeHtml(audit.engine?.axeVersion)} · tags ${escapeHtml((audit.engine?.tags ?? []).join(", "))}</p>
    <p class="method-note"><strong>Score methodology:</strong> ${escapeHtml(scoreBreakdown.formula ?? "Not available.")} Weights: ${escapeHtml(JSON.stringify(scoreBreakdown.weights ?? {}))}. The score is a Hydra-defined indicator, not an official WCAG score.</p>
    <h2>Findings (${(audit.violations ?? []).length} rules)</h2>${findingRows(audit) || "<p>No violations were returned by this audit.</p>"}
    <h2>Repairs</h2>${repairs || "<p>No repair proposals recorded.</p>"}
    <h2>Verification</h2>${verificationRows || "<p>No verification runs recorded.</p>"}
    <h2>Scan limitations</h2><ul class="limits">${[...(audit.scanLimitations ?? []), ...report.limitations].map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>
  </body></html>`;
}

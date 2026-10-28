import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleCheck,
  CircleAlert,
  ClipboardCheck,
  Code2,
  Download,
  ExternalLink,
  FileClock,
  FileSearch,
  Eye,
  Info,
  LoaderCircle,
  Monitor,
  Moon,
  RotateCcw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Sun,
  WandSparkles,
  X,
} from "lucide-react";
import { Link, useLocation, useOutletContext, useParams, useSearchParams } from "react-router-dom";
import {
  applyRepair,
  downloadAuditReport,
  getAudit,
  getAuditRepairs,
  getAudits,
  getControlledArtifacts,
  getHealth,
  getVerifications,
  rejectRepair,
  rollbackRepair,
  suggestRepair,
  verifyAudit,
  verifyRepair,
} from "../api/client.js";
import { EmptyState } from "../components/EmptyState.jsx";
import { useToast } from "../components/useToast.js";
import { DEFAULT_PREFERENCES, readPreferences, savePreferences } from "../utils/preferences.js";
import { handleRadioGroupKeyDown } from "../utils/radioGroup.js";
import { PageHeading } from "./pages.jsx";

function getFindingGuidance(violation) {
  const guidance = {
    "image-alt": {
      meaning: "Assistive technology may not be able to communicate this image's purpose to people who cannot see it.",
      impact: "People may miss information or context conveyed by the image.",
      fix: 'Describe the image’s purpose in alt text. If it is purely decorative, use alt="". Do not guess at an image’s meaning.',
    },
    label: {
      meaning: "This form control does not have a programmatically associated label.",
      impact: "People using screen readers may not know what information the control requests.",
      fix: "Associate a visible <label> with the control using matching for/id attributes, or use another appropriate accessible-name technique.",
    },
    "button-name": {
      meaning: "This button does not expose a clear accessible name.",
      impact: "Assistive technology users may not know what action the button performs.",
      fix: "Add visible button text or an accessible name that describes the action. Keep decorative icons hidden from assistive technology.",
    },
    "link-name": {
      meaning: "This link does not expose a clear accessible name.",
      impact: "People navigating by links may not understand the link’s destination or purpose.",
      fix: "Use concise link text that describes its destination; provide text alternatives for image-only links.",
    },
    "color-contrast": {
      meaning: "Text or another visual element may not have enough contrast against its background.",
      impact: "Some people may find the content difficult to read, especially in bright conditions or at smaller text sizes.",
      fix: "Choose foreground and background colors that meet the applicable contrast threshold, then verify the actual rendered colors.",
    },
    "heading-order": {
      meaning: "The heading levels in this part of the page may skip a logical level.",
      impact: "A non-linear heading outline can make it harder to understand and navigate the page structure.",
      fix: "Review the content hierarchy and use heading levels that reflect its actual structure; do not change levels based on visual size alone.",
    },
    region: {
      meaning: "Some page content may be outside a landmark region.",
      impact: "People using landmark navigation may have difficulty locating or skipping to this content.",
      fix: "Place the content in an appropriate semantic landmark, such as main, nav, header, or footer, when it fits the page structure.",
    },
    "document-title": {
      meaning: "The page may be missing a useful document title.",
      impact: "People may have difficulty identifying the page in browser tabs, history, and assistive technology.",
      fix: "Provide a concise, descriptive <title> that identifies the page and its purpose.",
    },
    "html-has-lang": {
      meaning: "The primary language of the page may not be identified.",
      impact: "Screen readers may use the wrong pronunciation rules for page content.",
      fix: 'Set the correct language on the root element, for example <html lang="en">.',
    },
  };
  return guidance[violation.id] ?? {
    meaning: violation.description,
    impact: "The effect depends on the affected element and its context. Review the evidence before deciding how users are affected.",
    fix: "Use the axe-core rule guidance and inspect the affected element in context. Automated findings may need human review.",
  };
}

export function ResultsPage() {
  const [query, setQuery] = useState("");
  const [severity, setSeverity] = useState("All severities");
  const [audit, setAudit] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [selectedSelector, setSelectedSelector] = useState("");
  const previewRef = useRef(null);
  const location = useLocation();
  const navigationAudit = location.state?.audit;
  const [searchParams] = useSearchParams();
  const requestedAuditId = searchParams.get("auditId");
  const filters = ["All severities", "Critical", "Serious", "Moderate", "Minor"];

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setAudit(navigationAudit ?? null);
    setLoadError("");
    setLoading(true);

    async function loadResults() {
      try {
        if (navigationAudit && (!requestedAuditId || navigationAudit.id === requestedAuditId)) {
          if (active) setAudit(navigationAudit);
          return;
        }
        if (requestedAuditId) {
          const { audit: requestedAudit } = await getAudit(requestedAuditId, { signal: controller.signal });
          if (active) setAudit(requestedAudit);
          return;
        }
        const { audits } = await getAudits({ signal: controller.signal, limit: 1 });
        if (!audits.length) {
          if (active) setAudit(null);
          return;
        }
        const { audit: latestAudit } = await getAudit(audits[0].id, { signal: controller.signal });
        if (active) setAudit(latestAudit);
      } catch (error) {
        if (error.name !== "AbortError" && active) setLoadError(error.message);
      } finally {
        if (active) setLoading(false);
      }
    }

    loadResults();
    return () => {
      active = false;
      controller.abort();
    };
  }, [navigationAudit, requestedAuditId]);

  const filteredViolations = useMemo(() => {
    if (!audit) return [];
    const normalizedQuery = query.trim().toLowerCase();
    return audit.violations.filter((violation) => {
      if (severity !== "All severities" && violation.impact !== severity.toLowerCase()) return false;
      if (!normalizedQuery) return true;
      const evidence = violation.nodes.map((node) => [node.selector, node.html, node.failureSummary, ...node.targets].join(" ")).join(" ");
      return `${violation.id} ${violation.impact} ${violation.description} ${violation.help} ${violation.wcagCriteria.join(" ")} ${evidence}`.toLowerCase().includes(normalizedQuery);
    });
  }, [audit, query, severity]);

  function highlightElement(selector) {
    setSelectedSelector(selector);
    previewRef.current?.contentWindow?.postMessage({ type: "a11ypilot-highlight", selector }, "*");
  }

  return (
    <div className="page-content workflow-page results-page">
      <PageHeading eyebrow="REAL BROWSER AUDIT · AXE-CORE" title={<>Accessibility<br /><span className="gradient-text">findings.</span></>} description="Understand what was detected, why it may matter, and where to review it. Every finding below comes from this completed scan." />
      <section className="panel results-panel">
        {audit && (
          <div className="audit-result-header">
            <div className="audit-result-project">
              <span className="audit-result-mark"><Eye size={16} /></span>
              <div><strong>{audit.projectName ?? audit.source}</strong><span>{audit.sourceType === "url" ? audit.finalUrl : "Sanitized, isolated HTML preview"}</span></div>
            </div>
            <div className="audit-result-meta">
              <span><CircleCheck size={13} /> {audit.engine?.name ?? "axe-core"}</span>
              <span>Single-page scan</span>
              <span>Private account history</span>
              <span>{new Date(audit.createdAt).toLocaleString()}</span>
              <span>{(audit.durationMs / 1000).toFixed(1)}s</span>
              <span>WCAG {audit.wcagLevel}</span>
            </div>
          </div>
        )}
        {audit?.historyNotice && <p className="history-storage-note" role="status"><Info size={15} />{audit.historyNotice}</p>}
        <div className="results-toolbar">
          <label className="results-search"><Search size={16} /><input type="search" aria-label="Search audit findings" placeholder="Search issues, selectors, WCAG…" value={query} onChange={(event) => setQuery(event.target.value)} /></label>
          <div className="severity-filters" role="group" aria-label="Filter by severity" aria-disabled={!audit}>
            {filters.map((filter) => <button key={filter} type="button" aria-pressed={severity === filter} className={`severity-filter${severity === filter ? " severity-filter-active" : ""}`} onClick={() => setSeverity(filter)}>{filter}</button>)}
          </div>
          {(query || severity !== "All severities") && <button className="results-reset" type="button" onClick={() => { setQuery(""); setSeverity("All severities"); }}><RotateCcw size={13} /> Clear filters</button>}
        </div>
        {audit && <div className="score-summary">
          <div className="score-indicator"><span className="score-value">{audit.summary.score ?? "—"}</span><span className="score-label">ACCESSZ SCORE · NOT WCAG COMPLIANCE</span></div>
          <div className="score-stats">
            <span className="score-stat severity-critical"><strong>{audit.summary.scoreBreakdown.failedRuleCount}</strong><small>failing rules</small></span>
            <span className="score-stat severity-passes"><strong>{audit.summary.passes}</strong><small>passing rules</small></span>
            <span className="score-stat severity-review"><strong>{audit.summary.incomplete}</strong><small>need review</small></span>
            <span className="score-stat"><strong>{audit.summary.inapplicable}</strong><small>not applicable</small></span>
          </div>
        </div>}
        {audit && <div className="results-weight-note"><Info size={14} /><span>{audit.summary.scoreBreakdown.formula} Weights: critical 5, serious 4, moderate 2, minor 1; each passing rule has weight 1. Incomplete and inapplicable rules are excluded.</span></div>}
        {loading && <div className="results-loading" role="status"><LoaderCircle size={18} className="spin" /> Loading real audit results…</div>}
        {loadError && <p className="form-message form-message-error" role="alert"><CircleAlert size={15} />{loadError}</p>}
        {!loading && !loadError && !audit && <EmptyState eyebrow="Your results start with a real scan" title="No completed audit yet." description="Run an audit or scan the intentionally inaccessible built-in sample to see actual findings and evidence." actionLabel="Run an accessibility scan" />}
        {audit && !loading && <div className="result-content">
          {audit.previewHtml && <section className="preview-panel">
            <div className="preview-heading"><div><p className="eyebrow">ISOLATED HTML PREVIEW</p><strong>Highlight an affected element</strong></div><span className="preview-safety"><ShieldCheck size={13} /> Opaque origin · scripts removed · no network</span></div>
            <iframe ref={previewRef} title={`Isolated preview: ${audit.projectName}`} sandbox="allow-scripts" srcDoc={buildPreviewDocument(audit.previewHtml)} className="audit-preview-frame" />
          </section>}
          {audit.violations.length === 0 ? <div className="results-clean-state"><CircleCheck size={22} /><div><strong>No axe-core violations were detected.</strong><p>This is not proof of accessibility or WCAG conformance. Review incomplete checks, scan limitations, and the page manually.</p></div></div> : <div className="violation-list" aria-label="Accessibility violations">
            <div className="violation-list-heading"><div><p className="eyebrow">AUTOMATED VIOLATIONS</p><h2>{filteredViolations.length} of {audit.violations.length} rules</h2></div><span className="violation-count">{audit.summary.violationNodes} affected nodes</span></div>
            {filteredViolations.length ? filteredViolations.map((violation) => <article className="violation-card" key={violation.id}>
              <div className="violation-card-heading"><span className={`impact-badge impact-${violation.impact ?? "moderate"}`}>{violation.impact ?? "Needs review"}</span><span className="violation-rule-id">{violation.id}</span>{violation.wcagCriteria.map((criterion) => <span className="wcag-badge" key={criterion}>{criterion}</span>)}</div>
              <h3>{violation.help}</h3>
              <div className="finding-explainer">
                <div><h4>What this means</h4><p>{getFindingGuidance(violation).meaning}</p></div>
                <div><h4>Why it may matter</h4><p>{getFindingGuidance(violation).impact}</p></div>
                <div><h4>Suggested next step</h4><p>{getFindingGuidance(violation).fix}</p></div>
              </div>
              <p className="violation-description">{violation.description}</p>
              <div className="violation-actions"><span>{violation.nodeCount} affected {violation.nodeCount === 1 ? "element" : "elements"}{violation.nodesTruncated ? " · evidence truncated" : ""}</span><Link className="text-link" to={`/audits/${audit.id}/issues/${encodeURIComponent(violation.id)}`} state={{ audit, issue: violation }}>Issue details <ArrowUpRight size={14} /></Link></div>
              <div className="violation-evidence">
                {violation.nodes.map((node, index) => <details className="evidence-node" key={`${node.selector}-${index}`}>
                  <summary><Code2 size={13} /><code>{node.selector || node.targets.join(", ") || "Affected page element"}</code><span>Evidence &amp; failure summary</span></summary>
                  <div className="evidence-content">
                    <div className="evidence-control-row">{audit.previewHtml && node.selector && <button type="button" className={`text-link highlight-button${selectedSelector === node.selector ? " highlight-selected" : ""}`} onClick={() => highlightElement(node.selector)}><Eye size={13} /> Highlight in preview</button>}</div>
                    <pre className="evidence-html"><code>{node.html || "No HTML snippet provided by axe-core."}</code></pre>
                    {node.failureSummary && <p className="failure-summary">{node.failureSummary}</p>}
                    {node.targets.length > 0 && <p className="target-summary"><strong>Target paths:</strong> {node.targets.join(" · ")}</p>}
                    {node.relatedNodes.length > 0 && <div className="related-nodes"><strong>Related elements</strong>{node.relatedNodes.map((related, relatedIndex) => <pre key={relatedIndex}>{related.html || related.targets.join(", ")}{related.failureSummary ? `\n${related.failureSummary}` : ""}</pre>)}</div>}
                  </div>
                </details>)}
              </div>
              <a className="axe-help-link" href={violation.helpUrl} target="_blank" rel="noreferrer">Read axe-core guidance <ExternalLink size={12} /></a>
            </article>) : <div className="filter-empty"><Search size={17} /><strong>No matching violations.</strong><span>Try a different search or severity filter.</span></div>}
          </div>}
          {audit.incomplete.length > 0 && <section className="secondary-results-section"><h2><CircleAlert size={16} /> Incomplete checks · human review required ({audit.incomplete.length})</h2><p>These checks could not be decided automatically. They are not reported as violations.</p>{audit.incomplete.map((rule) => <RuleEvidence key={rule.id} rule={rule} kind="incomplete" />)}</section>}
          <details className="secondary-results-section passing-rules"><summary><CircleCheck size={16} /> Passing axe-core rules ({audit.passes.length})</summary><p>Rules reported as passed by axe-core in this specific scan.</p>{audit.passes.map((rule) => <RuleEvidence key={rule.id} rule={rule} kind="pass" />)}</details>
          <details className="secondary-results-section passing-rules"><summary><Info size={16} /> Inapplicable axe-core rules ({audit.inapplicable.length})</summary><p>These rules had no matching content or controls in this page; they are not counted in the score.</p>{audit.inapplicable.map((rule) => <RuleEvidence key={rule.id} rule={rule} kind="pass" />)}</details>
          <details className="secondary-results-section passing-rules"><summary><Info size={16} /> Keyboard review candidates ({audit.keyboardAudit?.candidates?.length ?? 0})</summary><p>Keyboard heuristics are candidates for manual investigation—not definitive WCAG failures.</p>{audit.keyboardAudit?.candidates?.map((candidate, index) => <div className="keyboard-candidate" key={`${candidate.type}-${index}`}><span className="wcag-badge">{candidate.classification}</span><strong>{candidate.type}</strong><code>{candidate.selector || "Document focus order"}</code><p>{candidate.explanation}</p>{candidate.html && <pre>{candidate.html}</pre>}</div>)}</details>
          <details className="secondary-results-section passing-rules scan-limitations"><summary><Info size={16} /> Engine, scan limitations &amp; blocked requests</summary><p>Requested {new Date(audit.createdAt).toLocaleString()} · duration {(audit.durationMs / 1000).toFixed(2)} seconds · engine axe-core {audit.engine.axeVersion ?? "version unavailable"}.</p>{audit.scanLimitations.map((limitation) => <p key={limitation}>• {limitation}</p>)}{audit.blockedRequests?.map((blocked, index) => <p key={index}><code>{blocked.reason}</code> · {blocked.url}</p>)}</details>
        </div>}
      </section>
      {audit && <div className="results-engine-note"><CircleAlert size={15} /><span>Automated checks inform review; they do not prove full WCAG conformance.</span></div>}
    </div>
  );
}

export function IssueDetailPage() {
  const { auditId, issueId } = useParams();
  const location = useLocation();
  const [audit, setAudit] = useState(location.state?.audit ?? null);
  const [issue, setIssue] = useState(location.state?.issue ?? null);
  const [loadError, setLoadError] = useState("");

  useEffect(() => {
    if (issue) return undefined;
    const controller = new AbortController();
    getAudit(auditId, { signal: controller.signal })
      .then(({ audit: loadedAudit }) => {
        setAudit(loadedAudit);
        setIssue(loadedAudit.violations.find((violation) => violation.id === issueId) ?? null);
      })
      .catch((error) => {
        if (error.name !== "AbortError") setLoadError(error.message);
      });
    return () => controller.abort();
  }, [auditId, issueId, issue]);

  if (!audit || !issue) {
    return (
      <div className="page-content workflow-page">
        <PageHeading eyebrow="ISSUE DETAIL" title="Finding the evidence." description={loadError || "Loading the saved audit finding."} />
        {loadError ? <EmptyState eyebrow="Audit unavailable" title="This finding could not be loaded." description={loadError} actionLabel="Run a new audit" /> : <div className="results-loading" role="status"><LoaderCircle size={18} className="spin" /> Loading issue details…</div>}
      </div>
    );
  }

  return (
    <div className="page-content workflow-page issue-detail-page">
      <PageHeading eyebrow={`AXE RULE · ${issue.id}`} title={<>{issue.help}<br /><span className="gradient-text">Evidence, not guesses.</span></>} description={issue.description}>
        <div className="issue-detail-actions">
          <Link className="button button-primary" to={`/workspace?auditId=${encodeURIComponent(audit.id)}&violationId=${encodeURIComponent(issue.id)}`}><WandSparkles size={15} /> Prepare repair</Link>
          <Link className="button button-secondary" to={`/audits/results?auditId=${encodeURIComponent(audit.id)}`} state={{ audit }}><ArrowRight size={15} /> Back to results</Link>
        </div>
      </PageHeading>
      <div className="issue-detail-layout">
        <section className="panel issue-detail-card">
          <div className="violation-card-heading"><span className={`impact-badge impact-${issue.impact ?? "moderate"}`}>{issue.impact ?? "Needs review"}</span>{issue.wcagCriteria.map((criterion) => <span className="wcag-badge" key={criterion}>{criterion}</span>)}</div>
          <h2>{issue.help}</h2><div className="finding-explainer">{Object.entries(getFindingGuidance(issue)).map(([label, text]) => <div key={label}><h3>{label === "meaning" ? "What this means" : label === "impact" ? "Why it may matter" : "Suggested next step"}</h3><p>{text}</p></div>)}</div><p>{issue.description}</p><a className="axe-help-link" href={issue.helpUrl} target="_blank" rel="noreferrer">Read rule guidance <ExternalLink size={12} /></a>
          {issue.nodes.map((node, index) => <div className="issue-element" key={`${node.selector}-${index}`}><p className="eyebrow">AFFECTED ELEMENT {index + 1}</p><code>{node.selector || node.targets.join(", ") || "Page element"}</code><pre className="evidence-html"><code>{node.html}</code></pre>{node.failureSummary && <p className="failure-summary">{node.failureSummary}</p>}{node.relatedNodes.length > 0 && <div className="related-nodes"><strong>Related elements</strong>{node.relatedNodes.map((related, relatedIndex) => <pre key={relatedIndex}>{related.html || related.targets.join(", ")}{related.failureSummary ? `\n${related.failureSummary}` : ""}</pre>)}</div>}</div>)}
        </section>
        <aside className="panel workflow-next"><div className="workflow-icon"><Eye size={19} /></div><p className="eyebrow">AUDIT CONTEXT</p><h2>{audit.projectName ?? audit.source}</h2><div className="workflow-steps"><div className="workflow-step"><span>01</span><p>Scanned {new Date(audit.createdAt).toLocaleString()}</p></div><div className="workflow-step"><span>02</span><p>{issue.nodeCount} affected elements returned by axe-core</p></div><div className="workflow-step"><span>03</span><p>Engine: {audit.engine.name}</p></div></div><p className="form-footer-note"><Info size={14} /> Automated finding; inspect the full page and assistive technology output before applying changes.</p></aside>
      </div>
    </div>
  );
}

function RuleEvidence({ rule, kind }) {
  return <details className={`rule-evidence rule-evidence-${kind}`}><summary><span className="violation-rule-id">{rule.id}</span><span>{rule.help}</span><span>{rule.nodeCount} nodes</span></summary><p>{rule.description}</p>{rule.wcagCriteria.map((criterion) => <span className="wcag-badge" key={criterion}>{criterion}</span>)}{rule.nodes.slice(0, 3).map((node, index) => <pre className="evidence-html" key={index}>{node.selector}\n{node.html}{node.failureSummary ? `\n${node.failureSummary}` : ""}</pre>)}</details>;
}

function buildPreviewDocument(sanitizedHtml) {
  const nonce = globalThis.crypto?.randomUUID?.().replaceAll("-", "") ?? `${Date.now()}${Math.random().toString(36).slice(2)}`;
  const encodedMarkup = JSON.stringify(sanitizedHtml).replaceAll("<", "\\u003c");
  const controller = `const source=${encodedMarkup};document.body.innerHTML=source;window.addEventListener("message",function(event){if(event.source!==window.parent||event.data?.type!=="a11ypilot-highlight"||typeof event.data.selector!=="string")return;try{const target=document.querySelector(event.data.selector);if(!target)return;target.scrollIntoView({block:"center",behavior:"smooth"});target.style.setProperty("outline","3px solid #a89dff","important");target.style.setProperty("outline-offset","3px","important");setTimeout(()=>{target.style.removeProperty("outline");target.style.removeProperty("outline-offset")},3500)}catch{}},false);`;
  const policy = `default-src 'none'; script-src 'nonce-${nonce}'; connect-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; frame-src 'none'; object-src 'none'; base-uri 'none'; form-action 'none'`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${policy}"><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:16px;background:#fff;color:#161922;font:14px/1.5 system-ui,sans-serif}</style></head><body></body><script nonce="${nonce}">${controller}</script></html>`;
}

export function RepairWorkspacePage() {
  const [searchParams] = useSearchParams();
  const queryAuditId = searchParams.get("auditId") ?? "";
  const [audits, setAudits] = useState([]);
  const [audit, setAudit] = useState(null);
  const [auditId, setAuditId] = useState(queryAuditId);
  const [violationId, setViolationId] = useState(searchParams.get("violationId") ?? "");
  const [nodeIndex, setNodeIndex] = useState(0);
  const [provider, setProvider] = useState(null);
  const [repair, setRepair] = useState(null);
  const [existingRepairs, setExistingRepairs] = useState([]);
  const [artifacts, setArtifacts] = useState([]);
  const [artifactId, setArtifactId] = useState("");
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");
  const [dialogAction, setDialogAction] = useState("");
  const [manualConfirmed, setManualConfirmed] = useState(false);
  const dialogRef = useRef(null);
  const returnFocusRef = useRef(null);
  const notify = useToast();

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      getAudits({ signal: controller.signal, limit: 25 }),
      getHealth({ signal: controller.signal }),
      getControlledArtifacts({ signal: controller.signal }),
    ]).then(([{ audits: records }, health, { artifacts: ownedArtifacts }]) => {
      setAudits(records);
      setArtifacts(ownedArtifacts);
      setProvider(health.capabilities?.aiSuggestions ?? { provider: "groq", status: "unavailable" });
      if (!queryAuditId && records.length) setAuditId(records[0].id);
      setLoading(false);
    }).catch((requestError) => {
      if (requestError.name !== "AbortError") {
        setError(requestError.message);
        setLoading(false);
      }
    });
    return () => controller.abort();
  }, [queryAuditId]);

  useEffect(() => {
    const auditArtifact = artifacts.find((item) => item.auditId === auditId);
    const unassociatedArtifact = artifacts.find((item) => !item.auditId);
    setArtifactId(auditArtifact?.id ?? unassociatedArtifact?.id ?? "");
  }, [auditId, artifacts]);

  useEffect(() => {
    if (!auditId) {
      setAudit(null);
      return undefined;
    }
    const controller = new AbortController();
    setLoading(true);
    setError("");
    Promise.all([
      getAudit(auditId, { signal: controller.signal }),
      getAuditRepairs(auditId, { signal: controller.signal }),
    ]).then(([{ audit: selectedAudit }, { repairs: records }]) => {
        setAudit(selectedAudit);
        setExistingRepairs(records);
        setViolationId((current) => selectedAudit.violations.some((item) => item.id === current)
          ? current
          : selectedAudit.violations[0]?.id ?? "");
        setNodeIndex(0);
        setRepair(records.at(-1) ?? null);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [auditId]);

  const selectedViolation = audit?.violations.find((item) => item.id === violationId) ?? null;
  const selectedNode = selectedViolation?.nodes[nodeIndex] ?? null;

  useEffect(() => {
    if (dialogAction) dialogRef.current?.focus();
    else returnFocusRef.current?.focus();
  }, [dialogAction]);

  async function createSuggestion() {
    if (!audit || !selectedViolation || !selectedNode) return;
    if (!artifactId) {
      setError("No controlled HTML source is associated with this audit. Run an HTML audit or add an owned HTML artifact before requesting a repair.");
      return;
    }
    setWorking(true);
    setError("");
    setManualConfirmed(false);
    try {
      const { repair: suggestion } = await suggestRepair({
        auditId: audit.id,
        artifactId,
        violationId: selectedViolation.id,
        nodeIndex,
      });
      setRepair(suggestion);
      setExistingRepairs((current) => [...current.filter((record) => record.id !== suggestion.id), suggestion]);
      if (suggestion.providerStatus) setProvider(suggestion.providerStatus);
      notify(suggestion.source === "groq" ? "Groq repair suggestion is ready for review." : "A deterministic or manual fallback is ready.", "success");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function applySuggestion() {
    if (!repair) return;
    setWorking(true);
    setError("");
    try {
      const { repair: accepted } = await applyRepair(repair.id, manualConfirmed, {
        reviewedPatchHash: repair.patchHash,
        artifactVersion: repair.artifactVersion,
      });
      setRepair(accepted);
      setExistingRepairs((current) => current.map((record) => record.id === accepted.id ? accepted : record));
      setDialogAction("");
      notify("Patch applied to the controlled repair artifact. It is not verified.", "success");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function rejectSuggestion() {
    if (!repair) return;
    setWorking(true);
    setError("");
    try {
      const { repair: rejected } = await rejectRepair(repair.id);
      setRepair(rejected);
      setExistingRepairs((current) => current.map((record) => record.id === rejected.id ? rejected : record));
      notify("Repair suggestion rejected.", "info");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function rollbackSuggestion() {
    if (!repair) return;
    setWorking(true);
    setError("");
    try {
      const { repair: rolledBack } = await rollbackRepair(repair.id);
      setRepair(rolledBack);
      setExistingRepairs((current) => current.map((record) => record.id === rolledBack.id ? rolledBack : record));
      setDialogAction("");
      notify("The controlled artifact was rolled back to its original source.", "success");
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setWorking(false);
    }
  }

  async function copyCode(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      notify(`${label} copied.`, "success");
    } catch {
      setError("Clipboard access is unavailable. Select and copy the code manually.");
    }
  }

  if (loading && !audit && audits.length === 0) {
    return <div className="page-content workflow-page"><PageHeading eyebrow="REPAIR WORKSPACE" title="Review a safe, scoped patch." description="Choose a real axe-core finding and decide whether its proposed change belongs in your source." /><div className="results-loading" role="status"><LoaderCircle size={18} className="spin" /> Loading completed audits…</div></div>;
  }

  return (
    <div className="page-content workflow-page repair-page">
      <PageHeading eyebrow="REPAIR COPILOT · HUMAN APPROVAL REQUIRED" title={<>Better fixes, with<br /><span className="gradient-text">you in control.</span></>} description="Start from a real finding, inspect a minimal patch, then apply only to a controlled HTML artifact—not to a live website." />
      <section className="panel repair-selection-panel">
        <div className="repair-selection-head"><div><p className="eyebrow">01 · SELECT REAL EVIDENCE</p><h2>Choose an audit finding</h2></div><Link className="text-link" to="/audits/new">Run a new audit <ArrowUpRight size={14} /></Link></div>
        <div className="repair-select-grid">
          <label className="field-label" htmlFor="repair-audit-select">Completed audit
            <select id="repair-audit-select" className="settings-select" value={auditId} onChange={(event) => setAuditId(event.target.value)} disabled={working || !audits.length}>
              {!audits.length && <option value="">No completed audits</option>}
              {audits.map((record) => <option value={record.id} key={record.id}>{record.projectName ?? record.source} · {new Date(record.createdAt).toLocaleString()}</option>)}
            </select>
          </label>
          <label className="field-label" htmlFor="repair-violation-select">Accessibility violation
            <select id="repair-violation-select" className="settings-select" value={violationId} onChange={(event) => { setViolationId(event.target.value); setNodeIndex(0); setRepair(null); }} disabled={!audit?.violations.length || working}>
              {!audit?.violations.length && <option value="">No violations in this audit</option>}
              {audit?.violations.map((violation) => <option value={violation.id} key={violation.id}>[{violation.impact ?? "review"}] {violation.id} · {violation.help}</option>)}
            </select>
          </label>
          <label className="field-label" htmlFor="repair-node-select">Affected element
            <select id="repair-node-select" className="settings-select" value={nodeIndex} onChange={(event) => { setNodeIndex(Number(event.target.value)); setRepair(null); }} disabled={!selectedViolation?.nodes.length || working}>
              {selectedViolation?.nodes.map((node, index) => <option value={index} key={`${node.selector}-${index}`}>{node.selector || node.targets.join(", ") || `Element ${index + 1}`}</option>)}
            </select>
          </label>
        </div>
        {existingRepairs.length > 0 && <label className="field-label repair-history-select" htmlFor="repair-history-select">Existing repair suggestions
          <select id="repair-history-select" className="settings-select" value={repair?.id ?? ""} onChange={(event) => setRepair(existingRepairs.find((record) => record.id === event.target.value) ?? null)}>
            {existingRepairs.map((record) => <option value={record.id} key={record.id}>{record.violationId} · {record.status} · {new Date(record.createdAt).toLocaleString()}</option>)}
          </select>
        </label>}
        {selectedViolation && selectedNode && <div className="repair-finding-summary"><div className="violation-card-heading"><span className={`impact-badge impact-${selectedViolation.impact ?? "moderate"}`}>{selectedViolation.impact ?? "needs review"}</span><span className="violation-rule-id">{selectedViolation.id}</span>{selectedViolation.wcagCriteria.map((criterion) => <span className="wcag-badge" key={criterion}>{criterion}</span>)}</div><h3>{selectedViolation.help}</h3><p>{selectedViolation.description}</p><code>{selectedNode.selector}</code><pre className="evidence-html">{selectedNode.html}</pre><p className="form-footer-note"><Info size={14} /> Only this affected element and bounded surrounding context are sent to Groq when a suggestion is requested. Scanned HTML is untrusted data, never instructions.</p></div>}
        {!loading && !error && !audits.length && <EmptyState eyebrow="Start from actual scan output" title="No completed audit is available." description="Run a real URL or HTML audit first. Repair suggestions are never generated from seeded or invented findings." actionLabel="Run an accessibility audit" />}
        {audit && !audit.violations.length && <EmptyState eyebrow="This audit has no violations" title="No repair is needed from these results." description="Incomplete checks and keyboard review candidates require human assessment and are not represented as automated violations." actionLabel="Review audit results" actionTo={`/audits/results?auditId=${encodeURIComponent(audit.id)}`} />}
        <div className="repair-controls-row">
          <span className={`provider-status provider-status-${provider?.status ?? "unavailable"}`} role="status"><Sparkles size={14} /> GROQ · {provider?.status === "not_configured" ? "NOT CONFIGURED · DETERMINISTIC FALLBACK ENABLED" : provider?.status === "available" ? "AVAILABLE" : provider?.status === "temporarily_unavailable" ? "TEMPORARILY UNAVAILABLE · FALLBACK ENABLED" : provider?.status === "misconfigured" ? "MODEL CONFIGURATION ISSUE · FALLBACK ENABLED" : provider?.status === "configured" ? `CONFIGURED · ${provider.model}` : "STATUS UNAVAILABLE"}</span>
          <button type="button" className="button button-primary" onClick={() => void createSuggestion()} disabled={!selectedViolation || !selectedNode || working}>
            {working ? <><LoaderCircle size={15} className="spin" /> Preparing suggestion…</> : <><WandSparkles size={15} /> Generate Fix Suggestion</>}
          </button>
        </div>
      </section>

      {error && <p className="form-message form-message-error" role="alert"><CircleAlert size={15} />{error}</p>}

      {repair && <section className="repair-review panel" aria-labelledby="repair-review-title">
        <div className="repair-review-header"><div><p className="eyebrow">02 · REVIEW THE PATCH</p><h2 id="repair-review-title">{repair.source === "groq" ? "Groq-generated suggestion" : "Deterministic / manual suggestion"}</h2></div><span className={`repair-state repair-state-${repair.status}`}>{repair.status.replace("_", " ")}</span></div>
        {repair.fallbackReason && <p className="repair-fallback-note"><Info size={15} />{repair.fallbackReason}</p>}
        <p>{repair.explanation}</p><p className="repair-rationale"><strong>Accessibility rationale</strong> {repair.accessibilityRationale}</p>
        {repair.cssPatch && <section className="repair-css-patch" aria-label="CSS repair details">
          <strong>{repair.applicable ? "CSS-only patch" : "CSS evidence"} · {repair.cssPatch.application}</strong>
          <code>Target: {repair.cssPatch.targetSelector}</code>
          {repair.cssPatch.originalDeclaration && <pre className="repair-code">{repair.cssPatch.originalDeclaration}</pre>}
          {repair.cssPatch.proposedDeclaration && <pre className="repair-code repair-code-proposed">{repair.cssPatch.proposedDeclaration}</pre>}
          {repair.cssPatch.evidence && <p className="form-footer-note">
            Rendered evidence: text {repair.cssPatch.evidence.foreground ?? "unknown"} on {repair.cssPatch.evidence.effectiveBackground ?? "unknown background"}
            {repair.cssPatch.evidence.fontSize ? ` · ${repair.cssPatch.evidence.fontSize}` : ""}
            {repair.cssPatch.evidence.fontWeight ? ` · weight ${repair.cssPatch.evidence.fontWeight}` : ""}.
          </p>}
          {repair.cssPatch.contrastCheck && <p className="form-footer-note">
            {repair.cssPatch.contrastCheck.ratio === null
              ? "Candidate contrast ratio needs manual review."
              : `Calculated candidate: ${repair.cssPatch.contrastCheck.ratio}:1${repair.cssPatch.contrastCheck.requiredRatio ? ` (required ${repair.cssPatch.contrastCheck.requiredRatio}:1)` : ""}.`}
            This estimate is not verification; only a successful rescan can verify the repair.
          </p>}
        </section>}
        {repair.expectedVerificationCriteria?.length > 0 && <div className="repair-assumptions"><strong>Expected verification criteria</strong><ul>{repair.expectedVerificationCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}</ul></div>}
        {repair.assumptions.length > 0 && <div className="repair-assumptions"><strong>Assumptions to check</strong><ul>{repair.assumptions.map((assumption) => <li key={assumption}>{assumption}</li>)}</ul></div>}
        {repair.manualReviewRequired && <p className="repair-manual-warning"><CircleAlert size={15} /> Human review required before applying. Confirm the proposed content is accurate and appropriate.</p>}
        {repair.applicable ? <div className="repair-diff" aria-label="Before and after code diff">
          <section><div className="repair-code-head"><h3>Original</h3><button type="button" className="quiet-button" onClick={() => void copyCode(repair.originalCode, "Original code")} aria-label="Copy original code"><ClipboardCheck size={14} /> Copy</button></div><pre className="repair-code"><code>{highlightMarkup(repair.originalCode)}</code></pre></section>
          <section><div className="repair-code-head"><h3>Proposed</h3><button type="button" className="quiet-button" onClick={() => void copyCode(repair.proposedCode, "Proposed code")} aria-label="Copy proposed code"><ClipboardCheck size={14} /> Copy</button></div><pre className="repair-code repair-code-proposed"><code>{highlightMarkup(repair.proposedCode)}</code></pre></section>
        </div> : <div className="repair-no-patch"><Info size={15} /><span>No automatic patch is safe for this finding. Use the explanation to make and review a contextual manual change.</span></div>}
        {repair.status === "proposed" && <div className="repair-actions">
          <button type="button" className="button button-secondary" onClick={() => void rejectSuggestion()} disabled={working}><X size={15} /> Reject Fix</button>
          <button type="button" className="button button-secondary" onClick={() => void createSuggestion()} disabled={working}><RotateCcw size={14} /> Regenerate Suggestion</button>
          {repair.applicable && <button type="button" className="button button-primary" onClick={(event) => { returnFocusRef.current = event.currentTarget; setManualConfirmed(false); setDialogAction("apply"); }} disabled={working || !repair.patchHash}><Eye size={15} /> Review Patch</button>}
        </div>}
        {["applied", "verified", "needs_review"].includes(repair.status) && <div className="repair-applied-block">
          <p className="repair-verified-label"><ShieldCheck size={15} /> Applied to controlled artifact · <strong>{repair.status === "verified" ? "Verified by rescan" : repair.status === "needs_review" ? "Needs review" : "Not verified"}</strong></p>
          <div className="repair-code-head"><h3>Updated artifact preview</h3><button type="button" className="quiet-button" onClick={() => void copyCode(repair.updatedArtifact, "Updated artifact")}><ClipboardCheck size={14} /> Copy artifact</button></div>
          <iframe title="Applied repair artifact preview" sandbox="allow-scripts" srcDoc={buildPreviewDocument(repair.updatedArtifact)} className="audit-preview-frame" />
          <div className="repair-actions">
            {repair.status !== "verified" && <Link className="button button-primary" to={`/verification?auditId=${encodeURIComponent(repair.auditId)}&repairId=${encodeURIComponent(repair.id)}`}><ClipboardCheck size={14} /> Verify repaired artifact</Link>}
            <button type="button" className="button button-secondary" onClick={(event) => { returnFocusRef.current = event.currentTarget; setDialogAction("rollback"); }} disabled={working}><RotateCcw size={14} /> Roll back patch</button>
          </div>
          <p className="form-footer-note"><Info size={14} /> A patch is verified only after the controlled artifact completes a new scan and the relevant finding is absent. Incomplete checks or regressions require review.</p>
        </div>}
        {repair.status === "rolled_back" && <p className="repair-fallback-note"><RotateCcw size={15} /> Original source restored. This repair can no longer be applied.</p>}
        {repair.status === "rejected" && <p className="repair-fallback-note"><X size={15} /> You rejected this suggestion. No source was changed.</p>}
      </section>}

      {dialogAction && repair && <div className="repair-dialog-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) setDialogAction(""); }}>
        <section className="repair-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="repair-confirm-title" aria-describedby="repair-confirm-description" tabIndex={-1} ref={dialogRef} onKeyDown={(event) => {
          if (event.key === "Escape") setDialogAction("");
          if (event.key === "Tab") {
            const focusable = [...event.currentTarget.querySelectorAll('button:not(:disabled), input:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
            const first = focusable[0];
            const last = focusable[focusable.length - 1];
            if (event.shiftKey && (document.activeElement === first || document.activeElement === dialogRef.current)) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialogRef.current)) {
              event.preventDefault();
              first?.focus();
            }
          }
        }}>
          <p className="eyebrow">{dialogAction === "apply" ? "EXPLICIT APPROVAL" : "ROLLBACK"}</p>
          <h2 id="repair-confirm-title">{dialogAction === "apply" ? "Apply this scoped patch?" : "Restore the original source?"}</h2>
          <p id="repair-confirm-description">{dialogAction === "apply" ? "The change will affect only the saved, user-controlled HTML artifact. It will never modify a live website." : "Rollback restores the exact source snapshot captured before this patch was applied."}</p>
          {dialogAction === "apply" && <p className="repair-manual-warning">This approval is bound to the displayed patch hash and artifact version. If either changed, the backend will reject this approval and require a new review.</p>}
          {dialogAction === "apply" && repair.manualReviewRequired && <label className="repair-review-confirm"><input type="checkbox" checked={manualConfirmed} onChange={(event) => setManualConfirmed(event.target.checked)} /> I reviewed the assumptions and confirm this content is accurate, including any suggested alternative text.</label>}
          <div className="repair-actions"><button type="button" className="button button-secondary" onClick={() => setDialogAction("")} disabled={working}>Cancel</button><button type="button" className="button button-primary" onClick={() => void (dialogAction === "apply" ? applySuggestion() : rollbackSuggestion())} disabled={working || (dialogAction === "apply" && repair.manualReviewRequired && !manualConfirmed)}>{working ? "Working…" : dialogAction === "apply" ? "Approve & Apply Fix" : "Roll back"}</button></div>
        </section>
      </div>}
    </div>
  );
}

function highlightMarkup(source) {
  const tokens = source.split(/(<\/?[\w-]+|\/?>|[\w:-]+(?==)|"(?:[^"]*)"|'(?:[^']*)')/g);
  return tokens.map((token, index) => {
    if (/^<\/?[\w-]+|\/?>$/.test(token)) return <span className="code-token-tag" key={index}>{token}</span>;
    if (/^[\w:-]+$/.test(token)) return <span className="code-token-attribute" key={index}>{token}</span>;
    if (/^["']/.test(token)) return <span className="code-token-string" key={index}>{token}</span>;
    return token;
  });
}

export function VerificationPage() {
  const [searchParams] = useSearchParams();
  const [audits, setAudits] = useState([]);
  const [auditId, setAuditId] = useState(searchParams.get("auditId") ?? "");
  const [repairs, setRepairs] = useState([]);
  const [repairId, setRepairId] = useState(searchParams.get("repairId") ?? "");
  const [verifications, setVerifications] = useState([]);
  const [activeVerification, setActiveVerification] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getAudits({ signal: controller.signal, limit: 25 }).then(({ audits: records }) => {
      setAudits(records);
      setAuditId((current) => current || records[0]?.id || "");
    }).catch((requestError) => {
      if (requestError.name !== "AbortError") setError(requestError.message);
    }).finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  const refreshHistory = useCallback(async (selectedAuditId) => {
    if (!selectedAuditId) return;
    const [repairResponse, verificationResponse] = await Promise.all([
      getAuditRepairs(selectedAuditId),
      getVerifications(selectedAuditId),
    ]);
    setRepairs(repairResponse.repairs);
    setVerifications(verificationResponse.verifications);
    setRepairId((current) => repairResponse.repairs.some((repair) => repair.id === current)
      ? current
      : repairResponse.repairs.find((repair) => ["applied", "needs_review", "verified"].includes(repair.status))?.id ?? "");
  }, []);

  useEffect(() => {
    if (!auditId) {
      setRepairs([]);
      setVerifications([]);
      return undefined;
    }
    let active = true;
    setError("");
    refreshHistory(auditId).catch((requestError) => {
      if (active) setError(requestError.message);
    });
    return () => { active = false; };
  }, [auditId, refreshHistory]);

  async function runVerification(kind) {
    if (!auditId) return;
    setWorking(true);
    setError("");
    setActiveVerification(null);
    try {
      const result = kind === "repair"
        ? await verifyRepair(repairId)
        : await verifyAudit(auditId);
      setActiveVerification(result.verification);
      await refreshHistory(auditId);
    } catch (requestError) {
      setActiveVerification(requestError.data?.verification ?? null);
      setError(requestError.message);
      await refreshHistory(auditId).catch(() => {});
    } finally {
      setWorking(false);
    }
  }

  const selectedAudit = audits.find((audit) => audit.id === auditId);
  const selectedRepair = repairs.find((repair) => repair.id === repairId);
  const verification = activeVerification ?? verifications.at(-1) ?? null;
  const comparison = verification?.comparison;
  const remainingCritical = [
    ...(comparison?.remaining ?? []),
    ...(comparison?.newlyIntroduced ?? []),
    ...(comparison?.changed ?? []).map((finding) => finding.after),
  ].filter((finding) => finding.impact === "critical").length;
  const groups = [
    ["Resolved", comparison?.resolved, "verified"],
    ["Still present", comparison?.remaining, "review"],
    ["Changed", comparison?.changed, "review"],
    ["New regressions", comparison?.newlyIntroduced, "error"],
    ["Manual review", comparison?.manualReview, "review"],
  ];

  return (
    <div className="page-content workflow-page verification-page">
      <PageHeading eyebrow="EVIDENCE-BASED VERIFICATION" title={<>Prove the improvement.<br /><span className="gradient-text">Catch regressions, too.</span></>} description="A repair is verified only when a successful rescan confirms the relevant finding is gone. Incomplete checks stay visible for human review." />
      {error && <p className="form-message form-message-error" role="alert"><CircleAlert size={15} />{error}</p>}
      {loading && <div className="results-loading" role="status"><LoaderCircle size={17} className="spin" /> Loading audit history…</div>}
      {!loading && !audits.length && <EmptyState eyebrow="Start from real scan evidence" title="No completed audit is available." description="Run an accessibility audit before comparing results. Verification never uses seeded findings." actionLabel="Start an audit" />}
      {!!audits.length && <>
        <section className="panel verification-controls">
          <label className="field-label" htmlFor="verification-audit">Baseline audit</label>
          <select id="verification-audit" className="settings-select" value={auditId} onChange={(event) => { setAuditId(event.target.value); setActiveVerification(null); }}>
            {audits.map((audit) => <option value={audit.id} key={audit.id}>{audit.projectName ?? audit.source} · {new Date(audit.createdAt).toLocaleString()}</option>)}
          </select>
          <div className="verification-control-actions">
            <button type="button" className="button button-secondary" onClick={() => void runVerification("full")} disabled={working || !selectedAudit}>
              {working ? <><LoaderCircle size={15} className="spin" /> Scanning…</> : <><RotateCcw size={15} /> Run full audit again</>}
            </button>
            <label className="field-label" htmlFor="verification-repair">Applied repair</label>
            <select id="verification-repair" className="settings-select" value={repairId} onChange={(event) => setRepairId(event.target.value)} disabled={!repairs.length}>
              <option value="">Select an applied repair</option>
              {repairs.map((repair) => <option key={repair.id} value={repair.id}>{repair.violationId} · {repair.status}</option>)}
            </select>
            <button type="button" className="button button-primary" onClick={() => void runVerification("repair")} disabled={working || !selectedRepair || !["applied", "needs_review", "verified"].includes(selectedRepair.status)}>
              {working ? <><LoaderCircle size={15} className="spin" /> Verifying…</> : <><ClipboardCheck size={15} /> Verify selected repair</>}
            </button>
          </div>
          {selectedAudit && <p className="form-footer-note"><Info size={14} /> Baseline {selectedAudit.summary.score ?? "—"}/100 · {selectedAudit.sourceType === "url" ? "A live URL rescan is environmental; use the controlled repair snapshot for reliable patch verification." : "The original sanitized HTML audit is retained as the baseline."}</p>}
        </section>

        {verification && <section className="panel verification-result" aria-live="polite">
          <div className="verification-result-heading">
            <div><p className="eyebrow">LATEST RESCAN · {verification.scanStatus ?? verification.status}</p><h2>{verification.status === "verified" ? "Finding confirmed resolved" : verification.status === "failed" ? "Verification did not complete" : verification.status === "environmental_change" ? "Live page may have changed" : "Human review required"}</h2></div>
            <span className={`repair-state repair-state-${verification.status}`}>{verification.status.replaceAll("_", " ")}</span>
          </div>
          {verification.error && <p className="form-message form-message-error" role="alert">{verification.error.message}</p>}
          <div className="verification-score-row">
            <div><small>Baseline score</small><strong>{verification.baselineScore ?? "—"}</strong></div>
            <ArrowRight size={17} />
            <div><small>Follow-up score</small><strong>{verification.finalScore ?? "Not available"}</strong></div>
            <div><small>Difference</small><strong>{verification.scoreDifference === null ? "—" : `${verification.scoreDifference > 0 ? "+" : ""}${verification.scoreDifference}`}</strong></div>
            <div><small>Distinct baseline findings</small><strong>{comparison?.counts.baselineDistinctFindings ?? "—"}</strong></div>
            <div><small>Remaining critical issues</small><strong>{remainingCritical}</strong></div>
          </div>
          {verification.summary && <div className="verification-check-stats" aria-label="Follow-up check outcomes">
            <span>Passed <strong>{verification.summary.passes}</strong></span>
            <span>Failed <strong>{verification.summary.violations}</strong></span>
            <span>Incomplete <strong>{verification.summary.incomplete}</strong></span>
            <span>Inapplicable <strong>{verification.summary.inapplicable}</strong></span>
          </div>}
          {comparison && <div className="verification-findings-grid">{groups.map(([label, findings, tone]) => <section className={`verification-finding-group verification-tone-${tone}`} key={label}>
            <h3>{label} <span>{findings?.length ?? 0}</span></h3>
            {!findings?.length && <p>None recorded.</p>}
            {findings?.map((finding, index) => {
              const current = finding.after ?? finding;
              const prior = finding.before;
              return <details key={`${current.ruleId}-${current.selector}-${index}`}>
                <summary><strong>{current.ruleId}</strong> · {current.selector || "Target unavailable"}</summary>
                {prior && <p><strong>Before:</strong> {prior.failureSummary}</p>}
                <p>{current.failureSummary ?? current.help ?? "Review the affected target."}</p>
                <pre className="evidence-html">{current.html}</pre>
              </details>;
            })}
          </section>)}</div>}
          <p className="form-footer-note"><Info size={14} /> Score changes reflect actual scan results, not raw violation counts. This indicator is not a legal compliance determination or proof of full WCAG conformance.</p>
        </section>}

        <section className="panel verification-timeline">
          <div className="panel-heading"><div><p className="eyebrow">AUDIT TRAIL</p><h2>Verification timeline</h2></div><span className="history-count">{verifications.length} runs</span></div>
          {!verifications.length && <p className="form-footer-note">No verification runs have been recorded for this baseline.</p>}
          {verifications.map((record) => <button type="button" className="verification-timeline-row" key={record.id} onClick={() => setActiveVerification(record)}>
            <span className={`impact-badge impact-${record.status === "verified" ? "minor" : record.status === "failed" ? "critical" : "moderate"}`}>{record.status.replaceAll("_", " ")}</span>
            <span>{new Date(record.createdAt).toLocaleString()} · {record.scope}</span>
            <strong>{record.finalScore ?? "—"}</strong>
          </button>)}
        </section>
      </>}
    </div>
  );
}

export function ReportsPage() {
  const [audits, setAudits] = useState([]);
  const [historyStorage, setHistoryStorage] = useState("mongodb");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getAudits({ signal: controller.signal, limit: 25 })
      .then(({ audits: records, storage }) => {
        setAudits(records);
        setHistoryStorage(storage ?? "mongodb");
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message);
      })
      .finally(() => setLoading(false));
    return () => controller.abort();
  }, []);

  async function exportAudit(auditId, format) {
    try {
      await downloadAuditReport(auditId, format);
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  return (
    <div className="page-content workflow-page reports-page">
      <PageHeading eyebrow="YOUR AUDIT HISTORY" title={<>A record of making<br /><span className="gradient-text">the web work better.</span></>} description="Your audits, reports, and verified improvements—kept together in one place." />
      <section className="panel history-panel">
        <div className="history-heading"><div><p className="eyebrow">{historyStorage === "mongodb" ? "PRIVATE ACCOUNT HISTORY · MONGODB ATLAS" : "PRIVATE ACCOUNT HISTORY"}</p><h2>Audit history</h2></div><span className="history-count">{audits.length} audits</span></div>
        {loading && <div className="results-loading" role="status"><LoaderCircle size={17} className="spin" /> Loading saved audits…</div>}
        {error && <p className="form-message form-message-error" role="alert"><CircleAlert size={15} />{error}</p>}
        {!loading && !error && !audits.length && <EmptyState eyebrow="Your history starts here" title="No completed audits yet." description="Completed scans and repair records are associated with your AccessZ account and stored in MongoDB Atlas when the service is configured. This history follows your account across devices." actionLabel="Create your first audit" />}
        {audits.length > 0 && <div className="history-list">{audits.map((audit) => <div className="history-item" key={audit.id}>
          <span className="history-item-icon"><FileClock size={17} /></span>
          <div className="history-item-main"><strong>{audit.projectName ?? audit.source}</strong><span>{audit.sourceType === "url" ? audit.finalUrl : `HTML · WCAG ${audit.wcagLevel}`} · {new Date(audit.createdAt).toLocaleString()} · Private account history</span></div>
          <div className="history-item-score"><strong>{audit.summary.score ?? "—"}</strong><span>{audit.summary.violations} violations · {(audit.durationMs / 1000).toFixed(1)}s</span></div>
          <Link className="round-arrow" to={`/audits/results?auditId=${encodeURIComponent(audit.id)}`} aria-label={`View results for ${audit.projectName ?? audit.source}`}><ArrowUpRight size={15} /></Link>
          <button type="button" className="quiet-button" onClick={() => void exportAudit(audit.id, "json")} aria-label={`Export ${audit.projectName ?? audit.source} JSON report`} title="Export JSON report"><Download size={15} /> JSON</button>
          <button type="button" className="quiet-button" onClick={() => void exportAudit(audit.id, "html")} aria-label={`Export ${audit.projectName ?? audit.source} HTML report`} title="Export print-friendly HTML report"><FileSearch size={15} /> HTML</button>
        </div>)}</div>}
        <div className="report-footnote"><Info size={14} /> Audit history, repairs, and verification records are stored in the account’s MongoDB-backed workspace. Browser-local audit history is disabled for signed-in accounts to prevent data from crossing between users who share a device.</div>
      </section>
    </div>
  );
}

export function SettingsPage() {
  const notify = useToast();
  const { theme, setTheme } = useOutletContext();
  const [preferences, setPreferences] = useState(readPreferences);
  const [apiState, setApiState] = useState({ loading: true, health: null, error: "" });
  const healthControllerRef = useRef(null);
  const aiStatus = apiState.health?.capabilities?.aiSuggestions;

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(preferences.reducedMotion);
  }, [preferences.reducedMotion]);

  useEffect(() => {
    if (!savePreferences(preferences)) {
      notify("Browser storage is unavailable; your audit preferences could not be saved.", "info");
    }
  }, [preferences, notify]);

  const checkApi = useCallback(async () => {
    healthControllerRef.current?.abort();
    const controller = new AbortController();
    healthControllerRef.current = controller;
    setApiState({ loading: true, health: null, error: "" });
    try {
      const health = await getHealth({ signal: controller.signal });
      setApiState({ loading: false, health, error: "" });
    } catch (error) {
      if (error.name !== "AbortError") setApiState({ loading: false, health: null, error: error.message });
    } finally {
      if (healthControllerRef.current === controller) healthControllerRef.current = null;
    }
  }, []);

  useEffect(() => {
    checkApi();
    return () => healthControllerRef.current?.abort();
  }, [checkApi]);

  function updatePreference(name, value) {
    setPreferences((current) => ({ ...current, [name]: value }));
  }

  function resetPreferences() {
    setPreferences(DEFAULT_PREFERENCES);
    setTheme("light");
    notify("Preferences restored to their defaults.", "success");
  }

  return (
    <div className="page-content settings-page">
      <PageHeading eyebrow="MAKE IT YOURS" title={<>A workspace that<br /><span className="gradient-text">works for you.</span></>} description="Tune your experience. Your preferences stay on this device." />
      <div className="settings-layout">
        <div className="settings-main">
          <section className="panel settings-card">
            <div className="settings-section-head"><div className="settings-heading-icon"><Monitor size={17} /></div><div><h2>Appearance</h2><p>Choose the look and feel of your workspace.</p></div></div>
            <div className="theme-options" role="radiogroup" aria-label="Theme">
              <button type="button" className={`theme-option${theme === "dark" ? " theme-option-selected" : ""}`} onClick={() => setTheme("dark")} onKeyDown={(event) => handleRadioGroupKeyDown(event, ["dark", "light"], theme, setTheme)} role="radio" tabIndex={theme === "dark" ? 0 : -1} aria-checked={theme === "dark"}><span className="theme-preview theme-preview-dark"><i /><i /><i /></span><span className="theme-option-label"><Moon size={14} /> Dark</span>{theme === "dark" && <Check size={15} className="theme-check" />}</button>
              <button type="button" className={`theme-option${theme === "light" ? " theme-option-selected" : ""}`} onClick={() => setTheme("light")} onKeyDown={(event) => handleRadioGroupKeyDown(event, ["dark", "light"], theme, setTheme)} role="radio" tabIndex={theme === "light" ? 0 : -1} aria-checked={theme === "light"}><span className="theme-preview theme-preview-light"><i /><i /><i /></span><span className="theme-option-label"><Sun size={14} /> Light</span>{theme === "light" && <Check size={15} className="theme-check" />}</button>
            </div>
          </section>
          <section className="panel settings-card">
            <div className="settings-section-head"><div className="settings-heading-icon"><Settings2 size={17} /></div><div><h2>Audit preferences</h2><p>Set the defaults used when you prepare a new audit.</p></div></div>
            <label className="settings-level-row" htmlFor="default-level"><span><strong>Default WCAG level</strong><small>Recommended for most public-facing experiences.</small></span><select id="default-level" className="settings-select" value={preferences.defaultLevel} onChange={(event) => updatePreference("defaultLevel", event.target.value)}><option value="A">WCAG A</option><option value="AA">WCAG AA</option><option value="AAA">WCAG AAA</option></select></label>
            <label className="toggle-row settings-toggle"><span className="toggle-copy"><strong>Include best-practice checks</strong><small>Prefill this option in new audit forms.</small></span><input type="checkbox" checked={preferences.includeBestPractices} onChange={(event) => updatePreference("includeBestPractices", event.target.checked)} /><span className="toggle-ui" aria-hidden="true" /></label>
            <label className="toggle-row settings-toggle"><span className="toggle-copy"><strong>Reduce motion</strong><small>Prefer calmer transitions and animations.</small></span><input type="checkbox" checked={preferences.reducedMotion} onChange={(event) => updatePreference("reducedMotion", event.target.checked)} /><span className="toggle-ui" aria-hidden="true" /></label>
          </section>
          <section className="panel settings-card">
            <div className="settings-section-head"><div className="settings-heading-icon"><Sparkles size={17} /></div><div><h2>AI suggestions</h2><p>AI assistance is optional and is never needed for audits.</p></div></div>
            <div className="integration-row"><div className="integration-brand">G</div><div className="integration-copy"><strong>Groq repair copilot</strong><span>Backend-only configuration: <code>GROQ_API_KEY</code> · <code>GROQ_MODEL</code></span></div><span className={`integration-status${aiStatus?.status === "available" ? " integration-online" : " integration-not-ready"}`}><span />{aiStatus?.status === "available" ? "Available" : aiStatus?.status === "configured" ? "Configured" : aiStatus?.status === "temporarily_unavailable" ? "Temporarily unavailable" : aiStatus?.status === "misconfigured" ? "Model configuration issue" : aiStatus?.status === "not_configured" ? "Not configured" : "Status unavailable"}</span></div>
            <p className="integration-hint"><Info size={14} /> Scanning works without Groq. Suggestions use safe deterministic/manual fallbacks when Groq is not configured or available. Keys and source snippets never appear in browser configuration.</p>
          </section>
          <section className="panel settings-card">
            <div className="settings-section-head"><div className="settings-heading-icon"><ShieldCheck size={17} /></div><div><h2>Service status</h2><p>Check whether the AccessZ API can be reached.</p></div></div>
            <div className="service-row"><div className="service-mark"><Code2 size={17} /></div><div className="integration-copy"><strong>Backend API</strong><span>{apiState.health?.service ?? "accessz-api"}</span></div><span className={`integration-status${apiState.health ? " integration-online" : ""}`}>{apiState.loading ? <><LoaderCircle size={13} className="spin" />Checking</> : apiState.health ? <><span />Connected</> : <><span />Offline</>}</span><button type="button" className="quiet-button" onClick={checkApi} disabled={apiState.loading} aria-label="Check API status" title="Check API status"><RotateCcw size={15} /></button></div>
            {apiState.error && <p className="service-error" role="status"><Info size={14} />{apiState.error}</p>}
            <div className="engine-row"><span>Automated scan engine</span><span className={`engine-badge${apiState.health?.scanner?.status === "available" ? " engine-badge-online" : ""}`}><span />{apiState.loading ? "Checking" : apiState.health?.scanner?.status === "available" ? "Playwright + axe-core ready" : apiState.health ? "Chromium unavailable" : "Status unavailable"}</span></div>
            <div className="engine-row"><span>Account persistence</span><span className={`engine-badge${apiState.health?.database?.status === "connected" ? " engine-badge-online" : ""}`}><span />{apiState.loading ? "Checking" : apiState.health?.database?.status === "connected" ? "MongoDB Atlas connected" : apiState.health?.database?.status === "not_configured" ? "MongoDB not configured" : apiState.health ? "MongoDB unavailable" : "Status unavailable"}</span></div>
            <div className="engine-row"><span>Authentication</span><span className={`engine-badge${apiState.health?.capabilities?.authentication === "available" ? " engine-badge-online" : ""}`}><span />{apiState.loading ? "Checking" : apiState.health?.capabilities?.authentication === "available" ? "Available" : "Unavailable"}</span></div>
          </section>
          <div className="settings-reset-row"><span>Preferences are saved locally in your browser.</span><button type="button" className="text-link" onClick={resetPreferences}><RotateCcw size={14} /> Reset preferences</button></div>
        </div>
        <aside className="settings-aside">
          <div className="settings-aside-orb"><ShieldCheck size={23} /></div>
          <p className="eyebrow">MADE FOR PEOPLE</p>
          <h2>Accessibility isn't a score.</h2>
          <p>It's the everyday work of making sure everyone can use what we build.</p>
          <div className="aside-values"><span><Check size={14} /> Real evidence over estimates</span><span><Check size={14} /> Developers stay in control</span><span><Check size={14} /> Accessibility as a practice</span></div>
          <Link className="aside-learn-link" to="/audits/new">Start with a page <ArrowRight size={14} /></Link>
        </aside>
      </div>
    </div>
  );
}

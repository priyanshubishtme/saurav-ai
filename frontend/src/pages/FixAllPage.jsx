import { useEffect, useState } from "react";
import { ArrowDownToLine, Check, CircleAlert, Clipboard, Code2, Globe2, LoaderCircle, Monitor, RotateCcw, ShieldCheck, Smartphone, WandSparkles } from "lucide-react";
import { Link } from "react-router-dom";
import { createHtmlAudit, createUrlAudit, getAudit, getControlledArtifact, getControlledArtifacts, applyBulkRepair, proposeBulkRepair, rollbackBulkRepair, verifyAudit, verifyBulkRepair } from "../api/client.js";
import { PageHeading } from "./pages.jsx";

function buildSafePreview(html, css) {
  const parsed = new DOMParser().parseFromString(html, "text/html");
  parsed.querySelectorAll("script, iframe, object, embed, base, meta[http-equiv='refresh'], meta[http-equiv='Content-Security-Policy']").forEach((node) => node.remove());
  parsed.querySelectorAll("*").forEach((element) => {
    for (const attribute of [...element.attributes]) {
      if (/^on/i.test(attribute.name)) element.removeAttribute(attribute.name);
    }
  });
  const policy = document.createElement("meta");
  policy.httpEquiv = "Content-Security-Policy";
  policy.content = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:; media-src data: blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
  parsed.head.prepend(policy);
  if (css) {
    const style = parsed.createElement("style");
    style.textContent = css;
    parsed.head.append(style);
  }
  return `<!doctype html>${parsed.documentElement.outerHTML}`;
}

function downloadText(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function findingsCount(audit) {
  return audit?.violations?.reduce((count, item) => count + item.nodeCount, 0) ?? 0;
}

export function FixAllPage() {
  const [mode, setMode] = useState("html");
  const [html, setHtml] = useState("");
  const [css, setCss] = useState("");
  const [projectName, setProjectName] = useState("Pasted HTML");
  const [url, setUrl] = useState("");
  const [audit, setAudit] = useState(null);
  const [artifact, setArtifact] = useState(null);
  const [draft, setDraft] = useState(null);
  const [verification, setVerification] = useState(null);
  const [working, setWorking] = useState(false);
  const [confirmApply, setConfirmApply] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [viewport, setViewport] = useState("desktop");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    getControlledArtifacts({ signal: controller.signal }).then(async ({ artifacts }) => {
      const rollbackRecord = artifacts.find((item) => item.bulkRollbackAvailable);
      if (!rollbackRecord || !active) return;
      const [{ artifact: fullArtifact }, { audit: savedAudit }] = await Promise.all([
        getControlledArtifact(rollbackRecord.id, { signal: controller.signal }),
        getAudit(rollbackRecord.auditId, { signal: controller.signal }),
      ]);
      if (!active) return;
      setArtifact(fullArtifact);
      setAudit(savedAudit);
      setMode(savedAudit.sourceType === "url" ? "url" : "html");
      setHtml(fullArtifact.html);
      setCss(fullArtifact.additionalCss ?? "");
      setNotice("Recovered an applied bulk repair. You can verify the controlled artifact again or revert it to its saved original source.");
    }).catch((requestError) => {
      if (active && requestError.name !== "AbortError") setError(requestError.message);
    });
    return () => { active = false; controller.abort(); };
  }, []);

  async function scanSource(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    setDraft(null);
    setVerification(null);
    setArtifact(null);
    setWorking(true);
    try {
      let result;
      if (mode === "url") {
        const candidate = new URL(url.trim());
        if (!["http:", "https:"].includes(candidate.protocol) || candidate.username || candidate.password) {
          throw new Error("Enter a public HTTP or HTTPS URL without embedded credentials.");
        }
        result = await createUrlAudit({ url: candidate.href });
      } else {
        const combinedBytes = new TextEncoder().encode(html).length + new TextEncoder().encode(css).length;
        if (!html.trim()) throw new Error("Paste the HTML source to scan.");
        if (combinedBytes > 300_000) throw new Error("HTML and CSS must total 300 KB or less. The source has not been truncated.");
        result = await createHtmlAudit({ html, additionalCss: css || undefined, projectName: projectName.trim() || "Pasted HTML" });
      }
      setAudit(result.audit);
      setHtml(result.audit.sourceType === "url" ? result.audit.renderedHtml ?? "" : html);
      setCss(result.audit.sourceType === "url" ? result.audit.capturedCss ?? "" : css);
      const { artifacts } = await getControlledArtifacts();
      const record = artifacts.find((item) => item.auditId === result.audit.id);
      if (record) {
        const full = await getControlledArtifact(record.id);
        setArtifact(full.artifact);
        setHtml(full.artifact.html);
        setCss(full.artifact.additionalCss ?? "");
      }
      if (result.audit.sourceType === "url" && !result.audit.sourceCapture?.available) {
        setNotice(result.audit.sourceCapture?.reason ?? "The page was scanned but no editable rendered source could be captured.");
      } else if (result.audit.sourceType === "url") {
        const missingStyles = result.audit.sourceCapture?.inaccessibleStylesheets?.length ?? 0;
        setNotice(missingStyles
          ? `Captured rendered HTML and ${result.audit.sourceCapture.capturedStylesheets} stylesheet(s); ${missingStyles} stylesheet(s) could not be read. The candidate preview may differ from the live page.`
          : `Captured rendered HTML and ${result.audit.sourceCapture?.capturedStylesheets ?? 0} readable stylesheet(s).`);
      }
    } catch (requestError) {
      setError(requestError.message || "The source could not be scanned.");
    } finally {
      setWorking(false);
    }
  }

  async function generateAll() {
    if (!audit || !artifact) return;
    setWorking(true);
    setError("");
    setNotice("");
    setVerification(null);
    try {
      const { draft: generated } = await proposeBulkRepair({ auditId: audit.id, artifactId: artifact.id });
      setDraft(generated);
      setHtml(generated.originalHtml);
      setCss(generated.originalCss);
      setNotice("The repaired candidate was scanned with the real accessibility scanner before it was shown. Review every change; it remains unapplied.");
    } catch (requestError) {
      setError(requestError.message || "A complete repair candidate could not be generated. The original source remains available.");
    } finally {
      setWorking(false);
    }
  }

  async function applyAll() {
    if (!draft || !artifact) return;
    setWorking(true);
    setError("");
    try {
      const result = await applyBulkRepair({ draftId: draft.id, patchHash: draft.patchHash, artifactVersion: draft.artifactVersion, confirmed: true });
      setDraft((current) => ({ ...current, status: result.draft.status, appliedVersion: result.draft.appliedVersion }));
      setArtifact((current) => ({ ...current, ...result.artifact, bulkRollbackAvailable: true, bulkDraftId: draft.id }));
      setHtml(result.artifact.html);
      setCss(result.artifact.additionalCss ?? "");
      setConfirmApply(false);
      setConfirmed(false);
      setNotice("All validated, non-conflicting changes were applied to your controlled artifact only. The live website was not changed.");
    } catch (requestError) {
      setError(requestError.message || "The patches could not be applied.");
    } finally {
      setWorking(false);
    }
  }

  async function verifyAgain() {
    if (!draft && !audit) return;
    setWorking(true);
    setError("");
    try {
      const result = draft ? await verifyBulkRepair(draft.id) : await verifyAudit(audit.id);
      setVerification(result);
      setNotice("Verification used a new scan of the applied controlled artifact. This does not establish full WCAG conformance or confirm demo wording quality.");
    } catch (requestError) {
      setError(requestError.message || "The applied artifact could not be rescanned.");
    } finally {
      setWorking(false);
    }
  }

  async function revertAll() {
    if (!artifact) return;
    setWorking(true);
    setError("");
    try {
      const result = await rollbackBulkRepair(artifact.id, draft?.id ?? artifact.bulkDraftId);
      setArtifact((current) => ({ ...current, ...result.artifact, bulkRollbackAvailable: false, bulkDraftId: undefined }));
      setDraft((current) => current ? { ...current, status: "rolled_back" } : current);
      setHtml(result.artifact.html);
      setCss(result.artifact.additionalCss ?? "");
      setVerification(null);
      setNotice("The controlled artifact was restored to its exact pre-apply source snapshot.");
    } catch (requestError) {
      setError(requestError.message || "The source could not be reverted.");
    } finally {
      setWorking(false);
    }
  }

  async function copy(value, label) {
    try {
      await navigator.clipboard.writeText(value);
      setNotice(`${label} copied.`);
    } catch {
      setError("Clipboard access is unavailable; select the source text and copy it manually.");
    }
  }

  const originalHtml = draft?.originalHtml ?? artifact?.html ?? html;
  const originalCss = draft?.originalCss ?? artifact?.additionalCss ?? css;
  const repairedHtml = draft?.repairedHtml ?? html;
  const repairedCss = draft?.repairedCss ?? css;
  const beforePreview = buildSafePreview(originalHtml, originalCss);
  const afterPreview = buildSafePreview(repairedHtml, repairedCss);

  return (
    <div className="page-content workflow-page fix-all-page">
      <PageHeading eyebrow="BULK ACCESSIBILITY REPAIR · REVIEW REQUIRED" title={<>Fix the findings.<br /><span className="gradient-text">Keep control.</span></>} description="Scan pasted source or a public URL, generate a complete candidate, compare real scan results, and apply only after review." />
      <section className="panel fix-all-source-panel">
        <div className="source-tabs" role="group" aria-label="Source input mode">
          <button type="button" className={`source-tab${mode === "html" ? " source-tab-active" : ""}`} aria-pressed={mode === "html"} onClick={() => { setMode("html"); setAudit(null); setArtifact(null); setDraft(null); }}><Code2 size={16} /> Paste HTML and CSS</button>
          <button type="button" className={`source-tab${mode === "url" ? " source-tab-active" : ""}`} aria-pressed={mode === "url"} onClick={() => { setMode("url"); setAudit(null); setArtifact(null); setDraft(null); }}><Globe2 size={16} /> Scan public URL</button>
        </div>
        <form onSubmit={(event) => void scanSource(event)} className="fix-all-source-form">
          {mode === "url" ? <label className="field-label" htmlFor="fix-all-url">Public page URL<input id="fix-all-url" type="url" value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/page" required /><span className="field-hint">Fetching happens only on the backend. Private/local destinations and unsafe redirects are blocked; authenticated pages are not accessed.</span></label> : <>
            <label className="field-label" htmlFor="fix-all-project">Project name<input id="fix-all-project" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={100} /></label>
            <label className="field-label" htmlFor="fix-all-html">Original HTML <span className="optional-label">MAX 300 KB WITH CSS</span><textarea id="fix-all-html" className="code-input" rows={12} value={html} onChange={(event) => setHtml(event.target.value)} placeholder="Paste the complete HTML document here" spellCheck="false" /></label>
            <label className="field-label" htmlFor="fix-all-css">Separate CSS <span className="optional-label">OPTIONAL · MAX 100 KB</span><textarea id="fix-all-css" className="code-input" rows={7} value={css} onChange={(event) => setCss(event.target.value)} placeholder="Paste CSS not already included in the HTML" spellCheck="false" /></label>
          </>}
          <button type="submit" className="button button-primary" disabled={working}>{working ? <><LoaderCircle size={15} className="spin" /> Scanning source…</> : <><ShieldCheck size={15} /> {mode === "url" ? "Fetch and Scan" : "Scan Code"}</>}</button>
        </form>
        {error && <p className="form-message form-message-error" role="alert"><CircleAlert size={15} />{error}</p>}
        {notice && <p className="history-storage-note" role="status">{notice}</p>}
      </section>

      {audit && <section className="panel fix-all-audit-panel">
        <div className="repair-code-head"><div><p className="eyebrow">REAL AXE-CORE RESULTS</p><h2>{audit.projectName ?? audit.source}</h2></div><span>{findingsCount(audit)} affected element(s) · {audit.violations.length} failing rules</span></div>
        {(audit.sourceType === "url" || audit.blockedRequests?.length > 0) && <div className="fix-all-capture-report"><strong>{audit.sourceType === "url" ? "URL source capture" : "Source and stylesheet limits"}</strong>{audit.sourceType === "url" && <p>{audit.sourceCapture?.reason ?? `Rendered HTML captured from ${audit.finalUrl ?? audit.requestedUrl}. HTTP ${audit.sourceCapture?.httpStatus ?? "status unavailable"}.`}</p>}{(audit.sourceCapture?.authenticationLikely || [401, 403].includes(audit.sourceCapture?.httpStatus)) && <p><CircleAlert size={14} /> Authentication or access control may be required. This scanner did not log in or bypass access controls.</p>}{audit.sourceCapture?.accessibleStylesheetUrls?.map((sheetUrl, index) => <p key={`captured-${index}`}>Captured stylesheet: {sheetUrl}</p>)}{audit.sourceCapture?.inaccessibleStylesheets?.map((sheet, index) => <p key={index}><CircleAlert size={14} /> Stylesheet unavailable: {sheet.url} · {sheet.reason}</p>)}{audit.sourceType === "html" && audit.blockedRequests?.length > 0 && <p>Paste any required external stylesheet content into the separate CSS editor. External resources are blocked for pasted-source scans.</p>}{audit.blockedRequests?.map((item, index) => <p key={`blocked-${index}`}><CircleAlert size={14} /> Request blocked: {item.url} · {item.reason}</p>)}</div>}
        {!artifact && <p className="repair-manual-warning">This page was scanned, but an editable source snapshot could not be captured within limits. Bulk repair is unavailable; no live changes were made.</p>}
        {artifact && !artifact.bulkRollbackAvailable && <div className="repair-actions"><button type="button" className="button button-primary" onClick={() => void generateAll()} disabled={working || !audit.violations.length}><WandSparkles size={15} /> Fix All Issues</button><p className="form-footer-note">Up to 20 detected elements are processed per candidate. Unsupported, overlapping, or evidence-poor fixes are listed for manual review.</p></div>}
        {artifact?.bulkRollbackAvailable && !draft && <div className="repair-actions"><button type="button" className="button button-primary" onClick={() => void verifyAgain()} disabled={working}><ShieldCheck size={14} /> Run Verification Again</button><button type="button" className="button button-secondary" onClick={() => void revertAll()} disabled={working}><RotateCcw size={14} /> Revert All Changes</button></div>}
        {audit.violations.map((violation) => <p className="fix-all-finding-row" key={violation.id}><strong>{violation.id}</strong> · {violation.help} <span>{violation.nodeCount} element(s)</span><Link to={`/workspace?auditId=${encodeURIComponent(audit.id)}&violationId=${encodeURIComponent(violation.id)}`}>Fix selected issue</Link></p>)}
        {audit.incomplete?.length > 0 && <p className="form-footer-note">{audit.incomplete.length} incomplete check(s) need human review; they are not counted as verified violations.</p>}
      </section>}

      {draft && <section className="panel fix-all-review-panel">
        <div className="repair-review-header"><div><p className="eyebrow">CANDIDATE · NOT LIVE</p><h2>Original and repaired source</h2></div><span className={`repair-state repair-state-${draft.status}`}>{draft.status}</span></div>
        <div className="fix-all-toolbar">
          <button type="button" className="quiet-button" onClick={() => void copy(originalHtml, "Original HTML")}><Clipboard size={14} /> Copy Original Code</button>
          <button type="button" className="quiet-button" onClick={() => downloadText("original.html", originalHtml, "text/html")}><ArrowDownToLine size={14} /> Download Original</button>
          <button type="button" className="quiet-button" onClick={() => void copy(repairedHtml, "Repaired HTML")}><Clipboard size={14} /> Copy Repaired Code</button>
          <button type="button" className="quiet-button" onClick={() => downloadText("repaired.html", repairedHtml, "text/html")}><ArrowDownToLine size={14} /> Download Repaired</button>
          {originalCss && <><button type="button" className="quiet-button" onClick={() => void copy(originalCss, "Original CSS")}><Clipboard size={14} /> Copy Original CSS</button><button type="button" className="quiet-button" onClick={() => downloadText("original.css", originalCss, "text/css")}><ArrowDownToLine size={14} /> Download Original CSS</button></>}
          {repairedCss && <><button type="button" className="quiet-button" onClick={() => void copy(repairedCss, "Repaired CSS")}><Clipboard size={14} /> Copy Repaired CSS</button><button type="button" className="quiet-button" onClick={() => downloadText("repaired.css", repairedCss, "text/css")}><ArrowDownToLine size={14} /> Download Repaired CSS</button></>}
        </div>
        {draft.truncated && <p className="repair-manual-warning">The source has more than {draft.examined} candidate elements. This draft is bounded and does not represent unprocessed findings as fixed.</p>}
        <div className="repair-diff fix-all-code-grid"><section><h3>Original HTML</h3><pre className="repair-code"><code>{originalHtml}</code></pre>{originalCss && <><h3>Original CSS</h3><pre className="repair-code"><code>{originalCss}</code></pre></>}</section><section><h3>Repaired HTML</h3><pre className="repair-code repair-code-proposed"><code>{repairedHtml}</code></pre>{repairedCss && <><h3>Repaired CSS</h3><pre className="repair-code repair-code-proposed"><code>{repairedCss}</code></pre></>}</section></div>
        <section className="fix-all-changes"><h3>Change-by-change diff</h3>{draft.changes.length > 0 && <nav className="fix-all-change-nav" aria-label="Navigate repair changes">{draft.changes.map((change, index) => <a key={`${change.violationId}-${index}`} href={`#fix-all-change-${index}`}>Change {index + 1} · {change.violationId}</a>)}</nav>}{draft.changes.length ? draft.changes.map((change, index) => <article id={`fix-all-change-${index}`} className="fix-all-change" key={`${change.violationId}-${change.selector}-${index}`}><p><span className="violation-rule-id">{change.violationId}</span> · <code>{change.selector}</code></p><div className="fix-all-snippet-diff"><pre className="repair-code repair-diff-line-remove">− {change.originalCode}</pre><pre className="repair-code repair-diff-line-add">+ {change.proposedCode}</pre></div><p>{change.explanation}</p>{change.assumptions?.length > 0 && <p className="repair-manual-warning"><CircleAlert size={14} /> Human review: {change.assumptions.join(" ")}</p>}</article>) : <p>No safe applicable patches were generated.</p>}{draft.skipped.map((item, index) => <p className="fix-all-skipped" key={`${item.violationId}-${item.selector}-${index}`}><CircleAlert size={14} /> {item.violationId}{item.selector ? ` · ${item.selector}` : ""}: {item.reason}</p>)}</section>

        <section className="fix-all-scan-comparison"><h3>Automated findings before and after candidate scan</h3><div><p>Before: {draft.before.violationCount} failing rules</p><p>Candidate after: {draft.after.violationCount} failing rules</p><p>Resolved: {draft.comparison.counts.resolved} · Remaining: {draft.comparison.counts.remaining} · New: {draft.comparison.counts.newlyIntroduced} · Changed: {draft.comparison.counts.changed}</p></div><p className="form-footer-note">Axe-core checks are automated signals, not full WCAG verification. Demo wording needs human confirmation even when a rule disappears.</p></section>
        {draft.scanLimitations?.map((limitation) => <p className="form-footer-note" key={limitation}>{limitation}</p>)}
        <section className="fix-all-preview-section"><div className="repair-code-head"><div><h3>Before and after preview</h3><p className="form-footer-note">Scripts are blocked by the iframe sandbox and network requests are restricted by content security policy. Some external assets may be missing.</p></div><div className="viewport-toggle" role="group" aria-label="Preview viewport"><button type="button" aria-pressed={viewport === "desktop"} onClick={() => setViewport("desktop")}><Monitor size={14} /> Desktop</button><button type="button" aria-pressed={viewport === "mobile"} onClick={() => setViewport("mobile")}><Smartphone size={14} /> Mobile</button></div></div><div className={`repair-preview-grid fix-all-preview-grid fix-all-viewport-${viewport}`}><section><h4>Before</h4><iframe title="Fix all original HTML preview" sandbox="" srcDoc={beforePreview} /></section><section><h4>After</h4><iframe title="Fix all repaired HTML preview" sandbox="" srcDoc={afterPreview} /></section></div></section>

        {verification && <section className="fix-all-scan-comparison" role="status"><h3>Post-apply verification · {(verification.verification ?? verification).status}</h3><p>Resolved {(verification.verification ?? verification).resolvedFindings ?? (verification.comparison?.counts?.resolved ?? 0)}; remaining {(verification.verification ?? verification).remainingFindings ?? (verification.comparison?.counts?.remaining ?? 0)}; new {(verification.verification ?? verification).newFindings ?? (verification.comparison?.counts?.newlyIntroduced ?? 0)}; manual checks {(verification.verification ?? verification).manualReview ?? (verification.comparison?.counts?.manualReview ?? 0)}.</p></section>}
        <div className="repair-actions fix-all-actions">
          {draft.status === "proposed" && <button type="button" className="button button-secondary" onClick={() => void generateAll()} disabled={working}><RotateCcw size={14} /> Regenerate Fix</button>}
          {draft.status === "proposed" && draft.changes.length > 0 && <button type="button" className="button button-primary" onClick={() => { setConfirmed(false); setConfirmApply(true); }} disabled={working}><Check size={14} /> Apply All Fixes</button>}
          {draft.status === "applied" && <button type="button" className="button button-primary" onClick={() => void verifyAgain()} disabled={working}><ShieldCheck size={14} /> Run Verification Again</button>}
          {artifact?.bulkRollbackAvailable && <button type="button" className="button button-secondary" onClick={() => void revertAll()} disabled={working}><RotateCcw size={14} /> Revert All Changes</button>}
        </div>
      </section>}

      {confirmApply && draft && <div className="repair-dialog-backdrop"><section className="repair-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="bulk-apply-title"><h2 id="bulk-apply-title">Apply all validated changes?</h2><p>{draft.changes.length} non-conflicting patch(es) will update the controlled artifact, which is stored for your review. No remote website will be modified.</p><label className="repair-review-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /> I reviewed the complete diff, assumptions, and demo text, and approve these changes to the controlled artifact.</label><div className="repair-actions"><button type="button" className="button button-secondary" onClick={() => setConfirmApply(false)} disabled={working}>Cancel</button><button type="button" className="button button-primary" onClick={() => void applyAll()} disabled={!confirmed || working}>{working ? "Applying…" : "Confirm Apply All"}</button></div></section></div>}
    </div>
  );
}

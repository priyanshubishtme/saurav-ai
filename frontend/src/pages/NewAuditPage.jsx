import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  ArrowRight,
  Check,
  CircleCheck,
  Code2,
  FileCode2,
  Globe2,
  Info,
  LoaderCircle,
  Play,
  Shield,
  Sparkles,
  SquareCode,
  X,
} from "lucide-react";
import { useNavigate } from "react-router-dom";
import { createHtmlAudit, createUrlAudit, getHealth } from "../api/client.js";
import { useToast } from "../components/useToast.js";
import { readPreferences } from "../utils/preferences.js";
import { handleRadioGroupKeyDown } from "../utils/radioGroup.js";
import { PageHeading } from "./pages.jsx";

const sampleHtml = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Accessibility sample</title>
  <style>
    body { background: white; color: #888; font: 14px sans-serif; padding: 2rem; }
    button:focus, input:focus { outline: none; box-shadow: none; }
  </style>
</head>
<body>
  <main>
    <h1>Sample account form</h1>
    <p>Some text is too light to read comfortably.</p>
    <img src="data:image/gif;base64,R0lGODlhAQABAAD/ACwAAAAAAQABAAACADs=">
    <label>Email</label><input type="email">
    <button type="button"><svg aria-hidden="true" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"></path></svg></button>
  </main>
</body>
</html>`;

export function NewAuditPage() {
  const navigate = useNavigate();
  const [sourceType, setSourceType] = useState("url");
  const [source, setSource] = useState("");
  const [additionalCss, setAdditionalCss] = useState("");
  const [projectName, setProjectName] = useState("Pasted HTML");
  const [initialPreferences] = useState(readPreferences);
  const [wcagLevel, setWcagLevel] = useState(initialPreferences.defaultLevel);
  const [includeBestPractices, setIncludeBestPractices] = useState(initialPreferences.includeBestPractices);
  const [formError, setFormError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [progressStage, setProgressStage] = useState("");
  const [engineStatus, setEngineStatus] = useState({ loading: true, available: null });
  const controllerRef = useRef(null);
  const retryPayloadRef = useRef(null);
  const notify = useToast();

  useEffect(() => {
    const healthController = new AbortController();
    getHealth({ signal: healthController.signal })
      .then(({ scanner }) => setEngineStatus({ loading: false, available: scanner.status === "available" }))
      .catch((error) => {
        if (error.name !== "AbortError") setEngineStatus({ loading: false, available: false });
      });
    return () => {
      healthController.abort();
      controllerRef.current?.abort();
    };
  }, []);

  function chooseSource(type) {
    if (submitting) return;
    setSourceType(type);
    setSource("");
    setFormError("");
    setRequestError("");
  }

  async function runAudit(payload) {
    setFormError("");
    setRequestError("");
    controllerRef.current?.abort();

    const controller = new AbortController();
    controllerRef.current = controller;
    retryPayloadRef.current = payload;
    setSubmitting(true);
    setElapsedSeconds(0);
    setProgressStage("Starting an isolated Chromium session");

    const progressTimer = window.setInterval(() => {
      setElapsedSeconds((elapsed) => elapsed + 1);
      setProgressStage((stage) => stage === "Starting an isolated Chromium session"
        ? "Loading the page and checking accessibility rules"
        : "Reviewing real page findings and keyboard focus");
    }, 1000);

    try {
      const result = payload.url
        ? await createUrlAudit(payload, { signal: controller.signal })
        : await createHtmlAudit(payload, { signal: controller.signal });
      const { audit } = result;
      const persistenceMessage = result.storage === "mongodb"
        ? "Real axe-core scan completed and saved to your AccessZ account."
        : "Real axe-core scan completed and saved to temporary server history.";
      notify(persistenceMessage, "success");
      navigate("/audits/results", { state: { audit } });
    } catch (error) {
      if (error.name !== "AbortError") {
        const requestId = error.requestId ? ` Request ID: ${error.requestId}.` : "";
        setRequestError(`${error.message}${requestId}`);
        notify(error.message, "info");
      }
    } finally {
      window.clearInterval(progressTimer);
      if (controllerRef.current === controller) {
        controllerRef.current = null;
        setSubmitting(false);
        setProgressStage("");
      }
    }
  }

  function cancelAudit() {
    controllerRef.current?.abort();
    controllerRef.current = null;
    setSubmitting(false);
    setProgressStage("");
    setRequestError("Audit cancelled. No results were saved.");
  }

  function handleSubmit(event) {
    event.preventDefault();
    setFormError("");
    setRequestError("");
    const normalizedSource = source.trim();

    if (!normalizedSource) {
      setFormError(sourceType === "url" ? "Enter the page URL you want to audit." : "Paste the HTML you want to audit.");
      return;
    }

    if (sourceType === "url") {
      try {
        const parsedUrl = new URL(normalizedSource);
        if (!["http:", "https:"].includes(parsedUrl.protocol) || parsedUrl.username || parsedUrl.password) {
          throw new Error("Unsupported URL");
        }
      } catch {
        setFormError("Enter a public URL beginning with https:// or http://, without embedded credentials.");
        return;
      }
      void runAudit({
        url: normalizedSource,
        wcagLevel,
        includeBestPractices,
        ...(additionalCss.trim() ? { additionalCss: additionalCss.trim() } : {}),
      });
      return;
    }

    if (new TextEncoder().encode(normalizedSource).length > 300_000) {
      setFormError("HTML must be 300,000 bytes or fewer.");
      return;
    }
    void runAudit({
      html: normalizedSource,
      projectName: projectName.trim() || "Pasted HTML",
      wcagLevel,
      includeBestPractices,
      ...(additionalCss.trim() ? { additionalCss: additionalCss.trim() } : {}),
    });
  }

  function loadSampleSource() {
    chooseSource("html");
    setProjectName("AccessZ intentional accessibility sample");
    setSource(sampleHtml);
  }

  function scanSample() {
    setSourceType("html");
    setSource(sampleHtml);
    setProjectName("AccessZ intentional accessibility sample");
    void runAudit({
      html: sampleHtml,
      projectName: "AccessZ intentional accessibility sample",
      wcagLevel,
      includeBestPractices,
      ...(additionalCss.trim() ? { additionalCss: additionalCss.trim() } : {}),
    });
  }

  return (
    <div className="page-content form-page">
      <PageHeading
        eyebrow="A GOOD PLACE TO BEGIN"
        title={<>A more inclusive<br /><span className="gradient-text">web starts here.</span></>}
        description="Scan a public page or paste a small HTML snippet. Findings come from real axe-core checks, never sample data."
      />
      <div className="form-layout">
        <form className="panel audit-form-panel" onSubmit={handleSubmit} noValidate>
          <div className="form-panel-title">
            <span className="form-step">01</span>
            <div><h2>Choose what to check</h2><p>Your source is scanned in an isolated Chromium context.</p></div>
          </div>
          <div className="source-tabs" role="group" aria-label="Audit source type">
            <button type="button" aria-pressed={sourceType === "url"} className={`source-tab${sourceType === "url" ? " source-tab-active" : ""}`} onClick={() => chooseSource("url")} disabled={submitting}><Globe2 size={17} /> Website URL</button>
            <button type="button" aria-pressed={sourceType === "html"} className={`source-tab${sourceType === "html" ? " source-tab-active" : ""}`} onClick={() => chooseSource("html")} disabled={submitting}><Code2 size={17} /> HTML snippet</button>
          </div>
          {sourceType === "url" ? (
            <label className="field-label" htmlFor="audit-source">
              Page URL<span className="optional-label">PUBLIC HTTP/S</span>
              <div className="input-with-icon"><Globe2 size={16} /><input id="audit-source" type="url" name="source" placeholder="https://your-site.com/page" value={source} onChange={(event) => setSource(event.target.value)} autoComplete="url" aria-describedby={formError ? "form-error" : "url-help"} disabled={submitting} /></div>
              <span id="url-help" className="field-hint">Only use a public page you own or have permission to test. Private, local, and metadata destinations are blocked.</span>
            </label>
          ) : (
            <>
              <label className="field-label" htmlFor="project-name">Project name<span className="optional-label">OPTIONAL</span>
                <input className="settings-select project-name-input" id="project-name" value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={100} disabled={submitting} />
              </label>
              <label className="field-label html-source-label" htmlFor="audit-source">HTML source<span className="optional-label">MAX 300 KB</span>
                <textarea id="audit-source" name="source" className="code-input" placeholder="Paste semantic HTML here…" value={source} onChange={(event) => setSource(event.target.value)} aria-describedby={formError ? "form-error" : "html-help"} spellCheck="false" disabled={submitting} />
                <span id="html-help" className="field-hint">The server removes scripts, forms, and active content. HTML runs on a unique local origin with all network access blocked.</span>
              </label>
            </>
          )}
          <label className="field-label html-source-label" htmlFor="audit-additional-css">
            Additional CSS (optional)<span className="optional-label">MAX 100 KB</span>
            <textarea
              id="audit-additional-css"
              name="additionalCss"
              className="code-input"
              placeholder="Paste CSS to supplement the audit's rendered style evidence…"
              value={additionalCss}
              onChange={(event) => setAdditionalCss(event.target.value)}
              maxLength={100_000}
              rows={5}
              spellCheck="false"
              disabled={submitting}
              aria-describedby="additional-css-help"
            />
            <span id="additional-css-help" className="field-hint">For HTML audits, this is added as a separate stylesheet without replacing existing styles. For URL audits, it supplements style evidence only; the live site is never changed.</span>
          </label>
          {formError && <p className="form-message form-message-error" id="form-error" role="alert"><AlertCircle size={16} />{formError}</p>}

          <div className="form-divider" />
          <div className="form-section-row"><div><h3>Choose a standard</h3><p>WCAG 2.0 and 2.1 checks, plus supported WCAG 2.2 AA rules.</p></div><span className="field-info"><Info size={14} /> Automated checks only</span></div>
          <div className="standard-options" role="radiogroup" aria-label="WCAG conformance level">
            {["A", "AA", "AAA"].map((level) => <button key={level} type="button" role="radio" tabIndex={wcagLevel === level ? 0 : -1} aria-checked={wcagLevel === level} className={`standard-option${wcagLevel === level ? " standard-option-selected" : ""}`} onClick={() => setWcagLevel(level)} onKeyDown={(event) => handleRadioGroupKeyDown(event, ["A", "AA", "AAA"], wcagLevel, setWcagLevel)} disabled={submitting}><span className="radio-dot">{wcagLevel === level && <i />}</span><span><strong>WCAG {level}</strong><small>{level === "A" ? "Essential" : level === "AA" ? "Recommended" : "Enhanced"}</small></span>{level === "AA" && <span className="recommended-tag">COMMON</span>}</button>)}
          </div>
          <label className="toggle-row"><span className="toggle-copy"><strong>Include best-practice checks</strong><small>Include non-WCAG recommendations alongside WCAG results.</small></span><input type="checkbox" checked={includeBestPractices} onChange={(event) => setIncludeBestPractices(event.target.checked)} disabled={submitting} /><span className="toggle-ui" aria-hidden="true" /></label>

          {requestError && (
            <div className="form-message form-message-error request-message" role="alert">
              <AlertCircle size={16} />
              <div><strong>{requestError.startsWith("Audit cancelled") ? "Audit cancelled." : "No results were saved."}</strong><span>{requestError}</span>
                {!requestError.startsWith("Audit cancelled") && retryPayloadRef.current && <button type="button" className="text-link retry-link" onClick={() => void runAudit(retryPayloadRef.current)}><Play size={13} /> Retry scan</button>}
              </div>
              <button type="button" aria-label="Dismiss error" onClick={() => setRequestError("")}><X size={15} /></button>
            </div>
          )}
          {submitting && (
            <div className="scan-progress" role="status" aria-live="polite">
              <span className="scan-progress-indicator"><LoaderCircle size={16} className="spin" /></span>
              <span className="scan-progress-copy"><strong>{progressStage}</strong><small>Step 02 / 02 · {elapsedSeconds}s elapsed · Progress is indeterminate</small></span>
              <button type="button" className="button button-secondary scan-cancel-button" onClick={cancelAudit}>Cancel scan</button>
              <div className="scan-progress-track" aria-hidden="true"><span /></div>
            </div>
          )}
          <div className="form-submit-row">
            <span className="form-secure"><Shield size={14} /> Real scan · bounded time limit</span>
            <button type="submit" className="button button-primary" disabled={submitting}>{submitting ? <><LoaderCircle size={16} className="spin" /> Scanning…</> : <>Run accessibility scan <ArrowRight size={16} /></>}</button>
          </div>
        </form>

        <aside className="audit-aside">
          <section className="panel aside-panel">
            <div className="aside-icon"><SquareCode size={18} /></div>
            <p className="eyebrow">REAL ENGINE, REAL FINDINGS</p>
            <h2>Try an intentionally inaccessible page</h2>
            <p>This built-in page includes missing labels and image text, low-contrast text, and a focus-indicator review candidate. Every result comes from a real scan.</p>
            <button className="button button-primary button-full" type="button" onClick={scanSample} disabled={submitting}><Play size={15} /> Scan the built-in sample</button>
            <button className="button button-secondary button-full sample-load-button" type="button" onClick={loadSampleSource} disabled={submitting}><FileCode2 size={15} /> Load sample source into editor</button>
            <span className="aside-note"><CircleCheck size={13} /> Clearly labeled sample input · never pre-filled as scan data</span>
          </section>
          <section className="capability-card">
            <div className="capability-heading"><span className="capability-mark"><Sparkles size={15} /></span><strong>Engine status</strong></div>
            <p>Each scan uses an isolated Chromium browser, axe-core, strict network controls, and a bounded execution time.</p>
            <div className={`capability-status${engineStatus.available === true ? " capability-status-ready" : ""}${engineStatus.available === false ? " capability-status-unavailable" : ""}`} role="status"><span className="status-dot" /> {engineStatus.loading ? "CHECKING SCAN ENGINE" : engineStatus.available ? "CHROMIUM + AXE-CORE READY" : "SCAN ENGINE UNAVAILABLE"}</div>
          </section>
        </aside>
      </div>
      <div className="form-footer-note"><Info size={14} /> The AccessZ score is a transparent weighted rule indicator—not an official WCAG compliance score. Automated results never replace human review.</div>
    </div>
  );
}

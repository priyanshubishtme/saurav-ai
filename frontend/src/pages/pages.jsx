import { useEffect, useState } from "react";
import {
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  AudioLines,
  Check,
  CircleHelp,
  Clock3,
  Code2,
  Fingerprint,
  Gauge,
  Globe2,
  Layers3,
  Plus,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  Zap,
} from "lucide-react";
import { Link } from "react-router-dom";
import { getAudits } from "../api/client.js";
import { EmptyState } from "../components/EmptyState.jsx";

const scoreTicks = ["100", "75", "50", "25", "0"];

function PageHeading({ eyebrow, title, description, children }) {
  return (
    <div className="page-heading">
      <div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="page-description">{description}</p></div>
      {children}
    </div>
  );
}

function DashboardPage() {
  const today = new Intl.DateTimeFormat("en", { weekday: "long", month: "long", day: "numeric" }).format(new Date()).toUpperCase();
  const [audits, setAudits] = useState([]);
  const [auditError, setAuditError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    getAudits({ signal: controller.signal, limit: 25 })
      .then(({ audits: records }) => setAudits(records))
      .catch((error) => {
        if (error.name !== "AbortError") setAuditError(error.message);
      });
    return () => controller.abort();
  }, []);

  const latestAudit = audits[0];
  const scoreHistory = audits.filter((audit) => Number.isFinite(audit.summary.score)).reverse();
  const scorePoints = scoreHistory.map((audit, index) => {
    const x = scoreHistory.length === 1 ? 500 : 30 + (index / (scoreHistory.length - 1)) * 940;
    const y = 145 - (audit.summary.score / 100) * 130;
    return `${x},${y}`;
  }).join(" ");
  const findings = audits.reduce((sum, audit) => sum + (audit.summary.violationNodes ?? 0), 0);

  return (
    <div className="page-content dashboard-page">
      <PageHeading eyebrow={today} title={<>Make every page<br className="heading-break" /> work for <span className="gradient-text">everyone.</span></>} description="A clear view of your accessibility work starts here." />
      <section className="welcome-panel">
        <div className="welcome-grid" aria-hidden="true" />
        <div className="welcome-content">
          <div className="welcome-eyebrow"><span className="welcome-spark"><Sparkles size={13} /></span> YOUR ACCESSIBILITY WORKSPACE</div>
          <h2>Start with a more<br />inclusive web.</h2>
          <p>Run a real audit to uncover barriers, explore actionable repairs, and make your experience better for every visitor.</p>
          <Link className="button button-primary" to="/audits/new"><Sparkles size={16} /> Start your first audit <ArrowRight size={16} /></Link>
          <div className="welcome-footnote"><ShieldCheck size={14} /> No scan results are shown until a real scan is complete.</div>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="art-glow" />
          <div className="orbit orbit-one" /><div className="orbit orbit-two" /><div className="orbit orbit-three" />
          <div className="art-core"><div className="art-core-inner"><AudioLines size={31} strokeWidth={1.45} /></div><span className="art-signal"><Check size={11} /></span></div>
          <span className="art-float float-one"><Fingerprint size={16} /><span>Inclusive by design</span></span>
          <span className="art-float float-two"><Zap size={15} /><span>Real-time insight</span></span>
        </div>
        <div className="welcome-index"><span>01</span><span className="welcome-index-line" /><span>04</span></div>
      </section>

      <div className="section-title-row"><div><p className="eyebrow">YOUR WORKSPACE</p><h2>At a glance</h2></div><Link className="text-link" to="/reports">View history <ArrowUpRight size={15} /></Link></div>
      <section className="metric-grid" aria-label="Workspace overview">
        <article className="metric-card"><div className="metric-top"><span className="metric-icon metric-indigo"><Gauge size={17} /></span>        <span className="metric-state">{latestAudit ? "REAL SCAN" : "NO SCANS"}</span></div><p className="metric-label">Accessibility score</p><div className="metric-number">{latestAudit?.summary.score ?? "—"}<span className="metric-denom"> / 100</span></div><p className="metric-footnote">{latestAudit ? "Latest AccessZ weighted rule indicator" : "Waiting for your first real scan"}</p></article>
        <article className="metric-card"><div className="metric-top"><span className="metric-icon metric-cyan"><Layers3 size={17} /></span><span className="metric-chip">LAST 25 SCANS</span></div><p className="metric-label">Audits completed</p><div className="metric-number">{audits.length}</div><p className="metric-footnote">Real audits available in this workspace</p></article>
        <article className="metric-card"><div className="metric-top"><span className="metric-icon metric-amber"><TriangleAlert size={17} /></span><span className="metric-chip">LAST 25 SCANS</span></div><p className="metric-label">Affected elements</p><div className="metric-number">{findings}</div><p className="metric-footnote">Actual axe-core violation nodes</p></article>
        <article className="metric-card"><div className="metric-top"><span className="metric-icon metric-green"><Check size={17} /></span><span className="metric-chip">VERIFIED ONLY</span></div><p className="metric-label">Confirmed repairs</p><div className="metric-number">—</div><p className="metric-footnote">Run verification to confirm a repair</p></article>
      </section>

      <div className="dashboard-lower-grid">
        <section className="panel trend-panel">
          <div className="panel-heading"><div><p className="eyebrow">MEASURE WHAT MATTERS</p><h2>Score over time</h2></div><span className="select-static" aria-label="Showing the last 30 days">Last 30 days <ArrowDownRight size={14} /></span></div>
          <div className="chart-area" aria-label="No score history is available until an audit is completed.">
            <div className="chart-axis">{scoreTicks.map((tick) => <span key={tick}>{tick}</span>)}</div>
            <div className="chart-grid">{scoreTicks.map((tick) => <span key={tick} />)}{scoreHistory.length >= 2 ? <svg className="score-trend-svg" viewBox="0 0 1000 150" preserveAspectRatio="none" role="img" aria-label="AccessZ scores from real completed audits"><polyline points={scorePoints} fill="none" stroke="#9d91ff" strokeWidth="3" vectorEffect="non-scaling-stroke" />{scoreHistory.map((audit, index) => { const x = scoreHistory.length === 1 ? 500 : 30 + (index / (scoreHistory.length - 1)) * 940; const y = 145 - (audit.summary.score / 100) * 130; return <circle key={audit.id} cx={x} cy={y} r="5" fill="#9d91ff"><title>{audit.projectName ?? audit.source}: {audit.summary.score}/100</title></circle>; })}</svg> : <div className="chart-empty"><span className="chart-empty-icon"><Gauge size={19} /></span><strong>{scoreHistory.length ? "One real scan recorded" : "Your progress will show up here"}</strong><span>{scoreHistory.length ? "Complete another audit to compare score history." : auditError || "Complete an audit to start your score history."}</span></div>}</div>
          </div>
          <div className="chart-legend"><span><i /> ACCESSIBILITY SCORE</span><span className="chart-period"><Clock3 size={13} /> Updated when a scan completes</span></div>
        </section>
        <section className="panel activity-panel">
          <div className="panel-heading"><div><p className="eyebrow">THE LATEST</p><h2>Recent audits</h2></div><Link className="round-arrow" to="/reports" aria-label="View all audits"><ArrowUpRight size={16} /></Link></div>
          {audits.length ? <div className="recent-audit-list">{audits.slice(0, 3).map((audit) => <Link className="recent-audit-row" key={audit.id} to={`/audits/results?auditId=${encodeURIComponent(audit.id)}`}><span className="activity-empty-mark"><Globe2 size={15} /></span><span className="recent-audit-copy"><strong>{audit.projectName ?? audit.source}</strong><small>{new Date(audit.createdAt).toLocaleDateString()} · {audit.summary.violations} violations</small></span><span className="recent-audit-score">{audit.summary.score ?? "—"}</span></Link>)}</div> : <div className="activity-empty"><div className="activity-empty-mark"><Globe2 size={18} /></div><strong>{auditError ? "Audit history unavailable" : "A fresh start"}</strong><p>{auditError || "Your completed audits will be easy to find here."}</p><Link to="/audits/new" className="text-link">Create an audit <ArrowRight size={14} /></Link></div>}
          <div className="activity-footnote"><span className="activity-live-dot" />{audits.length ? "Real scans · in-memory audit history" : auditError ? "Connect the backend to load recent audits" : "Your workspace is ready for its first project"}</div>
        </section>
      </div>

      <section className="next-step-banner">
        <div className="next-step-icon"><Code2 size={20} /></div>
        <div><p className="eyebrow">A THOUGHTFUL FIRST STEP</p><strong>Start with a URL or paste a small HTML sample.</strong>        <span>Run a real Playwright + axe-core scan; no results are invented or implied.</span></div>
        <Link to="/audits/new" className="button button-secondary">Set up an audit <ArrowRight size={15} /></Link>
      </section>
    </div>
  );
}

export { DashboardPage, PageHeading };

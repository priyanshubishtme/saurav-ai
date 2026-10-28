import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  Bell,
  BookOpenCheck,
  ChevronLeft,
  CircleHelp,
  ClipboardCheck,
  FileClock,
  Gauge,
  LayoutDashboard,
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  Settings2,
  ShieldCheck,
  Sparkles,
  WandSparkles,
  X,
} from "lucide-react";
import { Link, NavLink, Outlet, useLocation } from "react-router-dom";
import { getHealth } from "../api/client.js";
import { useAuth } from "../auth/useAuth.js";
import { readPreferences, readThemePreference, saveThemePreference } from "../utils/preferences.js";
import { useToast } from "./useToast.js";

const navigation = [
  { label: "Overview", to: "/", icon: LayoutDashboard, end: true },
  { label: "New audit", to: "/audits/new", icon: Sparkles },
  { label: "Audit results", to: "/audits/results", icon: Gauge },
];

const workspaceLinks = [
  { label: "Repair workspace", to: "/workspace", icon: WandSparkles },
  { label: "Verification", to: "/verification", icon: ClipboardCheck },
  { label: "Reports & history", to: "/reports", icon: FileClock },
];

const titles = {
  "/": "Overview",
  "/audits/new": "New audit",
  "/audits/results": "Audit results",
  "/workspace": "Repair workspace",
  "/verification": "Verification",
  "/reports": "Reports & history",
  "/settings": "Settings",
};

function NavigationLink({ item, collapsed, onNavigate }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end}
      onClick={onNavigate}
      className={({ isActive }) => `nav-link${isActive ? " nav-link-active" : ""}`}
      title={collapsed ? item.label : undefined}
    >
      <Icon size={18} strokeWidth={1.8} />
      <span>{item.label}</span>
    </NavLink>
  );
}

function SidebarContent({ collapsed, closeMobile, user, onSignOut, signingOut }) {
  return (
    <>
      <NavLink className="brand-lockup" to="/" aria-label="AccessZ home" onClick={closeMobile}>
        <span className="brand-mark"><span /><span /><span /><span /></span>
        {!collapsed && <span className="brand-name">Access<span>Z</span></span>}
      </NavLink>
      <div className="workspace-switcher">
        <div className="workspace-avatar">{user?.name?.slice(0, 1)?.toUpperCase() ?? "A"}</div>
        {!collapsed && (
          <>
            <div className="workspace-copy"><strong>{user?.name ?? "Private workspace"}</strong><span>Account history</span></div>
          </>
        )}
      </div>
      <nav className="side-nav" aria-label="Main navigation">
        <p className="nav-label">{!collapsed && "WORKSPACE"}</p>
        {navigation.map((item) => <NavigationLink key={item.to} item={item} collapsed={collapsed} onNavigate={closeMobile} />)}
        <p className="nav-label nav-label-spaced">{!collapsed && "IMPROVE"}</p>
        {workspaceLinks.map((item) => <NavigationLink key={item.to} item={item} collapsed={collapsed} onNavigate={closeMobile} />)}
      </nav>
      <div className="sidebar-bottom">
        <Link className="sidebar-help" to="/audits/new" onClick={closeMobile}>
          <span className="help-icon"><BookOpenCheck size={17} /></span>
          {!collapsed && <div><strong>Your next step starts here.</strong><span>Prepare your first accessibility audit.</span></div>}
          {!collapsed && <ArrowUpRight size={15} className="help-arrow" />}
        </Link>
        <NavLink to="/settings" onClick={closeMobile} className={({ isActive }) => `nav-link settings-link${isActive ? " nav-link-active" : ""}`} title={collapsed ? "Settings" : undefined}>
          <Settings2 size={18} strokeWidth={1.8} /><span>Settings</span>
        </NavLink>
        <div className="profile-row">
          <div className="profile-avatar">{user?.name?.slice(0, 1)?.toUpperCase() ?? "A"}</div>
          {!collapsed && <div className="profile-copy"><strong>{user?.name ?? "AccessZ member"}</strong><span>{user?.email}</span></div>}
          <button type="button" className="profile-logout" onClick={onSignOut} disabled={signingOut} aria-label="Sign out" title="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      </div>
    </>
  );
}

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [apiOnline, setApiOnline] = useState(null);
  const [signingOut, setSigningOut] = useState(false);
  const [theme, setTheme] = useState(readThemePreference);
  const location = useLocation();
  const notify = useToast();
  const { user, signOut } = useAuth();
  const title = location.pathname.startsWith("/issues/") ? "Issue detail" : titles[location.pathname] ?? "Overview";

  async function handleSignOut() {
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      notify(error.message, "error");
    } finally {
      setSigningOut(false);
    }
  }

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    if (!saveThemePreference(theme)) {
      notify("Browser storage is unavailable; this theme choice will not persist after closing the page.", "info");
    }
  }, [theme, notify]);

  useEffect(() => {
    document.documentElement.dataset.reduceMotion = String(readPreferences().reducedMotion);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    getHealth({ signal: controller.signal })
      .then(() => setApiOnline(true))
      .catch((error) => {
        if (error.name !== "AbortError") setApiOnline(false);
      });
    return () => controller.abort();
  }, [location.pathname]);

  useEffect(() => {
    setMobileOpen(false);
  }, [location.pathname]);

  return (
    <div className={`app-frame${collapsed ? " sidebar-collapsed" : ""}`}>
      {mobileOpen && <button className="mobile-backdrop" onClick={() => setMobileOpen(false)} aria-label="Close navigation" />}
      <aside className={`sidebar${mobileOpen ? " sidebar-mobile-open" : ""}`} aria-label="Application sidebar">
        <SidebarContent collapsed={collapsed && !mobileOpen} closeMobile={() => setMobileOpen(false)} user={user} onSignOut={handleSignOut} signingOut={signingOut} />
        <button className="sidebar-collapse" onClick={() => setCollapsed((value) => !value)} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"} title={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
          {collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          {!collapsed && <span>Collapse</span>}
          {!collapsed && <ChevronLeft size={14} className="collapse-chevron" />}
        </button>
        <button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close navigation"><X size={19} /></button>
      </aside>
      <main className="main-column">
        <header className="topbar">
          <div className="topbar-start">
            <button className="mobile-menu icon-button" onClick={() => setMobileOpen(true)} aria-label="Open navigation"><Menu size={19} /></button>
            <div className="breadcrumb"><span>Workspace</span><span className="breadcrumb-separator">/</span><strong>{title}</strong></div>
          </div>
          <div className="topbar-actions">
            <div className={`connection-status${apiOnline === false ? " connection-offline" : ""}`} role="status">
              <span className="connection-dot" />{apiOnline === null ? "Connecting" : apiOnline ? "API connected" : "API offline"}
            </div>
            <button className="icon-button notification-button" aria-label="Notifications" title="Notifications" onClick={() => notify("Audit notifications will appear here after a real scan is complete.")}><Bell size={17} /></button>
            <span className="topbar-divider" />
            <NavLink className="topbar-help" to="/settings" aria-label="Help and settings"><CircleHelp size={17} /></NavLink>
            <Link className="command-button" to="/audits/new" aria-label="Quick start: new accessibility audit" title="New accessibility audit"><Sparkles size={14} /><span>Quick start</span></Link>
          </div>
        </header>
        <div className="page-scroll"><Outlet context={{ theme, setTheme }} /></div>
        <footer className="app-footer">
          <span><ShieldCheck size={14} /> Built for the open web</span>
          <span>Audit results only appear after a real scan.</span>
        </footer>
      </main>
    </div>
  );
}

import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider } from "./auth/AuthContext.jsx";
import { useAuth } from "./auth/useAuth.js";
import AuthPage from "./auth/AuthPage.jsx";
import AppShell from "./components/AppShell.jsx";
import { ToastProvider } from "./components/ToastProvider.jsx";
import {
  DashboardPage,
  IssueDetailPage,
  NewAuditPage,
  ReportsPage,
  RepairWorkspacePage,
  ResultsPage,
  SettingsPage,
  VerificationPage,
} from "./pages/index.js";

function RequireAuth() {
  const { status, user } = useAuth();
  const location = useLocation();

  if (status === "loading") return <main className="auth-page"><p role="status">Checking your secure session…</p></main>;
  if (!user) return <Navigate to="/login" replace state={{ from: location }} />;
  return <Outlet />;
}

function ApplicationRoutes() {
  return (
    <ToastProvider>
      <Routes>
        <Route path="/login" element={<AuthPage mode="login" />} />
        <Route path="/signup" element={<AuthPage mode="signup" />} />
        <Route element={<RequireAuth />}>
          <Route element={<AppShell />}>
            <Route index element={<DashboardPage />} />
            <Route path="audits/new" element={<NewAuditPage />} />
            <Route path="audits/results" element={<ResultsPage />} />
            <Route path="audits/:auditId/issues/:issueId" element={<IssueDetailPage />} />
            <Route path="workspace" element={<RepairWorkspacePage />} />
            <Route path="verification" element={<VerificationPage />} />
            <Route path="reports" element={<ReportsPage />} />
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </ToastProvider>
  );
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <ApplicationRoutes />
      </AuthProvider>
    </BrowserRouter>
  );
}

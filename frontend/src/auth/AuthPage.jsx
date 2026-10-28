import { useState } from "react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "./useAuth.js";

export default function AuthPage({ mode }) {
  const isSignUp = mode === "signup";
  const { status, authError, signIn, signUp } = useAuth();
  const [values, setValues] = useState({ name: "", email: "", username: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  if (status === "loading") {
    return <main className="auth-page"><p role="status">Checking your secure session…</p></main>;
  }
  if (status === "authenticated") return <Navigate to="/" replace />;

  function update(event) {
    setValues((current) => ({ ...current, [event.target.name]: event.target.value }));
  }

  async function submit(event) {
    event.preventDefault();
    setSubmitting(true);
    setError("");
    try {
      if (isSignUp) await signUp(values);
      else await signIn({ identifier: values.email, password: values.password });
      navigate(location.state?.from?.pathname ?? "/", { replace: true });
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="auth-page">
      <section className="auth-card" aria-labelledby="auth-title">
        <Link className="auth-brand" to="/login" aria-label="AccessZ sign in">
          <span className="brand-mark"><span /><span /><span /><span /></span>
          <strong>AccessZ</strong>
        </Link>
        <div className="auth-icon"><ShieldCheck size={20} /></div>
        <p className="auth-eyebrow">PRIVATE ACCESSIBILITY WORKSPACE</p>
        <h1 id="auth-title">{isSignUp ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-description">Your audits and repair history are private to your account.</p>
        {(error || (status === "unavailable" && authError)) && (
          <div className="auth-alert" role="alert">
            {error || authError}
            {status === "unavailable" && <span> The service needs a working MongoDB connection and session secret.</span>}
          </div>
        )}
        <form className="auth-form" onSubmit={submit}>
          {isSignUp && (
            <>
              <label htmlFor="account-name">Full name</label>
              <input id="account-name" name="name" autoComplete="name" value={values.name} onChange={update} required maxLength={100} />
              <label htmlFor="account-username">Username</label>
              <input id="account-username" name="username" autoComplete="username" value={values.username} onChange={update} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" />
            </>
          )}
          <label htmlFor="account-email">{isSignUp ? "Email address" : "Email or username"}</label>
          <input id="account-email" name="email" type={isSignUp ? "email" : "text"} autoComplete={isSignUp ? "email" : "username"} value={values.email} onChange={update} required maxLength={254} />
          <label htmlFor="account-password">Password</label>
          <input id="account-password" name="password" type="password" autoComplete={isSignUp ? "new-password" : "current-password"} value={values.password} onChange={update} required minLength={isSignUp ? 12 : 1} maxLength={128} />
          {isSignUp && (
            <>
              <p className="auth-password-note">Use at least 12 characters with uppercase, lowercase, and a number.</p>
              <label htmlFor="account-confirm-password">Confirm password</label>
              <input id="account-confirm-password" name="confirmPassword" type="password" autoComplete="new-password" value={values.confirmPassword} onChange={update} required minLength={12} maxLength={128} />
            </>
          )}
          <button className="auth-submit" type="submit" disabled={submitting || status === "unavailable"}>
            {submitting ? "Please wait…" : isSignUp ? "Create account" : "Sign in"}
            {!submitting && <ArrowRight size={16} />}
          </button>
        </form>
        <p className="auth-switch">
          {isSignUp ? "Already have an account?" : "New to AccessZ?"}{" "}
          <Link to={isSignUp ? "/login" : "/signup"}>{isSignUp ? "Sign in" : "Create account"}</Link>
        </p>
        <p className="auth-security"><ShieldCheck size={14} /> Passwords are hashed. Session cookies are HttpOnly.</p>
      </section>
    </main>
  );
}

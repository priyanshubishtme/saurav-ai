import { useEffect, useState } from "react";
import { ArrowRight, AtSign, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck, Sparkles, UserRound } from "lucide-react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import NeuralCanvas from "./NeuralCanvas.jsx";
import { useAuth } from "./useAuth.js";

export default function AuthPage({ mode }) {
  const isSignUp = mode === "signup";
  const { status, authError, signIn, signUp } = useAuth();
  const [values, setValues] = useState({ name: "", email: "", username: "", password: "", confirmPassword: "" });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    setShowPassword(false);
    setShowConfirmation(false);
  }, [isSignUp]);

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
    <main className="auth-page auth-experience">
      <section className="auth-visual" aria-label="About AccessZ">
        <NeuralCanvas />
        <div className="auth-visual-content">
          <Link className="auth-brand" to="/login" aria-label="AccessZ sign in">
            <span className="brand-mark"><span /><span /><span /><span /></span>
            <strong>AccessZ</strong>
          </Link>
          <div className="auth-visual-copy">
            <span className="auth-visual-kicker"><Sparkles size={14} /> ACCESSIBILITY, IN FOCUS</span>
            <h2>See your product<br />through <span>every lens.</span></h2>
            <p>Find the barriers between your interface and the people who use it. Then make the next release more welcoming.</p>
            <div className="auth-visual-tags" aria-label="AccessZ capabilities">
              <span><i /> Real browser audits</span>
              <span><i /> Actionable evidence</span>
              <span><i /> Private by design</span>
            </div>
          </div>
          <div className="auth-visual-footer"><span className="auth-orbit-mark" aria-hidden="true">◌</span><span>Build for more people.</span><span className="auth-visual-footer-line" /></div>
        </div>
      </section>

      <section className="auth-panel" aria-labelledby="auth-title">
        <div className="auth-panel-glow" aria-hidden="true" />
        <div className="auth-card">
          <div className="auth-heading-row">
            <div className="auth-icon"><ShieldCheck size={20} /></div>
            <span className="auth-heading-note"><span /> SECURE WORKSPACE</span>
          </div>
          <p className="auth-eyebrow">{isSignUp ? "YOUR ACCESSIBILITY WORKSPACE" : "WELCOME TO YOUR WORKSPACE"}</p>
          <h1 id="auth-title">{isSignUp ? "Make room for everyone." : "Welcome back"}</h1>
          <p className="auth-description">{isSignUp ? "Create an account to keep your audits and repair history together." : "Sign in to continue improving the experiences you build."}</p>
          {(error || (status === "unavailable" && authError)) && (
            <div className="auth-alert" role="alert" aria-live="polite">
              {error || authError}
              {status === "unavailable" && <span> The service needs a working MongoDB connection and session secret.</span>}
            </div>
          )}
          <form className="auth-form" onSubmit={submit}>
            {isSignUp && (
              <>
                <label htmlFor="account-name">Full name</label>
                <div className="auth-input-wrap"><UserRound size={17} aria-hidden="true" /><input id="account-name" name="name" autoComplete="name" placeholder="Your name" value={values.name} onChange={update} required maxLength={100} /></div>
                <label htmlFor="account-username">Username</label>
                <div className="auth-input-wrap"><AtSign size={17} aria-hidden="true" /><input id="account-username" name="username" autoComplete="username" placeholder="Choose a username" value={values.username} onChange={update} required minLength={3} maxLength={30} pattern="[A-Za-z0-9_]+" /></div>
              </>
            )}
            <label htmlFor="account-email">{isSignUp ? "Email address" : "Email or username"}</label>
            <div className="auth-input-wrap">{isSignUp ? <Mail size={17} aria-hidden="true" /> : <AtSign size={17} aria-hidden="true" />}<input id="account-email" name="email" type={isSignUp ? "email" : "text"} autoComplete={isSignUp ? "email" : "username"} placeholder={isSignUp ? "you@example.com" : "Email or username"} value={values.email} onChange={update} required maxLength={254} /></div>
            <label htmlFor="account-password">Password</label>
            <div className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="account-password" name="password" type={showPassword ? "text" : "password"} autoComplete={isSignUp ? "new-password" : "current-password"} placeholder={isSignUp ? "At least 12 characters" : "Enter your password"} value={values.password} onChange={update} required minLength={isSignUp ? 12 : 1} maxLength={128} /><button className="auth-password-toggle" type="button" onClick={() => setShowPassword((visible) => !visible)} aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword}>{showPassword ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
            {isSignUp && (
              <>
                <p className="auth-password-note">Use at least 12 characters with uppercase, lowercase, and a number.</p>
                <label htmlFor="account-confirm-password">Confirm password</label>
                <div className="auth-input-wrap"><LockKeyhole size={17} aria-hidden="true" /><input id="account-confirm-password" name="confirmPassword" type={showConfirmation ? "text" : "password"} autoComplete="new-password" placeholder="Re-enter your password" value={values.confirmPassword} onChange={update} required minLength={12} maxLength={128} /><button className="auth-password-toggle" type="button" onClick={() => setShowConfirmation((visible) => !visible)} aria-label={showConfirmation ? "Hide confirmation password" : "Show confirmation password"} aria-pressed={showConfirmation}>{showConfirmation ? <EyeOff size={17} /> : <Eye size={17} />}</button></div>
              </>
            )}
            <button className="auth-submit" type="submit" disabled={submitting || status === "unavailable"}>
              {submitting ? <><span className="auth-submit-spinner" aria-hidden="true" /> Please wait…</> : isSignUp ? "Create account" : "Sign in to AccessZ"}
              {!submitting && <ArrowRight size={17} />}
            </button>
          </form>
          <p className="auth-switch">
            {isSignUp ? "Already have an account?" : "New to AccessZ?"}{" "}
            <Link to={isSignUp ? "/login" : "/signup"}>{isSignUp ? "Sign in" : "Create an account"}</Link>
          </p>
          <p className="auth-security"><ShieldCheck size={14} /> Passwords are hashed. Session cookies are HttpOnly.</p>
        </div>
        <p className="auth-panel-footer">ACCESSIBLE BY DESIGN <span>·</span> PRIVATE BY DEFAULT</p>
      </section>
    </main>
  );
}

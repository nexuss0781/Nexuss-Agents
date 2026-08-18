import { ArrowLeft, ArrowRight, Github } from "lucide-react";
import "./LoginPortal.css";

const AXOLOTL_ICON = "/axolotl-only.png";

function beginSignIn(provider: "google" | "github") {
  window.location.assign(`/auth/${provider}`);
}

export default function LoginPortal() {
  const error = new URLSearchParams(window.location.search).get("error");
  const errorMessage = error === "configuration"
    ? "Sign-in is not fully configured yet. Check the server settings and try again."
    : error === "invalid_handoff"
      ? "That sign-in link expired. Start again with Google or GitHub."
      : error === "handoff_required"
        ? "The sign-in handoff was incomplete. Start again with Google or GitHub."
        : error === "user_not_found"
          ? "Your account could not be loaded. Please try again."
          : error === "handoff_failed"
            ? "The sign-in handoff could not be completed. Please try again."
            : null;

  return (
    <main className="login-portal">
      <a className="login-brand" href="/" aria-label="Return to Nexuss-Agent home">
        <img src={AXOLOTL_ICON} alt="" />
        <span>NEXUSS-AGENT</span>
      </a>
      <section className="login-card" aria-labelledby="login-title">
        <div className="login-mark"><img src={AXOLOTL_ICON} alt="Nexuss-Agent AXOLOTL mark" /></div>
        <p className="login-kicker">Welcome</p>
        <h1 id="login-title">Start where you left off.</h1>
        <p className="login-copy">Continue with the account you use most. If this is your first visit, we will create your account automatically.</p>
        {errorMessage && <p className="login-error" role="alert">{errorMessage}</p>}
        <div className="login-options">
          <button className="login-option" onClick={() => beginSignIn("google")}>
            <span className="google-symbol" aria-hidden="true">G</span>
            Continue with Google
            <ArrowRight size={17} />
          </button>
          <button className="login-option" onClick={() => beginSignIn("github")}>
            <Github size={18} aria-hidden="true" />
            Continue with GitHub
            <ArrowRight size={17} />
          </button>
        </div>
        <p className="login-note">No password to create or remember.</p>
      </section>
      <a className="login-back" href="/"><ArrowLeft size={15} /> Back to home</a>
    </main>
  );
}

import React from "react";
import { ArrowLeft, ArrowUpRight, Github, LockKeyhole } from "lucide-react";
import "./LoginPortal.css";

const AXOLOTL_ICON = "/axolotl-only.png";

export type LoginProvider = "google" | "github";

export function getLoginProviderPath(provider: LoginProvider) {
  return `/auth/${provider}`;
}

function beginSignIn(provider: LoginProvider) {
  window.location.assign(getLoginProviderPath(provider));
}

export default function LoginPortal() {
  const search = new URLSearchParams(typeof window === "undefined" ? "" : window.location.search);
  const error = search.get("error");
  const missing = search.get("missing")?.split(",").filter(Boolean) ?? [];
  const errorMessage = error === "configuration"
    ? missing.length > 0
      ? `Add ${missing.join(" and ")} in Render, then redeploy.`
      : "Sign-in is not fully configured yet. Check the server settings and try again."
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
      <div className="login-grid" aria-hidden="true" />
      <a className="login-brand" href="/" aria-label="Return to Nexuss-Agent home">
        <img src={AXOLOTL_ICON} alt="" />
        <span>NEXUSS-AGENT</span>
      </a>
      <p className="login-index" aria-hidden="true"><span>ACCESS / 01</span><span>PRIVATE WORKSPACE</span></p>
      <section className="login-stage" aria-labelledby="login-title">
        <div className="login-intro">
          <p className="login-kicker"><span aria-hidden="true" /> Workspace access</p>
          <h1 id="login-title">Enter the<br /><em>work.</em></h1>
          <p className="login-copy">A private surface for the threads, projects, and decisions that deserve continuity.</p>
          <div className="login-schematic" aria-hidden="true">
            <span className="schematic-node node-one" />
            <span className="schematic-node node-two" />
            <span className="schematic-node node-three" />
            <span className="schematic-line line-one" />
            <span className="schematic-line line-two" />
            <p>THREAD CONTINUITY<br />AT HANDOFF</p>
          </div>
        </div>
        <section className="login-card" aria-label="Sign in to Nexuss-Agent">
          <div className="login-card-topline"><span>IDENTITY CHECK</span><span>01—03</span></div>
          <div className="login-mark"><img src={AXOLOTL_ICON} alt="Nexuss-Agent AXOLOTL mark" /></div>
          <h2>Choose your<br />secure entry.</h2>
          <p className="login-card-copy">First visit? Your workspace is created after you sign in.</p>
          {errorMessage && <p className="login-error" role="alert"><LockKeyhole size={15} />{errorMessage}</p>}
          <div className="login-options">
            <button className="login-option login-option-primary" onClick={() => beginSignIn("google")}>
              <span className="google-symbol" aria-hidden="true">G</span>
              <span><strong>Continue with Google</strong><small>Recommended</small></span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
            <button className="login-option" onClick={() => beginSignIn("github")}>
              <Github size={19} aria-hidden="true" />
              <span><strong>Continue with GitHub</strong><small>Use your developer identity</small></span>
              <ArrowUpRight size={18} aria-hidden="true" />
            </button>
          </div>
          <p className="login-note"><LockKeyhole size={13} aria-hidden="true" /> No password stored. Your identity stays with your provider.</p>
        </section>
      </section>
      <a className="login-back" href="/"><ArrowLeft size={15} /> Back to home</a>
      <p className="login-status" aria-hidden="true"><span className="status-dot" /> AUTHENTICATION READY</p>
    </main>
  );
}

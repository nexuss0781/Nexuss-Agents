// Design philosophy: Obsidian Console — editorial precision, stealth graphite surfaces, espresso accents, and a calm systems-instrument hierarchy.
import { ArrowRight, ArrowUpRight, Check, Command, Layers3, Play, ShieldCheck, Sparkles } from "lucide-react";

const HERO_VISUAL = "/manus-storage/nexuss-agent-landing-hero_618d2aff.png";
const ORCHESTRATION_VISUAL = "/manus-storage/nexuss-agent-orchestration-visual_9fb38424.png";
const TEXTURE_VISUAL = "/manus-storage/nexuss-agent-signal-texture_a08b61e4.png";
const AXOLOTL_ICON = "/axolotl-only.png";

function enterWorkspace() {
  window.location.href = "/app";
}

export default function Landing() {
  return (
    <div className="landing-page">
      <header className="landing-nav">
        <a className="landing-brand" href="/" aria-label="Nexuss-Agent home">
          <span className="landing-brand-mark"><img src={AXOLOTL_ICON} alt="" /></span>
          <span><strong>NEXUSS-AGENT</strong><small>AGENT RUNTIME / LOCAL</small></span>
        </a>
        <nav className="landing-nav-links" aria-label="Primary navigation">
          <a href="#system">System</a>
          <a href="#principles">Principles</a>
          <a href="#access">Access</a>
        </nav>
        <button className="landing-nav-cta" onClick={enterWorkspace}>Open console <ArrowUpRight size={15} /></button>
      </header>

      <main>
        <section className="landing-hero" style={{ backgroundImage: `url(${TEXTURE_VISUAL})` }}>
          <div className="landing-hero-overlay" />
          <div className="landing-hero-grid" /><div className="landing-hero-schematic" aria-hidden="true"><span className="schematic-loop schematic-loop-a" /><span className="schematic-loop schematic-loop-b" /><span className="schematic-eye schematic-eye-a" /><span className="schematic-eye schematic-eye-b" /><span className="schematic-index">AX / 001</span></div>
          <div className="landing-hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" />NEXUSS / 001 <span>AGENTIC RUNTIME</span></div>
            <h1>Think in systems.<br /><em>Move with intent.</em></h1>
            <p>Nexuss-Agent is a focused workspace for turning complex prompts into clear, durable threads of work.</p>
            <div className="landing-hero-actions">
              <button className="landing-primary" onClick={enterWorkspace}>Enter the workspace <ArrowRight size={16} /></button>
              <a className="landing-secondary" href="#system"><Play size={14} /> Explore the system</a>
            </div>
            <div className="landing-proof-row"><span><Check size={13} /> Private by default</span><span><Check size={13} /> Built for momentum</span><span><Check size={13} /> No context loss</span></div>
          </div>
          <div className="landing-hero-readout"><span>STATUS</span><strong>STEALTH / READY</strong><span>THREAD INDEX / 001</span></div>
        </section>

        <section className="landing-intro section-shell" id="system">
          <div className="section-kicker">01 / THE WORKBENCH</div>
          <div className="intro-grid"><h2>Less noise.<br /><span>More signal.</span></h2><div><p className="large-copy">Agentic work does not begin with more surface area. It begins with a precise place for the next move.</p><p className="muted-copy">Nexuss-Agent keeps the workbench close, the context legible, and every thread ready to become a system.</p></div></div>
          <div className="principle-strip"><div><span>01</span><strong>Capture</strong><p>Turn raw intent into a thread you can return to.</p></div><div><span>02</span><strong>Shape</strong><p>Keep projects, prompts, and decisions in one frame.</p></div><div><span>03</span><strong>Advance</strong><p>Move from thought to action without losing the why.</p></div></div>
        </section>

        <section className="landing-orchestration section-shell" id="principles">
          <div className="section-kicker">02 / THREAD LOGIC</div>
          <div className="visual-split"><div className="visual-frame"><img src={ORCHESTRATION_VISUAL} alt="Abstract Nexuss-Agent orchestration system" /><span className="frame-corner corner-a" /><span className="frame-corner corner-b" /><div className="frame-label">SIGNAL MAP / 02</div></div><div className="visual-copy"><h2>One console for<br /><span>the whole thought.</span></h2><p>Projects give your work a home. Threads give it memory. The composer keeps the next move within reach.</p><div className="feature-list"><div><Layers3 size={17} /><span><strong>Context that stays put</strong><small>Assign a thread to a project without leaving the work.</small></span></div><div><Command size={17} /><span><strong>Fast by design</strong><small>Keyboard-first actions for the moments that matter.</small></span></div><div><ShieldCheck size={17} /><span><strong>Quietly local</strong><small>Your first workspace is yours, without account friction.</small></span></div></div></div></div>
        </section>

        <section className="landing-access section-shell" id="access" style={{ backgroundImage: `url(${TEXTURE_VISUAL})` }}>
          <div className="access-panel"><div><div className="section-kicker">03 / ENTRY POINT</div><h2>Start with a<br /><span>clean surface.</span></h2><p>Create a thread, name the work, and let the system take shape around you.</p></div><button className="landing-primary" onClick={enterWorkspace}>Open Nexuss-Agent <ArrowRight size={16} /></button></div>
        </section>
      </main>

      <footer className="landing-footer"><span>© 2026 NEXUSS-AGENT</span><span>AXOLOTL / AGENT RUNTIME</span><span>BUILT FOR CLEARER MOVES</span></footer>
    </div>
  );
}

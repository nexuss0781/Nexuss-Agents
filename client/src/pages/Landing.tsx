// Design philosophy: Obsidian Console — technical editorial brutalism, AXOLOTL geometry, and a premium instrument for complex work.
import { useEffect, useState } from "react";
import { ArrowRight, ArrowUpRight, Braces, Check, ChevronDown, Code2, FolderKanban, GitBranch, Layers3, Menu, MoveRight, Plus, ShieldCheck, Sparkles, X } from "lucide-react";
import "./Landing.css";

const AXOLOTL_ICON = "/axolotl-only.png";
const HERO_VISUAL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663100991006/LnTCbGOvmiEOValM.webp";
const CAPABILITY_VISUAL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663100991006/cqDGGiNGfXHkPKku.webp";
const FINAL_VISUAL = "https://files.manuscdn.com/user_upload_by_module/session_file/310519663100991006/eKKdXbFKdTrwyMgn.webp";

const navigation = [{ id: "system", label: "System" }, { id: "workbench", label: "Workbench" }, { id: "method", label: "Method" }];

function enterWorkspace() { window.location.href = "/app"; }

function Mark() {
  return <span className="nexus-brand-mark" aria-hidden="true"><img src={AXOLOTL_ICON} alt="" /></span>;
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeSection, setActiveSection] = useState("system");

  useEffect(() => {
    document.documentElement.classList.add("landing-route");
    document.body.classList.add("landing-route");
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
      if (visible) setActiveSection(visible.target.id);
    }, { rootMargin: "-32% 0px -55% 0px", threshold: [0.05, 0.35, 0.7] });
    navigation.forEach(({ id }) => { const section = document.getElementById(id); if (section) observer.observe(section); });
    return () => { document.documentElement.classList.remove("landing-route"); document.body.classList.remove("landing-route"); observer.disconnect(); };
  }, []);

  const closeMenu = () => setMenuOpen(false);

  return (
    <div className="nexus-landing">
      <header className="nexus-nav">
        <a className="nexus-wordmark" href="/" aria-label="Nexuss-Agent home"><Mark /><span className="nexus-wordmark-copy"><strong>NEXUSS-AGENT</strong><small>AGENTIC WORKSPACE</small></span></a>
        <nav className={`nexus-nav-links ${menuOpen ? "is-open" : ""}`} aria-label="Primary navigation">
          {navigation.map(({ id, label }) => <a className={activeSection === id ? "is-active" : ""} href={`#${id}`} key={id} onClick={closeMenu}>{label}</a>)}
          <button className="nexus-mobile-enter" onClick={enterWorkspace}>Open workspace <ArrowUpRight size={15} /></button>
        </nav>
        <div className="nexus-nav-actions"><button className="nexus-nav-enter" onClick={enterWorkspace}>Open workspace <ArrowUpRight size={14} /></button><button className="nexus-menu-toggle" onClick={() => setMenuOpen((open) => !open)} aria-expanded={menuOpen} aria-label={menuOpen ? "Close navigation" : "Open navigation"}>{menuOpen ? <X size={19} /> : <Menu size={19} />}</button></div>
      </header>

      <main>
        <section className="nexus-hero" id="overview">
          <div className="nexus-hero-noise" aria-hidden="true" />
          <div className="nexus-hero-shell">
            <div className="nexus-hero-copy">
              <div className="nexus-index"><span className="nexus-index-line" />NEXUSS / 001 <span>AGENT RUNTIME</span></div>
              <div className="nexus-hero-original-brand"><img src={AXOLOTL_ICON} alt="Original Nexuss-Agent AXOLOTL brand mark" /><span><strong>AXOLOTL</strong><small>THE ORIGINAL SYSTEM MARK</small></span></div>
              <h1>The instrument<br />for <i>complex work.</i></h1>
              <p>A disciplined surface for the work that does not fit inside one prompt. Hold the thread, shape the project, and keep the next move close.</p>
              <div className="nexus-hero-actions"><button className="nexus-button nexus-button-light" onClick={enterWorkspace}>Enter the workspace <ArrowRight size={17} /></button><a className="nexus-text-link" href="#system">See how it holds context <MoveRight size={16} /></a></div>
              <div className="nexus-hero-proof" aria-label="Product qualities"><span><Check size={13} /> Project-linked threads</span><span><Check size={13} /> Rich working surfaces</span><span><Check size={13} /> Local-first start</span></div>
            </div>
            <div className="nexus-hero-visual" aria-label="Abstract AXOLOTL runtime instrument">
              <img src={HERO_VISUAL} alt="Abstract AXOLOTL-derived runtime instrument in graphite and warm white" />
              <div className="nexus-visual-scan" aria-hidden="true" /><div className="nexus-visual-corner nexus-visual-corner-tl" aria-hidden="true" /><div className="nexus-visual-corner nexus-visual-corner-br" aria-hidden="true" />
              <div className="nexus-hero-docket nexus-docket-top"><span>THREAD</span><strong>01 / ACTIVE</strong></div><div className="nexus-hero-docket nexus-docket-bottom"><span>STATE</span><strong>READY FOR INPUT</strong></div><div className="nexus-hero-stamp"><Mark /><span>AXOLOTL<br />SYSTEM MARK</span></div>
            </div>
          </div>
          <div className="nexus-hero-footer"><span>SCROLL TO TRACE THE SYSTEM</span><ChevronDown size={14} /><span>01—05</span></div>
        </section>

        <section className="nexus-manifesto" id="system">
          <div className="nexus-section-shell">
            <div className="nexus-section-meta"><span>01 / CONTEXT IS AN ASSET</span><span>THE WORKBENCH MANIFESTO</span></div>
            <div className="nexus-manifesto-grid"><h2>Complexity does not<br />need more tabs.<br /><i>It needs memory.</i></h2><div className="nexus-manifesto-copy"><p className="nexus-lede">Nexuss-Agent treats a conversation as a durable work object, not an ephemeral exchange. Each thread has a place, a project can give it a frame, and the work remains legible as it grows.</p><p>Designed for researchers, builders, operators, and anyone who needs to make a complicated thing clear before moving it forward.</p><a className="nexus-inline-link" href="#workbench">Trace the operating surface <ArrowRight size={15} /></a></div></div>
            <div className="nexus-principle-bar"><article><span>01</span><strong>Keep the thread.</strong><p>Start from a clean prompt. Return without reconstructing the premise.</p></article><article><span>02</span><strong>Frame the work.</strong><p>Assign projects when context needs a durable home.</p></article><article><span>03</span><strong>Read the thinking.</strong><p>Use Markdown, LaTeX, and code when plain chat is not enough.</p></article></div>
          </div>
        </section>

        <section className="nexus-capabilities">
          <div className="nexus-section-shell">
            <div className="nexus-section-meta"><span>02 / OPERATING SURFACES</span><span>THE SYSTEM, UNFOLDED</span></div>
            <div className="nexus-capability-layout">
              <div className="nexus-capability-list"><h2>Structure without<br /><i>ceremony.</i></h2><p className="nexus-intro">Everything visible in the workspace has one job: make the current line of thought easier to continue.</p><div className="nexus-capability-items"><article><span className="nexus-capability-icon"><GitBranch size={18} /></span><div><span className="nexus-capability-number">01 / THREAD LOGIC</span><h3>Continuity that survives the first exchange.</h3><p>Create, rename, delete, and revisit focused threads without letting a working history dissolve into a feed.</p></div></article><article><span className="nexus-capability-icon"><FolderKanban size={18} /></span><div><span className="nexus-capability-number">02 / PROJECT FRAME</span><h3>Projects that clarify the line of work.</h3><p>Assign the current thread at the composer. Keep context associated without interrupting the act of thinking.</p></div></article><article><span className="nexus-capability-icon"><Braces size={18} /></span><div><span className="nexus-capability-number">03 / RICH RESPONSE SURFACE</span><h3>Readable by humans, useful for technical work.</h3><p>Render formatted Markdown, mathematical notation, and syntax-highlighted code in the same composed surface.</p></div></article></div></div>
              <figure className="nexus-specimen"><img src={CAPABILITY_VISUAL} alt="Abstract graphite systems specimen representing threads, projects, and context" /><figcaption><span>SPECIMEN / 02</span><span>CONTEXT → THREAD → MOVE</span></figcaption><span className="nexus-specimen-rule nexus-specimen-rule-a" aria-hidden="true" /><span className="nexus-specimen-rule nexus-specimen-rule-b" aria-hidden="true" /></figure>
            </div>
          </div>
        </section>

        <section className="nexus-workbench" id="workbench">
          <div className="nexus-section-shell">
            <div className="nexus-workbench-intro"><div className="nexus-section-meta"><span>03 / THE ACTUAL SURFACE</span><span>BUILT FOR THE NEXT MOVE</span></div><div><h2>A workbench that<br /><i>stays out of the way.</i></h2><p>Open a fresh runtime, choose the frame, and let the message become the centre of gravity. The interface is deliberately quiet so the work can be more precise.</p></div></div>
            <div className="nexus-console-preview" aria-label="Nexuss-Agent workspace preview">
              <aside className="nexus-preview-rail"><div className="nexus-preview-identity"><Mark /><span>NEXUSS<br />AGENT</span></div><button className="nexus-preview-new"><Plus size={14} /> <span>NEW THREAD</span></button><div className="nexus-preview-group"><span>CONVERSATIONS</span><button className="is-selected"><i />Map the implementation</button><button><i />Research notes</button><button><i />Untitled thread</button></div><div className="nexus-preview-profile"><span>NO</span><div><strong>Nexuss Operator</strong><small>PRIVATE CONSOLE</small></div></div></aside>
              <div className="nexus-preview-stage"><div className="nexus-preview-topline"><span>AGENT RUNTIME / LOCAL</span><strong>Map the implementation</strong><span>SYSTEM / STANDBY</span></div><div className="nexus-preview-message"><div className="nexus-preview-role"><Mark /><span>ASSISTANT / ANALYSIS</span></div><h3>Define the system before<br />you build the interface.</h3><p>Start by holding the essential objects in view: the thread, the project, and the next decision. The rest can remain quiet.</p><div className="nexus-code-sample"><span>workspace.ts</span><pre><code><i>const</i> <b>move</b> = <u>preserveContext</u>(thread, project);</code></pre></div></div><div className="nexus-preview-composer"><div><span>PROJECT / PRODUCT SYSTEM</span><span>READY FOR INPUT</span></div><p>Ask what the work needs next…</p><button aria-label="Send prompt"><ArrowUpRight size={16} /></button></div></div>
            </div>
            <div className="nexus-workbench-footer"><span>THE REAL INTERFACE AT <strong>/APP</strong></span><button onClick={enterWorkspace}>Open the workbench <ArrowRight size={16} /></button></div>
          </div>
        </section>

        <section className="nexus-method" id="method">
          <div className="nexus-section-shell"><div className="nexus-method-heading"><div className="nexus-section-meta"><span>04 / THE METHOD</span><span>FROM SIGNAL TO SURFACE</span></div><h2>Make the next move<br /><i>feel obvious.</i></h2></div><div className="nexus-method-grid"><article><span className="nexus-method-index">A</span><Sparkles size={18} /><h3>Begin with the raw signal.</h3><p>Open a thread when a thought deserves a place to develop rather than a place to disappear.</p></article><article><span className="nexus-method-index">B</span><Layers3 size={18} /><h3>Give the work its frame.</h3><p>Use a project when the thread belongs to a broader line of inquiry, build, or decision.</p></article><article><span className="nexus-method-index">C</span><Code2 size={18} /><h3>Use the right working language.</h3><p>Let prose, equations, and code sit beside each other when the work needs more than plain text.</p></article><article><span className="nexus-method-index">D</span><ShieldCheck size={18} /><h3>Keep the system calm.</h3><p>Start locally and without an account gate. Focus the surface before you add more machinery.</p></article></div></div>
        </section>

        <section className="nexus-access" id="access"><img className="nexus-access-image" src={FINAL_VISUAL} alt="Abstract monochrome AXOLOTL signal field" /><div className="nexus-access-shade" aria-hidden="true" /><div className="nexus-section-shell nexus-access-content"><div className="nexus-section-meta"><span>05 / ENTRY POINT</span><span>THE CONSOLE IS READY</span></div><div className="nexus-access-main"><div><h2>Let the work<br /><i>keep its shape.</i></h2><p>Your next thread does not need another dashboard. It needs a surface worthy of the question.</p></div><button className="nexus-button nexus-button-light" onClick={enterWorkspace}>Open Nexuss-Agent <ArrowRight size={18} /></button></div></div></section>
      </main>
      <footer className="nexus-footer"><a className="nexus-wordmark" href="/" aria-label="Nexuss-Agent home"><Mark /><span className="nexus-wordmark-copy"><strong>NEXUSS-AGENT</strong><small>AXOLOTL / AGENT RUNTIME</small></span></a><span>BUILT FOR CLEARER MOVES</span><span>© 2026</span></footer>
    </div>
  );
}

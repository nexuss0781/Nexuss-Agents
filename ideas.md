# Nexuss-Agent Design Direction

## Three possible directions

### Theme Name: Obsidian Console
Very dark, precise, and editorial, with a monochrome command-center feel and restrained technical accents.
**Probability:** 0.07

### Theme Name: Paper Signal
A light-first workspace inspired by premium documentation tools, using warm white surfaces and ink-black typography.
**Probability:** 0.03

### Theme Name: Graphite Atelier
A quiet, tactile dark workspace with graphite surfaces, subtle material depth, and a single electric-lime signature accent.
**Probability:** 0.08

## Chosen approach: Obsidian Console

### Design Movement
Swiss International Style translated into a contemporary developer-console interface: disciplined alignment, strong typographic hierarchy, asymmetric composition, and purposeful restraint.

### Core Principles
1. **High signal, low ornament.** Every control earns its place and inactive elements recede.
2. **Monochrome hierarchy.** Contrast, spacing, weight, and texture carry more meaning than color.
3. **Conversation as the focal instrument.** The thread should feel like a calm, spacious workbench rather than a noisy chat feed.
4. **Precision in motion.** Interactions are quick, tactile, and never decorative for their own sake.

### Color Philosophy
The interface is built from near-black, black, graphite, smoke, and white. The absence of color creates a neutral technical canvas that lets content and state changes lead. A very small amount of cold silver is used for separators and metadata, while the AXOLOTL mark is rendered as a white geometric silhouette so the brand is recognizable even without a colored accent.

### Layout Paradigm
A persistent, narrow navigation rail anchors the left edge. The conversation workspace occupies the center with a deliberately offset reading column rather than a fully centered dashboard grid. Project context and thread metadata sit in the upper workspace margin; the composer is anchored to the lower edge as a floating workbench with a clear perimeter.

### Signature Elements
- A compact AXOLOTL glyph made from an angular loop and two eye dots.
- Hairline separators with small uppercase section labels, inspired by technical schematics.
- Monospace metadata and tiny index numbers that make the workspace feel instrumented and intentional.

### Interaction Philosophy
Interactions should feel like editing a live instrument panel. Hover states reveal affordances without changing layout. Selection is expressed with a crisp light surface or white rule. Destructive actions are explicit and calm. Keyboard navigation and predictable focus states are first-class behaviors.

### Animation
Use 140–220ms transitions with a snappy ease-out. New messages enter with a subtle opacity and 6px upward translation. Side panels and dialogs fade and translate from their trigger edge, never scale from zero. Thread selection updates immediately, while secondary metadata settles in after a short 40ms stagger. Respect `prefers-reduced-motion` by removing nonessential entrance movement.

### Typography System
Use **Space Grotesk** for display labels, headings, and primary navigation, paired with **IBM Plex Mono** for metadata, timestamps, project IDs, keyboard hints, and code. Use compact uppercase labels with increased tracking for system sections. Conversation prose should be readable at 15–16px with generous line-height; thread titles should be dense and confident rather than oversized.

### Brand Essence
Nexuss-Agent is a focused AI workbench for people who think in systems, built to keep ideas, threads, and projects in one composed space.

**Personality:** precise, composed, inventive.

### Brand Voice
Headlines are direct and quietly confident. CTAs use active verbs without hype. Microcopy explains state plainly and avoids generic onboarding language.

Example lines:
- “A cleaner surface for complicated thinking.”
- “Keep the thread. Shape the system.”

### Wordmark & Logo
The AXOLOTL mark is a bold geometric icon: a flattened, angular body loop with two small circular eye cuts, paired with a custom-spaced `NEXUSS-AGENT` wordmark in uppercase Space Grotesk. The icon should remain legible at 20px and become a strong standalone mark at larger sizes.

### Signature Brand Color
**AXOLOTL WHITE — #F4F4F0**, a slightly warm white used for the AXOLOTL mark, active controls, and primary action surfaces. It is ownable because it is intentionally softer than pure white while retaining crisp contrast against the Obsidian Console background.

## Style Decisions

- Decorative diagrams must derive from the AXOLOTL angular loop, eye-dot geometry, thread indices, or technical hairline schematics; generic orbit and constellation language is avoided.
- The workspace grid remains deliberately asymmetric, with the reading surface offset against the sidebar and composer rather than centered like a conventional dashboard.
- The AXOLOTL glyph acts as a primary brand motif in system moments and empty states, not only as a small header badge.

- The AXOLOTL mark remains a precise geometric symbol rather than a colorful mascot or illustrative animal on the public landing page.
- The landing page uses AXOLOTL WHITE, graphite, smoke, and cold-silver hierarchy; warm bronze and sepia accents are excluded from the public brand surface.
- Hero decoration is derived from angular loop geometry, eye dots, thread indices, and schematic hairlines rather than generic circuits, constellations, or orbital diagrams.
- The public landing page and `/app` workspace share the same restrained Obsidian Console language so the transition between them feels continuous.

## Premium Landing Evolution: The Instrument for Complex Work

The public surface evolves from a short product introduction into a **cinematic field guide for agentic work**. The intended feeling is not an ordinary SaaS landing page: it is an invitation into a composed instrument that absorbs complexity and returns a next move. The visual system will remain monochrome, but gain depth through translucent graphite planes, macro AXOLOTL geometry, precision diagrams, editorial imagery, and a varied progression of dense and quiet sections.

### Narrative Architecture

The story opens with an oversized product declaration and a live-looking runtime specimen. It then shifts through a manifesto, an operational capabilities sequence, an applied workspace preview, a systems principles wall, a practical implementation strip, and a high-contrast final entry point. Every section answers a progressively more concrete question: why the product exists, how it holds context, what the workspace makes possible, and where to begin.

### Visual Language

Use **technical editorial brutalism** rather than generic dark SaaS styling. Section transitions will alternate between full-bleed dark fields, fine-rule index bands, dense card assemblies, and quiet typographic interludes. The AXOLOTL symbol becomes a macro-scale structural contour, while its eye dots become an active-status motif. A near-white action surface is reserved for decisive moments. No gradients in brand colors, colorful lighting, pill-heavy UI, generic bento grids, fake testimonials, or fabricated performance claims are permitted.

### Interaction and Motion

Motion should make the site feel awake but controlled: the hero specimen emits a slow signal sweep, rules resolve into place, cards raise minimally on hover, and the local navigation identifies the active section on scroll. All nonessential motion will be disabled for reduced-motion preferences. CTA actions remain direct: they always enter the real `/app` workspace.

### Content Standard

The page will use concrete product language based only on the implemented workspace: threads, projects, assignment, local persistence, Markdown, LaTex, code rendering, and responsive composition. It will avoid invented customers, reviews, integrations, metrics, and capabilities.

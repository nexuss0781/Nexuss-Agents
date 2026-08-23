# Premium Landing Redesign

- [x] Define a richer premium narrative, section architecture, and visual rhythm for the public site.
- [x] Generate distinctive AXOLOTL-derived visual assets for the hero, feature system, and final conversion moment.
- [x] Rebuild the landing page with elevated motion, product proof, platform capability sections, and a stronger `/app` entry.
- [x] Preserve the existing `/app` workspace and test the route transition.
- [x] Validate desktop and mobile visual composition, interactions, accessibility, and production build.
- [x] Save a checkpoint and push the completed redesign to `master`.

## Render Asset Repair

- [x] Identify all Manus storage URLs that break on the Render deployment and locate local source assets.
- [x] Package optimized Render-safe visual assets within the static build output.
- [x] Replace landing, workspace, favicon, and manifest references with stable deployed paths.
- [x] Validate production build output and browser asset requests at desktop and mobile sizes.
- [x] Save the correction and push the deployment-ready fix to `master`.

## Original AXOLOTL Brand Restoration

- [x] Review the approved original AXOLOTL brand file and identify the correct source for all visible brand surfaces.
- [x] Prepare a compact Render-safe version of the original brand mark for the site and favicon.
- [x] Restore the original brand in the landing header, hero focal point, workspace, favicon, and manifest.
- [x] Confirm the restored brand is visible in the first impression at desktop, mobile, and the live Render deployment.
- [x] Save and push the original-brand restoration to `master`.

## Label and Jargon Simplification

- [x] Audit miniature labels, decorative system codes, and AI-jargon fragments across `/` and `/app`.
- [x] Remove landing-page readouts, micro-labels, and nonessential jargon while preserving headings, brand, and navigation.
- [x] Remove workspace decorative labels while retaining the labels required to use threads, projects, and the composer.
- [x] Validate the simplified layout at desktop and mobile sizes.
- [x] Save and push the label-free revision to `master`.

## External Skill Review

- [x] Clone the requested repository and locate only `SKILL/SKILL.md`.
- [x] Review the skill instructions in full without modifying any files.
- [x] Deliver a concise assessment of the skill.

## Simple Sign-In Portal

- [x] Confirm the cross-site server-handoff session model and configure the active Nexuss Auth project with the exact Render origin, callback, Google, and GitHub providers.
- [x] Upgrade the app for secure server-side authentication handling with cross-site handoff exchange and signed HTTP-only application sessions.
- [x] Test the callback success path, session cookie creation, and workspace redirect with a mocked one-time handoff exchange.
- [x] Test invalid or replayed handoff rejection and verify that no session cookie is created.
- [x] Test signed session recovery and Nexuss-Agent logout cookie clearing.
- [x] Test explicit handoff-token replay rejection without a second session cookie.
- [x] Create a dedicated login portal with Google and GitHub entry; first-time users are created by the selected provider flow.
- [x] Configure automatic account creation and route signed-in users into the protected workspace.
- [x] Verify callback success, invalid/replayed handoff rejection, session recovery, logout, and protected access with automated tests; the user will complete the live provider test on Render.
- [x] Save and push the authentication-enabled project to `master`.
- [x] Confirm the configured callback already uses the exact active Render origin, so the server can safely use the registered production callback without a runtime-origin override.

## OAuth Bootstrap Repair

- [x] Identify the unused built-in OAuth initialization that emits the missing `OAUTH_SERVER_URL` error.
- [x] Remove the unused initialization while preserving the Nexuss Auth Google and GitHub routes.
- [x] Validate server startup, TypeScript, production build, and provider-start routes without `OAUTH_SERVER_URL`.
- [x] Recheck Google, GitHub, and missing-handoff callback responses after removing the template OAuth bootstrap.
- [x] Save and push the correction to `master`.

## Nexuss Auth Handoff Repair

- [x] Re-read the Nexuss Auth handoff contract and capture the failure details without retaining one-time tokens; the prior callback masked the service response and now emits only safe failure categories and status codes.
- [x] Correct the server-side handoff exchange handling and callback parsing with safe error categories for configuration, missing, invalid, or expired handoffs.
- [x] Test successful and rejected handoff behavior, including replay rejection, without exposing sensitive tokens.
- [x] Verify the live Google completion flow after the diagnostic callback repair deploys to Render.
- [x] Save and push the callback repair to `master`.

## Render Auth Configuration Diagnosis

- [x] Identify the exact missing runtime setting from the callback configuration path without exposing values.
- [x] Show the operator the missing variable name in the sign-in recovery message.
- [x] Validate both missing-setting and fully configured callback behavior with the full test suite, TypeScript, and production build.
- [x] Save and push the configuration-feedback update to `master`.

## Signed-In Account Navigation

- [x] Inspect the current authenticated user data passed into the workspace and the existing account presentation.
- [x] Add a larger, visible account area with the real avatar, name, email, and sign-out action.
- [x] Validate the enlarged account area visually at desktop and mobile sizes; the avatar, name, email, and sign-out action remain visible in the desktop topbar/sidebar and the mobile drawer, with initials as a fallback if the provider avatar fails to load. Profile unit test, TypeScript, and production build also passed.
- [x] Save and push the account navigation enhancement to `master`.

## Login Portal Visual Redesign

- [x] Audit the current `/login` composition, existing authentication states, and responsive layout constraints.
- [x] Redesign the login portal with a distinctive AXOLOTL-led dark editorial composition while retaining the established Google and GitHub authentication flows.
- [x] Add polished interaction, keyboard-focus accessibility, and configuration-feedback states without altering the server-side sign-in contract.
- [x] Validate the redesigned login view at desktop and mobile sizes, including provider-route unit coverage, safe configuration-feedback rendering, TypeScript, and production build.
- [x] Save and push the finished login portal redesign to `master`.

> Visual review note: The desktop entry console keeps a clear asymmetric headline-to-auth-panel hierarchy, while the 390px mobile layout retains readable identity metadata and full-width Google and GitHub actions.

## Paradox-DB Connection Readiness

- [x] Inspect whether an existing Paradox-DB integration is configured and confirm the appropriate server-side connection approach.
- [x] Register the approved Paradox-DB account with a generated high-entropy registration credential, obtaining a gateway-issued API key without exposing credentials in source code or URLs.
- [x] Generate a separate high-entropy database passphrase and retain the generated API key and passphrase in a restricted local credential record until application persistence is explicitly wired.
- [x] Verify encrypted Paradox-DB connectivity with a minimal server-side database operation, remote encrypted sync, and clean shutdown.
- [x] Document the successful connection and persistence implementation constraints before adding application data models.

## Authenticated Workspace Persistence

- [x] Audit the existing local thread/project/message data structures and define the durable, user-scoped Paradox-DB schema.
- [x] Wire and validate protected server-side Paradox-DB configuration through the shared server-only workspace store without exposing API credentials or encryption passphrases to the browser.
- [x] Implement and test authenticated persistence APIs for projects, project-assigned threads, projectless threads, every message in each thread history, and one-time legacy imports.
- [x] Replace the workspace’s browser-only data path with durable server data and one-time safe migration of existing local histories.
- [x] Test user isolation, complete history round trips, project assignment and removal, projectless threads, reload persistence, safe migration, and recoverable failure handling.
- [x] Add an application-level regression test proving stale local history is skipped when the signed-in user already has durable remote projects or threads.
- [x] Add a client rendering test proving the workspace load failure state presents its recovery message and retry action.
- [x] Add an explicit fresh-load regression test proving persisted project and complete thread history data reappear after the workspace is reopened.
- [x] Save and push the finished authenticated workspace persistence feature to `master`.

## Workspace Persistence Reliability Fix

- [x] Reproduce the authenticated workspace becoming stuck on “LOADING YOUR WORKSPACE” and identify the blocked migration-refresh and poisoned operation-queue paths.
- [x] Fix the migration and loading readiness transitions so retry can recover and workspace actions become available.
- [x] Verify new project creation, projectless thread creation, message saving, and durable reload behavior through authenticated router and mounted client coverage.
- [x] Add a mounted client regression test proving Retry recovers from a failed workspace load into an interactive workspace state.
- [x] Add a mounted client regression test proving project creation is enabled and succeeds after the workspace has recovered.
- [x] Save and push the workspace reliability fix to `master`.

## Live Production Workspace Repair

- [x] Inspect the live production workspace request and confirm the deployed server reports `Paradox-DB persistence is not configured`.
- [x] Apply `PARADOX_GATEWAY_URL`, `PARADOX_API_KEY`, and `PARADOX_PASSPHRASE` to the Render server environment, then redeploy; the live workspace now loads and displays persisted project data.
- [ ] Verify a live signed-in workspace can create a project, send a first message, and persist the resulting project-linked thread on the deployed service.
- [ ] Save and push the production workspace repair to `master`.

## Composer and Project Assignment Interaction

- [x] Audit why the empty workspace disables the composer and project assignment controls despite available persisted projects.
- [x] Allow an authenticated user to enter a first message immediately, creating a durable thread on send when none exists.
- [x] Keep the assignment dropdown enabled for saved projects and apply the selected project to the created or active thread.
- [x] Test immediate compose, automatic thread creation, project selection, assignment persistence, and message saving through mounted client coverage, full tests, TypeScript, and production build.
- [x] Save and push the composer interaction fix to `master`.

## Durable Thread Identity and Response States

- [x] Audit the persisted thread schema, new-thread flow, and current loading presentation.
- [x] Add a stable unique chat slug to durable threads and show it as a usable identifier in the workspace.
- [x] Prevent redundant empty threads so a user retains one clean starting thread instead of duplicate blank histories.
- [x] Add a professional future-response skeleton that can represent long-running generated output without blocking the workspace.
- [x] Test unique thread identity, single empty-thread creation, and response loading states with server and client coverage, TypeScript, and a production build.
- [x] Save and push the thread identity and response-state improvements to `master`.

## Focused Chat Workspace Refinement

- [x] Audit the current client route, thread query, composer placement, and repeated account presentation.
- [x] Put the active thread’s unique chat slug in the browser address and support opening that chat directly.
- [x] Load full message history only for the active chat while retaining lightweight thread/project navigation for performance.
- [x] Place project selection on the composer’s left, send control on its right, and remove the duplicated top-right account copy while keeping the sign-out icon.
- [x] Test deep-link selection, single-chat history loading, persistent project assignment, and responsive control placement with server, router, mounted-client, TypeScript, and production-build coverage.
- [x] Save and push the focused-chat refinement to `master`.

## Local-First Workspace Saves and Project Hydration

- [x] Review the Paradox-DB local dotdat and sync contract alongside the current server connection lifecycle.
- [x] Persist every workspace mutation to the local encrypted dotdat snapshot before returning success to the user session.
- [x] Replace per-action cloud synchronization with the encrypted database daemon’s bounded queued batch sync so project, thread, and message creation do not await cloud I/O.
- [x] Hydrate saved projects independently from active chat history and display a left-sidebar project skeleton while that data is loading.
- [x] Test local-first mutation acknowledgment, queued sync behavior, project hydration without a first prompt, project skeleton presentation, TypeScript, and a production build.
- [x] Save and push the local-first workspace persistence enhancement to `master` (GitHub commit `156086b`).

## Workspace Settings Surface

- [x] Replace the top-right sign-out control with an accessible settings-gear trigger.
- [x] Create a polished dark workspace settings panel with account information, local-first persistence context, focused-workspace information, and an intentional sign-out action.
- [x] Add regression coverage and validate the settings trigger, panel, account sign-out action, Escape dismissal, TypeScript, and the production build.
- [x] Save and push the workspace settings enhancement to `master` (GitHub commit `d5e23dc`).

## Provider and Model Preferences

- [x] Replace informational workspace settings rows with encrypted user-scoped API key and OpenAI-compatible base endpoint configuration.
- [x] Add guarded server-side dynamic model discovery and persistent multi-select model preferences without exposing the API key to the browser.
- [x] Build and test a streamlined responsive settings form with refreshable model choices, select/unselect controls, recovery feedback, TypeScript, and a production build.
- [x] Save and push the provider and model preferences enhancement to `master` (GitHub commit `080bedd`).

## Settings Scrollability

- [x] Make the settings panel body independently scrollable within the viewport while preserving its header and footer actions.
- [x] Retain a separate, bounded scroll area for long available-model catalogs.
- [x] Validate responsive scroll behavior, TypeScript, and the production build.
- [x] Save a checkpoint for the validated settings scrollability correction (project version `887a5c01`).
- [x] Push the settings scrollability correction and checklist record to `master` (GitHub commit `75aca0a`).

## Composer Model and Project Controls

- [x] Display saved selected models in a composer dropdown at the current left-side project-control position.
- [x] Move project assignment to the composer’s right edge beside the send action while preserving thread assignment behavior.
- [x] Anchor model and project menus to their respective triggers, then validate TypeScript and the production build.
- [x] Validate trigger-relative model/project menu structure, mobile anchoring rules, TypeScript, and the production build with focused regression coverage.
- [ ] Confirm the new composer controls visually in a live authenticated desktop and mobile workspace session.
- [x] Save a checkpoint for the composer control refinement (project version `60977735`).
- [x] Push the composer control refinement and checklist record to `master` (GitHub commit `6e7fffe`).

## Research Content Renderer

- [x] Upgrade message rendering for CommonMark/GFM content, mathematical notation, syntax-highlighted code, tables, citations, and Mermaid diagrams with a restrained content-first presentation.
- [x] Add robust rendering fallbacks for invalid diagram definitions, safe external links, and accessible copyable code blocks.
- [x] Add regression coverage for research-rich content formats, then validate TypeScript and the production build.
- [x] Save a checkpoint for the research renderer enhancement (project version `cb6000dd`).
- [x] Push the research renderer enhancement and checklist record to `master` (GitHub commit `9bab791`).

## Durable Provider Secret and Model Catalog Persistence

- [x] Keep provider API secrets in the encrypted, user-scoped Paradox workspace and never return them to the browser.
- [x] Persist the discovered model catalog alongside selected-model preferences so Settings rehydrates after refresh or restart.
- [x] Show a non-revealing configured-secret status in Settings and authenticate model discovery from the durable server-side secret.
- [x] Add regression coverage for secret-status hydration, catalog persistence, TypeScript, and the production build.
- [ ] Save and push the durable provider persistence enhancement to `master`.

## Release Verification Notes

- The local frontend persistence suite passes and the TypeScript check and production build pass.
- Full server integration tests require the deployment’s configured `PARADOX_API_KEY`, `PARADOX_PASSPHRASE`, and gateway access; those credentials are not present in this shell.
- Live authenticated Render verification remains pending: refresh the workspace, reopen Settings, confirm the non-revealing configured-secret status and persisted model list, then run Refresh models without re-entering the key.

## Playground Model Streaming and Prompt Queue

- [x] Connect the selected encrypted provider model to an authenticated OpenAI-compatible streaming endpoint.
- [x] Render assistant output token by token and persist the completed or stopped partial response in the user-scoped Paradox workspace.
- [x] Change Send into a forceful Stop control during generation and abort the upstream provider reader immediately.
- [x] Add a subtle Send dropdown for sending the current draft after the active response or after all queued prompts, with completion notifications.
- [x] Add regression coverage for chunked SSE parsing, cancellation, live output, Stop state, and queue controls.
- [ ] Save and push the playground streaming integration to `master`.

## Playground Verification Notes

- TypeScript validation, the frontend persistence/streaming suite, the isolated server SSE parser suite, production build, and diff hygiene checks pass.
- Full server integration tests still require the deployment’s configured Paradox credentials and a live provider endpoint.
- Live authenticated verification remains pending: select a saved model, send a prompt, confirm token-by-token output, test Send after this response and Send after queued prompts, then click Stop and verify the partial response persists after refresh.

## Corrected Playground Interaction and Composer Visuals

The playground now keeps the initial composer minimal: there is no queue chevron until a streaming response is active and the user has typed a follow-up. During streaming with an empty draft, the primary control is a red Stop button. Once a follow-up exists, it becomes Send with a separate chevron; the direct action queues the follow-up for the next provider completion, while the dropdown exposes only **Add to queue** for deferred execution.

Duplicate live/persisted user and assistant turns are suppressed with timestamp-aware checks. Stop clears pending queue work when no new prompt is written and carries a transient hidden stop instruction into the next model request without persisting it in the visible conversation. The project selector now sits beside the model selector in the composer’s top row, and the model menu has an explicit Saved models header, left-to-right model-name rendering, and clearer active-state styling.

Focused verification passes: TypeScript, 15 frontend/server streaming tests, production build, and diff hygiene. The local browser reached the authenticated login screen; live playground visual verification remains dependent on a signed-in workspace session.

## Empty Response and Console-First Error Management

- [x] Flush unterminated final provider SSE frames so the last token is not lost when a provider closes without a trailing newline.
- [x] Support common `delta.content`, `message.content`, `reasoning_content`, `thinking`, and text-completion payload variants.
- [x] Surface provider error events to the server console and keep browser-facing messages concise.
- [x] Log safe request status, malformed-frame, cancellation, and empty-output diagnostics without logging prompts or credentials.
- [x] Separate JSON parsing failures from provider event failures so error events are not swallowed as malformed frames.
- [x] Add regression coverage for empty final frames, payload variants, provider errors, and concise client error handling.
- [ ] Build, commit, and push the error-management hardening.

## Deployed Provider Failure Diagnostics

The playground stream now returns a safe request ID, provider error code, HTTP status, and bounded redacted diagnostic for failed model requests. `big-pickle` failures such as an unselected model, missing key, provider HTTP rejection, invalid endpoint, and transport error are classified in the server console and surfaced in the browser console without exposing prompts or credentials. The visible UI remains concise and non-disruptive.

Focused TypeScript and streaming/error tests pass. The remaining release action is the production build and push of the diagnostic contract.

## OpenRouter Free-Model Documentation

- [x] Created `AI-Models/Openrouter.md` from the supplied OpenRouter catalog.
- [x] Organized the reference into catalog, reasoning, coding, multimodal, retrieval, and operational modules.
- [x] Documented 15 free-model entries, one adjacent paid reranker, routing recommendations, capability negotiation, privacy/licensing caveats, and streaming/error-handling guidance.
- [x] Validated 15 free inventory rows, modular headings, reference metadata, and `git diff --check`.

## Autonomous Builder Platform Blueprint

- [x] Defined Nexuss-Agent as a persistent autonomous-builder operating system rather than a research mode, WebDev mode, or assistant clone.
- [x] Specified the hierarchical principal-orchestrator, sub-orchestrator, specialist, harness, tool, and independent-quality-agent workflow.
- [x] Defined recursive decomposition, evidence-backed completion, bounded autonomy, failure recovery, and durable mission state.
- [x] Defined the experience-to-memory-to-skill-to-shortcut promotion pipeline with domain and subdomain classification.
- [x] Created `docs/Nexuss-AGI-Builder-Workflow.md` with the end-to-end workflow, platform primitives, roadmap, and system-prompt principle.


## Phase 3 — Server-Owned Mission Runner

- [x] Added durable mission leases with expiry, heartbeat, ownership, and release semantics.
- [x] Implemented server-owned lifecycle progression, dependency-aware work-item claiming, sequential execution, cancellation cleanup, and lease cleanup.
- [x] Added guarded queue, pause, resume, stop, retry, and recovery commands.
- [x] Exposed authenticated mission create/get/list/start/pause/resume/stop/retry/recover tRPC procedures with concise conflict errors.
- [x] Added deterministic runner regression coverage for lifecycle completion, concurrent-start deduplication, and cancellation.
- [x] TypeScript, runner/constitution tests, production build, and diff hygiene pass. Paradox-backed integration tests remain deployment-credential dependent.

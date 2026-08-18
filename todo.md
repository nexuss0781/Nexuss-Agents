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
- [ ] Save and push the correction to `master`.

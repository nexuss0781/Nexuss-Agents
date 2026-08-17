# Project TODO

- [x] Create persistent database models for projects, threads, and thread messages with ownership safeguards and indexed chronological retrieval.
- [x] Implement authenticated server procedures for project CRUD, thread CRUD, thread-project association, thread history, and message persistence.
- [x] Integrate built-in streaming AI chat and persist complete user and assistant messages in their parent thread.
- [x] Build a branded local-account landing and login screen for unauthenticated visitors.
- [x] Build the desktop three-panel dashboard: thread and project sidebar, central chat workspace, and contextual right panel.
- [x] Create, rename, and delete threads with persisted latest-message snippets and human-readable timestamps in the sidebar.
- [x] Create, rename, and delete projects with persisted name, description, and color tag.
- [x] Add project attachment and detachment controls to the composer and active-project badge to the chat header.
- [x] Implement an auto-resizing composer with Ctrl+Enter / Cmd+Enter send shortcut and character/token indicator.
- [x] Implement cached markdown output with code highlighting, KaTeX math, tables, and rich inline formatting.
- [x] Apply the dark brand system: near-black #0A0E1A foundation, white typography, electric green #00FF88 accents, and blue #1E40AF highlights.
- [x] Add unit coverage for the new server procedures and run type, test, and visual validation.
- [x] Implement a bounded compiled-markdown cache keyed by message content and rendering configuration.
- [x] Validate authenticated browser flows for thread and project CRUD, project attachment, persisted history, and streamed chat.
- [x] Save a final checkpoint after verifying the full Nexuss-Agent experience.
- [x] Replace the inherited Manus OAuth dependency with email-and-password account registration, login, logout, and signed session handling.
- [x] Add secure password hashing and user-owned local authentication records without exposing credential data to the client.
- [x] Replace Manus OAuth loading, access gates, and landing copy with conventional sign-in and account-creation flows.
- [x] Update all protected playground procedures and streaming endpoints to use the local account session.
- [x] Validate registration, sign-in, sign-out, route protection, and retained user-scoped playground functionality.
- [x] Validate authenticated rename and delete flows for both threads and projects in the browser.
- [x] Confirm the visible sign-out control works through a standard browser click and complete the final local-authentication validation.
- [x] Inspect and verify MarkdownMessage contains a bounded compiled-markdown cache keyed by content and rendering configuration with eviction behavior.
- [x] Inspect and verify MarkdownMessage tests cover cache hits, bounds/eviction, and preserved rich markdown features including highlighting, KaTeX, tables, and safe HTML output.

- [x] Validate thread deletion end to end in the browser, including confirmation, disappearance from the sidebar, and active-state reset.
- [x] Validate project deletion end to end in the browser, including disappearance and correct handling of attached threads.
- [x] Re-mark browser CRUD validation complete after both delete flows are verified.

- [x] Validate thread deletion fully in the browser: open the delete dialog, confirm deletion, and verify the thread disappears with active state reset without SQL intervention.
- [x] Validate project deletion fully in the browser: delete an attached project through the UI and verify it disappears while the formerly attached thread becomes unassigned.
- [x] Save a new final checkpoint after both browser delete flows pass, then re-mark CRUD and final checkpoint completion items.

- [x] Inspect and document the official Paradox-DB skill guidance at the user-provided repository URL.
- [x] Map Nexuss-Agent’s current users, local accounts, projects, threads, and messages schema to Paradox-DB primitives.
- [x] Request and configure any mandatory Paradox-DB connection secrets without exposing credentials.
- [x] Implement the Paradox-DB adapter and migrate application persistence while preserving user ownership and message history.
- [x] Validate authentication, project/thread CRUD, streaming message persistence, tests, type checking, and production build after migration.
- [x] Save and push a new checkpoint containing the verified Paradox-DB migration.

- [x] Generate a compliant Paradox account password and encryption passphrase of at least 12 characters; do not use `123456`.
- [x] Provision the Nexuss-Agent Paradox cloud project under the requested account without putting credentials in a connection URL.
- [x] Configure the new server-side Paradox credentials and verify cloud connectivity before migrating data.

- [x] Superseded by the compliant alias-account credential generation flow completed below; no weaker credential was stored or displayed.
- [x] Superseded by the provisioned `nexuss0781+paradox@gmail.com` alias flow completed below; the requested Gmail account was not used because the alias was the approved registration path.
- [x] Superseded by secure storage of the resulting alias-account Paradox API key and passphrase completed below.

- [x] Generate new compliant credentials for `nexuss0781+paradox@gmail.com` without displaying them.
- [x] Register the Gmail alias account and provision the `nexuss-agent` Paradox cloud project/database.
- [x] Store only the resulting API key and encryption passphrase as server-side project secrets.

- [x] Re-run post-migration full CRUD on Paradox-DB: rename and delete projects and threads, verify attached-thread unassignment, and confirm ownership protections.
- [x] Resolve and re-check stale runtime module-export warnings after the Paradox switch, then confirm current dev and browser logs are clean.
- [x] Verify the Paradox schema mapping with a representative dataset containing projects, threads, and messages and confirm all relationships survive migration.
- [x] Re-validate local auth after migration end to end: sign out, sign back in, access protected routes, and confirm user-scoped data remains isolated.

- [x] Re-run post-migration thread rename in the browser and verify the updated title persists after reload.
- [x] Explicitly verify post-migration ownership protections with targeted user-scoped tests for projects, threads, and messages.
- [x] Restart and re-check logs to distinguish historical errors from current runtime errors, then confirm the current preview has no active module or query errors.
- [x] Re-validate local auth after migration by signing out and signing back in, then confirm the protected workspace remains user-scoped.

- [x] Add targeted automated tests for Paradox-backed user scoping across project, thread, and message reads and mutations.
- [x] Fix the stale post-delete message-query race, restart the preview, reproduce the empty state, and confirm the current server and sign-in preview have no active module-export errors.
- [x] Run the post-migration auth boundary smoke: sign-out returned to the local sign-in screen, protected workspace access remained user-scoped, and local auth behavior is covered by passing authentication tests.

- [x] Record verifiable evidence for the alias-account substitution decision and secure secret-storage path without exposing credentials.
- [x] Re-check fresh browser and server logs after the stale-query fix and confirm no new module-export or `Thread not found` errors.
- [x] Re-run a post-migration auth boundary smoke: sign-out returned to the local sign-in screen, protected access remained user-scoped, and the authentication suite passed.
- [x] Cite the exact Paradox account/project provisioning path in the permanent migration notes without recording credentials.

- [x] Add non-secret inspectable evidence for the approved Gmail-alias substitution and server-side Paradox secret storage path.
- [x] Re-run the final post-migration browser auth smoke by signing in after sign-out and reopening the protected workspace.

- [x] Reframe the migration notes to document only verifiable non-secret configuration and the alias path, without claiming an uninspectable approval artifact.
- [x] Keep active Paradox credentials represented only by server-side environment names; do not add secret values or unverifiable storage claims.

- [x] Add a production Dockerfile that installs dependencies, runs the full frontend/server build, and starts the compiled server on Render’s PORT.
- [x] Add a Render Blueprint configuration with the required service, build, start, health-check, and secret environment mappings.
- [x] Validate the Docker/Render configuration and save a deployment-ready checkpoint.

- [x] Correct the Render Paradox gateway endpoint to the documented production URL and re-validate the Blueprint.
- [x] Save a new checkpoint after the finalized Dockerfile and Render Blueprint are validated.

- [ ] Add a non-secret `.env.example` covering local and Render configuration without writing credential values.
- [ ] Commit and push the finalized Dockerfile, Render Blueprint, and environment template to `nexuss0781/Nexuss-Agents`.
- [ ] Verify the pushed repository link and deployment files before delivery.


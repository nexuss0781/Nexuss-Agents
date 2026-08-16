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


# Nexuss-Git Phase 10: Repository Search and Code Analysis

## Delivered behavior

Nexuss-Git now includes a dedicated Search tab for the selected repository. Users can search symbols, text, or filenames through a server-owned GitHub code-search request. Results are bounded to fifty normalized matches and display the repository path and filename. Selecting a result opens the Files tab and requests the matching file through the existing file-content path.

The file preview now includes a deterministic first-pass analysis action. Analysis runs only against the already loaded text and reports line count, non-empty code lines, import count, a lightweight structure count, TODO/FIXME/HACK markers, detected language, and a low/review signal. It never executes repository code and does not claim to replace a full static-analysis engine.

## Server contract

The central Nexuss Auth service now exposes `GET /v1/github/search?owner=&repo=&q=`. The request is project-scoped through the existing GitHub grant, uses the server-held GitHub access token, constrains the query to the selected repository, and returns normalized metadata rather than raw provider responses. Nexuss-Agent exposes this as `workspace.github.search`.

| Surface | Current behavior | Safety boundary |
|---|---|---|
| Search input | Explicit submit with 200-character maximum | No request is sent for an empty query |
| Search endpoint | GitHub code search scoped to `owner/repo` | Central-auth grant and server-held token required |
| Result set | Maximum fifty normalized matches | No raw token, content, or executable artifact returned |
| Result navigation | Opens the matching path in the file viewer | Content remains bounded by the Phase 9 file limit |
| Code analysis | Counts structure and flags obvious review markers | Text-only; no repository execution |

## Deployment dependency

The central-auth search endpoint was added to `nexuss0781/nexuss-auth` and must be redeployed before live search requests can succeed. Nexuss-Agent’s typed wrapper, tRPC procedure, Search tab, result navigation, and analysis panel are included in the current Phase 10 commit.

## Verification

Nexuss-Agent TypeScript validation passed, the targeted GitHub authorization tests passed with four tests, and the production build passed. Nexuss Auth typecheck passed and its complete server suite passed with thirteen tests.

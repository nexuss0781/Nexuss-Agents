# Nexuss-Git Phase 9: File Tree and Repository File Viewer

## Delivered behavior

Nexuss-Git now loads the selected repository’s default branch tree through a server-owned GitHub API path. The file browser converts GitHub’s flat recursive tree into a sorted hierarchy, places folders before files, and supports expandable folders, file selection, path filtering, and compact size labels.

Selecting a file requests its content through a separate server-owned endpoint. The preview is rendered as text in a scrollable code surface. The UI keeps repository, branch, tree loading, file loading, retry, no-match, and preview-error states separate so an unavailable file does not collapse the entire repository workspace.

## Safety boundaries

The central Nexuss Auth service performs the authenticated GitHub request with the stored connection token. Nexuss-Agent receives only normalized tree metadata or bounded file content. Repository paths reject empty segments, absolute paths, and `.` or `..` traversal segments. Tree responses are capped at 5,000 paths, and file previews are capped at 512,000 bytes. A truncated tree is clearly disclosed in the UI.

| Surface | Contract | Safety behavior |
|---|---|---|
| Tree | `GET /v1/github/tree?owner=&repo=&ref=` | Project-scoped grant; normalized entries; maximum 5,000 paths |
| File | `GET /v1/github/file?owner=&repo=&path=&ref=` | Project-scoped grant; text decoding only; maximum 512 KB |
| Nexuss tRPC | `workspace.github.tree` and `workspace.github.file` | Requires the Nexuss session and forwards no token to the browser |
| Browser preview | Selected file content | Escaped inside `<pre>`; no HTML execution |

## Deployment dependency

The central-auth endpoint was added to `nexuss0781/nexuss-auth` and pushed to `main` as `e9baba2`. Nexuss-Agent wrappers and tRPC procedures are included in the current Phase 9 changes. The deployed Nexuss Auth service must be redeployed before the new tree and file queries can return live data.

## Verification

Nexuss-Agent TypeScript validation passed, the existing GitHub authorization suite passed with four tests, and the production build passed. The central Nexuss Auth server typecheck passed and its full server suite passed with thirteen tests.

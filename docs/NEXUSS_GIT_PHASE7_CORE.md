# Nexuss-Git Phase 7: Application Core

## Scope

Phase 7 adds the first real Axolotl Store application surface to Nexuss-Agent. Nexuss-Git is registered as a right-window extension with a compact GitHub icon, a 320px hard minimum width, and a 440px default width. It renders through the existing host-owned `RightWindowApi`, so the app can request workspace expansion without accessing host internals.

## User-facing surface

The app is organized as a focused repository workspace. Its header identifies Nexuss-Git, the repository picker exposes search and GitHub connection entry points, and the navigation separates Overview, Files, Changes, Branches, and Activity. The Overview surface presents repository status cards, quick workflow actions, and a visible safety note explaining that publishing remains reviewable and confirmation-gated.

When no repository is connected, every section has an intentional empty state rather than failing or displaying fabricated data. The app also includes a command-style request bar for the future GitHub operation layer; until a repository is connected it returns a local, non-destructive connection notice.

## Implementation boundary

The current phase is UI-first. Repository discovery, file retrieval, branch mutation, commits, pushes, pull requests, issues, safety gates, and the activity journal remain the next operation layers. No network or filesystem mutation is performed by the Phase 7 shell.

| Surface | Current behavior | Next integration point |
|---|---|---|
| Repository picker | Shows disconnected state and safe connection/search affordances | GitHub authorization and repository query |
| Overview | Shows status cards, workflow actions, and safety copy | Repository summary query |
| Files | Intentional empty state | Workspace file-tree API |
| Changes | Intentional empty state | Git diff/status API |
| Branches | Intentional empty state | Branch query and guarded branch mutations |
| Activity | Intentional empty state | Commit, PR, issue, and workflow journal |
| Command bar | Non-destructive local notice | Natural-language Git action dispatcher |

## Verification

The host passes the repository TypeScript check after registration and styling changes. The completed implementation is committed and pushed to `master` as `2c6bd5c` (`feat: add Nexuss-Git extension core UI`).

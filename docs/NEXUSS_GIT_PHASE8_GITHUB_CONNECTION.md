# Nexuss-Git Phase 8: GitHub Connection and Repository Data

## Delivered behavior

Nexuss-Git now consumes the existing server-owned GitHub procedures through the typed tRPC client. On opening the app, it checks the user’s persisted GitHub grant through `workspace.github.status`. If the grant is connected, it loads the available repositories through `workspace.github.repositories` and keeps the GitHub access token on the server side.

The Connect GitHub action starts the existing `/auth/github/connect` handoff. That route delegates authorization to Nexuss Auth using the configured central-auth project, redirect URI, and GitHub authorization purpose. Nexuss-Git never receives or stores the GitHub access token in browser state.

## Repository experience

The repository picker now supports loading, filtering, retry, and empty states. Each returned repository displays its full name, visibility, default branch, and optional description context. Selecting a repository updates the overview surface with the repository identity, public/private status, default branch, GitHub link, and loaded-data status. Refresh revalidates both connection status and repository data.

| State | User-visible behavior |
|---|---|
| Checking | Shows a connection check and avoids presenting a false disconnected state |
| Not configured or disconnected | Shows Connect GitHub and does not request the repository list |
| Connected and loading | Shows a repository loading state in the picker |
| Connected with data | Shows searchable repository options and count |
| Query failure | Shows a non-destructive error with Retry |
| No search match | Shows an explicit no-match state |
| Repository selected | Shows repository summary and enables the next workspace layers |

## Existing server contract reused

The server already owns the central-auth handoff and GitHub grant exchange in `server/nexussAuth.ts` and `server/githubAuth.ts`. The tRPC namespace in `server/routers.ts` exposes `workspace.github.status`, `workspace.github.repositories`, and `workspace.github.clone`. Phase 8 wires the first two into Nexuss-Git; the clone procedure remains available for the later project-import and workspace operation phase.

## Verification

The targeted GitHub authorization suite passes with four tests. The TypeScript check passes. The production build passes with only the project’s existing analytics placeholder and large-chunk warnings. A broader legacy suite still contains unrelated brittle Home persistence expectations; Phase 8 does not introduce a new server failure in the targeted auth tests.

# Nexuss-Git Phase 11: Pull-Request Review and Commenting

## Delivered behavior

The Nexuss-Git Changes tab is now a pull-request review workspace. For a selected repository it loads open pull requests, shows author and branch context, and opens a focused review view for the selected pull request. The review view loads changed files and displays bounded unified patches in expandable file cards with additions and deletions.

Review comments are drafted locally inside the app. Clicking **Review comment** does not post immediately. Nexuss-Git first shows a confirmation surface explaining that the comment will become visible on the selected pull request as the connected GitHub account. Only the explicit **Confirm & post** action sends the mutation.

## Server contract

The central Nexuss Auth service now exposes the following project-scoped routes:

| Route | Purpose | Limit |
|---|---|---|
| `GET /v1/github/pulls` | List open or closed pull requests | Maximum 50 pull requests |
| `GET /v1/github/pull-files` | Load changed files for one pull request | Maximum 100 files; each patch capped at 100 KB |
| `POST /v1/github/comment` | Create a pull-request issue comment | Comment body required; maximum 10,000 characters |

Nexuss-Agent exposes these through `workspace.github.pulls`, `workspace.github.pullFiles`, and `workspace.github.comment`. The comment procedure requires `confirmed: true` in its validated input, and the UI only supplies that value after the user opens and accepts the confirmation surface.

## Safety boundaries

All GitHub access continues to use the server-held authorization grant. The browser receives normalized pull-request metadata, bounded diff text, and the returned comment result; it never receives the GitHub access token. Publishing is isolated from read operations as a POST mutation and is never triggered by selecting a pull request or loading a diff.

Patch data is rendered as text in a `<pre>` element. Repository code is not executed. Failed loading and failed posting remain visible as recoverable UI states, and the draft is retained unless the post succeeds.

## Deployment dependency

The central-auth changes were added to `nexuss0781/nexuss-auth` and must be redeployed before production pull-request review or comment operations can use the new routes.

## Verification

Nexuss-Agent TypeScript validation passed, the focused GitHub tests passed with four tests, and the production build passed. Nexuss Auth typecheck passed and its complete server suite passed with thirteen tests.

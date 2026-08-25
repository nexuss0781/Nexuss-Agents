# Nexuss-Git Phase 13: Repository Analytics and Developer Activity

## Delivered behavior

Nexuss-Git now includes a dedicated Analytics tab for a selected repository. It presents a compact dashboard covering recent commits, pull-request activity, workflow health, contributor participation, repository stars and forks, open issues, and primary language.

The dashboard intentionally labels the data as a bounded activity sample. It helps a developer orient themselves inside a repository; it is not a billing report, an audit ledger, or a replacement for GitHub’s complete historical analytics.

## Server aggregation

The central Nexuss Auth service exposes the project-scoped route `GET /v1/github/analytics`. It makes bounded GitHub API requests for repository metadata, recent commits, all-state pull requests, contributors, and recent Actions runs, then returns a normalized aggregate without exposing the GitHub grant.

| Dataset | Bound | Dashboard use |
|---|---:|---|
| Commits | 30 | Recent commit stream and activity volume |
| Pull requests | 30 | Open, merged, and draft activity |
| Contributors | 20 | Ranked contribution participation |
| Workflow runs | 30 | Completed success rate and run health |

Workflow success rate is calculated from completed runs in the returned sample. If no completed run exists, the dashboard shows an unavailable value rather than manufacturing a percentage.

## Client contract

Nexuss-Agent exposes the aggregation through `workspace.github.analytics`. The `NexussGitAnalyticsPanel` component loads it only after a repository is selected and displays retry and empty states for recoverable failures.

The metrics are derived server-side from the authenticated GitHub account’s project-scoped access. The browser receives normalized metadata, not access tokens. Dates are formatted for the user’s locale, while commit messages are reduced to their first bounded line.

## Safety and interpretation

The analytics route is read-only. It does not mutate repositories, execute repository code, or infer private facts beyond the returned GitHub API fields. Results can be affected by GitHub pagination, rate limits, repository visibility, and the bounded sample sizes above.

## Verification

Nexuss-Agent TypeScript validation passed, focused GitHub tests passed with four tests, and the production build passed. Nexuss Auth typecheck passed and its full server suite passed with thirteen tests.

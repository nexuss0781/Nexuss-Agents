# GitHub Actions API Notes

The External Terminal lane uses the official GitHub REST API capabilities documented at [REST API endpoints for workflows](https://docs.github.com/rest/actions/workflows), [REST API endpoints for workflow runs](https://docs.github.com/rest/actions/workflow-runs), and [REST API endpoints for workflow artifacts](https://docs.github.com/rest/actions/artifacts).

The workflow dispatch endpoint is `POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches`. It requires a workflow configured for `workflow_dispatch`, a `ref`, and optional inputs. GitHub documents a maximum of 25 input properties and returns a workflow run ID and URLs when available.

Run monitoring uses `GET /repos/{owner}/{repo}/actions/runs/{run_id}` and job details use `GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs`. Cancellation uses `POST /repos/{owner}/{repo}/actions/runs/{run_id}/cancel`. Artifacts use `GET /repos/{owner}/{repo}/actions/runs/{run_id}/artifacts`. GitHub documents OAuth or personal-token permission requirements for private repositories; Nexuss routes these calls through the central Nexuss Auth GitHub grant rather than exposing a GitHub token to Nexuss-Agent or the browser.

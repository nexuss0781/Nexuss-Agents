# Nexuss-Agent environment configuration

Do not commit a real `.env` file. Configure these values locally in an ignored `.env` file or privately in Render’s Environment settings.

| Variable | Required | Purpose | Example or source |
|---|---:|---|---|
| `NODE_ENV` | Yes | Runtime mode | `production` on Render |
| `JWT_SECRET` | Yes | Signs local authentication sessions | Generate a long random value; Render Blueprint generates one |
| `PARADOX_API_KEY` | Yes | Server-side Paradox cloud API key | Copy from the Paradox account |
| `PARADOX_PASSPHRASE` | Yes | Encrypts the Paradox database | Copy the original passphrase securely |
| `PARADOX_GATEWAY_URL` | Yes | Paradox gateway | `https://paradox-db.onrender.com/v1` |
| `PARADOX_PROJECT_NAME` | Yes | Paradox project | `nexuss-agent` |
| `PARADOX_DATABASE_NAME` | Yes | Paradox database | `nexuss-agent` |
| `PARADOX_DB_PATH` | No | Local encrypted snapshot path | `/tmp/nexuss-agent.paradox.db` |
| `BUILT_IN_FORGE_API_URL` | Yes | Server AI gateway URL | Use the configured AI gateway URL |
| `BUILT_IN_FORGE_API_KEY` | Yes | Server AI gateway key | Use the configured AI gateway key |
| `VITE_APP_ID` | No | Frontend compatibility identifier | `nexuss-agent` |
| `VITE_APP_TITLE` | No | Browser/app title | `Nexuss-Agent` |
| `VITE_FRONTEND_FORGE_API_URL` | No | Frontend compatibility gateway URL | Use the configured frontend URL if required |
| `VITE_FRONTEND_FORGE_API_KEY` | No | Frontend compatibility key | Use the configured frontend key if required |
| `VITE_ANALYTICS_ENDPOINT` | No | Optional analytics endpoint | Leave blank to disable |
| `VITE_ANALYTICS_WEBSITE_ID` | No | Optional analytics site ID | Leave blank to disable |
| `NEXUSS_AUTH_URL` | Prepared | Nexuss Auth service URL | `https://nexuss-auth.vercel.app` |
| `NEXUSS_AUTH_PROJECT_ID` | Prepared | Registered Nexuss Auth project | `nexuss-agent` |
| `NEXUSS_AUTH_REDIRECT_URI` | Prepared | Exact registered callback | `https://nexuss-agents.onrender.com/auth/callback` |

The Render Blueprint marks secret values as `sync: false`, while `JWT_SECRET` is generated automatically. Never paste the Paradox passphrase or API key into `render.yaml`, Dockerfile, source code, or a public GitHub file.

Nexuss Auth is registered and its public configuration is included in `render.yaml`. The current Render and Nexuss Auth domains are cross-site, so the application intentionally keeps its existing secure local session until both services can be placed under a shared custom parent domain. See `NEXUSS_AUTH_AUDIT.md` for the verified session-handoff constraint.

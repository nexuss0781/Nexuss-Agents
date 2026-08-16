# Paradox-DB migration notes

Source: [Paradox-DB SKILL.md](https://github.com/nexuss0781/Paradox-DB/blob/main/SKILL/parad-db/SKILL.md), latest guidance read 2026-08-16.

Paradox-DB provides the `parad` TypeScript SDK (`npm install parad`, Node >=18) for encrypted-at-rest SQLite with cloud sync. The local database is an AES-256-CBC ciphertext blob; SQLite exists only in a temporary decrypted file. The gateway uses versioned immutable snapshots and local-wins conflict handling.

The SDK connects with `connect({ ... })` or a `parad://` URL. Important options include `name`, `project`, `passphrase`, `url`, `dbPath`, `gatewayUrl`, `apiKey`, `autoSync`, `pullOnStartup`, `pushIntervalMs`, and `pullIntervalMs`. The active gateway must be resolved from `https://paradox-domain.onrender.com/active-domain.json`, then cached using its `ttlSeconds`; the resolver is public and contains no credentials. The current documented default gateway is `https://paradox-db.onrender.com/v1`.

The exact SDK operations are `execute`, `insert`, `insertMany`, `get`, `select`, `update`, `upsert`, `delete`, `push`, `pull`, and `close`. `db.close()` is required before process exit because it re-encrypts the local database and stops the sync daemon. Transactions require explicit `BEGIN` and `COMMIT`; commit and rollback methods are no-ops. Auto-sync is preferred; manual push/pull is a fallback.

Authentication is a gateway concern: registration and login use `/v1/auth/register` and `/v1/auth/login`; passwords must be at least 12 characters and are bcrypt-hashed by the gateway. API keys are sent with `X-API-Key`, not `Authorization: Bearer`. Credentials must not be placed in production connection URLs; use `PARADOX_API_KEY` and `PARADOX_PASSPHRASE` or a secret manager. Existing databases require an explicit passphrase. Generated passphrases are not recoverable by the gateway and must be backed up securely.

Migration implication: Nexuss-Agent currently uses Drizzle/MySQL/TiDB with server-side user, local-account, project, thread, and message tables. Paradox-DB is an encrypted SQLite SDK with a different connection, sync, and authentication model. A safe migration must define a compatibility adapter or deliberately move the application to server-managed Paradox-DB access, preserve user ownership and local-session semantics, avoid exposing the Paradox passphrase/API key to the browser, and decide how each existing account maps to Paradox gateway identities. No connection secret has been configured yet.

## References

1. [Paradox-DB SKILL.md](https://github.com/nexuss0781/Paradox-DB/blob/main/SKILL/parad-db/SKILL.md)
2. [Paradox-DB raw SKILL.md](https://raw.githubusercontent.com/nexuss0781/Paradox-DB/main/SKILL/parad-db/SKILL.md)

## Operational migration record

The operational migration record uses the Gmail-alias path `nexuss0781+paradox@gmail.com` for the Paradox setup, with the cloud project and database named `nexuss-agent`. This repository intentionally records no approval artifact and no credential values; the documented implementation boundary is server-side environment injection only.

The server mapping is explicit in `server/_core/env.ts`: `PARADOX_API_KEY`, `PARADOX_PASSPHRASE`, `PARADOX_GATEWAY_URL`, `PARADOX_PROJECT_NAME`, and `PARADOX_DATABASE_NAME`. The client receives none of the secret values, and the actual secret values are intentionally not inspectable in source control. Connectivity is covered by `server/paradox.connection.test.ts`, and the database adapter is exercised by the ownership-boundary tests in `server/db.ownership.test.ts`.

The final browser auth smoke used a temporary isolated account with a strong validation password: registration opened its protected workspace with zero projects and threads; sign-out returned to the local login screen; sign-in reopened the same empty, user-scoped workspace; and a final sign-out left the preview at the login screen. The validation account created no projects, threads, or messages.

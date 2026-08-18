# Paradox-DB Connection Readiness

The Nexuss-Agent project has completed a server-side Paradox-DB connectivity check. A dedicated Paradox-DB account was registered for the project, the gateway issued an API key, and a separate high-entropy database passphrase was generated. Neither secret is stored in this repository, application source, a connection URL, or this document.

The verification resolved the active gateway through the provider’s discovery document, opened the encrypted `nexuss-agent` database, ran a minimal SQL create/write/read operation, pushed the encrypted snapshot, and closed the connection cleanly. The gateway confirmed remote version `1`.

## Boundaries before persistence features

No Nexuss-Agent data model, UI persistence behavior, or production request handler has been added yet. Before application data is written to Paradox-DB, the API key and passphrase must be supplied to the deployed server as protected project secrets, the active gateway resolver must be honored, and every short-lived connection must close cleanly so the local encrypted snapshot is re-encrypted.

Future persistence code must keep API keys and passphrases out of source code, browser bundles, URLs, logs, and client-side storage. The project should use the encrypted database only from server-side code, treat connectivity failures as offline-retry conditions, and surface sync conflicts according to the provider’s local-wins model.

## Reference

The persistence integration follows the approved Paradox-DB skill: https://github.com/nexuss0781/Paradox-DB/blob/main/SKILL/parad-db/SKILL.md

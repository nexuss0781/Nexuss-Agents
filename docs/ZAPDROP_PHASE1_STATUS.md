# Zapdrop Phase 1 Status

**Status:** Complete  
**Scope:** Desktop scaffold and repository isolation  
**Date:** 2026-08-27

## Delivered

Zapdrop now has an isolated Tauri 2 desktop application under `apps/zapdrop-desktop`. The package contains a React/TypeScript frontend, Rust/Tauri backend, minimal capability policy, Tauri window configuration, generated icon assets, local development scripts, and a README.

The frontend includes the first dashboard experience: local-network status, nearby-device cards, file selection preview, multi-recipient selection preview, quick-share panel, and a native-bridge status indicator. The Scan and Share controls have scaffold interactions that clearly identify future phases rather than pretending that discovery or transfer is already implemented.

The Rust backend exposes a typed `get_app_info` Tauri command. It returns the application name, package version, current implementation phase, native platform, and local-only flag. In a browser Vite preview, the UI uses a safe fallback; in Tauri, it invokes the native command.

## Verification evidence

| Check | Result |
|---|---|
| Zapdrop frontend type check and production build | Passed with `pnpm --dir apps/zapdrop-desktop build` |
| Rust backend compile check | Passed with `cargo check --manifest-path apps/zapdrop-desktop/src-tauri/Cargo.toml` |
| Tauri native build without installer bundle | Passed with `pnpm --dir apps/zapdrop-desktop tauri build --no-bundle` |
| Existing repository TypeScript check | Passed with `pnpm check` |
| Browser preview render | Passed at `http://127.0.0.1:1420/` |
| Scan interaction preview | Passed; UI transitions to `Scanning...` and reports Phase 3 placeholder behavior |
| Existing repository Vitest suite | Did not complete in the sandbox; it remained active after emitting existing test output and was stopped. No Zapdrop test failure was reported. |

## Repository changes

The root repository now has a workspace configuration and convenience scripts:

```text
pnpm zapdrop:install
pnpm zapdrop:dev
pnpm zapdrop:build
pnpm zapdrop:check
```

Rust `target` directories are ignored. Generated dependency directories and frontend build output remain ignored. The existing web application source and runtime boundary were not changed.

## Next phase

Phase 2 should add persistent settings and device identity: a random stable device ID, key-pair lifecycle, protected private-key storage, identity reset, settings persistence, and coordinator startup/shutdown behavior. Network discovery should remain deferred until the identity contract is stable.

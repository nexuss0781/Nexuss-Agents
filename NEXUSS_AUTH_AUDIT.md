# Nexuss Auth integration audit

## Registered project

The Nexuss Auth CLI validated the supplied project-scoped token and registered the active `nexuss-agent` project with GitHub as the enabled provider. Its configured production origin is `https://nexuss-agents.onrender.com`, and its exact callback is `https://nexuss-agents.onrender.com/auth/callback`.

## Security finding

The currently registered application origin and the managed Nexuss Auth service are cross-site: the application is hosted on `onrender.com`, while the service is hosted on `vercel.app`. Nexuss Auth creates an HTTP-only session cookie with `SameSite=Lax`. A browser at the Render origin cannot include that cookie in a cross-site `fetch` request to the Vercel origin. The SDK’s `getUser()` flow therefore cannot securely recover a browser session at the current production domains.

The application must not accept a user object posted from the browser as authentication proof, because that would allow a caller to impersonate any identity. The existing local application session is retained until a secure session handoff is available.

> **Activation status:** Nexuss Auth is registered, SDK/CLI-tested, and configured in Render, but it is **not activated as the application’s runtime session provider**. Local email/password authentication remains the active production path until the same-site domain requirement below is met.

## Required deployment topology

To complete the migration securely, host both the app and Nexuss Auth on subdomains of one registrable custom domain, such as `app.example.com` and `auth.example.com`, then register the exact production callback `https://app.example.com/auth/callback`. The browser can then send the Auth service’s `SameSite=Lax` session cookie on same-site requests, and the SDK’s supported `getUser()` / `logout()` flow can be used without exposing a session token.

## Verified signals

The Nexuss Auth token validation test passed using the official CLI. The Nexuss Auth configuration test passed against the service health endpoint and registered production settings. Both tests automatically skip when their private environment configuration is absent, so ordinary source-only test runs do not require credentials.

On 2026-08-17, the configured Render hostname `https://nexuss-agents.onrender.com` resolved in the browser but displayed no rendered application content during the audit. The hostname remains the exact registered Nexuss Auth origin and callback host; deployment runtime troubleshooting is separate from the verified authentication-domain compatibility finding.

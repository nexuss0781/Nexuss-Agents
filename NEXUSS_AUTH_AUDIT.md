# Nexuss Auth integration audit

## Registered project

The Nexuss Auth CLI validated the supplied project-scoped token and registered the active `nexuss-agent` project with GitHub and Google as enabled providers. Its configured production origin is `https://nexuss-agents.onrender.com`, and its exact callback is `https://nexuss-agents.onrender.com/auth/callback`.

## Security finding

The currently registered application origin and the managed Nexuss Auth service are cross-site: the application is hosted on `onrender.com`, while the service is hosted on `vercel.app`. Nexuss Auth creates an HTTP-only session cookie with `SameSite=Lax`. A browser at the Render origin cannot include that cookie in a cross-site `fetch` request to the Vercel origin. The SDK’s `getUser()` flow therefore cannot securely recover a browser session at the current production domains.

The application must not accept a user object posted from the browser as authentication proof, because that would allow a caller to impersonate any identity. The existing local application session is retained until a secure session handoff is available.

> **Activation status:** Nexuss Auth is configured as the only sign-in entry point in the application UI, but it is **not yet activated as the application’s runtime session provider**. The current project configuration and cross-site deployment topology must be repaired before Google sign-in can establish a secure workspace session.

The public sign-in interface presents only **Continue with Google**. It uses the official SDK URL builder with the configured project ID and exact production callback. The application no longer presents, invokes, or documents an email/password sign-in option.

Until the Nexuss project is confirmed and the application and auth service are placed under a same-site custom-domain topology, a completed Google redirect must not be treated as proof of a local workspace session. The application must continue to establish authenticated state only through a verified server-side session.

## Required deployment topology

To complete the migration securely, host both the app and Nexuss Auth on subdomains of one registrable custom domain, such as `app.example.com` and `auth.example.com`, then register the exact production callback `https://app.example.com/auth/callback`. The browser can then send the Auth service’s `SameSite=Lax` session cookie on same-site requests, and the SDK’s supported `getUser()` / `logout()` flow can be used without exposing a session token.

## Verified signals

The Nexuss Auth token validation test passed using the official CLI. The Nexuss Auth configuration test passed against the service health endpoint and registered production settings. Both tests automatically skip when their private environment configuration is absent, so ordinary source-only test runs do not require credentials.

On 2026-08-17, the configured Render hostname `https://nexuss-agents.onrender.com` initially resolved in the browser without rendered application content. After the current GitHub deployment updated, the live site rendered the Nexuss-Agent sign-in screen successfully. The hostname remains the exact registered Nexuss Auth origin and callback host; deployment runtime troubleshooting is separate from the verified authentication-domain compatibility finding.

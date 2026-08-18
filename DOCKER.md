# Serving Nexuss-Agent with Docker

The root `Dockerfile` builds and runs the complete Node application. This matters because Nexuss-Agent now handles sign-in callbacks on the server before serving the protected workspace.

## Build the image

```bash
docker build -t nexuss-agent .
```

## Run locally

Provide the authentication routing values and a session-signing secret at runtime:

```bash
docker run --rm --name nexuss-agent -p 8080:3000 \
  -e PORT=3000 \
  -e JWT_SECRET="replace-with-a-long-random-secret" \
  -e NEXUSS_AUTH_URL="https://nexuss-auth.vercel.app" \
  -e NEXUSS_AUTH_PROJECT_ID="nexuss-agent-v2" \
  -e NEXUSS_AUTH_REDIRECT_URI="http://localhost:8080/auth/callback" \
  nexuss-agent
```

For production, register the exact production callback URL in Nexuss Auth and inject the same public routing values through the host's environment-variable configuration. Do not put provider secrets, project tokens, handoff tokens, or OAuth codes in the image, repository, or browser bundle.

# Serving Nexuss-Agent with Docker

The repository includes a production multi-stage `Dockerfile` and root-level `nginx.conf` for the frontend. The builder stage installs the locked pnpm dependencies and runs the Vite frontend build. The runtime stage serves the generated static files with Nginx.

## Build the image

```bash
docker build -t nexuss-agent-frontend .
```

## Run locally

```bash
docker run --rm --name nexuss-agent -p 8080:80 nexuss-agent-frontend
```

Open [http://localhost:8080](http://localhost:8080). Change the host-side port if `8080` is already in use; the container continues to listen on port `80`.

## SPA routing

Nginx is configured with a fallback to `/index.html`, so client-side navigation continues to work when a route is loaded directly or refreshed.

## Production notes

Hashed JavaScript, CSS, font, and image assets receive long-lived immutable cache headers. The HTML shell is explicitly not cached so a new deployment is discovered promptly. The image also includes a lightweight HTTP health check against the Nginx root.

The current sandbox does not include the Docker CLI, so the frontend type-check and Vite production build were validated locally; run the two Docker commands above in a Docker-enabled environment to build and start the image.

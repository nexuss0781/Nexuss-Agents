import { createAuth } from "nexuss-auth";

const fallbackConfig = {
  authUrl: "https://nexuss-auth.vercel.app",
  projectId: "nexuss-agent",
  redirectUri: "https://nexuss-agents.onrender.com/auth/callback",
} as const;

export const NEXUSS_AUTH_PUBLIC_CONFIG = {
  authUrl: import.meta.env.VITE_NEXUSS_AUTH_URL || fallbackConfig.authUrl,
  projectId: import.meta.env.VITE_NEXUSS_AUTH_PROJECT_ID || fallbackConfig.projectId,
  redirectUri: import.meta.env.VITE_NEXUSS_AUTH_REDIRECT_URI || fallbackConfig.redirectUri,
} as const;

export const nexussAuth = createAuth({
  authUrl: NEXUSS_AUTH_PUBLIC_CONFIG.authUrl,
  projectId: NEXUSS_AUTH_PUBLIC_CONFIG.projectId,
});

export function getGoogleSignInUrl() {
  return nexussAuth.getLoginUrl("google", {
    redirectUri: NEXUSS_AUTH_PUBLIC_CONFIG.redirectUri,
  });
}

export function getGitHubSignInUrl() {
  return nexussAuth.getLoginUrl("github", {
    redirectUri: NEXUSS_AUTH_PUBLIC_CONFIG.redirectUri,
  });
}

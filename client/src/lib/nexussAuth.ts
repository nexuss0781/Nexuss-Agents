import { createAuth } from "nexuss-auth";

declare global {
  interface Window {
    __NEXUSS_AUTH_CONFIG__?: {
      authUrl?: string;
      projectId?: string;
      redirectUri?: string;
    };
  }
}

const fallbackConfig = {
  authUrl: "https://nexuss-auth.vercel.app",
  projectId: "nexuss-agent-v2",
  redirectUri: "https://nexuss-agents.onrender.com/auth/callback",
} as const;

const runtimeConfig = typeof window !== "undefined" ? window.__NEXUSS_AUTH_CONFIG__ : undefined;

export const NEXUSS_AUTH_PUBLIC_CONFIG = {
  authUrl: runtimeConfig?.authUrl || import.meta.env.VITE_NEXUSS_AUTH_URL || fallbackConfig.authUrl,
  projectId: runtimeConfig?.projectId || import.meta.env.VITE_NEXUSS_AUTH_PROJECT_ID || fallbackConfig.projectId,
  redirectUri: runtimeConfig?.redirectUri || import.meta.env.VITE_NEXUSS_AUTH_REDIRECT_URI || fallbackConfig.redirectUri,
} as const;

export const nexussAuth = createAuth({
  authUrl: NEXUSS_AUTH_PUBLIC_CONFIG.authUrl,
  projectId: NEXUSS_AUTH_PUBLIC_CONFIG.projectId,
});

export function getGoogleSignInUrl() {
  const url = new URL(nexussAuth.getLoginUrl("google", {
    redirectUri: NEXUSS_AUTH_PUBLIC_CONFIG.redirectUri,
  }));
  url.searchParams.set("handoff", "1");
  return url.toString();
}

export function getGitHubSignInUrl() {
  return nexussAuth.getLoginUrl("github", {
    redirectUri: NEXUSS_AUTH_PUBLIC_CONFIG.redirectUri,
  });
}

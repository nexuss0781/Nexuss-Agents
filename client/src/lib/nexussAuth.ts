import { buildLoginUrl } from "nexuss-auth";

export const NEXUSS_AUTH_PUBLIC_CONFIG = {
  authUrl: "https://nexuss-auth.vercel.app",
  projectId: "nexuss-agent",
  redirectUri: "https://nexuss-agents.onrender.com/auth/callback",
} as const;

export function getGoogleSignInUrl() {
  return buildLoginUrl(
    { authUrl: NEXUSS_AUTH_PUBLIC_CONFIG.authUrl, projectId: NEXUSS_AUTH_PUBLIC_CONFIG.projectId },
    "google",
    NEXUSS_AUTH_PUBLIC_CONFIG.redirectUri,
  );
}

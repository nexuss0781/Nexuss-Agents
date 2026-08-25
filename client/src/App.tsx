import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { trpc } from "./lib/trpc";
import Home from "./pages/Home";
import Landing from "./pages/Landing";
import LoginPortal from "./pages/LoginPortal";

const AUTH_CACHE_KEY = "nexuss-agent-authenticated-user";

type CachedAuthUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

function cacheAuthUser(user: CachedAuthUser | null) {
  try {
    if (user) {
      window.localStorage.setItem(AUTH_CACHE_KEY, JSON.stringify({ ...user, cachedAt: Date.now() }));
    } else {
      window.localStorage.removeItem(AUTH_CACHE_KEY);
    }
  } catch {
    // Storage can be unavailable in private browsing; the server session remains authoritative.
  }
}

function clearAuthCache() {
  try {
    window.localStorage.removeItem(AUTH_CACHE_KEY);
  } catch {
    // Ignore unavailable storage.
  }
}

function AuthenticatedRouteGate({ pathname }: { pathname: string }) {
  const session = trpc.nexuss.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const logout = trpc.nexuss.logout.useMutation({
    onSuccess: () => {
      clearAuthCache();
      window.location.assign("/");
    },
  });
  const isWorkspace = pathname === "/app" || pathname.startsWith("/app/");
  const isLogin = pathname === "/login";
  const isLanding = pathname === "/";

  useEffect(() => {
    if (!session.isSuccess) return;
    if (session.data) {
      cacheAuthUser(session.data);
      if (!isWorkspace) window.location.replace("/app");
    } else {
      clearAuthCache();
      if (isWorkspace || (!isLanding && !isLogin)) window.location.replace("/");
    }
  }, [isLanding, isLogin, isWorkspace, session.data, session.isSuccess]);

  if (session.isLoading) {
    return <main className="auth-loading"><Loader2 size={22} aria-label="Checking sign-in" /></main>;
  }

  if (session.data) {
    if (!isWorkspace) {
      return <main className="auth-loading"><Loader2 size={22} aria-label="Opening workspace" /></main>;
    }
    return <Home
      profileName={session.data.name || session.data.email || "Nexuss user"}
      profileEmail={session.data.email || undefined}
      profileAvatarUrl={session.data.avatarUrl || undefined}
      onSignOut={() => { clearAuthCache(); logout.mutate(); }}
      signOutPending={logout.isPending}
    />;
  }

  if (isLogin) return <LoginPortal />;
  if (isLanding) return <Landing />;
  return <main className="auth-loading"><Loader2 size={22} aria-label="Returning to home" /></main>;
}

function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          <AuthenticatedRouteGate pathname={window.location.pathname} />
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

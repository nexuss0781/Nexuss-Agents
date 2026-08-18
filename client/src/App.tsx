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

// Design philosophy: Obsidian Console — Swiss precision for the workspace, editorial stealth for the public landing page.
function WorkspaceGate() {
  const session = trpc.nexuss.me.useQuery(undefined, { retry: false, staleTime: 60_000 });
  const logout = trpc.nexuss.logout.useMutation({ onSuccess: () => { window.location.assign("/"); } });

  useEffect(() => {
    if (session.isSuccess && !session.data) window.location.replace("/login");
  }, [session.data, session.isSuccess]);

  if (session.isLoading) return <main className="auth-loading"><Loader2 size={22} aria-label="Checking sign-in" /></main>;
  if (!session.data) return <main className="auth-loading"><Loader2 size={22} aria-label="Redirecting to sign in" /></main>;

  return <Home profileName={session.data.name || session.data.email || "Nexuss user"} onSignOut={() => logout.mutate()} signOutPending={logout.isPending} />;
}

function App() {
  const pathname = window.location.pathname;
  const isWorkspace = pathname === "/app" || pathname.startsWith("/app/");
  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          {pathname === "/login" ? <LoginPortal /> : isWorkspace ? <WorkspaceGate /> : <Landing />}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

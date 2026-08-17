import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";
import Landing from "./pages/Landing";

// Design philosophy: Obsidian Console — Swiss precision for the workspace, editorial stealth for the public landing page.
function App() {
  const isWorkspace = window.location.pathname === "/app" || window.location.pathname.startsWith("/app/");

  return (
    <ErrorBoundary>
      <ThemeProvider defaultTheme="dark">
        <TooltipProvider>
          <Toaster />
          {isWorkspace ? <Home /> : <Landing />}
        </TooltipProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}

export default App;

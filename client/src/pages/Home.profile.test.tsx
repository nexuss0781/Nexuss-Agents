import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { trpc } from "../lib/trpc";
import Home from "./Home";

describe("workspace account navigation", () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, "location", {
      configurable: true,
      value: { pathname: "/app", search: "", hash: "" },
    });
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: () => null,
        setItem: () => undefined,
      },
    });
  });

  it("renders the signed-in user's real account details in the workspace navigation", () => {
    const queryClient = new QueryClient();
    const client = trpc.createClient({ links: [] });
    const html = renderToStaticMarkup(
      <trpc.Provider client={client} queryClient={queryClient}>
        <QueryClientProvider client={queryClient}>
          <Home
            profileName="Tadi Ivhu"
            profileEmail="tadi@example.com"
            profileAvatarUrl="https://images.example.com/tadi.png"
            onSignOut={() => undefined}
          />
        </QueryClientProvider>
      </trpc.Provider>,
    );

    expect(html).toContain("Tadi Ivhu");
    expect(html).toContain("tadi@example.com");
    expect(html).toContain("https://images.example.com/tadi.png");
    expect(html).toContain('aria-label="Sign out"');
  });
});

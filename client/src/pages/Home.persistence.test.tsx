// @vitest-environment jsdom
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { TRPCLink } from "@trpc/client";
import { observable } from "@trpc/server/observable";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppRouter } from "../../../server/routers";
import { trpc } from "../lib/trpc";
import Home from "./Home";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type WorkspaceSnapshot = { projects: Array<{ id: string; name: string; description: string; tone: string }>; threads: Array<{ id: string; title: string; projectId?: string; updatedAt: string; messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }> }> };

const roots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mockLink(resolve: (path: string) => WorkspaceSnapshot | Error): TRPCLink<AppRouter> {
  return () => ({ op }) => observable((observer) => {
    queueMicrotask(() => {
      const value = resolve(op.path);
      if (value instanceof Error) observer.error(value as never);
      else { observer.next({ result: { data: value } } as never); observer.complete(); }
    });
    return () => undefined;
  });
}

async function mountWorkspace(resolve: (path: string) => WorkspaceSnapshot | Error) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = trpc.createClient({ links: [mockLink(resolve)] });
  const queryClient = new QueryClient();
  roots.push({ root, host });
  await act(async () => {
    root.render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><Home profileName="Persistence Test" /></QueryClientProvider></trpc.Provider>);
    await new Promise((resolveTick) => setTimeout(resolveTick, 0));
  });
  return host;
}

async function waitForText(host: HTMLElement, text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (host.textContent?.includes(text)) return;
    await act(async () => { await new Promise((resolveTick) => setTimeout(resolveTick, 10)); });
  }
  throw new Error(`Expected workspace to render: ${text}`);
}

afterEach(() => {
  for (const { root, host } of roots.splice(0)) { root.unmount(); host.remove(); }
  window.localStorage.clear();
});

describe("persistent workspace client", () => {
  it("skips stale browser history when durable remote data already exists", async () => {
    window.localStorage.setItem("nexuss-agent-workspace-v2", JSON.stringify({
      projects: [{ id: "local-project", name: "Stale local project", description: "", tone: "#fff" }],
      threads: [],
    }));
    const mutations = vi.fn();
    const remote: WorkspaceSnapshot = { projects: [{ id: "remote-project", name: "Remote project", description: "", tone: "#fff" }], threads: [{ id: "remote-thread", title: "Remote history", updatedAt: "2026-08-18T00:00:00.000Z", messages: [] }] };
    const host = await mountWorkspace((path) => {
      if (path === "workspace.load") return remote;
      mutations(path);
      return remote;
    });

    await waitForText(host, "Remote history");
    expect(mutations).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("nexuss-agent-workspace-v2")).toContain("Stale local project");
  });

  it("renders a recoverable error state when the durable workspace cannot load", async () => {
    const host = await mountWorkspace(() => new Error("Gateway unavailable"));
    await waitForText(host, "Workspace unavailable.");
    expect(host.textContent).toContain("Retry loading");
  });

  it("renders complete persisted history again after a fresh workspace mount", async () => {
    const durable: WorkspaceSnapshot = { projects: [{ id: "project", name: "Persisted project", description: "", tone: "#fff" }], threads: [{ id: "thread", title: "Persisted history", projectId: "project", updatedAt: "2026-08-18T00:00:00.000Z", messages: [{ id: "one", role: "user", content: "First saved message", createdAt: "2026-08-18T00:00:00.000Z" }, { id: "two", role: "assistant", content: "Second saved message", createdAt: "2026-08-18T00:00:01.000Z" }] }] };
    const first = await mountWorkspace((path) => path === "workspace.load" ? durable : durable);
    await waitForText(first, "Second saved message");
    const second = await mountWorkspace((path) => path === "workspace.load" ? durable : durable);
    await waitForText(second, "First saved message");
    expect(second.textContent).toContain("Second saved message");
  });
});

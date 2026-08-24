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
import Home, { consumePlaygroundStream } from "./Home";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type WorkspaceSnapshot = { projects: Array<{ id: string; name: string; description: string; tone: string }>; threads: Array<{ id: string; chatSlug?: string; title: string; projectId?: string; updatedAt: string; messages: Array<{ id: string; role: "user" | "assistant"; content: string; createdAt: string }> }> };

const roots: Array<{ root: Root; host: HTMLDivElement }> = [];

function mockLink(resolve: (path: string, input?: unknown) => unknown | Error): TRPCLink<AppRouter> {
  return () => ({ op }) => observable((observer) => {
    queueMicrotask(() => {
      Promise.resolve(resolve(op.path, op.input)).then((value) => {
        if (value instanceof Error) observer.error(value as never);
        else { observer.next({ result: { data: value } } as never); observer.complete(); }
      }).catch((error) => observer.error(error));
    });
    return () => undefined;
  });
}

async function mountWorkspace(resolve: (path: string, input?: unknown) => unknown | Error, props: Partial<React.ComponentProps<typeof Home>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = trpc.createClient({ links: [mockLink((path, input) => {
    const response = resolve(path, input);
    if (path === "workspace.modelSettings" && response && typeof response === "object" && "projects" in response) return null;
    return response;
  })] });
  const queryClient = new QueryClient();
  roots.push({ root, host });
  await act(async () => {
    root.render(<trpc.Provider client={client} queryClient={queryClient}><QueryClientProvider client={queryClient}><Home profileName="Persistence Test" {...props} /></QueryClientProvider></trpc.Provider>);
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

async function waitForSelector(host: HTMLElement, selector: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const element = host.querySelector(selector);
    if (element) return element;
    await act(async () => { await new Promise((resolveTick) => setTimeout(resolveTick, 10)); });
  }
  throw new Error(`Expected selector: ${selector}`);
}

async function waitForInputPlaceholder(host: HTMLElement, selector: string, text: string) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const input = host.querySelector<HTMLInputElement>(selector);
    if (input?.placeholder.includes(text)) return input;
    await act(async () => { await new Promise((resolveTick) => setTimeout(resolveTick, 10)); });
  }
  throw new Error(`Expected input ${selector} to include placeholder: ${text}`);
}

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) {
    await act(async () => { root.unmount(); });
    host.remove();
  }
  window.localStorage.clear();
  window.history.replaceState({}, "", "/app");
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
      if (path === "workspace.navigation") return remote;
      mutations(path);
      return remote;
    });

    await waitForText(host, "Remote history");
    expect(mutations).not.toHaveBeenCalledWith("workspace.migrate");
    expect(window.localStorage.getItem("nexuss-agent-workspace-v2")).toContain("Stale local project");
  });

  it("renders a recoverable error state when the durable workspace cannot load", async () => {
    const host = await mountWorkspace(() => new Error("Gateway unavailable"));
    await waitForText(host, "Workspace unavailable.");
    expect(host.textContent).toContain("Retry loading");
  });

  it("recovers after Retry and allows a project to be created from the restored workspace", async () => {
    let loadAttempts = 0;
    let createdProject = false;
    const calls = vi.fn();
    const restored: WorkspaceSnapshot = { projects: [], threads: [{ id: "restored-thread", title: "Recovered thread", updatedAt: "2026-08-18T00:00:00.000Z", messages: [] }] };
    const host = await mountWorkspace((path) => {
      calls(path);
      if (path === "workspace.navigation") {
        loadAttempts += 1;
        if (loadAttempts === 1) return new Error("Gateway unavailable");
        return createdProject ? { ...restored, projects: [{ id: "created-project", name: "Recovered project", description: "", tone: "#f4f4f0" }] } : restored;
      }
      if (path === "workspace.createProject") {
        createdProject = true;
        return { id: "created-project", name: "Recovered project", description: "", tone: "#f4f4f0" };
      }
      return restored;
    });

    await waitForText(host, "Workspace unavailable.");
    const retry = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Retry loading"));
    await act(async () => {
      retry?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    });
    await waitForText(host, "Recovered thread");

    const addProject = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Add project"));
    expect(addProject?.hasAttribute("disabled")).toBe(false);
    await act(async () => { addProject?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const nameInput = host.querySelector<HTMLInputElement>('input[name="name"]');
    const projectForm = host.querySelector("form");
    if (!nameInput || !projectForm) throw new Error("Project editor did not open after recovery");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(nameInput, "Recovered project");
      nameInput.dispatchEvent(new Event("input", { bubbles: true }));
      projectForm.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    });
    await waitForText(host, "Recovered project");
    expect(calls).toHaveBeenCalledWith("workspace.createProject");
  });

  it("settles after a successful legacy import without waiting for a background refresh", async () => {
    window.localStorage.setItem("nexuss-agent-workspace-v2", JSON.stringify({
      projects: [],
      threads: [{ id: "legacy-thread", title: "Legacy history", updatedAt: "2026-08-18T00:00:00.000Z", messages: [] }],
    }));
    const calls = vi.fn();
    const empty: WorkspaceSnapshot = { projects: [], threads: [] };
    const host = await mountWorkspace((path) => {
      calls(path);
      if (path === "workspace.migrate") return { imported: true };
      return empty;
    });

    await waitForText(host, "Start a thread.");
    expect(calls).toHaveBeenCalledWith("workspace.migrate");
  });

  it("shows the left project skeleton and hydrates saved projects before a first prompt", async () => {
    let resolveNavigation: ((value: WorkspaceSnapshot) => void) | undefined;
    const pendingNavigation = new Promise<WorkspaceSnapshot>((resolve) => { resolveNavigation = resolve; });
    const host = await mountWorkspace((path) => path === "workspace.navigation" ? pendingNavigation : { projects: [], threads: [] });
    expect(host.querySelector('[aria-label="Loading saved projects"]')).not.toBeNull();
    await act(async () => { resolveNavigation?.({ projects: [{ id: "hydrated-project", name: "Saved before prompting", description: "", tone: "#f4f4f0" }], threads: [] }); });
    await waitForText(host, "Saved before prompting");
  });

  it("replaces topbar sign-out with secure provider settings and saves multiple selected models", async () => {
    const onSignOut = vi.fn();
    const savedSettings = { baseUrl: "https://models.example.com/v1", selectedModels: ["model-alpha"], availableModels: ["model-alpha", "model-beta"], apiKeyConfigured: true };
    const calls = vi.fn();
    const host = await mountWorkspace((path, input) => {
      calls(path, input);
      if (path === "workspace.modelSettings") return savedSettings;
      if (path === "workspace.saveModelSettings") return { ...savedSettings, selectedModels: (input as { selectedModels: string[] }).selectedModels };
      if (path === "workspace.discoverModels") return { models: ["model-alpha", "model-beta"] };
      return { projects: [], threads: [] };
    }, { profileName: "Settings Tester", profileEmail: "settings@example.com", onSignOut });
    await waitForText(host, "Start a thread.");
    expect(host.querySelector('.topbar button[aria-label="Sign out"]')).toBeNull();
    const settingsButton = host.querySelector<HTMLButtonElement>('button[aria-label="Open settings"]');
    expect(settingsButton).not.toBeNull();
    await act(async () => { settingsButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    await waitForText(host, "Base model API");
    expect(host.textContent).toContain("settings@example.com");
    expect(host.textContent).not.toContain("Encrypted local saving");
    expect(host.querySelector(".settings-scroll-body")).not.toBeNull();
    const apiKey = await waitForInputPlaceholder(host, 'input[aria-label="Model provider API key"]', "Saved securely");
    expect(apiKey.placeholder).toContain("Saved securely");
    expect(host.textContent).toContain("API secret stored securely in your encrypted workspace");
    expect(host.textContent).toContain("model-alpha");
    expect(host.textContent).toContain("model-beta");
    const refreshModels = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Refresh models"));
    await act(async () => { refreshModels?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((resolveTick) => setTimeout(resolveTick, 0)); });
    await waitForText(host, "model-beta");
    expect(host.querySelector(".model-list")).not.toBeNull();
    const beta = Array.from(host.querySelectorAll<HTMLButtonElement>(".model-choice")).find((button) => button.textContent?.includes("model-beta"));
    await act(async () => { beta?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    const saveProvider = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("Save provider"));
    await act(async () => { saveProvider?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((resolveTick) => setTimeout(resolveTick, 0)); });
    expect(calls).toHaveBeenCalledWith("workspace.saveModelSettings", expect.objectContaining({ selectedModels: ["model-alpha", "model-beta"] }));
    const signOut = Array.from(host.querySelectorAll(".settings-signout")).find((button) => button.textContent?.includes("Sign out"));
    await act(async () => { signOut?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(onSignOut).toHaveBeenCalledTimes(1);
    await act(async () => { window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); });
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });

  it("places selected models at the composer left and anchors project assignment at the send edge", async () => {
    const workspace: WorkspaceSnapshot = { projects: [{ id: "pntp", name: "PNTP", description: "", tone: "#f4f4f0" }], threads: [] };
    const host = await mountWorkspace((path) => {
      if (path === "workspace.modelSettings") return { baseUrl: "https://models.example.com/v1", selectedModels: ["model-alpha", "model-beta"], apiKeyConfigured: true };
      return workspace;
    });

    await waitForText(host, "model-alpha");
    const modelPicker = host.querySelector<HTMLButtonElement>('button[aria-label="Select model"]');
    expect(modelPicker?.textContent).toContain("model-alpha");
    expect(modelPicker?.closest(".composer-top")).not.toBeNull();
    await act(async () => { modelPicker?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.querySelector(".model-menu")).not.toBeNull();

    const projectPicker = host.querySelector<HTMLButtonElement>('button[aria-label="Assign project"]');
    expect(projectPicker?.closest(".composer-top")).not.toBeNull();
    await act(async () => { projectPicker?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.querySelector(".project-menu")).not.toBeNull();
    expect(host.querySelector(".project-menu")?.parentElement?.classList.contains("composer-project-anchor")).toBe(true);
  });

  it("shows Complex as the active execution style and keeps General and Instant upcoming", async () => {
    const host = await mountWorkspace((path) => {
      if (path === "workspace.modelSettings") return { baseUrl: "https://models.example.com/v1", selectedModels: ["model-alpha"], apiKeyConfigured: true };
      return { projects: [], threads: [] };
    });

    await waitForText(host, "model-alpha");
    const executionPicker = host.querySelector<HTMLButtonElement>('button[aria-label="Choose execution style"]');
    expect(executionPicker?.textContent).toContain("Complex");
    await act(async () => { executionPicker?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
    expect(host.querySelector(".execution-menu")?.textContent).toContain("Complex");
    expect(host.querySelector(".execution-menu")?.textContent).toContain("General");
    expect(host.querySelector(".execution-menu")?.textContent).toContain("Instant");
    expect(host.querySelector<HTMLButtonElement>('.execution-option.upcoming:nth-of-type(2)')?.disabled).toBe(true);
    expect(host.querySelector<HTMLButtonElement>('.execution-option.upcoming:nth-of-type(3)')?.disabled).toBe(true);
  });

  it("accepts multiple attachments without an extension allowlist", async () => {
    const host = await mountWorkspace((path) => {
      if (path === "workspace.modelSettings") return { baseUrl: "https://models.example.com/v1", selectedModels: ["model-alpha"], apiKeyConfigured: true };
      return { projects: [], threads: [] };
    });

    await waitForText(host, "model-alpha");
    const fileInput = host.querySelector<HTMLInputElement>('input[type="file"]');
    expect(fileInput).not.toBeNull();
    expect(fileInput?.multiple).toBe(true);
    expect(fileInput?.getAttribute("accept")).toBeNull();
    expect(host.querySelector('button[aria-label="Add attachments"]')).not.toBeNull();
  });

  it("shows active work from the server with simple progress and controls", async () => {
    const mission = { id: "mission-active", ownerId: "owner-1", goal: "Prepare the project update", status: "executing", version: 2, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" };
    const host = await mountWorkspace((path) => {
      if (path === "workspace.modelSettings") return { baseUrl: "https://models.example.com/v1", selectedModels: ["model-alpha"], apiKeyConfigured: true };
      if (path === "workspace.mission.list") return [mission];
      if (path === "workspace.mission.get") return { mission, workItems: [{ id: "work-1", status: "completed" }], events: [{ id: "event-1" }] };
      return { projects: [], threads: [] };
    });

    await waitForText(host, "1 working");
    const activity = host.querySelector<HTMLButtonElement>('button[aria-label="Open your work"]');
    await act(async () => { activity?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((resolveTick) => setTimeout(resolveTick, 0)); });
    await waitForText(host, "Prepare the project update");
    await waitForText(host, "1 of 1 steps complete");
    expect(host.textContent).toContain("Working");
    expect(host.querySelector('button[aria-label="Close your work"]')).not.toBeNull();
  });

  it("uses server-driven controls to pause and continue active work", async () => {
    let status: "executing" | "paused" = "executing";
    const calls = vi.fn();
    const baseMission = { id: "mission-controls", ownerId: "owner-1", goal: "Review the release notes", status: "executing", version: 1, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" };
    const host = await mountWorkspace((path) => {
      calls(path);
      if (path === "workspace.modelSettings") return { baseUrl: "https://models.example.com/v1", selectedModels: ["model-alpha"], apiKeyConfigured: true };
      if (path === "workspace.mission.list") return [{ ...baseMission, status }];
      if (path === "workspace.mission.get") return { mission: { ...baseMission, status }, workItems: [{ id: "work-controls", status: status === "paused" ? "pending" : "executing" }], events: [{ id: "event-controls" }] };
      if (path === "workspace.mission.pause") { status = "paused"; return { ...baseMission, status }; }
      if (path === "workspace.mission.resume") { status = "executing"; return { ...baseMission, status }; }
      return { projects: [], threads: [] };
    });

    await waitForText(host, "1 working");
    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Open your work"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((resolveTick) => setTimeout(resolveTick, 0)); });
    await waitForSelector(host, 'button[aria-label="Pause work"]');
    expect(host.querySelector('button[aria-label="Stop work"]')).not.toBeNull();

    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Pause work"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((resolveTick) => setTimeout(resolveTick, 0)); });
    await waitForSelector(host, 'button[aria-label="Continue work"]');
    expect(calls).toHaveBeenCalledWith("workspace.mission.pause");

    await act(async () => { host.querySelector<HTMLButtonElement>('button[aria-label="Continue work"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true })); await new Promise((resolveTick) => setTimeout(resolveTick, 0)); });
    await waitForSelector(host, 'button[aria-label="Pause work"]');
    expect(calls).toHaveBeenCalledWith("workspace.mission.resume");
  });

  it("submits the normal Complex composer request to autonomous mission intake and starts it", async () => {
    const inputs = vi.fn();
    const project: WorkspaceSnapshot["projects"][number] = { id: "pntp", name: "PNTP", description: "", tone: "#f4f4f0" };
    const empty: WorkspaceSnapshot = { projects: [project], threads: [] };
    const host = await mountWorkspace((path, input) => {
      inputs(path, input);
      if (path === "workspace.modelSettings") return { baseUrl: "https://models.example.com/v1", selectedModels: ["model-live"], availableModels: ["model-live"], apiKeyConfigured: true };
      if (path === "workspace.mission.createFromIntake") return { intake: { id: "intake-created" }, mission: { mission: { id: "mission-created", status: "created" }, workItems: [], events: [] } };
      if (path === "workspace.mission.start") return { mission: { id: "mission-created", status: "queued" }, workItems: [], events: [] };
      if (path === "workspace.mission.list") return [{ id: "mission-created", ownerId: "owner-1", goal: "Build the release workflow", status: "executing", version: 1, createdAt: "2026-08-24T00:00:00.000Z", updatedAt: "2026-08-24T00:00:00.000Z" }];
      return empty;
    });

    await waitForText(host, "Start a thread.");
    await waitForText(host, "model-live");
    const composer = host.querySelector<HTMLTextAreaElement>("textarea");
    if (!composer) throw new Error("Composer was not rendered");
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
      setValue?.call(composer, "Build the release workflow");
      composer.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('button[aria-label="Start work"]')?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolveTick) => setTimeout(resolveTick, 0));
    });

    await waitForText(host, "Build the release workflow");
    expect(inputs).toHaveBeenCalledWith("workspace.mission.createFromIntake", { projectId: null, model: "model-live", sources: [{ kind: "raw_prompt", text: "Build the release workflow" }] });
    expect(inputs).toHaveBeenCalledWith("workspace.mission.start", { missionId: "mission-created" });
  });

  it("requests full message history only for the browser-selected chat slug", async () => {
    window.history.replaceState({}, "", "/app/chat/chat-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
    const calls = vi.fn();
    const active: WorkspaceSnapshot = { projects: [], threads: [{ id: "focused-thread", chatSlug: "chat-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", title: "Focused history", updatedAt: "2026-08-18T00:00:00.000Z", messages: [{ id: "focus-message", role: "user", content: "Only this history is loaded", createdAt: "2026-08-18T00:00:00.000Z" }] }, { id: "other-thread", chatSlug: "chat-cccccccccccccccccccccccccccccccc", title: "Other history", updatedAt: "2026-08-17T00:00:00.000Z", messages: [] }] };
    const host = await mountWorkspace((path, input) => { calls(path, input); return active; });
    await waitForText(host, "Only this history is loaded");
    expect(calls).toHaveBeenCalledWith("workspace.navigation", undefined);
    expect(calls).toHaveBeenCalledWith("workspace.chat", { chatSlug: "chat-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    expect(host.textContent).toContain("chat-bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb");
  });

  it("renders complete persisted history again after a fresh workspace mount", async () => {
    const durable: WorkspaceSnapshot = { projects: [{ id: "project", name: "Persisted project", description: "", tone: "#fff" }], threads: [{ id: "thread", title: "Persisted history", projectId: "project", updatedAt: "2026-08-18T00:00:00.000Z", messages: [{ id: "one", role: "user", content: "First saved message", createdAt: "2026-08-18T00:00:00.000Z" }, { id: "two", role: "assistant", content: "Second saved message", createdAt: "2026-08-18T00:00:01.000Z" }] }] };
    const first = await mountWorkspace((path) => path === "workspace.load" ? durable : durable);
    await waitForText(first, "Second saved message");
    const second = await mountWorkspace((path) => path === "workspace.load" ? durable : durable);
    await waitForText(second, "First saved message");
    expect(second.textContent).toContain("Second saved message");
  });

  it("decodes token-by-token SSE frames and preserves the terminal completion event", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode(`data: {"type":"start"}\n\n`));
        controller.enqueue(encoder.encode(`data: {"type":"token","text":"Hello "}\n\n`));
        controller.enqueue(encoder.encode(`data: {"type":"token","text":"world"}\n\n`));
        controller.enqueue(encoder.encode(`data: {"type":"done","content":"Hello world"}\n\n`));
        controller.close();
      },
    });
    const events: string[] = [];
    await consumePlaygroundStream(new Response(stream, { status: 200 }), new AbortController().signal, (event) => events.push(event.type === "token" ? event.text || "" : event.type));
    expect(events).toEqual(["start", "Hello ", "world", "done"]);
  });

  it("keeps rejected stream details in the console and exposes a concise error", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      await expect(consumePlaygroundStream(new Response(JSON.stringify({ error: "Provider overloaded: retry-after=2" }), { status: 429, statusText: "Too Many Requests", headers: { "Content-Type": "application/json" } }), new AbortController().signal, () => undefined)).rejects.toThrow("The model request could not be completed.");
      expect(consoleError).toHaveBeenCalledWith("[Playground] stream request rejected", expect.objectContaining({ status: 429, detail: "Provider overloaded: retry-after=2" }));
    } finally {
      consoleError.mockRestore();
    }
  });

});

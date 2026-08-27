// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { trpc } from "@/lib/trpc";
import { TerminalApp, mergeEvents } from "./TerminalApp";
import type { TerminalEvent } from "../../../server/terminal/contracts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type MockSession = { sessionId: string; requestId: string; projectId: string; state: string; command: string; workingDirectory: string; interactive: boolean; startedAt: string; updatedAt: string; summary: string; events?: TerminalEvent[] };

const project = { id: "project-1", name: "Nexuss workspace", description: "", workspaceStatus: "ready" as const, workspaceFileCount: 12 };
const baseSession: MockSession = { sessionId: "session-1", requestId: "request-1", projectId: "project-1", state: "completed", command: "printf 'done'", workingDirectory: ".", interactive: true, startedAt: "2026-08-27T10:00:00.000Z", updatedAt: "2026-08-27T10:00:01.000Z", summary: "Local terminal command completed.", events: [] };
const calls = { start: [] as unknown[], input: [] as unknown[], cancel: [] as unknown[] };
let selectedSession: MockSession | null = null;
let sessions: MockSession[] = [baseSession];
let lastSource: { onmessage?: (event: MessageEvent) => void; onerror?: () => void; close: ReturnType<typeof vi.fn> } | null = null;

vi.mock("@/lib/trpc", () => ({
  trpc: {
    useUtils: () => ({ workspace: { terminal: { local: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } }, external: { list: { invalidate: vi.fn() }, get: { invalidate: vi.fn() } } } } }),
    workspace: { terminal: {
      local: {
        list: { useQuery: () => ({ data: sessions, isLoading: false }) },
        get: { useQuery: () => ({ data: selectedSession, isLoading: false }) },
        start: { useMutation: (options: { onSuccess: (value: MockSession) => void }) => ({ isPending: false, mutate: (value: unknown) => { calls.start.push(value); options.onSuccess({ ...baseSession, state: "running", command: String((value as { command: string }).command), events: [] }); } }) },
        input: { useMutation: (options: { onSuccess: () => void }) => ({ isPending: false, mutate: (value: unknown) => { calls.input.push(value); options.onSuccess(); } }) },
        cancel: { useMutation: (options: { onSuccess: (value: MockSession) => void }) => ({ isPending: false, mutate: (value: unknown) => { calls.cancel.push(value); options.onSuccess({ ...baseSession, state: "cancelled" }); } }) },
      },
      external: {
        list: { useQuery: () => ({ data: [], isLoading: false }) },
        get: { useQuery: () => ({ data: null, isLoading: false }) },
        start: { useMutation: (options: { onSuccess: (value: MockSession) => void }) => ({ isPending: false, mutate: (value: unknown) => options.onSuccess({ ...baseSession, sessionId: "external-1", state: "queued", summary: "Workflow dispatched." }) }) },
        cancel: { useMutation: (options: { onSuccess: () => void }) => ({ isPending: false, mutate: () => options.onSuccess() }) },
        refresh: { useMutation: (options: { onSuccess: () => void }) => ({ isPending: false, mutate: () => options.onSuccess() }) },
      },
    }, github: { repositories: { useQuery: () => ({ data: { repositories: [] }, isLoading: false }) }, workflows: { useQuery: () => ({ data: { workflows: [] }, isLoading: false }) } } },
  },
}));

class MockEventSource {
  onmessage?: (event: MessageEvent) => void;
  onerror?: () => void;
  close = vi.fn();
  constructor() { lastSource = this; }
}

Object.assign(globalThis, { EventSource: MockEventSource });

const roots: Array<{ root: Root; host: HTMLDivElement }> = [];
async function mount() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const queryClient = new QueryClient();
  roots.push({ root, host });
  await act(async () => { root.render(<QueryClientProvider client={queryClient}><TerminalApp api={{} as never} context={{ currentProject: project }} /></QueryClientProvider>); });
  return host;
}
function inputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  setter?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) await act(async () => { root.unmount(); host.remove(); });
  calls.start = []; calls.input = []; calls.cancel = []; selectedSession = null; sessions = [baseSession]; lastSource = null;
});

describe("TerminalApp", () => {
  it("merges live and snapshot events by sequence without duplicates", () => {
    const event = (sequence: number, text: string): TerminalEvent => ({ sequence, occurredAt: "2026-08-27T10:00:00.000Z", kind: "stdout", state: "running", text });
    expect(mergeEvents([event(2, "two")], [event(1, "one"), event(2, "updated")]).map((item) => item.text)).toEqual(["one", "updated"]);
  });

  it("renders history, sends a command payload, and attaches the live stream", async () => {
    const host = await mount();
    const historyButton = host.querySelector<HTMLButtonElement>("button[aria-label='Session history']");
    await act(async () => { historyButton?.click(); });
    expect(host.textContent).toContain("printf 'done'");
    const item = Array.from(host.querySelectorAll("button")).find((button) => button.textContent?.includes("printf 'done'"));
    await act(async () => { item?.click(); });
    await act(async () => { lastSource?.onmessage?.({ data: JSON.stringify({ type: "snapshot", session: { ...baseSession, state: "completed", events: [] } }) } as MessageEvent); });
    expect(lastSource).not.toBeNull();
    await act(async () => { lastSource?.onmessage?.({ data: JSON.stringify({ type: "event", event: { sequence: 1, occurredAt: "2026-08-27T10:00:00.000Z", kind: "stdout", state: "completed", text: "history output" } }) } as MessageEvent); });
    expect(host.textContent).toContain("history output");
  });

  it("renders streamed output and supports interactive input and cancellation", async () => {
    const host = await mount();
    const command = host.querySelector<HTMLInputElement>("input[aria-label='Terminal command']");
    await act(async () => { inputValue(command!, "read -r value; printf '%s' \"$value\""); command!.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    await act(async () => { lastSource?.onmessage?.({ data: JSON.stringify({ type: "event", event: { sequence: 1, occurredAt: "2026-08-27T10:00:00.000Z", kind: "stdout", state: "running", text: "live output" } }) } as MessageEvent); });
    expect(host.textContent).toContain("live output");
    const input = host.querySelector<HTMLInputElement>("input[aria-label='Terminal input']");
    expect(input).not.toBeNull();
    await act(async () => { inputValue(input!, "hello"); input!.form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    expect(calls.input[0]).toEqual({ sessionId: "session-1", input: "hello\n" });
    const cancel = host.querySelector<HTMLButtonElement>("button[aria-label='Cancel session']");
    await act(async () => { cancel?.click(); });
    expect(calls.cancel[0]).toEqual({ sessionId: "session-1" });
  });
});

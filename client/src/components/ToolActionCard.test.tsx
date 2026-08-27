// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolActionCard, type ToolActionEvent } from "./ToolActionCard";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const roots: Array<{ root: Root; host: HTMLDivElement }> = [];

afterEach(async () => {
  for (const { root, host } of roots.splice(0)) await act(async () => { root.unmount(); host.remove(); });
});

describe("ToolActionCard", () => {
  it("opens the related Terminal session when its workbench card is clicked", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    roots.push({ root, host });
    const event: ToolActionEvent = {
      id: "call-1",
      type: "terminal.started",
      actor: "general_agent",
      createdAt: "2026-08-28T10:00:00.000Z",
      payload: { action: "npm test", operationId: "session-1" },
    };
    const openTerminal = vi.fn();
    await act(async () => { root.render(<ToolActionCard event={event} onOpenTerminal={openTerminal} />); });
    const trigger = host.querySelector<HTMLButtonElement>("button.tool-action-trigger");
    expect(trigger).not.toBeNull();
    await act(async () => { trigger?.click(); });
    expect(openTerminal).toHaveBeenCalledWith("session-1");
    expect(host.querySelector(".tool-action-details")).toBeNull();
  });
});

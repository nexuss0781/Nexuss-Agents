import { describe, expect, it } from "vitest";
import { buildPlaygroundMessages, readOpenAICompatibleStream, resolveGeneralMode } from "./paradoxWorkspace";
import { composeGeneralSystemPrompt, GENERAL_AGENT_SYSTEM_PROMPT } from "./mission/generalAgentPrompt";

describe("playground model stream", () => {
  it("loads the central Markdown General prompt with the two operating modes", () => {
    expect(GENERAL_AGENT_SYSTEM_PROMPT).toContain("You are Nexuss-Agent General");
    expect(GENERAL_AGENT_SYSTEM_PROMPT).toContain("Skills/Tools/SKILL.md");
    expect(GENERAL_AGENT_SYSTEM_PROMPT).not.toContain("Skills/Tools/File-system/SKILL.md");
    expect(composeGeneralSystemPrompt("plan")).toContain("Active mode: Plan Enabled");
    expect(composeGeneralSystemPrompt("build")).toContain("Active mode: Build");
  });

  it("moves from Plan Enabled into Build only after an explicit approval reply to a plan", () => {
    const history = [{ role: "assistant" as const, content: "## Plan\n1. Inspect files\n2. Implement the change\n3. Run verification" }];
    expect(resolveGeneralMode({ requestedMode: "plan", prompt: "Approved", history })).toBe("build");
    expect(resolveGeneralMode({ requestedMode: "plan", prompt: "Can you explain the plan?", history })).toBe("plan");
    expect(resolveGeneralMode({ requestedMode: "build", prompt: "Approved", history })).toBe("build");
  });

  it("puts the Nexuss-Agent system prompt into the actual conversation payload", () => {
    const messages = buildPlaygroundMessages([{ role: "assistant", content: "Earlier reply" }], { prompt: "Hello", stopNotice: false, generalMode: "plan" });
    expect(messages[0]).toMatchObject({ role: "system", content: expect.stringContaining("Active mode: Plan Enabled") });
    expect(messages.at(-1)).toEqual({ role: "user", content: "Hello" });
    expect(messages).not.toContainEqual(expect.objectContaining({ content: expect.stringContaining("Poolside") }));
  });

  it("reassembles chunked OpenAI-compatible SSE frames and emits token text", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"Hel"));
        controller.enqueue(encoder.encode("lo \"}}]}\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"content\":\"world\"}}]}\n\n"));
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      },
    });
    const tokens: string[] = [];
    const result = await readOpenAICompatibleStream(new Response(stream), new AbortController().signal, token => tokens.push(token));
    expect(tokens).toEqual(["Hello ", "world"]);
    expect(result).toEqual({ content: "Hello world", stopped: false, finished: true });
  });

  it("flushes a final SSE frame even when the provider closes without a trailing newline", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"Final token\"}}]}"));
        controller.close();
      },
    });
    const tokens: string[] = [];
    const result = await readOpenAICompatibleStream(new Response(stream), new AbortController().signal, token => tokens.push(token));
    expect(tokens).toEqual(["Final token"]);
    expect(result.content).toBe("Final token");
  });

  it("supports text and reasoning-content variants", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Reasoned\"}}]}\n\n"));
        controller.enqueue(new TextEncoder().encode("data: {\"text\":\" answer\"}\n\ndata: [DONE]\n\n"));
        controller.close();
      },
    });
    const result = await readOpenAICompatibleStream(new Response(stream), new AbortController().signal, () => undefined);
    expect(result).toMatchObject({ content: "Reasoned answer", finished: true });
  });

  it("reassembles streamed filesystem tool calls without emitting fake text", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call_1\",\"type\":\"function\",\"function\":{\"name\":\"filesystem\",\"arguments\":\"{\\\"action\\\":\\\"read\\\"\"}}]}}]}\n\n"));
        controller.enqueue(encoder.encode("data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"arguments\":\",\\\"path\\\":\\\"README.md\\\"}\"}}]}}]}\n\ndata: [DONE]\n\n"));
        controller.close();
      },
    });
    const result = await readOpenAICompatibleStream(new Response(stream), new AbortController().signal, () => undefined);
    expect(result.content).toBe("");
    expect(result.toolCalls).toEqual([{ id: "call_1", type: "function", function: { name: "filesystem", arguments: "{\"action\":\"read\",\"path\":\"README.md\"}" } }]);
  });

  it("surfaces provider error events", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"error\":{\"message\":\"Provider overloaded\"}}\n\n"));
        controller.close();
      },
    });
    await expect(readOpenAICompatibleStream(new Response(stream), new AbortController().signal, () => undefined)).rejects.toThrow("Provider overloaded");
  });

  it("marks a provider stream stopped when its AbortSignal is cancelled", async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n"));
      },
      cancel() {},
    });
    const controller = new AbortController();
    const resultPromise = readOpenAICompatibleStream(new Response(stream), controller.signal, () => undefined);
    controller.abort();
    await expect(resultPromise).resolves.toMatchObject({ content: "Partial", stopped: true });
  });
});

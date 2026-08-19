import { describe, expect, it } from "vitest";
import { readOpenAICompatibleStream } from "./paradoxWorkspace";

describe("playground model stream", () => {
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

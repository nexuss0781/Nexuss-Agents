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
    expect(result).toEqual({ content: "Hello world", stopped: true });
  });

  it("marks a provider stream stopped when its AbortSignal is cancelled", async () => {
    let release: (() => void) | undefined;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("data: {\"choices\":[{\"delta\":{\"content\":\"Partial\"}}]}\n\n"));
        release = () => controller.close();
      },
      cancel() { release?.(); },
    });
    const controller = new AbortController();
    const resultPromise = readOpenAICompatibleStream(new Response(stream), controller.signal, () => undefined);
    controller.abort();
    await expect(resultPromise).resolves.toMatchObject({ content: "Partial", stopped: true });
  });
});

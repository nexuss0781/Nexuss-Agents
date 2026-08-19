import type { Express, Request, Response } from "express";
import { z } from "zod";
import { getNexussSession } from "./nexussAuth";
import { streamWorkspacePrompt } from "./paradoxWorkspace";

const streamInput = z.object({
  threadId: z.string().min(1).max(128),
  model: z.string().trim().min(1).max(256),
  prompt: z.string().trim().min(1).max(100_000),
  title: z.string().trim().min(1).max(240).optional(),
});

type StreamEvent = { type: "start" | "token" | "done" | "error"; [key: string]: unknown };

function sendEvent(res: Response, event: StreamEvent) {
  if (res.writableEnded) return;
  res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function registerPlaygroundStreamRoute(app: Express) {
  app.post("/api/playground/stream", async (req, res) => {
    const user = await getNexussSession(req as unknown as Request);
    if (!user?.id) {
      res.status(401).json({ error: "Sign in to use the model playground." });
      return;
    }

    const parsed = streamInput.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "The playground request is invalid." });
      return;
    }

    const controller = new AbortController();
    let settled = false;
    res.on("close", () => {
      if (!settled) controller.abort();
    });

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    try {
      sendEvent(res, { type: "start", model: parsed.data.model });
      const result = await streamWorkspacePrompt(
        user.id,
        parsed.data,
        controller.signal,
        token => sendEvent(res, { type: "token", text: token })
      );
      settled = true;
      if (controller.signal.aborted || res.writableEnded) return;
      sendEvent(res, { type: "done", stopped: result.stopped, content: result.content });
      res.end();
    } catch {
      settled = true;
      if (controller.signal.aborted || res.writableEnded) return;
      sendEvent(res, { type: "error", message: "The model could not complete this response." });
      res.end();
    }
  });
}

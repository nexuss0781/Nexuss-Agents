import type { Express, Request, Response } from "express";
import { getNexussSession } from "../nexussAuth";
import { getLocalTerminalSession, subscribeLocalTerminalSession } from "./localSessionManager";

function sendEvent(res: Response, event: Record<string, unknown>) {
  if (!res.writableEnded) res.write(`data: ${JSON.stringify(event)}\n\n`);
}

export function registerLocalTerminalRoute(app: Express) {
  app.get("/api/terminal/local/:sessionId/events", async (req, res) => {
    const user = await getNexussSession(req as unknown as Request);
    if (!user?.id) {
      res.status(401).json({ error: "Sign in to view terminal events." });
      return;
    }

    const sessionId = String(req.params.sessionId || "");
    try {
      const session = await getLocalTerminalSession(user.id, sessionId);
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      sendEvent(res, { type: "snapshot", session });

      if (["completed", "failed", "cancelled", "timed_out", "interrupted"].includes(session.state)) {
        res.end();
        return;
      }

      const unsubscribe = subscribeLocalTerminalSession(user.id, sessionId, event => sendEvent(res, { type: "event", event }));
      const heartbeat = setInterval(() => sendEvent(res, { type: "heartbeat", sessionId }), 15_000);
      heartbeat.unref?.();
      const cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
      };
      res.on("close", cleanup);
      res.on("finish", cleanup);
    } catch (error) {
      if (!res.headersSent) res.status(404).json({ error: error instanceof Error ? error.message : "Terminal session not found." });
      else res.end();
    }
  });
}

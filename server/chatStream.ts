import type { Express, Request, Response } from "express";
import { z } from "zod";
import { createThreadMessage, getProjectForUser, getThreadForUser, listThreadMessages } from "./db";
import { invokeLLMStream } from "./_core/llm";
import { authenticateLocalRequest } from "./localAuth";

const requestSchema = z.object({
  threadId: z.number().int().positive(),
  content: z.string().trim().min(1).max(20_000),
});

function writeEvent(res: Response, event: string, data: Record<string, unknown>) {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function extractText(payload: unknown): string {
  const response = payload as { choices?: Array<{ delta?: { content?: string }; message?: { content?: string } }> };
  const choice = response.choices?.[0];
  return choice?.delta?.content ?? choice?.message?.content ?? "";
}

async function pipeUpstream(response: globalThis.Response, res: Response) {
  if (!response.ok) throw new Error(await response.text());
  if (response.headers.get("content-type")?.includes("application/json")) {
    const text = extractText(await response.json());
    if (text) writeEvent(res, "delta", { text });
    return text;
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("The model response contained no body");
  const decoder = new TextDecoder();
  let buffer = "";
  let output = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const data = event.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.replace(/^data:\s?/, "")).join("\n");
      if (!data || data === "[DONE]") continue;
      try {
        const text = extractText(JSON.parse(data));
        if (text) {
          output += text;
          writeEvent(res, "delta", { text });
        }
      } catch {
        // Skip non-JSON upstream keep-alive frames.
      }
    }
  }
  return output;
}

export function registerChatStreamRoute(app: Express) {
  app.post("/api/chat/stream", async (req: Request, res: Response) => {
    let user = null;
    try {
      user = await authenticateLocalRequest(req);
    } catch {
      user = null;
    }
    if (!user) return res.status(401).json({ error: "Sign in to use Nexuss-Agent." });

    const parsed = requestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Invalid chat request." });
    const { threadId, content } = parsed.data;
    const thread = await getThreadForUser(threadId, user.id);
    if (!thread) return res.status(404).json({ error: "Thread not found." });

    await createThreadMessage({ threadId, userId: user.id, role: "user", content });
    const [messages, project] = await Promise.all([
      listThreadMessages(threadId, user.id),
      thread.projectId ? getProjectForUser(thread.projectId, user.id) : Promise.resolve(undefined),
    ]);
    const projectContext = project ? ` This conversation belongs to the project “${project.name}”: ${project.description || "No description supplied."}` : "";

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    try {
      const upstream = await invokeLLMStream({
        model: "gpt-5-mini",
        max_tokens: 1600,
        toolChoice: "none",
        messages: [
          { role: "system", content: `You are Nexuss, a precise assistant in a professional AI playground. You have no external tools. Answer directly and use clear Markdown when it improves readability.${projectContext}` },
          ...messages.slice(-30).map(message => ({ role: message.role, content: message.content })),
        ],
      });
      const output = await pipeUpstream(upstream, res);
      if (output.trim()) await createThreadMessage({ threadId, userId: user.id, role: "assistant", content: output });
      writeEvent(res, "done", { success: true });
    } catch (error) {
      console.error("[Chat stream]", error);
      writeEvent(res, "error", { message: "Nexuss could not complete that response. Please try again." });
    } finally {
      res.end();
    }
  });
}

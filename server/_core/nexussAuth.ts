import type { Express, Request, Response } from "express";
import * as db from "../db";
import { ENV } from "./env";
import { establishLocalSession } from "../localAuth";

const MAX_HANDOFF_LENGTH = 256;

type HandoffUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
};

function queryString(req: Request, key: string): string | undefined {
  const value = req.query[key];
  return typeof value === "string" ? value : undefined;
}

async function exchangeHandoff(handoffToken: string): Promise<HandoffUser | null> {
  const response = await fetch(`${ENV.nexussAuthUrl}/v1/handoff/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      projectId: ENV.nexussAuthProjectId,
      handoffToken,
    }),
  });
  if (!response.ok) return null;
  const payload = (await response.json()) as { user?: HandoffUser };
  const user = payload.user;
  if (!user || typeof user.id !== "string" || !user.id.trim()) return null;
  return {
    id: user.id,
    email: typeof user.email === "string" ? user.email : null,
    name: typeof user.name === "string" ? user.name : null,
    avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : null,
  };
}

export function registerNexussAuthRoutes(app: Express) {
  app.get("/auth/callback", async (req: Request, res: Response) => {
    const handoffToken = queryString(req, "handoff_token");
    const result = queryString(req, "nex_auth");

    if (result === "denied") {
      res.redirect(302, "/?auth=denied");
      return;
    }
    if (!handoffToken || handoffToken.length > MAX_HANDOFF_LENGTH) {
      res.status(400).json({ error: "handoff_token is required" });
      return;
    }

    try {
      const authUser = await exchangeHandoff(handoffToken);
      if (!authUser) {
        res.status(401).json({ error: "invalid or expired Nexuss Auth handoff" });
        return;
      }

      const openId = `nexuss:${authUser.id}`;
      await db.upsertUser({
        openId,
        name: authUser.name,
        email: authUser.email,
        loginMethod: "google",
        lastSignedIn: new Date(),
      });
      const localUser = await db.getUserByOpenId(openId);
      if (!localUser) {
        res.status(500).json({ error: "authenticated user could not be stored" });
        return;
      }

      await establishLocalSession(req, res, localUser.id, "nexuss");
      res.redirect(302, "/");
    } catch (error) {
      console.error("[Nexuss Auth] Callback failed", error);
      res.status(502).json({ error: "Nexuss Auth handoff failed" });
    }
  });
}

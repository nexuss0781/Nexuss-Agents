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

type HandoffExchangeResult =
  | { user: HandoffUser; error: null }
  | { user: null; error: "upstream_rejected" | "invalid_response" };

async function exchangeHandoff(handoffToken: string): Promise<HandoffExchangeResult> {
  const response = await fetch(`${ENV.nexussAuthUrl}/v1/handoff/exchange`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({
      projectId: ENV.nexussAuthProjectId,
      handoffToken,
    }),
  });
  if (!response.ok) {
    console.error("[Nexuss Auth] Handoff exchange rejected", { status: response.status, projectId: ENV.nexussAuthProjectId });
    return { user: null, error: "upstream_rejected" };
  }
  const payload = (await response.json()) as { user?: HandoffUser };
  const user = payload.user;
  if (!user || typeof user.id !== "string" || !user.id.trim()) {
    console.error("[Nexuss Auth] Handoff exchange returned an invalid user payload");
    return { user: null, error: "invalid_response" };
  }
  return {
    user: {
      id: user.id,
      email: typeof user.email === "string" ? user.email : null,
      name: typeof user.name === "string" ? user.name : null,
      avatarUrl: typeof user.avatarUrl === "string" ? user.avatarUrl : null,
    },
    error: null,
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
      const exchange = await exchangeHandoff(handoffToken);
      if (!exchange.user) {
        res.status(401).json({ error: "nexuss_auth_handoff_rejected", reason: exchange.error });
        return;
      }
      const authUser = exchange.user;
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
        console.error("[Nexuss Auth] Local user was not readable after upsert", { openId });
        res.status(503).json({ error: "local_persistence_unavailable" });
        return;
      }

      await establishLocalSession(req, res, localUser.id, "nexuss");
      res.redirect(302, "/");
    } catch (error) {
      console.error("[Nexuss Auth] Local callback persistence failed", error);
      res.status(503).json({ error: "local_persistence_unavailable" });
    }
  });
}

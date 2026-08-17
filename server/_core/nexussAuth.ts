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

function errorDetails(error: unknown) {
  return error instanceof Error
    ? { name: error.name, message: error.message }
    : { name: "UnknownError", message: String(error) };
}

type HandoffExchangeResult =
  | { user: HandoffUser; error: null }
  | { user: null; error: "upstream_rejected" | "invalid_response" | "upstream_unavailable" };

async function exchangeHandoff(handoffToken: string): Promise<HandoffExchangeResult> {
  let response: globalThis.Response;
  try {
    response = await fetch(`${ENV.nexussAuthUrl}/v1/handoff/exchange`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        projectId: ENV.nexussAuthProjectId,
        handoffToken,
      }),
    });
  } catch (error) {
    console.error("[Nexuss Auth] Handoff exchange network failure", {
      projectId: ENV.nexussAuthProjectId,
      ...errorDetails(error),
    });
    return { user: null, error: "upstream_unavailable" };
  }
  if (!response.ok) {
    let reason = "unknown";
    try {
      const body = (await response.json()) as { error?: unknown; reason?: unknown };
      if (typeof body.error === "string") reason = body.error;
      else if (typeof body.reason === "string") reason = body.reason;
    } catch {
      // Preserve the status-based diagnostic when the upstream body is not JSON.
    }
    console.error("[Nexuss Auth] Handoff exchange rejected", {
      status: response.status,
      reason,
      projectId: ENV.nexussAuthProjectId,
    });
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

    console.info("[Nexuss Auth] Handoff callback started", {
      projectId: ENV.nexussAuthProjectId,
      result: result ?? "missing",
      hasHandoffToken: Boolean(handoffToken),
      handoffTokenLength: handoffToken?.length ?? 0,
    });

    if (result === "denied") {
      res.redirect(302, "/?auth=denied");
      return;
    }
    if (!handoffToken || handoffToken.length > MAX_HANDOFF_LENGTH) {
      res.status(400).json({ error: "handoff_token is required" });
      return;
    }

    const exchange = await exchangeHandoff(handoffToken);
    if (!exchange.user) {
      console.warn("[Nexuss Auth] Handoff callback stopped at exchange", {
        projectId: ENV.nexussAuthProjectId,
        reason: exchange.error,
      });
      res.status(401).json({ error: "nexuss_auth_handoff_rejected", reason: exchange.error });
      return;
    }

    console.info("[Nexuss Auth] Handoff exchange succeeded", {
      projectId: ENV.nexussAuthProjectId,
      userReceived: true,
    });
    const authUser = exchange.user;
    const openId = `nexuss:${authUser.id}`;
    const localUserInput = {
      openId,
      name: authUser.name,
      email: authUser.email,
      loginMethod: "google" as const,
      lastSignedIn: new Date(),
    };

    try {
      await db.upsertUser(localUserInput);
      const localUser = await db.getUserByOpenId(openId);
      if (!localUser) {
        console.error("[Nexuss Auth] Local user was not readable after upsert", { openId });
        res.status(503).json({ error: "local_persistence_unavailable" });
        return;
      }

      try {
        await establishLocalSession(req, res, localUser.id, "nexuss");
      } catch (error) {
        console.error("[Nexuss Auth] Local session could not be created", {
          projectId: ENV.nexussAuthProjectId,
          jwtSecretConfigured: ENV.cookieSecret.length >= 32,
          ...errorDetails(error),
        });
        res.status(503).json({ error: "session_configuration_invalid" });
        return;
      }
      res.redirect(302, "/");
    } catch (error) {
      console.error("[Nexuss Auth] Local persistence failed", {
        projectId: ENV.nexussAuthProjectId,
        stage: "upsert_user_or_reload",
        ...errorDetails(error),
      });
      res.status(503).json({ error: "local_persistence_unavailable" });
    }
  });
}

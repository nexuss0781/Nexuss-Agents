import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const db = vi.hoisted(() => ({ createLocalUser: vi.fn() }));
const localAuth = vi.hoisted(() => ({
  authenticatePassword: vi.fn(),
  clearLocalSession: vi.fn(),
  establishLocalSession: vi.fn(),
  hashPassword: vi.fn(),
}));

vi.mock("./db", async importOriginal => ({ ...(await importOriginal<typeof import("./db")>()), ...db }));
vi.mock("./localAuth", () => localAuth);

import { appRouter } from "./routers";

function createContext(): TrpcContext {
  return {
    user: null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { cookie: vi.fn(), clearCookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

describe("local account authentication", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers a password-backed account and establishes a signed session", async () => {
    const user = { id: 19, openId: "local_session", name: "Nexuss User", email: "user@example.com", loginMethod: "password", role: "user", createdAt: new Date(), updatedAt: new Date(), lastSignedIn: new Date() };
    localAuth.hashPassword.mockResolvedValue("secure-hash");
    db.createLocalUser.mockResolvedValue(user);
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.register({ name: "Nexuss User", email: "USER@example.com", password: "password-123" })).resolves.toEqual(user);
    expect(localAuth.hashPassword).toHaveBeenCalledWith("password-123");
    expect(db.createLocalUser).toHaveBeenCalledWith({ name: "Nexuss User", email: "user@example.com", passwordHash: "secure-hash" });
    expect(localAuth.establishLocalSession).toHaveBeenCalledWith(ctx.req, ctx.res, 19);
  });

  it("does not establish a session for an incorrect password", async () => {
    localAuth.authenticatePassword.mockResolvedValue(null);
    const caller = appRouter.createCaller(createContext());

    await expect(caller.auth.login({ email: "user@example.com", password: "wrong-password" })).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    expect(localAuth.establishLocalSession).not.toHaveBeenCalled();
  });

  it("clears the local session cookie when the user signs out", async () => {
    const ctx = createContext();
    const caller = appRouter.createCaller(ctx);

    await expect(caller.auth.logout()).resolves.toEqual({ success: true });
    expect(localAuth.clearLocalSession).toHaveBeenCalledWith(ctx.req, ctx.res);
  });
});

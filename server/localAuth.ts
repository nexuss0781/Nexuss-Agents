import { compare, hash } from "bcryptjs";
import type { Request, Response } from "express";
import { jwtVerify, SignJWT } from "jose";
import { COOKIE_NAME } from "../shared/const";
import { getLocalAccountByEmail, getUserById, touchLastSignedIn } from "./db";
import { ENV } from "./_core/env";
import { getSessionCookieOptions } from "./_core/cookies";

const SESSION_DURATION_MS = 1000 * 60 * 60 * 24 * 7;
const PASSWORD_ROUNDS = 12;

function getCookieValue(cookieHeader: string | undefined, key: string) {
  if (!cookieHeader) return undefined;
  return cookieHeader.split(";").map(value => value.trim()).find(value => value.startsWith(`${key}=`))?.slice(key.length + 1);
}

function sessionSecret() {
  return new TextEncoder().encode(ENV.cookieSecret);
}

export async function hashPassword(password: string) {
  return hash(password, PASSWORD_ROUNDS);
}

export async function authenticatePassword(email: string, password: string) {
  const account = await getLocalAccountByEmail(email);
  if (!account || !(await compare(password, account.account.passwordHash))) return null;
  return account.user;
}

export async function createLocalSessionToken(userId: number, authMethod: "password" | "nexuss" = "password") {
  const expirationSeconds = Math.floor((Date.now() + SESSION_DURATION_MS) / 1000);
  return new SignJWT({ userId, authMethod })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt()
    .setExpirationTime(expirationSeconds)
    .sign(sessionSecret());
}

export async function authenticateLocalRequest(req: Request) {
  const token = getCookieValue(req.headers.cookie, COOKIE_NAME);
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, sessionSecret(), { algorithms: ["HS256"] });
    const userId = payload.userId;
    if (typeof userId !== "number" || (payload.authMethod !== "password" && payload.authMethod !== "nexuss")) return null;
    const user = await getUserById(userId);
    if (!user) return null;
    if (payload.authMethod === "password" && user.loginMethod !== "password") return null;
    if (payload.authMethod === "nexuss" && user.loginMethod !== "google") return null;
    void touchLastSignedIn(user.id);
    return user;
  } catch {
    return null;
  }
}

export async function establishLocalSession(req: Request, res: Response, userId: number, authMethod: "password" | "nexuss" = "password") {
  const token = await createLocalSessionToken(userId, authMethod);
  res.cookie(COOKIE_NAME, token, {
    ...getSessionCookieOptions(req),
    maxAge: SESSION_DURATION_MS,
  });
}

export function clearLocalSession(req: Request, res: Response) {
  res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(req), maxAge: -1 });
}

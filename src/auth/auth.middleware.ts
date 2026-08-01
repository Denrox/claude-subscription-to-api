import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { sessionSecret } from "./runtime";
import { SESSION_COOKIE, verifySession } from "./session";

const PUBLIC_EXACT = new Set(["/login", "/logout", "/health", "/favicon.ico"]);
const PUBLIC_PREFIXES = ["/assets/"];

function isPublic(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return part.slice(eq + 1).trim();
    }
  }
  return undefined;
}

export function serializeSessionCookie(value: string, maxAgeMs: number): string {
  const attrs = [
    `${SESSION_COOKIE}=${encodeURIComponent(value)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${Math.floor(maxAgeMs / 1000)}`,
  ];
  if (config.auth.cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}

export function clearSessionCookie(): string {
  const attrs = [`${SESSION_COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (config.auth.cookieSecure) attrs.push("Secure");
  return attrs.join("; ");
}

export function authMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isPublic(req.path)) return next();

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (verifySession(sessionSecret, token) !== null) return next();

    if (req.path.startsWith("/api/")) {
      res.status(401).json({ statusCode: 401, message: "not authenticated" });
      return;
    }
    const target = req.originalUrl && req.originalUrl !== "/" ? req.originalUrl : "";
    res.redirect(302, target ? `/login?next=${encodeURIComponent(target)}` : "/login");
  };
}

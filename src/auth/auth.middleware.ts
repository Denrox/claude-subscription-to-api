import type { NextFunction, Request, Response } from "express";
import { config } from "../config";
import { sessionSecret } from "./runtime";
import { SESSION_COOKIE, verifySession } from "./session";

// Paths reachable without a session. Everything else — the whole UI and the
// whole API — is closed. This is a deny-by-default list on purpose: a new route
// is protected the moment it exists, with no chance of forgetting a guard.
//
// /assets and /favicon.ico are the RR7 client bundle. They are hashed static
// files with no data in them, and they must load on the login page itself.
const PUBLIC_EXACT = new Set(["/login", "/logout", "/health", "/favicon.ico"]);
const PUBLIC_PREFIXES = ["/assets/"];

function isPublic(path: string): boolean {
  if (PUBLIC_EXACT.has(path)) return true;
  return PUBLIC_PREFIXES.some((p) => path.startsWith(p));
}

// Cookies are parsed here rather than pulling in cookie-parser: one cookie,
// one consumer. Values are URI-decoded because that is how Set-Cookie wrote it.
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

// Registered on the raw express instance before Nest's router and before the
// RR7 handler, so a single check covers the API, the UI documents, and the UI's
// own server-side data fetches.
export function authMiddleware() {
  return (req: Request, res: Response, next: NextFunction) => {
    if (isPublic(req.path)) return next();

    const token = readCookie(req.headers.cookie, SESSION_COOKIE);
    if (verifySession(sessionSecret, token) !== null) return next();

    // API callers get a status code they can act on; browsers get sent to the
    // login form with a `next` param so they land back where they aimed.
    if (req.path.startsWith("/api/")) {
      res.status(401).json({ statusCode: 401, message: "not authenticated" });
      return;
    }
    const target = req.originalUrl && req.originalUrl !== "/" ? req.originalUrl : "";
    res.redirect(302, target ? `/login?next=${encodeURIComponent(target)}` : "/login");
  };
}

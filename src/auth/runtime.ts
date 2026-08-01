import { randomBytes } from "crypto";
import { config } from "../config";
import { LoginThrottle } from "./session";

// Auth state shared by the express middleware (registered in main.ts, outside
// Nest's DI graph) and the Nest login controller. A module singleton is the
// smallest thing that reaches both.

// Resolved once at import so every request signs and verifies with the same
// key. A missing SESSION_SECRET is not fatal — a random per-boot key is still
// secure, it just invalidates existing cookies on restart. main.ts warns.
export const sessionSecret = config.auth.sessionSecret || randomBytes(32).toString("hex");
export const sessionSecretIsEphemeral = !config.auth.sessionSecret;

export const loginThrottle = new LoginThrottle(
  config.auth.maxLoginAttempts,
  config.auth.loginWindowMs,
);

// True when a password is configured at all. Without one, nothing could ever
// authenticate, so main.ts refuses to start rather than serving a UI that
// uploads OAuth tokens and can never be logged into.
export const passwordConfigured = !!(config.auth.password || config.auth.passwordHash);

// Client key for the throttle. TRUST_PROXY makes the app honor
// X-Forwarded-For; without it a spoofed header could be used to exhaust
// another client's budget, so the socket address is the default.
export function clientKey(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

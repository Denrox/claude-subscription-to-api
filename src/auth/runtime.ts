import { randomBytes } from "crypto";
import { config } from "../config";
import { LoginThrottle } from "./session";

export const sessionSecret = config.auth.sessionSecret || randomBytes(32).toString("hex");
export const sessionSecretIsEphemeral = !config.auth.sessionSecret;

export const loginThrottle = new LoginThrottle(
  config.auth.maxLoginAttempts,
  config.auth.loginWindowMs,
);

export const passwordConfigured = !!(config.auth.password || config.auth.passwordHash);

export function clientKey(req: { ip?: string; socket?: { remoteAddress?: string } }): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

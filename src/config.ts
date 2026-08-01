import { homedir } from "os";
import { join } from "path";

const claudeHome = process.env.CLAUDE_HOME || homedir();

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

function bool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  return raw === "1" || raw.toLowerCase() === "true";
}

export const config = {
  port: int("PORT", 3000),
  claudeHome,

  auth: {
    password: process.env.AUTH_PASSWORD || null,
    passwordHash: process.env.AUTH_PASSWORD_HASH || null,
    sessionSecret: process.env.SESSION_SECRET || null,
    sessionTtlMs: int("SESSION_TTL_HOURS", 24 * 30) * 60 * 60 * 1000,
    cookieSecure: bool("COOKIE_SECURE", false),
    maxLoginAttempts: int("MAX_LOGIN_ATTEMPTS", 10),
    loginWindowMs: int("LOGIN_WINDOW_MS", 15 * 60 * 1000),
  },

  claude: {
    bin: process.env.CLAUDE_BIN || "claude",
    timeoutMs: int("CLAUDE_TIMEOUT_MS", 120000),
    refreshModel: process.env.REFRESH_MODEL || "claude-haiku-4-5-20251001",
    refreshIntervalMs: int("REFRESH_INTERVAL_MS", 2 * 60 * 60 * 1000),
    refreshOnBoot: bool("REFRESH_ON_BOOT", true),
    refreshOnBootDelayMs: int("REFRESH_ON_BOOT_DELAY_MS", 15000),
  },

  paths: {
    credentials:
      process.env.CLAUDE_CREDENTIALS_PATH || join(claudeHome, ".claude", ".credentials.json"),
    cliConfig: process.env.CLAUDE_CONFIG_PATH || join(claudeHome, ".claude.json"),
    scratch: process.env.SCRATCH_DIR || "/tmp/remote-clode",
  },

  uiBuildDir: process.env.UI_BUILD_DIR || join(__dirname, "..", "ui", "build"),
};

export type AppConfig = typeof config;

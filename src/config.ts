import { homedir } from "os";
import { join } from "path";

const claudeHome = process.env.CLAUDE_HOME || homedir();
const scratch = process.env.SCRATCH_DIR || "/tmp/claude-subscription-to-api";

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

function list(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (!raw) return fallback;
  const items = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return items.length ? items : fallback;
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

  api: {
    enabled: bool("API_ENABLED", true),
    tokensPath:
      process.env.API_TOKENS_PATH || join(claudeHome, ".claude", "claude-subscription-to-api-tokens.json"),
    timeoutMs: int("API_TIMEOUT_MS", 10 * 60 * 1000),
    maxConcurrent: int("API_MAX_CONCURRENT", 4),
    allowTools: bool("API_ALLOW_TOOLS", false),
    systemPromptMode: process.env.API_SYSTEM_PROMPT_MODE === "append" ? "append" : "replace",
    partialMessages: bool("API_PARTIAL_MESSAGES", true),
    workDir: process.env.API_WORK_DIR || scratch,
    models: list("API_MODELS", ["claude-opus-5", "claude-sonnet-5", "claude-haiku-4-5"]),
  },

  docs: {
    enabled: bool("DOCS_ENABLED", true),
    swaggerUiVersion: process.env.SWAGGER_UI_VERSION || "5.17.14",
  },

  paths: {
    credentials:
      process.env.CLAUDE_CREDENTIALS_PATH || join(claudeHome, ".claude", ".credentials.json"),
    cliConfig: process.env.CLAUDE_CONFIG_PATH || join(claudeHome, ".claude.json"),
    scratch,
  },

  uiBuildDir: process.env.UI_BUILD_DIR || join(__dirname, "..", "ui", "build"),
};

export type AppConfig = typeof config;

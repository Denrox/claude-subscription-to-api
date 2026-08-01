import { homedir } from "os";
import { join } from "path";

// Centralized runtime configuration; everything is overridable via environment
// variables so docker-compose can tune behavior without code changes.
//
// The two files this app manages are the Claude CLI's own auth files. They live
// in the CLI's HOME — NOT in any app-owned data directory — because the whole
// point is that a user who SSHes into the host and runs `claude` picks up the
// same credentials. docker-compose bind-mounts the host user's ~/.claude and
// ~/.claude.json onto CLAUDE_HOME, so a write here is a write to the host home.
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
    // Exactly one of these is needed. AUTH_PASSWORD_HASH (see
    // `npm run hash-password`) keeps the plaintext out of the environment and
    // out of `docker inspect`; AUTH_PASSWORD is the convenient alternative.
    password: process.env.AUTH_PASSWORD || null,
    passwordHash: process.env.AUTH_PASSWORD_HASH || null,
    // Signs the session cookie. Unset = a random secret per boot, which is safe
    // but logs every user out on restart (main.ts warns about it).
    sessionSecret: process.env.SESSION_SECRET || null,
    sessionTtlMs: int("SESSION_TTL_HOURS", 24 * 30) * 60 * 60 * 1000,
    // Set when serving over HTTPS so the cookie never rides a plaintext hop.
    cookieSecure: bool("COOKIE_SECURE", false),
    // Failed logins allowed per client IP inside the window before 429s start.
    maxLoginAttempts: int("MAX_LOGIN_ATTEMPTS", 10),
    loginWindowMs: int("LOGIN_WINDOW_MS", 15 * 60 * 1000),
  },

  claude: {
    // The CLI binary. compose bind-mounts the host's own `claude` here, so the
    // container runs the exact version the SSH user runs.
    bin: process.env.CLAUDE_BIN || "claude",
    timeoutMs: int("CLAUDE_TIMEOUT_MS", 120000),
    // Model for the keep-warm ping. Cheapest available: the run exists for its
    // token-refresh side effect, not its output.
    refreshModel: process.env.REFRESH_MODEL || "claude-haiku-4-5-20251001",
    // How often to ping. The CLI only rotates when the token is near ITS OWN
    // expiry threshold (measured on an ~8h token: a run with ~7h left rewrote
    // nothing), so this has to be comfortably shorter than the token lifetime.
    refreshIntervalMs: int("REFRESH_INTERVAL_MS", 2 * 60 * 60 * 1000),
    // Ping once shortly after boot, so a container that was down over the
    // token's lifetime refreshes immediately instead of at the first interval.
    refreshOnBoot: bool("REFRESH_ON_BOOT", true),
    refreshOnBootDelayMs: int("REFRESH_ON_BOOT_DELAY_MS", 15000),
  },

  paths: {
    // The CLI's OAuth credentials: access + refresh token, expiry, scopes.
    credentials:
      process.env.CLAUDE_CREDENTIALS_PATH || join(claudeHome, ".claude", ".credentials.json"),
    // The CLI's global config: onboarding state, account, project trust. The
    // credentials alone aren't enough for a clean headless run — a missing or
    // blank config can trigger first-run behavior.
    cliConfig: process.env.CLAUDE_CONFIG_PATH || join(claudeHome, ".claude.json"),
    // cwd for the ping. Never the mounted home: `claude -p` writes session
    // transcripts keyed by cwd, and a scratch dir keeps that noise contained.
    scratch: process.env.SCRATCH_DIR || "/tmp/remote-clode",
  },

  // Where the RR7 UI build lives (client assets + server bundle).
  uiBuildDir: process.env.UI_BUILD_DIR || join(__dirname, "..", "ui", "build"),
};

export type AppConfig = typeof config;

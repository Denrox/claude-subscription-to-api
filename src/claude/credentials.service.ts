import { BadRequestException, Injectable } from "@nestjs/common";
import { existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync } from "fs";
import { dirname } from "path";
import { config } from "../config";

export interface CredentialsStatus {
  exists: boolean;
  path: string;
  // False when the file is present but its token strings are empty. The CLI
  // blanks them (keeping the surrounding metadata) when a refresh is rejected —
  // e.g. the refresh token was rotated by another client holding the same
  // credentials. Unlike `expired`, this never self-heals: every run fails until
  // someone re-authenticates.
  hasTokens: boolean | null;
  hasRefreshToken: boolean | null;
  expiresAt: number | null;
  expired: boolean | null;
  subscriptionType: string | null;
  scopes: string[] | null;
  updatedAt: number | null;
}

export interface CliConfigStatus {
  exists: boolean;
  path: string;
  hasCompletedOnboarding: boolean | null;
  account: string | null;
  updatedAt: number | null;
}

// Read/write side of the Claude CLI's two auth files.
//
// Reads NEVER return the tokens — only non-secret metadata — so the secret
// cannot leak back to the browser through a loader. Writes are atomic
// (temp + rename) so a partial write can never corrupt the CLI's live auth file
// out from under a running `claude` on the host.
@Injectable()
export class CredentialsService {
  // ---- ~/.claude/.credentials.json ----------------------------------------

  readCredentialsStatus(): CredentialsStatus {
    const path = config.paths.credentials;
    const base: CredentialsStatus = {
      exists: false,
      path,
      hasTokens: null,
      hasRefreshToken: null,
      expiresAt: null,
      expired: null,
      subscriptionType: null,
      scopes: null,
      updatedAt: null,
    };
    if (!existsSync(path)) return base;
    base.exists = true;
    base.updatedAt = mtime(path);

    let oauth: any;
    try {
      oauth = JSON.parse(readFileSync(path, "utf8"))?.claudeAiOauth ?? {};
    } catch {
      // Corrupt/unreadable: report that it exists but expose no metadata.
      return base;
    }
    const expiresAt = typeof oauth.expiresAt === "number" ? oauth.expiresAt : null;
    return {
      ...base,
      hasTokens: typeof oauth.accessToken === "string" && oauth.accessToken.trim().length > 0,
      hasRefreshToken:
        typeof oauth.refreshToken === "string" && oauth.refreshToken.trim().length > 0,
      expiresAt,
      expired: expiresAt === null ? null : expiresAt < Date.now(),
      subscriptionType: typeof oauth.subscriptionType === "string" ? oauth.subscriptionType : null,
      scopes: Array.isArray(oauth.scopes) ? oauth.scopes : null,
    };
  }

  // Accepts the contents of ~/.claude/.credentials.json, raw string or parsed
  // object. The shape is validated before anything touches disk: a syntactically
  // valid but wrong-shaped file (e.g. someone pasted ~/.claude.json here) would
  // otherwise silently break auth and look "uploaded".
  writeCredentials(body: unknown): CredentialsStatus {
    const data = parseJson(body, "credentials");
    const oauth = (data as any)?.claudeAiOauth;
    if (!oauth || typeof oauth !== "object") {
      throw new BadRequestException('credentials must contain a "claudeAiOauth" object');
    }
    if (typeof oauth.accessToken !== "string" || !oauth.accessToken.trim()) {
      throw new BadRequestException("claudeAiOauth.accessToken must be a non-empty string");
    }
    if (oauth.refreshToken !== undefined && typeof oauth.refreshToken !== "string") {
      throw new BadRequestException("claudeAiOauth.refreshToken, when present, must be a string");
    }
    if (oauth.expiresAt !== undefined && typeof oauth.expiresAt !== "number") {
      throw new BadRequestException("claudeAiOauth.expiresAt, when present, must be a number");
    }
    writeAtomic(config.paths.credentials, data);
    return this.readCredentialsStatus();
  }

  // ---- ~/.claude.json ------------------------------------------------------

  readCliConfigStatus(): CliConfigStatus {
    const path = config.paths.cliConfig;
    if (!existsSync(path)) {
      return { exists: false, path, hasCompletedOnboarding: null, account: null, updatedAt: null };
    }
    const updatedAt = mtime(path);
    let data: any;
    try {
      data = JSON.parse(readFileSync(path, "utf8"));
    } catch {
      return { exists: true, path, hasCompletedOnboarding: null, account: null, updatedAt };
    }
    return {
      exists: true,
      path,
      hasCompletedOnboarding:
        typeof data?.hasCompletedOnboarding === "boolean" ? data.hasCompletedOnboarding : null,
      account:
        typeof data?.oauthAccount?.emailAddress === "string" ? data.oauthAccount.emailAddress : null,
      updatedAt,
    };
  }

  // ~/.claude.json holds far more than auth (project history, MCP servers, …),
  // so the only structural requirement is "a JSON object" — anything stricter
  // would reject legitimate configs.
  writeCliConfig(body: unknown): CliConfigStatus {
    const data = parseJson(body, "config");
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new BadRequestException("config must be a JSON object");
    }
    writeAtomic(config.paths.cliConfig, data);
    return this.readCliConfigStatus();
  }
}

function parseJson(body: unknown, label: string): unknown {
  if (typeof body !== "string") return body;
  try {
    return JSON.parse(body);
  } catch (err: any) {
    throw new BadRequestException(`${label} must be valid JSON: ${err.message}`);
  }
}

function mtime(path: string): number | null {
  try {
    return statSync(path).mtimeMs;
  } catch {
    return null;
  }
}

// Temp + rename inside the destination directory, so the swap is atomic on the
// same filesystem. Mode 600 matches what the CLI writes: these files are the
// host user's OAuth tokens and nothing else should read them.
function writeAtomic(file: string, data: unknown): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", { mode: 0o600 });
  renameSync(tmp, file);
}

import { BadRequestException, Injectable } from "@nestjs/common";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname } from "path";
import { config } from "../config";

export interface CredentialsStatus {
  exists: boolean;
  path: string;
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

@Injectable()
export class CredentialsService {
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

function writeAtomic(file: string, data: unknown): void {
  const dir = dirname(file);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const contents = JSON.stringify(data, null, 2) + "\n";
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, contents, { mode: 0o600 });
  try {
    renameSync(tmp, file);
  } catch (err: any) {
    // A single-file bind mount (docker-compose maps ~/.claude.json straight onto
    // /home/app/.claude.json) is a mount point, and the kernel refuses to rename
    // over it. Fall back to rewriting in place, which the mount does allow.
    if (err?.code !== "EBUSY" && err?.code !== "EXDEV" && err?.code !== "EPERM") throw err;
    writeFileSync(file, contents, { mode: 0o600 });
    rmSync(tmp, { force: true });
  }
}

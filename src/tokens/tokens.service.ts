import { BadRequestException, Injectable, Logger, NotFoundException } from "@nestjs/common";
import { createHash, randomBytes, randomUUID } from "crypto";
import { existsSync, readFileSync } from "fs";
import { writeAtomicJson } from "../atomic-write";
import { config } from "../config";

export interface ApiTokenRecord {
  id: string;
  name: string;
  hash: string;
  prefix: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface ApiTokenView {
  id: string;
  name: string;
  prefix: string;
  createdAt: number;
  expiresAt: number | null;
  lastUsedAt: number | null;
  revokedAt: number | null;
  expired: boolean;
  active: boolean;
}

const SECRET_PREFIX = "rc-";
const SECRET_BYTES = 32;
const PREFIX_LENGTH = SECRET_PREFIX.length + 8;
const MAX_NAME_LENGTH = 80;
const LAST_USED_WRITE_INTERVAL_MS = 5 * 60 * 1000;

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function toView(record: ApiTokenRecord, now = Date.now()): ApiTokenView {
  const expired = record.expiresAt !== null && record.expiresAt <= now;
  return {
    id: record.id,
    name: record.name,
    prefix: record.prefix,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    lastUsedAt: record.lastUsedAt,
    revokedAt: record.revokedAt,
    expired,
    active: record.revokedAt === null && !expired,
  };
}

@Injectable()
export class TokensService {
  private readonly logger = new Logger(TokensService.name);
  private readonly byId = new Map<string, ApiTokenRecord>();
  private readonly byHash = new Map<string, ApiTokenRecord>();
  private loaded = false;

  list(): ApiTokenView[] {
    this.load();
    return [...this.byId.values()]
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((r) => toView(r));
  }

  create(input: { name?: unknown; expiresInDays?: unknown }): {
    token: string;
    view: ApiTokenView;
  } {
    this.load();
    const name = normalizeName(input.name);
    const expiresAt = normalizeExpiry(input.expiresInDays);

    const secret = SECRET_PREFIX + randomBytes(SECRET_BYTES).toString("base64url");
    const record: ApiTokenRecord = {
      id: `tok_${randomUUID().replace(/-/g, "")}`,
      name,
      hash: hashSecret(secret),
      prefix: secret.slice(0, PREFIX_LENGTH),
      createdAt: Date.now(),
      expiresAt,
      lastUsedAt: null,
      revokedAt: null,
    };

    this.byId.set(record.id, record);
    this.byHash.set(record.hash, record);
    this.persist();
    this.logger.log(`Created API token ${record.id} (${name})`);
    return { token: secret, view: toView(record) };
  }

  revoke(id: string): ApiTokenView {
    this.load();
    const record = this.byId.get(id);
    if (!record) throw new NotFoundException(`no token with id "${id}"`);
    if (record.revokedAt === null) {
      record.revokedAt = Date.now();
      this.persist();
      this.logger.log(`Revoked API token ${record.id}`);
    }
    return toView(record);
  }

  remove(id: string): { deleted: true; id: string } {
    this.load();
    const record = this.byId.get(id);
    if (!record) throw new NotFoundException(`no token with id "${id}"`);
    this.byId.delete(record.id);
    this.byHash.delete(record.hash);
    this.persist();
    this.logger.log(`Deleted API token ${record.id}`);
    return { deleted: true, id };
  }

  verify(secret: string | null | undefined, now = Date.now()): ApiTokenRecord | null {
    if (!secret) return null;
    this.load();
    const record = this.byHash.get(hashSecret(secret));
    if (!record) return null;
    if (record.revokedAt !== null) return null;
    if (record.expiresAt !== null && record.expiresAt <= now) return null;

    const previous = record.lastUsedAt;
    record.lastUsedAt = now;
    if (previous === null || now - previous > LAST_USED_WRITE_INTERVAL_MS) this.persist();
    return record;
  }

  private load(): void {
    if (this.loaded) return;
    this.loaded = true;
    const path = config.api.tokensPath;
    if (!existsSync(path)) return;

    let parsed: any;
    try {
      parsed = JSON.parse(readFileSync(path, "utf8"));
    } catch (err: any) {
      this.logger.error(`Could not parse ${path} (${err.message}) — starting with no tokens`);
      return;
    }

    const tokens = Array.isArray(parsed?.tokens) ? parsed.tokens : [];
    for (const raw of tokens) {
      const record = reviveRecord(raw);
      if (!record) continue;
      this.byId.set(record.id, record);
      this.byHash.set(record.hash, record);
    }
    this.logger.log(`Loaded ${this.byId.size} API token(s) from ${path}`);
  }

  private persist(): void {
    writeAtomicJson(config.api.tokensPath, { version: 1, tokens: [...this.byId.values()] });
  }

  reset(): void {
    this.byId.clear();
    this.byHash.clear();
    this.loaded = false;
  }
}

function reviveRecord(raw: any): ApiTokenRecord | null {
  if (!raw || typeof raw.id !== "string" || typeof raw.hash !== "string") return null;
  return {
    id: raw.id,
    name: typeof raw.name === "string" ? raw.name : "unnamed",
    hash: raw.hash,
    prefix: typeof raw.prefix === "string" ? raw.prefix : "",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : 0,
    expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : null,
    lastUsedAt: typeof raw.lastUsedAt === "number" ? raw.lastUsedAt : null,
    revokedAt: typeof raw.revokedAt === "number" ? raw.revokedAt : null,
  };
}

function normalizeName(value: unknown): string {
  const name = typeof value === "string" ? value.trim() : "";
  if (!name) throw new BadRequestException("name is required");
  if (name.length > MAX_NAME_LENGTH) {
    throw new BadRequestException(`name must be at most ${MAX_NAME_LENGTH} characters`);
  }
  return name;
}

function normalizeExpiry(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return null;
  const days = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(days) || days <= 0) {
    throw new BadRequestException("expiresInDays must be a positive number of days");
  }
  if (days > 3650) throw new BadRequestException("expiresInDays must be at most 3650");
  return Date.now() + days * 24 * 60 * 60 * 1000;
}

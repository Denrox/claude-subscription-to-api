import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

export const SESSION_COOKIE = "rc_session";

function sign(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function issueSession(secret: string, ttlMs: number, now = Date.now()): string {
  const exp = String(now + ttlMs);
  return `${exp}.${sign(secret, exp)}`;
}

export function verifySession(
  secret: string,
  token: string | undefined | null,
  now = Date.now(),
): number | null {
  if (!token) return null;
  const dot = token.indexOf(".");
  if (dot <= 0) return null;
  const exp = token.slice(0, dot);
  const mac = token.slice(dot + 1);
  if (!/^\d+$/.test(exp)) return null;
  if (!equalStrings(mac, sign(secret, exp))) return null;
  const expMs = Number(exp);
  return expMs > now ? expMs : null;
}

export function equalStrings(a: string, b: string): boolean {
  const ab = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const SCRYPT_KEYLEN = 32;

export function hashPassword(password: string, salt: Uint8Array = randomBytes(16)): string {
  const key = scryptSync(password, salt, SCRYPT_KEYLEN);
  return `scrypt$${Buffer.from(salt).toString("base64")}$${key.toString("base64")}`;
}

export function verifyPassword(
  password: string,
  opts: { password?: string | null; passwordHash?: string | null },
): boolean {
  if (!password) return false;
  if (opts.passwordHash) {
    const parts = opts.passwordHash.split("$");
    if (parts.length !== 3 || parts[0] !== "scrypt") return false;
    let salt: Buffer;
    try {
      salt = Buffer.from(parts[1], "base64");
    } catch {
      return false;
    }
    if (salt.length === 0) return false;
    return equalStrings(hashPassword(password, salt), opts.passwordHash);
  }
  if (opts.password) return equalStrings(password, opts.password);
  return false;
}

export class LoginThrottle {
  private readonly failures = new Map<string, number[]>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
  ) {}

  private recent(key: string, now: number): number[] {
    const times = (this.failures.get(key) ?? []).filter((t) => t > now - this.windowMs);
    if (times.length) this.failures.set(key, times);
    else this.failures.delete(key);
    return times;
  }

  blocked(key: string, now = Date.now()): boolean {
    return this.recent(key, now).length >= this.max;
  }

  recordFailure(key: string, now = Date.now()): void {
    const times = this.recent(key, now);
    times.push(now);
    this.failures.set(key, times);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }
}

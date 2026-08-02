import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../config";
import { TokensService } from "./tokens.service";

let dir: string;
const original = config.api.tokensPath;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "remote-clode-tokens-"));
  config.api.tokensPath = join(dir, "tokens.json");
});

afterEach(() => {
  config.api.tokensPath = original;
  rmSync(dir, { recursive: true, force: true });
});

function service(): TokensService {
  return new TokensService();
}

describe("TokensService", () => {
  it("returns a usable secret and stores only its hash", () => {
    const svc = service();
    const { token, view } = svc.create({ name: "laptop" });

    expect(token.startsWith("rc-")).toBe(true);
    expect(svc.verify(token)?.id).toBe(view.id);

    const onDisk = readFileSync(config.api.tokensPath, "utf8");
    expect(onDisk).not.toContain(token);
    expect(onDisk).not.toContain(token.slice(11));
    expect(statSync(config.api.tokensPath).mode & 0o777).toBe(0o600);
  });

  it("shows a prefix long enough to identify a row but not to guess the secret", () => {
    const { token, view } = service().create({ name: "laptop" });
    expect(token.startsWith(view.prefix)).toBe(true);
    expect(view.prefix.length).toBeLessThan(token.length / 2);
  });

  it("rejects an unknown secret", () => {
    const svc = service();
    svc.create({ name: "laptop" });
    expect(svc.verify("rc-nope")).toBeNull();
    expect(svc.verify("")).toBeNull();
    expect(svc.verify(undefined)).toBeNull();
  });

  it("stops accepting a revoked token", () => {
    const svc = service();
    const { token, view } = svc.create({ name: "laptop" });
    svc.revoke(view.id);

    expect(svc.verify(token)).toBeNull();
    expect(svc.list()[0].active).toBe(false);
    expect(svc.list()[0].revokedAt).not.toBeNull();
  });

  it("stops accepting a token past its expiry", () => {
    const svc = service();
    const { token, view } = svc.create({ name: "laptop", expiresInDays: 1 });
    const past = (view.expiresAt ?? 0) + 1;

    expect(svc.verify(token, past)).toBeNull();
    expect(svc.verify(token, (view.expiresAt ?? 0) - 1000)?.id).toBe(view.id);
  });

  it("records last use", () => {
    const svc = service();
    const { token, view } = svc.create({ name: "laptop" });
    expect(view.lastUsedAt).toBeNull();

    svc.verify(token, 1_700_000_000_000);
    expect(svc.list()[0].lastUsedAt).toBe(1_700_000_000_000);
  });

  it("forgets a deleted token entirely", () => {
    const svc = service();
    const { token, view } = svc.create({ name: "laptop" });
    svc.remove(view.id);

    expect(svc.list()).toHaveLength(0);
    expect(svc.verify(token)).toBeNull();
    expect(() => svc.remove(view.id)).toThrow();
  });

  it("rejects a token request with no name or a silly expiry", () => {
    const svc = service();
    expect(() => svc.create({ name: "  " })).toThrow();
    expect(() => svc.create({ name: "x".repeat(200) })).toThrow();
    expect(() => svc.create({ name: "ok", expiresInDays: 0 })).toThrow();
    expect(() => svc.create({ name: "ok", expiresInDays: "soon" })).toThrow();
  });

  it("survives a restart", () => {
    const first = service();
    const { token } = first.create({ name: "laptop" });

    const second = service();
    expect(second.verify(token)).not.toBeNull();
    expect(second.list()).toHaveLength(1);
  });

  it("rejects everything when the store is broken", () => {
    writeFileSync(config.api.tokensPath, "{ not json");
    const svc = service();
    expect(svc.list()).toEqual([]);
    expect(svc.verify("rc-anything")).toBeNull();
  });
});

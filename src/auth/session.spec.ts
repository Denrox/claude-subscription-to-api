import { describe, expect, it } from "vitest";
import {
  hashPassword,
  issueSession,
  LoginThrottle,
  verifyPassword,
  verifySession,
} from "./session";

const SECRET = "test-secret";

describe("session tokens", () => {
  it("round-trips an issued token", () => {
    const now = 1_000_000;
    const token = issueSession(SECRET, 60_000, now);
    expect(verifySession(SECRET, token, now + 1000)).toBe(now + 60_000);
  });

  it("rejects an expired token", () => {
    const now = 1_000_000;
    const token = issueSession(SECRET, 60_000, now);
    expect(verifySession(SECRET, token, now + 60_001)).toBeNull();
  });

  it("rejects a token signed with another secret", () => {
    const token = issueSession("other", 60_000, 0);
    expect(verifySession(SECRET, token, 1)).toBeNull();
  });

  it("rejects a token whose expiry was tampered with", () => {
    const token = issueSession(SECRET, 60_000, 0);
    const forged = `${9_999_999_999_999}.${token.split(".")[1]}`;
    expect(verifySession(SECRET, forged, 1)).toBeNull();
  });

  it("rejects missing and malformed tokens", () => {
    for (const bad of [undefined, null, "", "nodot", ".sig", "abc.sig"]) {
      expect(verifySession(SECRET, bad as any, 1)).toBeNull();
    }
  });
});

describe("passwords", () => {
  it("verifies a plaintext password", () => {
    expect(verifyPassword("hunter2", { password: "hunter2" })).toBe(true);
    expect(verifyPassword("hunter3", { password: "hunter2" })).toBe(false);
  });

  it("verifies a scrypt hash", () => {
    const hash = hashPassword("hunter2");
    expect(verifyPassword("hunter2", { passwordHash: hash })).toBe(true);
    expect(verifyPassword("hunter2 ", { passwordHash: hash })).toBe(false);
  });

  it("prefers the hash when both are configured", () => {
    const hash = hashPassword("from-hash");
    expect(verifyPassword("from-plain", { password: "from-plain", passwordHash: hash })).toBe(false);
    expect(verifyPassword("from-hash", { password: "from-plain", passwordHash: hash })).toBe(true);
  });

  it("rejects an empty password and a malformed hash", () => {
    expect(verifyPassword("", { password: "" })).toBe(false);
    expect(verifyPassword("x", { passwordHash: "bcrypt$a$b" })).toBe(false);
    expect(verifyPassword("x", { passwordHash: "scrypt$only-two" })).toBe(false);
  });
});

describe("login throttle", () => {
  it("blocks after max failures and forgets them after the window", () => {
    const t = new LoginThrottle(3, 1000);
    for (let i = 0; i < 3; i++) t.recordFailure("ip", 100);
    expect(t.blocked("ip", 200)).toBe(true);
    expect(t.blocked("ip", 1200)).toBe(false);
  });

  it("clears on a successful login", () => {
    const t = new LoginThrottle(1, 1000);
    t.recordFailure("ip", 100);
    expect(t.blocked("ip", 100)).toBe(true);
    t.reset("ip");
    expect(t.blocked("ip", 100)).toBe(false);
  });

  it("tracks clients independently", () => {
    const t = new LoginThrottle(1, 1000);
    t.recordFailure("a", 100);
    expect(t.blocked("b", 100)).toBe(false);
  });
});

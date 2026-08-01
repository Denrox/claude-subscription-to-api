import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { config } from "../config";
import { CredentialsService } from "./credentials.service";

// The service reads its paths from the shared config object; point them at a
// throwaway dir so the tests never touch a real ~/.claude.
let dir: string;
const original = { credentials: config.paths.credentials, cliConfig: config.paths.cliConfig };

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "remote-clode-test-"));
  config.paths.credentials = join(dir, ".claude", ".credentials.json");
  config.paths.cliConfig = join(dir, ".claude.json");
});

afterEach(() => {
  config.paths.credentials = original.credentials;
  config.paths.cliConfig = original.cliConfig;
  rmSync(dir, { recursive: true, force: true });
});

const VALID = {
  claudeAiOauth: {
    accessToken: "sk-ant-oat01-abc",
    refreshToken: "sk-ant-ort01-def",
    expiresAt: 4_000_000_000_000,
    scopes: ["user:inference", "user:profile"],
    subscriptionType: "max",
  },
};

describe("credentials", () => {
  it("reports absence before anything is uploaded", () => {
    const s = new CredentialsService().readCredentialsStatus();
    expect(s.exists).toBe(false);
    expect(s.hasTokens).toBeNull();
  });

  it("writes the file (creating ~/.claude) and reports metadata without tokens", () => {
    const svc = new CredentialsService();
    const status = svc.writeCredentials(VALID);
    expect(status.exists).toBe(true);
    expect(status.hasTokens).toBe(true);
    expect(status.hasRefreshToken).toBe(true);
    expect(status.expired).toBe(false);
    expect(status.subscriptionType).toBe("max");
    expect(JSON.stringify(status)).not.toContain("sk-ant-");

    const onDisk = JSON.parse(readFileSync(config.paths.credentials, "utf8"));
    expect(onDisk).toEqual(VALID);
    expect(statSync(config.paths.credentials).mode & 0o777).toBe(0o600);
  });

  it("accepts a raw JSON string body", () => {
    const status = new CredentialsService().writeCredentials(JSON.stringify(VALID));
    expect(status.hasTokens).toBe(true);
  });

  it("flags an expired token", () => {
    const svc = new CredentialsService();
    svc.writeCredentials({ claudeAiOauth: { ...VALID.claudeAiOauth, expiresAt: 1000 } });
    expect(svc.readCredentialsStatus().expired).toBe(true);
  });

  it("detects blanked tokens, which never self-heal", () => {
    const svc = new CredentialsService();
    svc.writeCredentials(VALID);
    writeFileSync(
      config.paths.credentials,
      JSON.stringify({ claudeAiOauth: { ...VALID.claudeAiOauth, accessToken: "" } }),
    );
    expect(svc.readCredentialsStatus().hasTokens).toBe(false);
  });

  it("rejects bad JSON and wrong shapes without touching disk", () => {
    const svc = new CredentialsService();
    expect(() => svc.writeCredentials("{nope")).toThrow(/valid JSON/);
    expect(() => svc.writeCredentials({ hasCompletedOnboarding: true })).toThrow(/claudeAiOauth/);
    expect(() => svc.writeCredentials({ claudeAiOauth: { accessToken: "  " } })).toThrow(
      /accessToken/,
    );
    expect(() => svc.writeCredentials({ claudeAiOauth: { accessToken: "a", expiresAt: "soon" } })).toThrow(
      /expiresAt/,
    );
    expect(svc.readCredentialsStatus().exists).toBe(false);
  });

  it("reports a corrupt file as present but opaque", () => {
    const svc = new CredentialsService();
    svc.writeCredentials(VALID);
    writeFileSync(config.paths.credentials, "{ truncated");
    const s = svc.readCredentialsStatus();
    expect(s.exists).toBe(true);
    expect(s.hasTokens).toBeNull();
  });
});

describe("cli config", () => {
  it("round-trips ~/.claude.json and surfaces the account", () => {
    const svc = new CredentialsService();
    const status = svc.writeCliConfig({
      hasCompletedOnboarding: true,
      oauthAccount: { emailAddress: "you@example.com" },
      projects: {},
    });
    expect(status.exists).toBe(true);
    expect(status.hasCompletedOnboarding).toBe(true);
    expect(status.account).toBe("you@example.com");
  });

  it("rejects non-objects", () => {
    const svc = new CredentialsService();
    expect(() => svc.writeCliConfig("[1,2]")).toThrow(/JSON object/);
    expect(() => svc.writeCliConfig("nope")).toThrow(/valid JSON/);
  });
});

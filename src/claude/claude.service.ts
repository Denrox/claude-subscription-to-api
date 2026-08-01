import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { config } from "../config";

// Spawns the Claude CLI. The container never mints or refreshes tokens itself:
// the CLI owns ~/.claude/.credentials.json and rotates the refresh token on
// every run, so a second refresher racing it is exactly what produces the
// blanked-token state that never self-heals. We just make the CLI run, and let
// it refresh itself.
@Injectable()
export class ClaudeService {
  private readonly logger = new Logger(ClaudeService.name);

  // Minimal throwaway run whose only purpose is the side effect: the CLI
  // refreshes its credentials from the stored refresh token when the access
  // token is near expiry. Cost is one haiku "hi" per tick.
  async ping(): Promise<{ output: string; durationMs: number }> {
    const started = Date.now();
    const output = await this.run("hi", config.claude.refreshModel);
    return { output, durationMs: Date.now() - started };
  }

  async version(): Promise<string | null> {
    try {
      return (await this.run("--version", null, { rawArgs: true })).trim();
    } catch (err: any) {
      this.logger.warn(`claude --version failed: ${err.message}`);
      return null;
    }
  }

  // `--dangerously-skip-permissions` keeps a headless run from blocking forever
  // on a permission prompt. CLAUDECODE is stripped from the env so the CLI does
  // not think it is nested inside another Claude Code session.
  private run(
    prompt: string,
    model: string | null,
    opts: { rawArgs?: boolean } = {},
  ): Promise<string> {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    const args = opts.rawArgs
      ? [prompt]
      : ["-p", prompt, "--dangerously-skip-permissions", ...(model ? ["--model", model] : [])];

    if (!existsSync(config.paths.scratch)) {
      mkdirSync(config.paths.scratch, { recursive: true });
    }

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(config.claude.bin, args, {
        env,
        cwd: config.paths.scratch,
        stdio: ["pipe", "pipe", "pipe"],
      });
      let stdout = "";
      let stderr = "";
      let timedOut = false;
      proc.stdout.on("data", (d) => (stdout += d));
      proc.stderr.on("data", (d) => (stderr += d));
      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill();
      }, config.claude.timeoutMs);
      proc.on("error", (err: any) => {
        clearTimeout(timer);
        reject(
          err.code === "ENOENT"
            ? new Error(
                `claude CLI not found at "${config.claude.bin}" — check the CLAUDE_BIN mount`,
              )
            : err,
        );
      });
      proc.on("close", (code) => {
        clearTimeout(timer);
        if (timedOut) {
          reject(new Error(`claude timed out after ${config.claude.timeoutMs / 1000}s`));
        } else if (code !== 0) {
          reject(new Error(stderr.trim() || `claude exited with code ${code}`));
        } else {
          resolve(stdout.trim());
        }
      });
      proc.stdin.end();
    });
  }
}

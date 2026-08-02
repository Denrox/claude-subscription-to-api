import { Injectable, Logger } from "@nestjs/common";
import { spawn } from "child_process";
import { existsSync, mkdirSync } from "fs";
import { config } from "../config";
import { AnthropicApiException, AnthropicErrorType } from "./api-error";
import {
  AnthropicMessage,
  AnthropicUsage,
  NormalizedRequest,
  buildMessage,
  emptyUsage,
  newId,
  usageFromCli,
} from "./anthropic";

export type StreamEmit = (event: string, data: unknown) => void;

interface CliOutcome {
  text: string;
  usage: AnthropicUsage;
}

const UPSTREAM_STATUS_TO_ERROR: Record<number, AnthropicErrorType> = {
  400: "invalid_request_error",
  401: "authentication_error",
  403: "permission_error",
  404: "not_found_error",
  413: "request_too_large",
  429: "rate_limit_error",
  529: "overloaded_error",
};

export function cliFailure(line: any): AnthropicApiException | null {
  if (!line || typeof line !== "object") return null;
  if (line.is_error !== true && (!line.subtype || line.subtype === "success")) return null;
  const message =
    typeof line.result === "string" && line.result
      ? line.result
      : `claude reported ${line.subtype ?? "an error"}`;
  return new AnthropicApiException(
    UPSTREAM_STATUS_TO_ERROR[line.api_error_status] ?? "api_error",
    message,
  );
}

function lastJsonObject(text: string): any {
  const candidates = [text, ...text.trim().split("\n").reverse()];
  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed.startsWith("{")) continue;
    try {
      return JSON.parse(trimmed);
    } catch {
      continue;
    }
  }
  return null;
}

@Injectable()
export class MessagesService {
  private readonly logger = new Logger(MessagesService.name);
  private inFlight = 0;
  private partialSupport: Promise<boolean> | null = null;

  async createMessage(request: NormalizedRequest): Promise<AnthropicMessage> {
    return this.withSlot(async () => {
      const raw = await this.runJson(request);
      return buildMessage({
        id: newId("msg"),
        model: request.model,
        text: raw.text,
        usage: raw.usage,
      });
    });
  }

  async streamMessage(
    request: NormalizedRequest,
    emit: StreamEmit,
    signal: AbortSignal,
  ): Promise<void> {
    return this.withSlot(async () => {
      const id = newId("msg");
      const partials = await this.supportsPartialMessages();

      emit("message_start", {
        type: "message_start",
        message: {
          id,
          type: "message",
          role: "assistant",
          model: request.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: emptyUsage(),
        },
      });
      emit("content_block_start", {
        type: "content_block_start",
        index: 0,
        content_block: { type: "text", text: "" },
      });

      let streamed = "";
      let sawPartialDelta = false;
      let resultText = "";
      let usage = emptyUsage();

      const pushText = (text: string) => {
        if (!text) return;
        streamed += text;
        emit("content_block_delta", {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text },
        });
      };

      await this.runStream(request, partials, signal, (line) => {
        if (line.type === "stream_event") {
          const event = line.event;
          if (event?.type === "content_block_delta" && event.delta?.type === "text_delta") {
            sawPartialDelta = true;
            pushText(String(event.delta.text ?? ""));
          }
          return;
        }
        if (line.type === "assistant" && !sawPartialDelta) {
          for (const block of line.message?.content ?? []) {
            if (block?.type === "text" && typeof block.text === "string") pushText(block.text);
          }
          return;
        }
        if (line.type === "result") {
          usage = usageFromCli(line.usage);
          if (typeof line.result === "string") resultText = line.result;
          const failure = cliFailure(line);
          if (failure) throw failure;
        }
      });

      if (!streamed && resultText) pushText(resultText);

      emit("content_block_stop", { type: "content_block_stop", index: 0 });
      emit("message_delta", {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage,
      });
      emit("message_stop", { type: "message_stop" });
    });
  }

  private async withSlot<T>(run: () => Promise<T>): Promise<T> {
    if (this.inFlight >= config.api.maxConcurrent) {
      throw new AnthropicApiException(
        "rate_limit_error",
        `too many requests at the same time (limit ${config.api.maxConcurrent}), try again soon`,
      );
    }
    this.inFlight += 1;
    try {
      return await run();
    } finally {
      this.inFlight -= 1;
    }
  }

  concurrency(): { inFlight: number; limit: number } {
    return { inFlight: this.inFlight, limit: config.api.maxConcurrent };
  }

  private async runJson(request: NormalizedRequest): Promise<CliOutcome> {
    const args = this.buildArgs(request, "json", false);
    const stdout = await this.spawnCli(args, request.prompt, null);

    let parsed: any;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new AnthropicApiException(
        "api_error",
        `claude returned something that is not JSON: ${stdout.slice(0, 500)}`,
      );
    }
    const failure = cliFailure(parsed);
    if (failure) throw failure;
    return {
      text: typeof parsed?.result === "string" ? parsed.result : "",
      usage: usageFromCli(parsed?.usage),
    };
  }

  private async runStream(
    request: NormalizedRequest,
    partials: boolean,
    signal: AbortSignal,
    onLine: (line: any) => void,
  ): Promise<void> {
    const args = this.buildArgs(request, "stream-json", partials);
    let buffer = "";
    const consume = (chunk: string, flush = false) => {
      buffer += chunk;
      const lines = buffer.split("\n");
      if (!flush) buffer = lines.pop() ?? "";
      else buffer = "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          onLine(JSON.parse(trimmed));
        } catch (err) {
          if (err instanceof AnthropicApiException) throw err;
          this.logger.warn(`Stream line could not be parsed, skipping it: ${trimmed.slice(0, 200)}`);
        }
      }
    };
    await this.spawnCli(args, request.prompt, signal, (chunk) => consume(chunk));
    consume("", true);
  }

  private buildArgs(request: NormalizedRequest, format: string, partials: boolean): string[] {
    const args = ["-p", "--output-format", format, "--no-session-persistence"];
    if (format === "stream-json") {
      args.push("--verbose");
      if (partials) args.push("--include-partial-messages");
    }
    args.push("--model", request.model);
    if (request.system) {
      args.push(
        config.api.systemPromptMode === "append" ? "--append-system-prompt" : "--system-prompt",
        request.system,
      );
    }
    if (config.api.allowTools) args.push("--dangerously-skip-permissions");
    else args.push("--tools", "");
    return args;
  }

  private supportsPartialMessages(): Promise<boolean> {
    if (!config.api.partialMessages) return Promise.resolve(false);
    if (!this.partialSupport) {
      this.partialSupport = this.spawnCli(["--help"], null, null)
        .then((help) => help.includes("--include-partial-messages"))
        .catch((err) => {
          this.logger.warn(`Could not read claude --help (${err.message}), so streaming goes turn by turn`);
          return false;
        });
    }
    return this.partialSupport;
  }

  private spawnCli(
    args: string[],
    stdin: string | null,
    signal: AbortSignal | null,
    onStdout?: (chunk: string) => void,
  ): Promise<string> {
    const env = { ...process.env };
    delete env.CLAUDECODE;

    if (!existsSync(config.api.workDir)) mkdirSync(config.api.workDir, { recursive: true });

    return new Promise<string>((resolve, reject) => {
      const proc = spawn(config.claude.bin, args, {
        env,
        cwd: config.api.workDir,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let stdout = "";
      let stderr = "";
      let timedOut = false;
      let aborted = false;
      let failure: Error | null = null;

      const timer = setTimeout(() => {
        timedOut = true;
        proc.kill("SIGTERM");
      }, config.api.timeoutMs);

      const onAbort = () => {
        aborted = true;
        proc.kill("SIGTERM");
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      const cleanup = () => {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
      };

      proc.stdout.setEncoding("utf8");
      proc.stdout.on("data", (chunk: string) => {
        if (onStdout) {
          try {
            onStdout(chunk);
          } catch (err: any) {
            failure = err;
            proc.kill("SIGTERM");
          }
        } else {
          stdout += chunk;
        }
      });
      proc.stderr.setEncoding("utf8");
      proc.stderr.on("data", (chunk: string) => (stderr += chunk));

      proc.on("error", (err: any) => {
        cleanup();
        reject(
          err.code === "ENOENT"
            ? new AnthropicApiException(
                "api_error",
                `claude CLI not found at "${config.claude.bin}", check the CLAUDE_BIN mount`,
              )
            : new AnthropicApiException("api_error", err.message),
        );
      });

      proc.on("close", (code) => {
        cleanup();
        if (failure) return reject(failure);
        if (aborted) return resolve(stdout);
        if (timedOut) {
          return reject(
            new AnthropicApiException(
              "overloaded_error",
              `claude timed out after ${Math.round(config.api.timeoutMs / 1000)}s`,
            ),
          );
        }
        if (code !== 0) {
          const reported = cliFailure(lastJsonObject(stdout));
          if (reported) return reject(reported);
          const detail = stderr.trim() || stdout.trim() || `claude exited with code ${code}`;
          return reject(new AnthropicApiException("api_error", detail));
        }
        resolve(stdout);
      });

      if (stdin !== null) proc.stdin.end(stdin);
      else proc.stdin.end();
    });
  }
}

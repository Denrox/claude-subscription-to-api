import { randomBytes } from "crypto";
import { invalidRequest } from "./api-error";

export interface AnthropicUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
}

export interface AnthropicMessage {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: { type: "text"; text: string }[];
  stop_reason: "end_turn" | "max_tokens" | "stop_sequence" | "tool_use";
  stop_sequence: string | null;
  usage: AnthropicUsage;
}

export interface NormalizedRequest {
  model: string;
  maxTokens: number;
  system: string | null;
  prompt: string;
  stream: boolean;
}

const MAX_ID_BYTES = 12;

export function newId(prefix: string): string {
  return `${prefix}_${randomBytes(MAX_ID_BYTES).toString("hex")}`;
}

export function emptyUsage(): AnthropicUsage {
  return {
    input_tokens: 0,
    output_tokens: 0,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
  };
}

export function normalizeRequest(body: any): NormalizedRequest {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw invalidRequest("request body must be a JSON object");
  }

  if (typeof body.model !== "string" || !body.model.trim()) {
    throw invalidRequest("model: field required");
  }
  if (typeof body.max_tokens !== "number" || !Number.isInteger(body.max_tokens) || body.max_tokens < 1) {
    throw invalidRequest("max_tokens: must be a positive integer");
  }
  if (body.tools !== undefined || body.tool_choice !== undefined) {
    throw invalidRequest(
      "this proxy does not support tools, because the CLI has its own tools",
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    throw invalidRequest("messages: must be a non-empty array");
  }
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw invalidRequest("stream: must be a boolean");
  }

  const turns = body.messages.map((message: any, index: number) => {
    if (!message || typeof message !== "object") {
      throw invalidRequest(`messages.${index}: must be an object`);
    }
    if (message.role !== "user" && message.role !== "assistant") {
      throw invalidRequest(`messages.${index}.role: must be "user" or "assistant"`);
    }
    return { role: message.role as "user" | "assistant", text: contentToText(message.content, `messages.${index}`) };
  });

  if (!turns.some((t: { role: string; text: string }) => t.role === "user" && t.text.trim())) {
    throw invalidRequest("messages: at least one user message with text is required");
  }

  return {
    model: body.model.trim(),
    maxTokens: body.max_tokens,
    system: systemToText(body.system),
    prompt: flattenMessages(turns),
    stream: body.stream === true,
  };
}

export function contentToText(content: unknown, path: string): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    throw invalidRequest(`${path}.content: must be a string or an array of text blocks`);
  }
  const parts: string[] = [];
  content.forEach((block: any, index: number) => {
    if (!block || typeof block !== "object") {
      throw invalidRequest(`${path}.content.${index}: must be a content block object`);
    }
    if (block.type !== "text" || typeof block.text !== "string") {
      throw invalidRequest(
        `${path}.content.${index}: this proxy supports only "text" blocks (got "${block.type}")`,
      );
    }
    parts.push(block.text);
  });
  return parts.join("\n");
}

export function systemToText(system: unknown): string | null {
  if (system === undefined || system === null) return null;
  if (typeof system === "string") return system.trim() ? system : null;
  const text = contentToText(system, "system");
  return text.trim() ? text : null;
}

export function flattenMessages(turns: { role: "user" | "assistant"; text: string }[]): string {
  if (turns.length === 1) return turns[0].text;
  const transcript = turns
    .map((turn) => `${turn.role === "user" ? "Human" : "Assistant"}: ${turn.text}`)
    .join("\n\n");
  return [
    "Continue the conversation below. Answer with your next assistant message only.",
    "Do not repeat or summarise the transcript.",
    "",
    transcript,
  ].join("\n");
}

export function usageFromCli(raw: any): AnthropicUsage {
  const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
  return {
    input_tokens: num(raw?.input_tokens),
    output_tokens: num(raw?.output_tokens),
    cache_creation_input_tokens: num(raw?.cache_creation_input_tokens),
    cache_read_input_tokens: num(raw?.cache_read_input_tokens),
  };
}

export function buildMessage(opts: {
  id: string;
  model: string;
  text: string;
  usage: AnthropicUsage;
}): AnthropicMessage {
  return {
    id: opts.id,
    type: "message",
    role: "assistant",
    model: opts.model,
    content: opts.text ? [{ type: "text", text: opts.text }] : [],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: opts.usage,
  };
}

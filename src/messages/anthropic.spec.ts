import { describe, expect, it } from "vitest";
import { AnthropicApiException } from "./api-error";
import { buildMessage, emptyUsage, normalizeRequest, usageFromCli } from "./anthropic";

const base = { model: "claude-opus-5", max_tokens: 1024 };

function reject(body: unknown): AnthropicApiException {
  try {
    normalizeRequest(body);
  } catch (err) {
    return err as AnthropicApiException;
  }
  throw new Error("expected normalizeRequest to throw");
}

describe("normalizeRequest", () => {
  it("passes a single user turn through without changes", () => {
    const req = normalizeRequest({
      ...base,
      messages: [{ role: "user", content: "hello" }],
    });
    expect(req.prompt).toBe("hello");
    expect(req.model).toBe("claude-opus-5");
    expect(req.stream).toBe(false);
    expect(req.system).toBeNull();
  });

  it("joins the text blocks inside one message", () => {
    const req = normalizeRequest({
      ...base,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "one" },
            { type: "text", text: "two" },
          ],
        },
      ],
    });
    expect(req.prompt).toBe("one\ntwo");
  });

  it("turns a multi-turn history into a labelled transcript", () => {
    const req = normalizeRequest({
      ...base,
      messages: [
        { role: "user", content: "What is 2 + 2?" },
        { role: "assistant", content: "4" },
        { role: "user", content: "And times ten?" },
      ],
    });
    expect(req.prompt).toContain("Human: What is 2 + 2?");
    expect(req.prompt).toContain("Assistant: 4");
    expect(req.prompt).toContain("Human: And times ten?");
    expect(req.prompt.indexOf("Human: What is 2 + 2?")).toBeLessThan(
      req.prompt.indexOf("Human: And times ten?"),
    );
  });

  it("accepts system as a string or as text blocks", () => {
    expect(
      normalizeRequest({ ...base, system: "be terse", messages: [{ role: "user", content: "hi" }] })
        .system,
    ).toBe("be terse");
    expect(
      normalizeRequest({
        ...base,
        system: [{ type: "text", text: "be terse" }],
        messages: [{ role: "user", content: "hi" }],
      }).system,
    ).toBe("be terse");
    expect(
      normalizeRequest({ ...base, system: "   ", messages: [{ role: "user", content: "hi" }] })
        .system,
    ).toBeNull();
  });

  it("reports missing required fields the same way the real API does", () => {
    expect(reject({ max_tokens: 1, messages: [] }).errorType).toBe("invalid_request_error");
    expect(reject({ ...base, messages: [] }).getStatus()).toBe(400);
    expect(reject({ model: "m", messages: [{ role: "user", content: "hi" }] }).message).toContain(
      "max_tokens",
    );
    expect(reject({ ...base, max_tokens: 0, messages: [] }).message).toContain("max_tokens");
    expect(reject(null).message).toContain("JSON object");
  });

  it("refuses the content this proxy cannot send further", () => {
    const image = reject({
      ...base,
      messages: [
        {
          role: "user",
          content: [{ type: "image", source: { type: "base64", data: "…" } }],
        },
      ],
    });
    expect(image.message).toContain("only \"text\" blocks");

    expect(reject({ ...base, tools: [{ name: "x" }], messages: [] }).message).toContain("tools");
    expect(
      reject({ ...base, messages: [{ role: "system", content: "hi" }] }).message,
    ).toContain("role");
    expect(
      reject({ ...base, messages: [{ role: "assistant", content: "hi" }] }).message,
    ).toContain("user message");
  });

  it("respects the stream flag", () => {
    expect(
      normalizeRequest({ ...base, stream: true, messages: [{ role: "user", content: "hi" }] })
        .stream,
    ).toBe(true);
    expect(
      reject({ ...base, stream: "yes", messages: [{ role: "user", content: "hi" }] }).message,
    ).toContain("stream");
  });
});

describe("usageFromCli", () => {
  it("defaults every counter to zero", () => {
    expect(usageFromCli(undefined)).toEqual(emptyUsage());
    expect(usageFromCli({ input_tokens: "12" })).toEqual(emptyUsage());
  });

  it("copies the counters that the CLI reports", () => {
    expect(
      usageFromCli({
        input_tokens: 12,
        output_tokens: 34,
        cache_creation_input_tokens: 5,
        cache_read_input_tokens: 6,
      }),
    ).toEqual({
      input_tokens: 12,
      output_tokens: 34,
      cache_creation_input_tokens: 5,
      cache_read_input_tokens: 6,
    });
  });
});

describe("buildMessage", () => {
  it("produces a Messages API response", () => {
    const message = buildMessage({
      id: "msg_1",
      model: "claude-opus-5",
      text: "hi",
      usage: emptyUsage(),
    });
    expect(message).toMatchObject({
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-opus-5",
      content: [{ type: "text", text: "hi" }],
      stop_reason: "end_turn",
      stop_sequence: null,
    });
  });

  it("leaves out the content block when the CLI said nothing", () => {
    const message = buildMessage({ id: "msg_1", model: "m", text: "", usage: emptyUsage() });
    expect(message.content).toEqual([]);
  });
});

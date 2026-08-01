import { describe, expect, it } from "vitest";
import { cliFailure } from "./messages.service";

describe("cliFailure", () => {
  it("ignores a successful run", () => {
    expect(cliFailure({ type: "result", subtype: "success", result: "hello" })).toBeNull();
    expect(cliFailure(null)).toBeNull();
    expect(cliFailure("nonsense")).toBeNull();
  });

  it("surfaces the CLI's own message rather than its raw JSON", () => {
    const failure = cliFailure({
      is_error: true,
      subtype: "success",
      api_error_status: 404,
      result: "There's an issue with the selected model (not-a-model).",
    });
    expect(failure?.message).toBe("There's an issue with the selected model (not-a-model).");
  });

  it("maps the upstream status onto the matching Anthropic error type", () => {
    expect(cliFailure({ is_error: true, api_error_status: 404 })?.errorType).toBe(
      "not_found_error",
    );
    expect(cliFailure({ is_error: true, api_error_status: 429 })?.getStatus()).toBe(429);
    expect(cliFailure({ is_error: true, api_error_status: 401 })?.errorType).toBe(
      "authentication_error",
    );
  });

  it("falls back to api_error when the CLI reports no upstream status", () => {
    const failure = cliFailure({ is_error: true, subtype: "error_during_execution" });
    expect(failure?.errorType).toBe("api_error");
    expect(failure?.getStatus()).toBe(500);
    expect(failure?.message).toContain("error_during_execution");
  });

  it("treats a non-success subtype as a failure even without is_error", () => {
    expect(cliFailure({ subtype: "error_max_turns" })?.errorType).toBe("api_error");
  });
});

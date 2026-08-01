import { config } from "../config";

const errorSchema = {
  type: "object",
  required: ["type", "error"],
  properties: {
    type: { type: "string", enum: ["error"] },
    error: {
      type: "object",
      required: ["type", "message"],
      properties: {
        type: {
          type: "string",
          enum: [
            "invalid_request_error",
            "authentication_error",
            "permission_error",
            "not_found_error",
            "request_too_large",
            "rate_limit_error",
            "api_error",
            "overloaded_error",
          ],
        },
        message: { type: "string" },
      },
    },
    request_id: { type: ["string", "null"] },
  },
} as const;

const errorResponse = (description: string) => ({
  description,
  content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } },
});

export function openapiDocument(): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "remote-clode API",
      version: "0.1.0",
      description: [
        "Two surfaces on one port.",
        "",
        "`/v1/*` is an Anthropic-shaped proxy in front of this host's Claude CLI. A request",
        "signed with a remote-clode API token is turned into a `claude -p` run and the CLI's",
        "answer is returned in the Messages API response shape, so an Anthropic SDK pointed at",
        "this base URL works unchanged for plain text conversations.",
        "",
        "`/api/*` is the management surface used by the web UI and requires the login session",
        "cookie. API tokens are created there and never work against `/api/*` themselves.",
        "",
        "**Differences from the real Claude API**",
        "",
        "- Only `text` content blocks are accepted; images and documents are rejected.",
        "- `tools` and `tool_choice` are rejected — the CLI owns its own tool set.",
        "- `max_tokens` is validated but not enforced; the CLI decides how long to run.",
        "- `temperature`, `top_p`, `top_k`, `stop_sequences`, `thinking` and `metadata` are ignored.",
        "- A multi-turn `messages` array is flattened into a single labelled transcript prompt,",
        "  because the CLI takes one prompt rather than a conversation.",
        "- Streaming emits one text content block; usage arrives on `message_delta`.",
        "- `POST /v1/messages/count_tokens` and the Batches, Files and Models capability",
        "  endpoints are not implemented.",
      ].join("\n"),
    },
    servers: [{ url: "/", description: "this host" }],
    tags: [
      { name: "Messages", description: "Anthropic-shaped proxy to the Claude CLI" },
      { name: "Tokens", description: "API token management (session cookie)" },
      { name: "Claude", description: "Credential and keep-alive management (session cookie)" },
    ],
    paths: {
      "/v1/messages": {
        post: {
          tags: ["Messages"],
          summary: "Create a message",
          description:
            "Runs the prompt through the host's Claude CLI and returns the result as a Messages API response. Set `stream: true` for a Server-Sent Events stream.",
          operationId: "createMessage",
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "anthropic-version",
              in: "header",
              required: false,
              schema: { type: "string", example: "2023-06-01" },
              description: "Accepted for SDK compatibility and ignored.",
            },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: { $ref: "#/components/schemas/MessageCreateParams" },
                examples: {
                  simple: {
                    summary: "Single turn",
                    value: {
                      model: config.api.models[0] ?? "claude-opus-5",
                      max_tokens: 1024,
                      messages: [{ role: "user", content: "Say hello in one sentence." }],
                    },
                  },
                  withSystem: {
                    summary: "System prompt and multi-turn history",
                    value: {
                      model: config.api.models[0] ?? "claude-opus-5",
                      max_tokens: 1024,
                      system: "You are a terse assistant.",
                      messages: [
                        { role: "user", content: "What is 2 + 2?" },
                        { role: "assistant", content: "4" },
                        { role: "user", content: "And times ten?" },
                      ],
                    },
                  },
                  streaming: {
                    summary: "Streaming",
                    value: {
                      model: config.api.models[0] ?? "claude-opus-5",
                      max_tokens: 1024,
                      stream: true,
                      messages: [{ role: "user", content: "Count to five." }],
                    },
                  },
                },
              },
            },
          },
          responses: {
            "200": {
              description:
                "A completed message, or an SSE stream of `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta` and `message_stop` events when `stream` is true.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Message" } },
                "text/event-stream": { schema: { type: "string" } },
              },
            },
            "400": errorResponse("Malformed or unsupported request"),
            "401": errorResponse("Missing, unknown, revoked or expired API token"),
            "429": errorResponse("Too many concurrent CLI runs"),
            "500": errorResponse("The CLI failed"),
            "529": errorResponse("The CLI timed out"),
          },
        },
      },
      "/v1/models": {
        get: {
          tags: ["Messages"],
          summary: "List the models this host will pass to the CLI",
          operationId: "listModels",
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          responses: {
            "200": {
              description: "Model list",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ModelList" } } },
            },
            "401": errorResponse("Missing or invalid API token"),
          },
        },
      },
      "/api/tokens": {
        get: {
          tags: ["Tokens"],
          summary: "List API tokens",
          operationId: "listTokens",
          security: [{ sessionCookie: [] }],
          responses: {
            "200": {
              description: "Token metadata. Secrets are never returned.",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      tokens: { type: "array", items: { $ref: "#/components/schemas/ApiToken" } },
                    },
                  },
                },
              },
            },
            "401": { description: "No session cookie" },
          },
        },
        post: {
          tags: ["Tokens"],
          summary: "Create an API token",
          description: "The plaintext token is returned once and cannot be retrieved again.",
          operationId: "createToken",
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: {
                    name: { type: "string", maxLength: 80, example: "laptop" },
                    expiresInDays: {
                      type: ["number", "null"],
                      minimum: 1,
                      maximum: 3650,
                      description: "Omit for a token that never expires.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "The created token, including its one-time secret",
              content: {
                "application/json": {
                  schema: {
                    allOf: [
                      { $ref: "#/components/schemas/ApiToken" },
                      {
                        type: "object",
                        required: ["token"],
                        properties: {
                          token: { type: "string", example: "rc-3Yk8…" },
                        },
                      },
                    ],
                  },
                },
              },
            },
            "400": { description: "Invalid name or expiry" },
            "401": { description: "No session cookie" },
          },
        },
      },
      "/api/tokens/{id}/revoke": {
        post: {
          tags: ["Tokens"],
          summary: "Revoke an API token",
          operationId: "revokeToken",
          security: [{ sessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": {
              description: "The revoked token",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ApiToken" } } },
            },
            "404": { description: "No such token" },
          },
        },
      },
      "/api/tokens/{id}": {
        delete: {
          tags: ["Tokens"],
          summary: "Delete an API token permanently",
          operationId: "deleteToken",
          security: [{ sessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Deleted" },
            "404": { description: "No such token" },
          },
        },
      },
      "/api/claude/status": {
        get: {
          tags: ["Claude"],
          summary: "Credential, CLI config and keep-alive status",
          operationId: "claudeStatus",
          security: [{ sessionCookie: [] }],
          responses: { "200": { description: "Status payload rendered by the dashboard" } },
        },
      },
      "/api/claude/credentials": {
        put: {
          tags: ["Claude"],
          summary: "Upload ~/.claude/.credentials.json",
          operationId: "putCredentials",
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { "200": { description: "Saved" }, "400": { description: "Invalid shape" } },
        },
      },
      "/api/claude/cli-config": {
        put: {
          tags: ["Claude"],
          summary: "Upload ~/.claude.json",
          operationId: "putCliConfig",
          security: [{ sessionCookie: [] }],
          requestBody: {
            required: true,
            content: { "application/json": { schema: { type: "object" } } },
          },
          responses: { "200": { description: "Saved" }, "400": { description: "Invalid shape" } },
        },
      },
      "/api/claude/refresh": {
        post: {
          tags: ["Claude"],
          summary: "Run the keep-alive ping now",
          operationId: "refreshNow",
          security: [{ sessionCookie: [] }],
          responses: { "200": { description: "Ping result, including failures" } },
        },
      },
      "/health": {
        get: {
          summary: "Liveness",
          operationId: "health",
          security: [],
          responses: { "200": { description: "ok" } },
        },
      },
    },
    components: {
      securitySchemes: {
        apiKeyAuth: {
          type: "apiKey",
          in: "header",
          name: "x-api-key",
          description: "A remote-clode API token, as the real Claude API expects its key.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "The same token as `Authorization: Bearer <token>`.",
        },
        sessionCookie: { type: "apiKey", in: "cookie", name: "rc_session" },
      },
      schemas: {
        Error: errorSchema,
        TextBlock: {
          type: "object",
          required: ["type", "text"],
          properties: { type: { type: "string", enum: ["text"] }, text: { type: "string" } },
        },
        InputMessage: {
          type: "object",
          required: ["role", "content"],
          properties: {
            role: { type: "string", enum: ["user", "assistant"] },
            content: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { $ref: "#/components/schemas/TextBlock" } },
              ],
            },
          },
        },
        MessageCreateParams: {
          type: "object",
          required: ["model", "max_tokens", "messages"],
          properties: {
            model: {
              type: "string",
              description: "Passed straight to `claude --model`. Aliases such as `opus` work.",
              examples: config.api.models,
            },
            max_tokens: {
              type: "integer",
              minimum: 1,
              description: "Required for API compatibility; not enforced by the CLI.",
            },
            messages: {
              type: "array",
              minItems: 1,
              items: { $ref: "#/components/schemas/InputMessage" },
            },
            system: {
              oneOf: [
                { type: "string" },
                { type: "array", items: { $ref: "#/components/schemas/TextBlock" } },
              ],
            },
            stream: { type: "boolean", default: false },
          },
        },
        Usage: {
          type: "object",
          properties: {
            input_tokens: { type: "integer" },
            output_tokens: { type: "integer" },
            cache_creation_input_tokens: { type: "integer" },
            cache_read_input_tokens: { type: "integer" },
          },
        },
        Message: {
          type: "object",
          required: ["id", "type", "role", "model", "content", "stop_reason", "usage"],
          properties: {
            id: { type: "string", example: "msg_2f1c9a0b3d4e5f6071829304" },
            type: { type: "string", enum: ["message"] },
            role: { type: "string", enum: ["assistant"] },
            model: { type: "string" },
            content: { type: "array", items: { $ref: "#/components/schemas/TextBlock" } },
            stop_reason: { type: ["string", "null"], enum: ["end_turn", null] },
            stop_sequence: { type: ["string", "null"] },
            usage: { $ref: "#/components/schemas/Usage" },
          },
        },
        ModelList: {
          type: "object",
          properties: {
            data: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  type: { type: "string", enum: ["model"] },
                  id: { type: "string" },
                  display_name: { type: "string" },
                  created_at: { type: ["string", "null"] },
                },
              },
            },
            has_more: { type: "boolean" },
            first_id: { type: ["string", "null"] },
            last_id: { type: ["string", "null"] },
          },
        },
        ApiToken: {
          type: "object",
          properties: {
            id: { type: "string", example: "tok_9c1f…" },
            name: { type: "string" },
            prefix: { type: "string", description: "Leading characters of the secret." },
            createdAt: { type: "integer", description: "Unix epoch milliseconds." },
            expiresAt: { type: ["integer", "null"] },
            lastUsedAt: { type: ["integer", "null"] },
            revokedAt: { type: ["integer", "null"] },
            expired: { type: "boolean" },
            active: { type: "boolean" },
          },
        },
      },
    },
  };
}

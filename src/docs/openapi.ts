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
      title: "claude-subscription-to-api API",
      version: "0.1.0",
      description: [
        "This app has two surfaces.",
        "",
        "`/v1/*` stands in front of this host's Claude CLI and answers in the shape of the",
        "Anthropic API. A request signed with a claude-subscription-to-api API token becomes a `claude -p`",
        "run, and the answer of the CLI comes back as a Messages API response. So an Anthropic",
        "SDK pointed at this base URL works without changes for plain text conversations.",
        "",
        "`/api/*` is the management surface for the web UI and needs the login session cookie.",
        "API tokens are created there, but they do not work against `/api/*` themselves.",
        "",
        "**Differences from the real Claude API**",
        "",
        "- Only `text` content blocks are accepted. Images and documents are rejected.",
        "- `tools` and `tool_choice` are rejected, because the CLI has its own tools.",
        "- `max_tokens` is validated but not enforced. The CLI decides how long to run.",
        "- `temperature`, `top_p`, `top_k`, `stop_sequences`, `thinking` and `metadata` are ignored.",
        "- A multi-turn `messages` array becomes one prompt with labelled turns, because the",
        "  CLI takes a single prompt and not a conversation.",
        "- Streaming sends one text content block. Usage arrives on `message_delta`.",
        "- `POST /v1/messages/count_tokens` and the Batches, Files and Models capability",
        "  endpoints are not implemented.",
      ].join("\n"),
    },
    servers: [{ url: "/", description: "this host" }],
    tags: [
      { name: "Messages", description: "The Claude CLI in the shape of the Anthropic API" },
      { name: "Tokens", description: "API token management (session cookie)" },
      { name: "Claude", description: "Credential and keep-alive management (session cookie)" },
    ],
    paths: {
      "/v1/messages": {
        post: {
          tags: ["Messages"],
          summary: "Create a message",
          description:
            "Runs the prompt through the Claude CLI of this host and returns the result as a Messages API response. Set `stream: true` to get a Server-Sent Events stream.",
          operationId: "createMessage",
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          parameters: [
            {
              name: "anthropic-version",
              in: "header",
              required: false,
              schema: { type: "string", example: "2023-06-01" },
              description: "Accepted so the SDKs are happy, and then ignored.",
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
                "A finished message. When `stream` is true, an SSE stream of `message_start`, `content_block_start`, `content_block_delta`, `content_block_stop`, `message_delta` and `message_stop` events.",
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/Message" } },
                "text/event-stream": { schema: { type: "string" } },
              },
            },
            "400": errorResponse("The request is malformed or not supported"),
            "401": errorResponse("The API token is missing, unknown, revoked or expired"),
            "429": errorResponse("Too many CLI runs at the same time"),
            "500": errorResponse("The CLI failed"),
            "529": errorResponse("The CLI ran out of time"),
          },
        },
      },
      "/v1/models": {
        get: {
          tags: ["Messages"],
          summary: "List the models this host gives to the CLI",
          operationId: "listModels",
          security: [{ apiKeyAuth: [] }, { bearerAuth: [] }],
          responses: {
            "200": {
              description: "Model list",
              content: { "application/json": { schema: { $ref: "#/components/schemas/ModelList" } } },
            },
            "401": errorResponse("The API token is missing or invalid"),
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
              description: "Token metadata. The secrets are never returned.",
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
            "401": { description: "There is no session cookie" },
          },
        },
        post: {
          tags: ["Tokens"],
          summary: "Create an API token",
          description: "The token itself is returned one time and cannot be read again.",
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
                      description: "Leave it out to get a token that never expires.",
                    },
                  },
                },
              },
            },
          },
          responses: {
            "201": {
              description: "The created token, together with its secret, shown one time",
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
            "400": { description: "The name or the expiry is invalid" },
            "401": { description: "There is no session cookie" },
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
            "404": { description: "There is no such token" },
          },
        },
      },
      "/api/tokens/{id}": {
        delete: {
          tags: ["Tokens"],
          summary: "Delete an API token for good",
          operationId: "deleteToken",
          security: [{ sessionCookie: [] }],
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
          responses: {
            "200": { description: "Deleted" },
            "404": { description: "There is no such token" },
          },
        },
      },
      "/api/claude/status": {
        get: {
          tags: ["Claude"],
          summary: "Status of the credentials, the CLI config and the keep-alive",
          operationId: "claudeStatus",
          security: [{ sessionCookie: [] }],
          responses: { "200": { description: "The payload the dashboard shows" } },
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
          responses: { "200": { description: "Saved" }, "400": { description: "The shape is wrong" } },
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
          responses: { "200": { description: "Saved" }, "400": { description: "The shape is wrong" } },
        },
      },
      "/api/claude/refresh": {
        post: {
          tags: ["Claude"],
          summary: "Run the keep-alive ping right now",
          operationId: "refreshNow",
          security: [{ sessionCookie: [] }],
          responses: { "200": { description: "The result of the ping, failures included" } },
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
          description: "A claude-subscription-to-api API token, in the place where the real Claude API waits for its key.",
        },
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          description: "The same token, sent as `Authorization: Bearer <token>`.",
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
              description: "Goes straight to `claude --model`. Short names like `opus` work too.",
              examples: config.api.models,
            },
            max_tokens: {
              type: "integer",
              minimum: 1,
              description: "Required so the API shape matches. The CLI does not enforce it.",
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
            prefix: { type: "string", description: "The first characters of the secret." },
            createdAt: { type: "integer", description: "Unix time in milliseconds." },
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

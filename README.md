# remote-clode

A small password-protected web UI for one job: keeping this host's Claude CLI
authenticated.

- **Upload** `~/.claude/.credentials.json` (and `~/.claude.json`) from a browser,
  and re-upload when they expire.
- **Keep them alive** as long as the refresh token allows, by running the CLI on
  a timer so it rotates its own tokens.
- **Write them into the host user's real home**, so anyone who SSHes into the
  box and runs `claude` picks up the same auth. No separate credential copy.
- **Lend the CLI out over HTTP**: mint an API token and call `/v1/messages`, an
  Anthropic-shaped endpoint that proxies to `claude -p` on this host.

Node + NestJS + React Router 7, one container, one process, one port.

## How it works

```
browser ──► :80 ────┬── /login, /logout, /api/*, /docs   NestJS   (session cookie)
                    ├── /v1/*                            NestJS   (API token)
                    └── everything else                  React Router 7 (SSR)
                              │
                              └─ loaders call /api over loopback, forwarding your cookie
```

Both halves run in the same Node process (`src/main.ts`), so the session cookie
lives on a single origin — no CORS and no second service to authenticate.

Everything is closed by default: `src/auth/auth.middleware.ts` runs before both
routers and lets through only `/login`, `/logout`, `/health`, the hashed client
assets, and `/v1/*` — which is not open, it is guarded one layer down by
`ApiTokenGuard` instead of the session cookie. A new route is protected the
moment it exists.

The two credentials never cross over: a session cookie cannot call `/v1`, and an
API token cannot call `/api` — so a leaked token cannot read or replace the
credentials it runs on.

**The app never performs the OAuth exchange itself.** The CLI owns
`.credentials.json` and rotates the refresh token on every run, so a second
refresher racing it is exactly what leaves the file with blank tokens — a state
that never self-heals. The keep-alive just runs `claude -p hi` on the cheapest
model and lets the CLI decide whether to rotate.

## Quick start (docker compose)

The compose file bind-mounts your real home files, so create them first if they
don't exist — docker silently creates a *directory* where a missing file mount
points:

```bash
mkdir -p ~/.claude && touch ~/.claude.json

cp .env.example .env
$EDITOR .env          # HOST_HOME, HOST_UID/HOST_GID (id -u / id -g), password
npm run hash-password # optional: put the hash in AUTH_PASSWORD_HASH instead

docker compose up -d --build
xdg-open http://localhost
```

Then, on a machine where you're already logged in, copy the contents of
`~/.claude/.credentials.json` into the **Credentials** box and save. The status
card should show a plan, an expiry, and `valid`.

The container runs as your uid:gid, so the files it writes into `~/.claude` stay
yours and an SSH session reads them normally.

### What gets mounted

| Host | Container | Why |
| --- | --- | --- |
| `$HOST_HOME/.claude` | `/home/app/.claude` | credentials, rw — the CLI rewrites this on rotation |
| `$HOST_HOME/.claude.json` | `/home/app/.claude.json` | CLI config (onboarding, account) |
| `$HOST_HOME/.local/bin/claude` | `/usr/local/bin/claude` | ro — the host's own CLI, so container and SSH run the same version |

The CLI is mounted rather than installed in the image, so there is no second
copy to keep in sync. `DISABLE_AUTOUPDATER=1` keeps the container from swapping
out the host user's install.

## Configuration

See `.env.example` for the full list. The ones that matter:

| Variable | Default | Notes |
| --- | --- | --- |
| `AUTH_PASSWORD` / `AUTH_PASSWORD_HASH` | — | **Required.** The app refuses to start without one; the hash wins if both are set. |
| `SESSION_SECRET` | random per boot | Signs session cookies. Unset = everyone is logged out on restart. Rotating it revokes all sessions. |
| `SESSION_TTL_HOURS` | 720 | Cookie lifetime. |
| `COOKIE_SECURE` | `0` | Set to `1` when serving over HTTPS. |
| `TRUST_PROXY` | unset | Set (e.g. `1`) only behind a proxy, so login throttling sees real client IPs. |
| `REFRESH_INTERVAL_MS` |  `7200000` (2h) | Keep-alive ping period. Must stay well under the access token's lifetime (~8h observed). |
| `CLAUDE_BIN` | `claude` | Path to the CLI. |
| `CLAUDE_HOME` | the process's home | Root for `.claude/` and `.claude.json`. |
| `API_ENABLED` | `1` | Set to `0` to reject every `/v1` request. |
| `API_ALLOW_TOOLS` | `0` | `0` runs the CLI with `--tools ""`. Setting `1` swaps in `--dangerously-skip-permissions`, which hands every token holder Bash and Write on this host. |
| `API_MAX_CONCURRENT` | `2` | Concurrent CLI runs. Beyond it, `/v1/messages` returns a `rate_limit_error`. |
| `API_TIMEOUT_MS` | `600000` (10m) | Per-request CLI budget, separate from `CLAUDE_TIMEOUT_MS`. |
| `API_SYSTEM_PROMPT_MODE` | `replace` | `replace` maps `system` onto `--system-prompt`; `append` keeps the CLI's own agent prompt and appends. |
| `API_MODELS` | current Opus/Sonnet/Haiku | Advertised by `GET /v1/models`. Not an allowlist — any `model` string is passed to `claude --model`. |
| `API_TOKENS_PATH` | `~/.claude/remote-clode-tokens.json` | Where token hashes live. Inside the mounted `.claude` dir, so it survives `docker compose up --build`. |
| `DOCS_ENABLED` | `1` | Serves `/docs` and `/openapi.json`. |

Sessions are stateless: the cookie is `<expiry>.<HMAC(expiry)>`, so there is
nothing to store and nothing to evict. The trade is that individual sessions
can't be revoked — rotate `SESSION_SECRET` to kill them all.

## API

Two surfaces, two credentials, no overlap.

### Management — `/api/*`, session cookie

**GETs never return the tokens** — only metadata — so a compromised session
can't read back what was uploaded.

- `GET /api/claude/status` — credentials metadata, CLI config metadata, and
  keep-alive history in one payload (what the dashboard renders).
- `PUT /api/claude/credentials` — upload `.credentials.json`. Body is the raw
  JSON or `{ "credentials": {...} }`. Validates the `claudeAiOauth` shape before
  touching disk, then writes atomically at mode `600`.
- `PUT /api/claude/cli-config` — upload `~/.claude.json` (any JSON object).
- `POST /api/claude/refresh` — run the keep-alive ping now. Always 200; a failed
  ping is reported in the body (`ok`, `rotated`, `error`).
- `GET /api/tokens` · `POST /api/tokens` · `POST /api/tokens/:id/revoke` ·
  `DELETE /api/tokens/:id` — API token management, mirrored by the **API tokens**
  page in the UI.
- `GET /health` — unauthenticated liveness, used by the compose healthcheck.

### CLI proxy — `/v1/*`, API token

- `POST /v1/messages` — Claude Messages API shape in, Messages API shape out.
  `stream: true` gives SSE.
- `GET /v1/models` — the models this host advertises.

### Docs

`GET /docs` renders Swagger UI over `GET /openapi.json`; both sit behind the
session cookie. The spec is hand-written in `src/docs/openapi.ts` — there is no
`@nestjs/swagger` dependency to keep in sync — and Swagger UI itself is pulled
from unpkg, so the docs page needs internet in the *browser*. The container
never fetches it, and `/openapi.json` works offline for import into any client.

## Using it as a Claude API

Mint a token on the **API tokens** page, then point any Anthropic client at this
host. The token goes in `x-api-key`, exactly where a real API key would, or in
`Authorization: Bearer`.

```bash
curl http://localhost/v1/messages \
  -H "x-api-key: $RC_TOKEN" \
  -H "content-type: application/json" \
  -d '{"model":"claude-opus-5","max_tokens":1024,
       "messages":[{"role":"user","content":"Say hello in one sentence."}]}'
```

```python
from anthropic import Anthropic

client = Anthropic(base_url="http://localhost", api_key=RC_TOKEN)
message = client.messages.create(
    model="claude-opus-5",
    max_tokens=1024,
    messages=[{"role": "user", "content": "Say hello in one sentence."}],
)
print(message.content[0].text)
```

Errors come back in the same envelope the real API uses
(`{"type":"error","error":{"type":"authentication_error",...}}`), so the SDK
raises its own typed exceptions and its retry logic behaves.

### Where it differs from the real API

It is a CLI in a trench coat, and the CLI is a coding agent, not a raw model.
The gaps that matter:

- **Text only.** Image and document blocks are rejected; so are `tools` and
  `tool_choice`, because the CLI owns its own tool set.
- **`max_tokens` is validated, not enforced.** The CLI decides how long to run.
  `temperature`, `top_p`, `top_k`, `stop_sequences`, `thinking` and `metadata`
  are ignored — the CLI does not expose them.
- **The conversation is flattened.** The CLI takes one prompt, so a multi-turn
  `messages` array becomes a labelled `Human:` / `Assistant:` transcript. A
  single user turn is passed through verbatim.
- **Usage is the CLI's accounting**, forwarded as-is. Billing still happens
  against the subscription the uploaded credentials belong to, not per token.
- **Streaming is one text block.** Deltas come from the CLI's own partial
  messages when the installed version supports `--include-partial-messages`
  (probed once via `claude --help`); otherwise text arrives per completed turn.
- **Not implemented:** `count_tokens`, Batches, Files, and the capability fields
  on `/v1/models`.

### Tokens

Tokens are `rc-`-prefixed random secrets. Only their SHA-256 is stored, in
`API_TOKENS_PATH` at mode `600`, so the plaintext exists exactly once — on the
screen right after you create it. A token can carry an expiry, can be revoked
(kept for the audit trail) or deleted outright, and records a coarse last-used
timestamp.

**A token is as powerful as the CLI it fronts.** With the default
`API_ALLOW_TOOLS=0` the CLI runs with `--tools ""`, so a token buys text
generation and nothing else. Turning tools on means anyone holding a token can
run Bash on this host as the container user.

## Reading the status card

- **`no tokens`** — the file is there but its token strings are empty. The CLI
  blanks them when a refresh is rejected, e.g. another machine holding the same
  credentials rotated the refresh token. This never recovers on its own: run
  `claude setup-token` on a machine you trust and upload the result.
- **`expired`** — past `expiresAt`. A ping usually fixes it if the refresh token
  is still good; otherwise re-upload.
- **`no rotation`** in the ping log is the normal, healthy case. It means the
  token had plenty of life left. What matters is that the CLI ran.

## Development

```bash
npm install && npm --prefix ui install
npm run build                  # API (tsc) + UI (react-router build)
AUTH_PASSWORD=dev SESSION_SECRET=dev npm start
npm test                       # vitest: session/password/throttle, credentials store,
                               #         token store, /v1/messages request mapping
```

The UI is built, not dev-served, because it is mounted into the API process. Use
`npm run build:ui` after editing `ui/app/**` (or `npm run dev`, which watches
both).

## Layout

```
src/
  main.ts                     bootstrap: parsers → auth → UI handler → Nest
  ui-handler.ts               express ⇄ fetch bridge for the RR7 server build
  auth/                       session HMAC, password hashing, throttle, middleware, login
  claude/
    credentials.service.ts    read/write the two CLI files (atomic, metadata-only reads)
    claude.service.ts         spawns the CLI
    refresh.service.ts        keep-alive timer + ping history
    claude.controller.ts      /api/claude/*
  tokens/
    tokens.service.ts         hashed token store on disk
    tokens.controller.ts      /api/tokens
  messages/
    anthropic.ts              request validation + Messages API shapes
    messages.service.ts       runs the CLI, maps json / stream-json onto SSE
    api-token.guard.ts        x-api-key / bearer -> token record
    api-error.filter.ts       every /v1 failure as an Anthropic error envelope
    messages.controller.ts    /v1/*
  docs/
    openapi.ts                hand-written OpenAPI 3.1 document
    docs.controller.ts        /docs + /openapi.json
ui/app/routes/
  login.tsx                   render-only; the form posts to Nest
  home.tsx                    status + upload forms + keep-alive
  tokens.tsx                  create, revoke and delete API tokens
```

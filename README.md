# remote-clode

A small password-protected web UI for one job: keeping this host's Claude CLI
authenticated.

- **Upload** `~/.claude/.credentials.json` (and `~/.claude.json`) from a browser,
  and re-upload when they expire.
- **Keep them alive** as long as the refresh token allows, by running the CLI on
  a timer so it rotates its own tokens.
- **Write them into the host user's real home**, so anyone who SSHes into the
  box and runs `claude` picks up the same auth. No separate credential copy.

Node + NestJS + React Router 7, one container, one process, one port.

## How it works

```
browser ──► :3000 ──┬── /login, /logout, /api/*   NestJS
                    └── everything else           React Router 7 (SSR)
                              │
                              └─ loaders call /api over loopback, forwarding your cookie
```

Both halves run in the same Node process (`src/main.ts`), so the session cookie
lives on a single origin — no CORS and no second service to authenticate.

Everything is closed by default: `src/auth/auth.middleware.ts` runs before both
routers and lets through only `/login`, `/logout`, `/health` and the hashed
client assets. A new route is protected the moment it exists.

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
xdg-open http://127.0.0.1:3000
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

Sessions are stateless: the cookie is `<expiry>.<HMAC(expiry)>`, so there is
nothing to store and nothing to evict. The trade is that individual sessions
can't be revoked — rotate `SESSION_SECRET` to kill them all.

## API

All under `/api`, all requiring a session cookie. **GETs never return the
tokens** — only metadata — so a compromised session can't read back what was
uploaded.

- `GET /api/claude/status` — credentials metadata, CLI config metadata, and
  keep-alive history in one payload (what the dashboard renders).
- `PUT /api/claude/credentials` — upload `.credentials.json`. Body is the raw
  JSON or `{ "credentials": {...} }`. Validates the `claudeAiOauth` shape before
  touching disk, then writes atomically at mode `600`.
- `PUT /api/claude/cli-config` — upload `~/.claude.json` (any JSON object).
- `POST /api/claude/refresh` — run the keep-alive ping now. Always 200; a failed
  ping is reported in the body (`ok`, `rotated`, `error`).
- `GET /health` — unauthenticated liveness, used by the compose healthcheck.

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
npm test                       # vitest: session/password/throttle + credentials store
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
ui/app/routes/
  login.tsx                   render-only; the form posts to Nest
  home.tsx                    status + upload forms + keep-alive
```

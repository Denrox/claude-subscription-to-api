# remote-clode

Keeps this host's Claude CLI authenticated from a browser, and lends it out at
`/v1/messages` in the Anthropic API shape. NestJS + React Router 7, one
container, one process, one port.

## Run

```bash
mkdir -p ~/.claude && touch ~/.claude.json
cp .env.example .env          # HOST_HOME, HOST_UID/HOST_GID, AUTH_PASSWORD
docker compose up -d --build
```

Then paste `~/.claude/.credentials.json`, from a machine where you are already
logged in, into the Credentials box at `http://localhost`.

Compose bind-mounts your real `~/.claude`, `~/.claude.json` and the host's
`claude` binary, and runs as your uid:gid, so the browser and an SSH session
share one set of credentials and one CLI. Create the two files before the first
`up`: docker makes a *directory* where a missing file mount points.

## Auth

`auth.middleware.ts` runs before both routers and lets through only `/login`,
`/logout`, `/health`, hashed assets and `/v1/*`, which an API token guards one
layer down. A new route is protected the moment it exists.

Session cookies cannot call `/v1`, API tokens cannot call `/api`. Management
GETs return metadata, never the tokens. Sessions are stateless HMACs, so
rotating `SESSION_SECRET` is the only way to revoke one.

## Keep-alive

The app never performs the OAuth exchange itself. The CLI owns
`.credentials.json` and rotates on every run, so a second refresher racing it
leaves blank tokens, which never self-heal. The timer just runs `claude -p hi`
on the cheapest model every two hours and lets the CLI decide.

`no rotation` is the healthy log line. `no tokens` means the CLI blanked them
after a rejected refresh: run `claude setup-token` elsewhere and re-upload.

## API

Mint a token on the API tokens page and send it as `x-api-key`. Only its
SHA-256 is stored, so the plaintext exists once, on screen.

It is a CLI in a trench coat: text only, no images, no `tools`, `max_tokens`
validated but not enforced, sampling params ignored, multi-turn `messages`
flattened into one `Human:`/`Assistant:` prompt. Errors use the real envelope so
the official SDKs retry correctly. Billing is the subscription, not per token.

`API_ALLOW_TOOLS=1` hands every token holder Bash on this host. Homelab only.

`GET /docs` is the endpoint reference. Config lives in `.env.example`.

## Development

```bash
npm install && npm --prefix ui install
npm run build && AUTH_PASSWORD=dev SESSION_SECRET=dev npm start
npm test
```

The UI is built, not dev-served, because it is mounted into the API process.
`npm run dev` watches both.

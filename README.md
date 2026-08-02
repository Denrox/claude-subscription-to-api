# remote-clode

Keeps the Claude CLI on this host logged in, and gives access to it over HTTP at
`/v1/messages`, in the same shape the Anthropic API uses. The API and the UI are
NestJS and React Router 7 inside the same Node process.

I made it because I have a subscription and no API key, and I still wanted to
test clients that talk to the API.

## Run

```bash
mkdir -p ~/.claude && touch ~/.claude.json
cp .env.example .env          # HOST_HOME, HOST_UID/HOST_GID, AUTH_PASSWORD
docker compose up -d --build
```

Then open `http://localhost` and paste `~/.claude/.credentials.json` into the
credentials box. Take the file from a machine where you are already logged in.

Compose mounts the real `~/.claude`, `~/.claude.json` and the host's `claude`
binary, and the container runs as your uid and gid. So the browser and an SSH
session use the same credentials and the same CLI. Create those two files before
the first `up`. If a file is missing, docker makes a directory in its place.

## Auth

`auth.middleware.ts` runs before both routers. It allows only `/login`,
`/logout`, `/health`, the hashed assets and `/v1/*`, and an API token guards
`/v1/*` one layer below. A new route is closed from the moment it exists.

A session cookie cannot call `/v1`, and an API token cannot call `/api`.
Management GETs return metadata, never the tokens. Sessions are stateless HMACs,
so the only way to revoke one is to rotate `SESSION_SECRET`.

## Keep-alive

The app does not do the OAuth exchange itself. The CLI owns
`.credentials.json` and rotates it on every run, so a second refresher working on
the same file leaves blank tokens, and that state never repairs itself. The timer
only runs `claude -p hi` on the cheapest model every two hours, and the CLI
decides what to do.

`no rotation` in the log is normal, it means the token still had time left.
`no tokens` means the CLI blanked them after a rejected refresh. Then run
`claude setup-token` on another machine and upload the result again.

## API

Create a token on the API tokens page and send it as `x-api-key`. Only its
SHA-256 is stored, so the token itself is visible one time, right after you
create it.

Behind the endpoint there is a CLI, not a raw model, so a few things are
different. Text only, no images, no `tools`. `max_tokens` is validated but not
enforced. Sampling parameters are ignored. A multi-turn `messages` array becomes
one prompt with `Human:` and `Assistant:` labels. Errors use the real error
envelope, so the official SDKs retry the way they should. Billing goes to the
subscription and not per token.

`API_ALLOW_TOOLS=1` gives everyone with a token a shell on this host. This
is for a homelab, not for the internet.

`GET /docs` lists the endpoints. Config lives in `.env.example`.

## Development

```bash
npm install && npm --prefix ui install
npm run build && AUTH_PASSWORD=dev SESSION_SECRET=dev npm start
npm test
```

The UI is built and not served by a dev server, because it runs inside the API
process. `npm run dev` watches both.

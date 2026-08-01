# Single image, single process: the Nest API and the React Router 7 UI are
# served by one Node server on one port (see src/main.ts).
#
# The Claude CLI is deliberately NOT installed here — docker-compose bind-mounts
# the host's own `claude` binary, so the container runs the exact version the
# SSH user runs and there is no second copy to keep in sync.

# ---- build: compile the API and build the UI ----
FROM node:22-bookworm-slim AS builder
WORKDIR /app

# .npmrc pins the public registry, so the build never depends on a mirror.
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
RUN npm run build:api

WORKDIR /app/ui
COPY ui/package.json ui/package-lock.json ui/.npmrc ./
RUN npm ci
COPY ui/ ./
RUN npm run build

# ---- runtime ----
FROM node:22-bookworm-slim AS runtime
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
# The RR7 server build resolves react/react-router from ui/node_modules.
COPY ui/package.json ui/package-lock.json ui/.npmrc ./ui/
RUN npm --prefix ui ci --omit=dev && npm cache clean --force

COPY --from=builder /app/dist ./dist
COPY --from=builder /app/ui/build ./ui/build

ENV NODE_ENV=production \
    PORT=3000 \
    HOME=/home/app \
    CLAUDE_HOME=/home/app \
    CLAUDE_BIN=/usr/local/bin/claude \
    SCRATCH_DIR=/tmp/remote-clode \
    # The CLI must never swap itself out from under the host user's mounted
    # install — the host owns updates.
    DISABLE_AUTOUPDATER=1

# compose runs this container as the HOST user's uid:gid (so files written into
# the mounted home are owned by them, and the SSH user can read them). That uid
# has no passwd entry and no pre-made home, so HOME is created world-writable
# for whatever uid ends up running.
RUN mkdir -p /home/app /tmp/remote-clode && chmod 777 /home/app /tmp/remote-clode

EXPOSE 3000
CMD ["node", "dist/main.js"]

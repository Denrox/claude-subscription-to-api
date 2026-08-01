FROM node:22-bookworm-slim AS builder
WORKDIR /app

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

FROM node:22-bookworm-slim AS runtime
WORKDIR /app

COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm cache clean --force
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
    DISABLE_AUTOUPDATER=1

RUN mkdir -p /home/app /tmp/remote-clode && chmod 777 /home/app /tmp/remote-clode

EXPOSE 3000
CMD ["node", "dist/main.js"]

import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import express, { json, urlencoded, type NextFunction, type Request, type Response } from "express";
import { join } from "path";
import { AppModule } from "./app.module";
import { authMiddleware } from "./auth/auth.middleware";
import { passwordConfigured, sessionSecretIsEphemeral } from "./auth/runtime";
import { config } from "./config";
import { createUiHandler } from "./ui-handler";

// One process, one port: Nest owns /api (plus the two auth form endpoints) and
// the React Router 7 app is mounted as express middleware for everything else.
// That keeps the session cookie on a single origin — no CORS, no second service
// to authenticate, and the UI's server-side loaders can call the API over
// loopback with the browser's cookie forwarded.

// Paths Nest owns. /login and /logout are form POSTs (GET /login is the RR7
// login page); /health stays bare so probes don't need to know about /api.
function isNestPath(req: Request): boolean {
  if (req.path === "/health" || req.path.startsWith("/api/")) return true;
  return req.method === "POST" && (req.path === "/login" || req.path === "/logout");
}

// Body parsers must not run for UI requests: the RR7 handler reads the request
// body itself, and a parser that already drained the stream would hang every
// form POST.
function onlyForNest(mw: (req: Request, res: Response, next: NextFunction) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isNestPath(req)) return next();
    return mw(req, res, next);
  };
}

async function bootstrap() {
  const logger = new Logger("bootstrap");

  if (!passwordConfigured) {
    // Refusing to boot is the point: this UI writes OAuth tokens into a real
    // home directory. A passwordless deploy would be an open credential drop.
    logger.error("Set AUTH_PASSWORD or AUTH_PASSWORD_HASH — refusing to start without a password.");
    process.exit(1);
  }
  if (sessionSecretIsEphemeral) {
    logger.warn("SESSION_SECRET is unset — using a random per-boot secret; restarts log you out.");
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable("x-powered-by");
  // Behind a reverse proxy, honor X-Forwarded-* so req.ip (login throttling) and
  // req.protocol reflect the real client. Off by default: trusting the header
  // when nothing sets it lets a client forge its own throttle bucket.
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);

  app.setGlobalPrefix("api", { exclude: ["login", "logout", "health"] });

  // Credentials blobs are small, but ~/.claude.json can be hundreds of KB.
  app.use(onlyForNest(json({ limit: "5mb" })));
  app.use(onlyForNest(urlencoded({ extended: false, limit: "1mb" })));

  // Registered before Nest's router and the UI handler, so every route below is
  // closed unless it is on the middleware's public list.
  app.use(authMiddleware());

  await mountUi(app, logger);

  await app.listen(config.port, "0.0.0.0");
  logger.log(`remote-clode listening on :${config.port}`);
  logger.log(`Managing ${config.paths.credentials} and ${config.paths.cliConfig}`);
}

async function mountUi(app: NestExpressApplication, logger: Logger): Promise<void> {
  const handler = await createUiHandler();
  if (!handler) {
    logger.warn(`No UI build at ${config.uiBuildDir} — API only. Run: npm run build:ui`);
    return;
  }

  // Hashed client assets are immutable; anything else in the client dir gets a
  // short cache. index:false so a stray index.html can't shadow the UI's route.
  app.use(
    "/assets",
    express.static(join(config.uiBuildDir, "client", "assets"), { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static(join(config.uiBuildDir, "client"), { maxAge: "1h", index: false }));

  // Express registers this before Nest's router (Nest mounts its routes during
  // listen()), so anything Nest owns has to be skipped explicitly or this
  // catch-all would answer it with a 404 document.
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isNestPath(req)) return next();
    return handler(req, res, next);
  });
  logger.log(`UI mounted from ${config.uiBuildDir}`);
}

bootstrap();

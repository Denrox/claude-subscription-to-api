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
import { newId } from "./messages/anthropic";
import { createUiHandler } from "./ui-handler";

const NEST_EXACT = new Set(["/health", "/docs", "/openapi.json"]);

function isNestPath(req: Request): boolean {
  if (NEST_EXACT.has(req.path)) return true;
  if (req.path.startsWith("/api/") || req.path.startsWith("/v1/")) return true;
  return req.method === "POST" && (req.path === "/login" || req.path === "/logout");
}

function onlyForNest(mw: (req: Request, res: Response, next: NextFunction) => void) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!isNestPath(req)) return next();
    return mw(req, res, next);
  };
}

function requestIds() {
  return (req: Request & { requestId?: string }, res: Response, next: NextFunction) => {
    if (!req.path.startsWith("/v1/")) return next();
    req.requestId = newId("req");
    res.setHeader("request-id", req.requestId);
    next();
  };
}

async function bootstrap() {
  const logger = new Logger("bootstrap");

  if (!passwordConfigured) {
    logger.error("Set AUTH_PASSWORD or AUTH_PASSWORD_HASH — refusing to start without a password.");
    process.exit(1);
  }
  if (sessionSecretIsEphemeral) {
    logger.warn("SESSION_SECRET is unset — using a random per-boot secret; restarts log you out.");
  }

  const app = await NestFactory.create<NestExpressApplication>(AppModule);
  app.disable("x-powered-by");
  if (process.env.TRUST_PROXY) app.set("trust proxy", process.env.TRUST_PROXY);

  app.setGlobalPrefix("api", {
    exclude: ["login", "logout", "health", "docs", "openapi.json", "v1/messages", "v1/models"],
  });

  app.use(onlyForNest(json({ limit: "5mb" })));
  app.use(onlyForNest(urlencoded({ extended: false, limit: "1mb" })));

  app.use(requestIds());
  app.use(authMiddleware());

  await mountUi(app, logger);

  await app.listen(config.port, "0.0.0.0");
  logger.log(`remote-clode listening on :${config.port}`);
  logger.log(`Managing ${config.paths.credentials} and ${config.paths.cliConfig}`);
  if (config.api.enabled) {
    logger.log(
      `CLI proxy on /v1/messages (tools ${config.api.allowTools ? "enabled" : "disabled"}, ` +
        `max ${config.api.maxConcurrent} concurrent), tokens in ${config.api.tokensPath}`,
    );
  } else {
    logger.warn("API_ENABLED=0 — /v1 rejects every request");
  }
}

async function mountUi(app: NestExpressApplication, logger: Logger): Promise<void> {
  const handler = await createUiHandler();
  if (!handler) {
    logger.warn(`No UI build at ${config.uiBuildDir} — API only. Run: npm run build:ui`);
    return;
  }

  app.use(
    "/assets",
    express.static(join(config.uiBuildDir, "client", "assets"), { immutable: true, maxAge: "1y" }),
  );
  app.use(express.static(join(config.uiBuildDir, "client"), { maxAge: "1h", index: false }));

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (isNestPath(req)) return next();
    return handler(req, res, next);
  });
  logger.log(`UI mounted from ${config.uiBuildDir}`);
}

bootstrap();

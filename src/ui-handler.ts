import type { NextFunction, Request, Response } from "express";
import { existsSync } from "fs";
import { createRequire } from "module";
import { Readable } from "stream";
import { join } from "path";
import { pathToFileURL } from "url";
import { config } from "./config";

type RRHandler = (request: globalThis.Request) => Promise<globalThis.Response>;

const importEsm: (specifier: string) => Promise<any> = new Function(
  "specifier",
  "return import(specifier)",
) as any;

export async function createUiHandler(): Promise<
  ((req: Request, res: Response, next: NextFunction) => void) | null
> {
  const serverBuild = join(config.uiBuildDir, "server", "index.js");
  if (!existsSync(serverBuild)) return null;

  const uiRoot = join(config.uiBuildDir, "..");
  const requireFromUi = createRequire(join(uiRoot, "package.json"));
  const rr = await importEsm(pathToFileURL(requireFromUi.resolve("react-router")).href);
  const build = await importEsm(pathToFileURL(serverBuild).href);
  const handle: RRHandler = rr.createRequestHandler(build, process.env.NODE_ENV);

  return (req, res, next) => {
    handle(toWebRequest(req))
      .then((webRes) => sendWebResponse(res, webRes))
      .catch(next);
  };
}

function toWebRequest(req: Request): globalThis.Request {
  const url = new URL(req.originalUrl || req.url, `${req.protocol}://${req.get("host")}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }

  const init: RequestInit & { duplex?: string } = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    init.body = Readable.toWeb(req) as ReadableStream;
    init.duplex = "half";
  }
  return new Request(url.href, init as RequestInit);
}

function sendWebResponse(res: Response, webRes: globalThis.Response): void {
  res.statusCode = webRes.status;
  res.statusMessage = webRes.statusText;
  for (const [key, value] of webRes.headers) {
    if (key.toLowerCase() === "set-cookie") continue;
    res.setHeader(key, value);
  }
  const cookies = webRes.headers.getSetCookie?.() ?? [];
  if (cookies.length) res.setHeader("set-cookie", cookies);

  if (!webRes.body) {
    res.end();
    return;
  }
  Readable.fromWeb(webRes.body as any).pipe(res);
}

import type { NextFunction, Request, Response } from "express";
import { existsSync } from "fs";
import { createRequire } from "module";
import { Readable } from "stream";
import { join } from "path";
import { pathToFileURL } from "url";
import { config } from "./config";

// Bridges express to the React Router 7 server build.
//
// @react-router/express would normally do this, but it peer-requires an exact
// react-router version — pulling it into this package would put a second copy
// of react-router in the image, pinned separately from the UI's. Adapting by
// hand is ~50 lines, keeps the API's dependencies to Nest + express, and lets
// the UI's react-router stay resolved from ui/node_modules where the build
// expects it.

type RRHandler = (request: globalThis.Request) => Promise<globalThis.Response>;

// tsc compiles this bundle to CommonJS, which rewrites a literal `import()`
// into `require()` — and require() cannot load the UI's ESM. Going through
// `new Function` keeps a real dynamic import in the emitted output.
const importEsm: (specifier: string) => Promise<any> = new Function(
  "specifier",
  "return import(specifier)",
) as any;

export async function createUiHandler(): Promise<
  ((req: Request, res: Response, next: NextFunction) => void) | null
> {
  const serverBuild = join(config.uiBuildDir, "server", "index.js");
  if (!existsSync(serverBuild)) return null;

  // react-router lives in ui/node_modules (the UI is its own package), so it is
  // resolved relative to the UI rather than through this package's own tree.
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
  // X-Forwarded-* is honored only when express is configured to trust the proxy
  // (TRUST_PROXY), so req.protocol/hostname can't be spoofed by a direct client.
  const url = new URL(req.originalUrl || req.url, `${req.protocol}://${req.get("host")}`);

  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) value.forEach((v) => headers.append(key, v));
    else if (value !== undefined) headers.set(key, value);
  }

  const init: RequestInit & { duplex?: string } = { method: req.method, headers };
  if (req.method !== "GET" && req.method !== "HEAD") {
    // Streamed, not buffered: RR7 reads the body itself. This is why the JSON /
    // urlencoded parsers in main.ts are scoped to the API's paths — a parser
    // that ran here would have already drained the stream and every UI form
    // POST would hang.
    init.body = Readable.toWeb(req) as ReadableStream;
    init.duplex = "half";
  }
  return new Request(url.href, init as RequestInit);
}

function sendWebResponse(res: Response, webRes: globalThis.Response): void {
  res.statusCode = webRes.status;
  res.statusMessage = webRes.statusText;
  for (const [key, value] of webRes.headers) {
    // Multiple Set-Cookie headers collapse into one comma-joined value when
    // iterated, which browsers mis-parse; getSetCookie() keeps them separate.
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

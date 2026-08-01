import { Controller, Get, Header, NotFoundException } from "@nestjs/common";
import { config } from "../config";
import { openapiDocument } from "./openapi";

const SWAGGER_BASE = "https://unpkg.com/swagger-ui-dist";

@Controller()
export class DocsController {
  @Get("openapi.json")
  spec(): Record<string, unknown> {
    if (!config.docs.enabled) throw new NotFoundException("docs are disabled");
    return openapiDocument();
  }

  @Get("docs")
  @Header("Content-Type", "text/html; charset=utf-8")
  page(): string {
    if (!config.docs.enabled) throw new NotFoundException("docs are disabled");
    const base = `${SWAGGER_BASE}@${config.docs.swaggerUiVersion}`;
    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>remote-clode API</title>
    <link rel="stylesheet" href="${base}/swagger-ui.css" />
    <style>
      body { margin: 0; background: #fafafa; }
      .topbar { display: none; }
      .rc-nav { font: 14px/1.4 ui-sans-serif, system-ui, sans-serif; padding: 12px 20px; background: #0f172a; color: #cbd5e1; }
      .rc-nav a { color: #fff; text-decoration: none; font-weight: 600; }
      .rc-nav a:hover { text-decoration: underline; }
    </style>
  </head>
  <body>
    <div class="rc-nav"><a href="/">&larr; remote-clode</a> &nbsp;·&nbsp; <a href="/tokens">API tokens</a> &nbsp;·&nbsp; <a href="/openapi.json">openapi.json</a></div>
    <div id="swagger"></div>
    <script src="${base}/swagger-ui-bundle.js"></script>
    <script>
      window.ui = SwaggerUIBundle({
        url: "/openapi.json",
        dom_id: "#swagger",
        deepLinking: true,
        persistAuthorization: true,
        tryItOutEnabled: true,
      });
    </script>
  </body>
</html>
`;
  }
}

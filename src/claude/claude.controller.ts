import { Body, Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import { config } from "../config";
import { CredentialsService } from "./credentials.service";
import { RefreshService } from "./refresh.service";

// REST surface for the UI. Mounted under /api (main.ts sets the global prefix)
// and closed to anyone without a session by the auth middleware.
//
// GETs return metadata only — never the token strings — so the browser cannot
// read back what was uploaded, even through a compromised session.
@Controller("claude")
export class ClaudeController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly refresher: RefreshService,
  ) {}

  // Everything the dashboard needs, in one round trip.
  @Get("status")
  status() {
    return {
      credentials: this.credentials.readCredentialsStatus(),
      cliConfig: this.credentials.readCliConfigStatus(),
      refresh: {
        last: this.refresher.lastResult(),
        recent: this.refresher.recentResults(),
        running: this.refresher.isRunning(),
        intervalMs: config.claude.refreshIntervalMs,
        nextRunAt: this.refresher.nextRunAt(),
      },
      home: config.claudeHome,
    };
  }

  // Body may be the raw credentials JSON string or { credentials: {...} }.
  @Put("credentials")
  @HttpCode(200)
  putCredentials(@Body() body: any) {
    const payload = body && typeof body === "object" && "credentials" in body ? body.credentials : body;
    return { saved: true, credentials: this.credentials.writeCredentials(payload) };
  }

  // Body may be the raw ~/.claude.json string or { config: {...} }.
  @Put("cli-config")
  @HttpCode(200)
  putCliConfig(@Body() body: any) {
    const payload = body && typeof body === "object" && "config" in body ? body.config : body;
    return { saved: true, cliConfig: this.credentials.writeCliConfig(payload) };
  }

  // Manual keep-warm ping. Never a 5xx on a failed ping: the failure detail is
  // the useful payload here (blank tokens, missing CLI, timeout), and the UI
  // renders it as-is.
  @Post("refresh")
  @HttpCode(200)
  async refresh() {
    return this.refresher.refresh("manual");
  }
}

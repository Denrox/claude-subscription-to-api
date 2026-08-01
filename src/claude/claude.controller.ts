import { Body, Controller, Get, HttpCode, Post, Put } from "@nestjs/common";
import { config } from "../config";
import { CredentialsService } from "./credentials.service";
import { RefreshService } from "./refresh.service";

@Controller("claude")
export class ClaudeController {
  constructor(
    private readonly credentials: CredentialsService,
    private readonly refresher: RefreshService,
  ) {}

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

  @Put("credentials")
  @HttpCode(200)
  putCredentials(@Body() body: any) {
    const payload = body && typeof body === "object" && "credentials" in body ? body.credentials : body;
    return { saved: true, credentials: this.credentials.writeCredentials(payload) };
  }

  @Put("cli-config")
  @HttpCode(200)
  putCliConfig(@Body() body: any) {
    const payload = body && typeof body === "object" && "config" in body ? body.config : body;
    return { saved: true, cliConfig: this.credentials.writeCliConfig(payload) };
  }

  @Post("refresh")
  @HttpCode(200)
  async refresh() {
    return this.refresher.refresh("manual");
  }
}

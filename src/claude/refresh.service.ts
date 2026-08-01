import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { config } from "../config";
import { ClaudeService } from "./claude.service";
import { CredentialsService } from "./credentials.service";

export interface RefreshResult {
  at: number;
  trigger: "boot" | "schedule" | "manual";
  ok: boolean;
  // What actually changed on disk, not merely that the CLI ran. A steady run of
  // rotated:false is normal and healthy — it means the token had plenty of life
  // left. The value is that the CLI ran at all.
  rotated: boolean;
  expiresAtBefore: number | null;
  expiresAtAfter: number | null;
  durationMs: number;
  error: string | null;
}

const HISTORY_LIMIT = 20;

// Keeps the credentials alive for as long as the refresh token allows, by
// pinging the CLI on a timer. Nothing else in this app runs the CLI, so without
// this the tokens would sit untouched until they expired past recovery.
//
// There is no "still fresh, skip" short-circuit: the CLI rotates only when the
// token is near ITS OWN expiry threshold, which we cannot observe from the
// file. Gating on remaining lifetime would risk never pinging inside the CLI's
// window, so every tick pings and the CLI decides.
@Injectable()
export class RefreshService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RefreshService.name);
  private timer: NodeJS.Timeout | null = null;
  private bootTimer: NodeJS.Timeout | null = null;
  private inFlight: Promise<RefreshResult> | null = null;
  private readonly history: RefreshResult[] = [];

  constructor(
    private readonly claude: ClaudeService,
    private readonly credentials: CredentialsService,
  ) {}

  onModuleInit(): void {
    const everyMin = Math.round(config.claude.refreshIntervalMs / 60000);
    this.logger.log(`Keep-warm ping scheduled every ${everyMin}m`);
    this.timer = setInterval(() => {
      void this.refresh("schedule").catch(() => undefined);
    }, config.claude.refreshIntervalMs);
    // Don't hold the event loop open on shutdown.
    this.timer.unref?.();

    if (config.claude.refreshOnBoot) {
      this.bootTimer = setTimeout(() => {
        void this.refresh("boot").catch(() => undefined);
      }, config.claude.refreshOnBootDelayMs);
      this.bootTimer.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.bootTimer) clearTimeout(this.bootTimer);
  }

  lastResult(): RefreshResult | null {
    return this.history[0] ?? null;
  }

  recentResults(): RefreshResult[] {
    return [...this.history];
  }

  nextRunAt(): number | null {
    return this.timer ? Date.now() + config.claude.refreshIntervalMs : null;
  }

  isRunning(): boolean {
    return this.inFlight !== null;
  }

  // Concurrent callers (the timer firing while someone clicks "Refresh now")
  // share one CLI run rather than racing two of them at the same credentials
  // file — the race is what blanks tokens.
  refresh(trigger: RefreshResult["trigger"]): Promise<RefreshResult> {
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.runRefresh(trigger).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async runRefresh(trigger: RefreshResult["trigger"]): Promise<RefreshResult> {
    const started = Date.now();
    const before = this.credentials.readCredentialsStatus();
    const record = (ok: boolean, error: string | null, after: number | null): RefreshResult => {
      const result: RefreshResult = {
        at: Date.now(),
        trigger,
        ok,
        rotated: ok && after !== before.expiresAt,
        expiresAtBefore: before.expiresAt,
        expiresAtAfter: after,
        durationMs: Date.now() - started,
        error,
      };
      this.history.unshift(result);
      if (this.history.length > HISTORY_LIMIT) this.history.length = HISTORY_LIMIT;
      if (ok) {
        this.logger.log(`Ping ok (${trigger}) — ${result.rotated ? "rotated" : "no rotation"}`);
      } else {
        this.logger.warn(`Ping failed (${trigger}): ${error}`);
      }
      return result;
    };

    if (!before.exists) {
      return record(false, "no credentials file — upload one first", null);
    }
    // Blank tokens never self-heal; a keep-warm run can't fix them and would
    // just fail. Say so plainly instead of surfacing a bare CLI exit code.
    if (before.hasTokens === false) {
      return record(false, "credentials are blank — re-authenticate and upload again", null);
    }

    try {
      await this.claude.ping();
    } catch (err: any) {
      return record(false, err?.message ?? String(err), this.credentials.readCredentialsStatus().expiresAt);
    }

    const after = this.credentials.readCredentialsStatus();
    if (after.hasTokens === false) {
      return record(false, "the refresh blanked the tokens — re-authenticate", after.expiresAt);
    }
    return record(true, null, after.expiresAt);
  }
}

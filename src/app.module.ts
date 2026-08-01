import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller";
import { ClaudeController } from "./claude/claude.controller";
import { ClaudeService } from "./claude/claude.service";
import { CredentialsService } from "./claude/credentials.service";
import { RefreshService } from "./claude/refresh.service";
import { HealthController } from "./health.controller";

@Module({
  controllers: [AuthController, ClaudeController, HealthController],
  providers: [ClaudeService, CredentialsService, RefreshService],
})
export class AppModule {}

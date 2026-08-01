import { Module } from "@nestjs/common";
import { AuthController } from "./auth/auth.controller";
import { ClaudeController } from "./claude/claude.controller";
import { ClaudeService } from "./claude/claude.service";
import { CredentialsService } from "./claude/credentials.service";
import { RefreshService } from "./claude/refresh.service";
import { DocsController } from "./docs/docs.controller";
import { HealthController } from "./health.controller";
import { ApiTokenGuard } from "./messages/api-token.guard";
import { MessagesController } from "./messages/messages.controller";
import { MessagesService } from "./messages/messages.service";
import { TokensController } from "./tokens/tokens.controller";
import { TokensService } from "./tokens/tokens.service";

@Module({
  controllers: [
    AuthController,
    ClaudeController,
    HealthController,
    TokensController,
    MessagesController,
    DocsController,
  ],
  providers: [
    ClaudeService,
    CredentialsService,
    RefreshService,
    TokensService,
    MessagesService,
    ApiTokenGuard,
  ],
})
export class AppModule {}

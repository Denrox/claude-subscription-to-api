import { CanActivate, ExecutionContext, Injectable } from "@nestjs/common";
import type { Request } from "express";
import { config } from "../config";
import { TokensService } from "../tokens/tokens.service";
import { AnthropicApiException } from "./api-error";

export function readPresentedToken(req: Request): string | null {
  const header = req.headers["x-api-key"];
  const key = Array.isArray(header) ? header[0] : header;
  if (typeof key === "string" && key.trim()) return key.trim();

  const auth = req.headers.authorization;
  if (typeof auth === "string" && auth.toLowerCase().startsWith("bearer ")) {
    const value = auth.slice(7).trim();
    if (value) return value;
  }
  return null;
}

@Injectable()
export class ApiTokenGuard implements CanActivate {
  constructor(private readonly tokens: TokensService) {}

  canActivate(context: ExecutionContext): boolean {
    if (!config.api.enabled) {
      throw new AnthropicApiException("not_found_error", "the CLI proxy API is disabled");
    }

    const req = context.switchToHttp().getRequest<Request & { apiTokenId?: string }>();
    const presented = readPresentedToken(req);
    if (!presented) {
      throw new AnthropicApiException(
        "authentication_error",
        "the API key is missing, send it in the x-api-key header or as Authorization: Bearer <token>",
      );
    }

    const record = this.tokens.verify(presented);
    if (!record) {
      throw new AnthropicApiException(
        "authentication_error",
        "the API key is not valid, it is unknown, revoked or expired",
      );
    }

    req.apiTokenId = record.id;
    return true;
  }
}

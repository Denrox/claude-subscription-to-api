import { Body, Controller, Get, HttpException, Post, Req, Res, UseFilters, UseGuards } from "@nestjs/common";
import type { Request, Response } from "express";
import { config } from "../config";
import { AnthropicExceptionFilter } from "./api-error.filter";
import { ApiTokenGuard } from "./api-token.guard";
import { AnthropicErrorType, ERROR_STATUS, errorBody } from "./api-error";
import { normalizeRequest } from "./anthropic";
import { MessagesService } from "./messages.service";

@Controller("v1")
@UseGuards(ApiTokenGuard)
@UseFilters(AnthropicExceptionFilter)
export class MessagesController {
  constructor(private readonly messages: MessagesService) {}

  @Post("messages")
  async create(
    @Body() body: any,
    @Req() req: Request & { requestId?: string },
    @Res() res: Response,
  ): Promise<void> {
    const request = normalizeRequest(body);

    if (!request.stream) {
      const message = await this.messages.createMessage(request);
      res.status(200).json(message);
      return;
    }

    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const controller = new AbortController();
    req.on("close", () => controller.abort());

    const emit = (event: string, data: unknown) => {
      if (res.writableEnded) return;
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    try {
      await this.messages.streamMessage(request, emit, controller.signal);
    } catch (err) {
      emit("error", toErrorEvent(err, req.requestId ?? null));
    } finally {
      if (!res.writableEnded) res.end();
    }
  }

  @Get("models")
  models() {
    const data = config.api.models.map((id) => ({
      type: "model",
      id,
      display_name: id,
      created_at: null,
    }));
    return {
      data,
      has_more: false,
      first_id: data[0]?.id ?? null,
      last_id: data[data.length - 1]?.id ?? null,
    };
  }
}

function toErrorEvent(err: unknown, requestId: string | null) {
  if (err instanceof HttpException) {
    const payload = err.getResponse();
    if (payload && typeof payload === "object" && (payload as any).type === "error") {
      const inner = (payload as any).error ?? {};
      return errorBody(inner.type ?? "api_error", inner.message ?? "request failed", requestId);
    }
    const status = err.getStatus();
    const type = (Object.entries(ERROR_STATUS).find(([, s]) => s === status)?.[0] ??
      "api_error") as AnthropicErrorType;
    return errorBody(type, err.message, requestId);
  }
  return errorBody("api_error", err instanceof Error ? err.message : "request failed", requestId);
}

import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from "@nestjs/common";
import type { Request, Response } from "express";
import { AnthropicErrorType, ERROR_STATUS, errorBody } from "./api-error";

const STATUS_TO_TYPE = new Map<number, AnthropicErrorType>(
  (Object.entries(ERROR_STATUS) as [AnthropicErrorType, number][]).map(([type, status]) => [
    status,
    type,
  ]),
);

@Catch()
export class AnthropicExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger("AnthropicApi");

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const res = http.getResponse<Response>();
    const req = http.getRequest<Request & { requestId?: string }>();
    const requestId = req.requestId ?? null;

    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const payload = exception instanceof HttpException ? exception.getResponse() : null;

    let type: AnthropicErrorType = STATUS_TO_TYPE.get(status) ?? (status >= 500 ? "api_error" : "invalid_request_error");
    let message = "internal server error";

    if (payload && typeof payload === "object" && (payload as any).type === "error") {
      const inner = (payload as any).error ?? {};
      type = inner.type ?? type;
      message = inner.message ?? message;
    } else if (typeof payload === "string") {
      message = payload;
    } else if (payload && typeof payload === "object") {
      const raw = (payload as any).message;
      message = Array.isArray(raw) ? raw.join(", ") : (raw ?? message);
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    if (status >= 500) {
      this.logger.error(`${req.method} ${req.originalUrl} -> ${status}: ${message}`);
    }

    if (res.headersSent) {
      res.end();
      return;
    }
    if (requestId) res.setHeader("request-id", requestId);
    res.status(status).json(errorBody(type, message, requestId));
  }
}

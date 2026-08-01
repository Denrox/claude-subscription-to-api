import { HttpException } from "@nestjs/common";

export const ERROR_STATUS = {
  invalid_request_error: 400,
  authentication_error: 401,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
} as const;

export type AnthropicErrorType = keyof typeof ERROR_STATUS;

export interface AnthropicErrorBody {
  type: "error";
  error: { type: AnthropicErrorType; message: string };
  request_id: string | null;
}

export class AnthropicApiException extends HttpException {
  constructor(
    readonly errorType: AnthropicErrorType,
    message: string,
  ) {
    super(errorBody(errorType, message, null), ERROR_STATUS[errorType]);
    this.message = message;
  }
}

export function errorBody(
  type: AnthropicErrorType,
  message: string,
  requestId: string | null,
): AnthropicErrorBody {
  return { type: "error", error: { type, message }, request_id: requestId };
}

export function invalidRequest(message: string): AnthropicApiException {
  return new AnthropicApiException("invalid_request_error", message);
}

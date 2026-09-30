// Error codes are part of the public API contract (web, Telegram bot, mobile app).
export const ERROR_CODES = {
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  AGE_NOT_CONFIRMED: 403,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  PLAN_LIMIT_REACHED: 402,
  INVALID_CODE: 422,
  AMBIGUOUS_BOOKMAKER: 409,
  EXPIRED_CODE: 410,
  BOOKMAKER_UNAVAILABLE: 503,
  STATS_UNAVAILABLE: 503,
  AI_UNAVAILABLE: 503,
  PAYMENT_FAILED: 402,
  INTERNAL: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_CODES;

/** An error whose message is safe to show to end users. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, options?: { details?: unknown; cause?: unknown }) {
    super(message, { cause: options?.cause });
    this.name = "AppError";
    this.code = code;
    this.status = ERROR_CODES[code];
    this.details = options?.details;
  }
}

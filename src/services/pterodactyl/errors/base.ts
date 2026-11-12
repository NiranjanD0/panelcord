export interface PterodactylApiErrorDetail {
  code?: string;
  status?: string;
  detail?: string;
  meta?: Record<string, unknown>;
}

export interface PterodactylErrorOptions {
  statusCode?: number;
  errors?: PterodactylApiErrorDetail[];
  apiKeyToRedact?: string;
  cause?: unknown;
  attemptCount?: number;
  retryAfterSeconds?: number;
  isRetryable?: boolean;
}

export class PterodactylError extends Error {
  public readonly statusCode?: number;
  public readonly errors: PterodactylApiErrorDetail[];
  public attemptCount?: number;
  public retryAfterSeconds?: number;
  public isRetryable?: boolean;

  constructor(message: string, options?: PterodactylErrorOptions) {
    const sanitizedMessage = PterodactylError.sanitizeMessage(message, options?.apiKeyToRedact);
    super(sanitizedMessage);
    this.name = "PterodactylError";
    this.statusCode = options?.statusCode;
    this.errors = options?.errors
      ? PterodactylError.sanitizeErrors(options.errors, options?.apiKeyToRedact)
      : [];
    this.attemptCount = options?.attemptCount;
    this.retryAfterSeconds = options?.retryAfterSeconds;
    this.isRetryable = options?.isRetryable;

    if (options?.cause) {
      if (
        options.apiKeyToRedact &&
        options.apiKeyToRedact.length >= 4 &&
        options.cause instanceof Error
      ) {
        options.cause.message = PterodactylError.sanitizeMessage(
          options.cause.message,
          options.apiKeyToRedact,
        );
        if (typeof options.cause.stack === "string") {
          options.cause.stack = PterodactylError.sanitizeMessage(
            options.cause.stack,
            options.apiKeyToRedact,
          );
        }
      }
      this.cause = options.cause;
    }

    if (
      options?.apiKeyToRedact &&
      options.apiKeyToRedact.length >= 4 &&
      typeof this.stack === "string"
    ) {
      this.stack = PterodactylError.sanitizeMessage(this.stack, options.apiKeyToRedact);
    }
  }

  public static sanitizeMessage(message: string, apiKey?: string): string {
    if (!apiKey || apiKey.length < 4) return message;
    return message.split(apiKey).join("[REDACTED]");
  }

  private static sanitizeErrors(
    errors: PterodactylApiErrorDetail[],
    apiKey?: string,
  ): PterodactylApiErrorDetail[] {
    if (!apiKey || apiKey.length < 4) return errors;

    return errors.map((err) => ({
      ...err,
      detail: err.detail ? PterodactylError.sanitizeMessage(err.detail, apiKey) : err.detail,
    }));
  }
}

import { PterodactylError, type PterodactylApiErrorDetail } from "./base.js";

export class PterodactylAuthError extends PterodactylError {
  constructor(
    message = "Authentication failed: Invalid or missing Pterodactyl API key.",
    options?: {
      errors?: PterodactylApiErrorDetail[];
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      statusCode: 401,
      errors: options?.errors,
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
    });
    this.name = "PterodactylAuthError";
  }
}

export class PterodactylForbiddenError extends PterodactylError {
  constructor(
    message = "Permission denied: The API key does not have permission to perform this action.",
    options?: {
      errors?: PterodactylApiErrorDetail[];
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      statusCode: 403,
      errors: options?.errors,
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
    });
    this.name = "PterodactylForbiddenError";
  }
}

export class PterodactylNotFoundError extends PterodactylError {
  constructor(
    message = "Resource not found: The requested Pterodactyl resource does not exist.",
    options?: {
      errors?: PterodactylApiErrorDetail[];
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      statusCode: 404,
      errors: options?.errors,
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
    });
    this.name = "PterodactylNotFoundError";
  }
}

export class PterodactylRateLimitError extends PterodactylError {
  constructor(
    message = "Rate limit exceeded: Too many requests sent to the Pterodactyl panel.",
    options?: {
      retryAfterSeconds?: number;
      attemptCount?: number;
      isRetryable?: boolean;
      errors?: PterodactylApiErrorDetail[];
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      statusCode: 429,
      errors: options?.errors,
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
      attemptCount: options?.attemptCount,
      retryAfterSeconds: options?.retryAfterSeconds,
      isRetryable: options?.isRetryable,
    });
    this.name = "PterodactylRateLimitError";
  }
}

export class PterodactylValidationError extends PterodactylError {
  constructor(
    message = "Validation error: The provided data failed Pterodactyl validation.",
    options?: {
      errors?: PterodactylApiErrorDetail[];
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      statusCode: 422,
      errors: options?.errors,
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
    });
    this.name = "PterodactylValidationError";
  }
}

export class PterodactylServerError extends PterodactylError {
  constructor(
    message = "Pterodactyl server error: The panel encountered an internal error.",
    options?: {
      statusCode?: number;
      errors?: PterodactylApiErrorDetail[];
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      statusCode: options?.statusCode ?? 500,
      errors: options?.errors,
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
    });
    this.name = "PterodactylServerError";
  }
}

export class PterodactylNetworkError extends PterodactylError {
  constructor(
    message = "Network failure: Unable to reach the Pterodactyl panel.",
    options?: {
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
    });
    this.name = "PterodactylNetworkError";
  }
}

export class PterodactylTimeoutError extends PterodactylError {
  public readonly timeoutMs?: number;

  constructor(
    message = "Request timeout: The Pterodactyl panel did not respond in time.",
    options?: {
      timeoutMs?: number;
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
    });
    this.name = "PterodactylTimeoutError";
    this.timeoutMs = options?.timeoutMs;
  }
}

export class PterodactylInvalidResponseError extends PterodactylError {
  constructor(
    message = "Invalid response: The Pterodactyl panel returned malformed or non-JSON data.",
    options?: {
      statusCode?: number;
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      statusCode: options?.statusCode,
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
    });
    this.name = "PterodactylInvalidResponseError";
  }
}

export class PterodactylUrlError extends PterodactylError {
  constructor(message = "Invalid panel URL: Must be a valid HTTP or HTTPS URL.") {
    super(message);
    this.name = "PterodactylUrlError";
  }
}

export class PterodactylAbortError extends PterodactylError {
  constructor(
    message = "Request aborted: The operation was cancelled.",
    options?: {
      attemptCount?: number;
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
      attemptCount: options?.attemptCount,
      isRetryable: false,
    });
    this.name = "PterodactylAbortError";
  }
}

export class PterodactylQueueFullError extends PterodactylError {
  constructor(
    message = "Request queue full: The concurrency limit queue for this panel has reached capacity.",
    options?: {
      apiKeyToRedact?: string;
      cause?: unknown;
    },
  ) {
    super(message, {
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
      isRetryable: false,
    });
    this.name = "PterodactylQueueFullError";
  }
}

export class PterodactylEncryptionConfigError extends PterodactylError {
  constructor(
    message = "Encryption configuration error: Master encryption key is missing or invalid.",
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause, isRetryable: false });
    this.name = "PterodactylEncryptionConfigError";
  }
}

export class PterodactylEncryptionError extends PterodactylError {
  constructor(
    message = "Failed to encrypt credentials.",
    options?: { apiKeyToRedact?: string; cause?: unknown },
  ) {
    super(message, {
      apiKeyToRedact: options?.apiKeyToRedact,
      cause: options?.cause,
      isRetryable: false,
    });
    this.name = "PterodactylEncryptionError";
  }
}

export class PterodactylDecryptionError extends PterodactylError {
  constructor(
    message = "Failed to decrypt credentials: authentication tag mismatch or corrupted ciphertext.",
    options?: { cause?: unknown },
  ) {
    super(message, { cause: options?.cause, isRetryable: false });
    this.name = "PterodactylDecryptionError";
  }
}

export class PterodactylUnsupportedKeyVersionError extends PterodactylError {
  constructor(keyVersion: number) {
    super(`Unsupported encryption key version: ${keyVersion}.`, { isRetryable: false });
    this.name = "PterodactylUnsupportedKeyVersionError";
  }
}

export class PanelConnectionNotFoundError extends PterodactylError {
  constructor(connectionId: string, guildId: string) {
    super(
      `Panel connection "${connectionId}" was not found or does not belong to guild "${guildId}".`,
      { isRetryable: false },
    );
    this.name = "PanelConnectionNotFoundError";
  }
}

export class DuplicateConnectionNameError extends PterodactylError {
  constructor(name: string, guildId: string) {
    super(`A panel connection named "${name}" already exists for guild "${guildId}".`, {
      isRetryable: false,
    });
    this.name = "DuplicateConnectionNameError";
  }
}

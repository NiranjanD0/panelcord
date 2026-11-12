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
  public readonly retryAfterSeconds?: number;

  constructor(
    message = "Rate limit exceeded: Too many requests sent to the Pterodactyl panel.",
    options?: {
      retryAfterSeconds?: number;
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
    });
    this.name = "PterodactylRateLimitError";
    this.retryAfterSeconds = options?.retryAfterSeconds;
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

import {
  PterodactylError,
  PterodactylAuthError,
  PterodactylForbiddenError,
  PterodactylNotFoundError,
  PterodactylRateLimitError,
  PterodactylValidationError,
  PterodactylServerError,
  PterodactylNetworkError,
  PterodactylTimeoutError,
  PterodactylInvalidResponseError,
  PterodactylUrlError,
  PterodactylAbortError,
} from "./errors/index.js";
import type {
  PterodactylClientConfig,
  HttpMethod,
  RequestOptions,
  PterodactylErrorResponse,
  RetryConfig,
} from "./types/index.js";
import { AccountEndpoint } from "./endpoints/account.js";
import { ServersEndpoint } from "./endpoints/servers.js";
import {
  validateAndNormalizePanelUrl,
  isBlockedHost,
  type UrlValidationOptions,
} from "./security.js";
import {
  DEFAULT_MAX_RETRIES,
  DEFAULT_BASE_DELAY_MS,
  DEFAULT_MAX_DELAY_MS,
  DEFAULT_RETRYABLE_STATUS_CODES,
  parseRetryAfter,
  isIdempotentMethod,
  isRetryableStatusCode,
  calculateBackoff,
  sleep,
  PanelConcurrencyManager,
} from "./resilience/index.js";

export const DEFAULT_TIMEOUT_MS = 10_000;
export const MAX_REDIRECTS = 3;
export const PTERODACTYL_ACCEPT_HEADER = "application/vnd.pterodactyl.v1+json, application/json";

export function normalizePanelUrl(rawUrl: string, options?: UrlValidationOptions): URL {
  return validateAndNormalizePanelUrl(rawUrl, options);
}

export class PterodactylClient {
  public readonly baseUrl: URL;
  private readonly apiKey: string;
  public readonly defaultTimeoutMs: number;
  public readonly account: AccountEndpoint;
  public readonly servers: ServersEndpoint;
  public readonly allowPrivateNetworks: boolean;
  public readonly retryConfig: Required<RetryConfig>;
  public readonly concurrencyManager: PanelConcurrencyManager;

  constructor(
    config: PterodactylClientConfig & {
      allowPrivateNetworks?: boolean;
      concurrencyManager?: PanelConcurrencyManager;
    },
  ) {
    if (!config.apiKey || typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw new PterodactylAuthError("API key must be a non-empty string.");
    }

    this.allowPrivateNetworks = config.allowPrivateNetworks === true;
    this.baseUrl = normalizePanelUrl(config.baseUrl, {
      allowPrivateNetworks: this.allowPrivateNetworks,
    });
    this.apiKey = config.apiKey.trim();
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;

    const baseRetryCodes = config.retry?.retryableStatusCodes ?? DEFAULT_RETRYABLE_STATUS_CODES;
    const retryHttp500 = config.retry?.retryHttp500 === true;
    const initialRetryCodes =
      retryHttp500 && !baseRetryCodes.includes(500) ? [...baseRetryCodes, 500] : baseRetryCodes;

    this.retryConfig = {
      maxRetries: config.retry?.maxRetries ?? DEFAULT_MAX_RETRIES,
      baseDelayMs: config.retry?.baseDelayMs ?? DEFAULT_BASE_DELAY_MS,
      maxDelayMs: config.retry?.maxDelayMs ?? DEFAULT_MAX_DELAY_MS,
      jitter: config.retry?.jitter ?? true,
      retryableStatusCodes: initialRetryCodes,
      retryHttp500,
      exceededMaxDelayBehavior: config.retry?.exceededMaxDelayBehavior ?? "fail",
    };

    this.concurrencyManager =
      config.concurrencyManager ?? new PanelConcurrencyManager(config.concurrency);
    this.account = new AccountEndpoint(this);
    this.servers = new ServersEndpoint(this);
  }

  public get sanitizedBaseUrl(): string {
    return this.baseUrl.origin;
  }

  private buildRequestUrl(
    path: string,
    query?: Record<string, string | number | boolean | undefined | null>,
  ): URL {
    let targetUrl: URL;

    if (path.startsWith("http://") || path.startsWith("https://") || path.startsWith("//")) {
      try {
        targetUrl = new URL(path, this.baseUrl);
      } catch {
        throw new PterodactylUrlError(`Invalid request path/URL: "${path}"`);
      }
    } else {
      const cleanPath = path.startsWith("/") ? path : `/${path}`;
      targetUrl = new URL(cleanPath, this.baseUrl);
    }

    // SSRF Guard: Prevent accidental credential forwarding to unrelated hosts
    if (
      targetUrl.hostname.toLowerCase() !== this.baseUrl.hostname.toLowerCase() ||
      targetUrl.port !== this.baseUrl.port
    ) {
      throw new PterodactylUrlError(
        "Prevented request to unrelated origin (credential leak protection).",
      );
    }

    if (query) {
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null) {
          targetUrl.searchParams.set(key, String(value));
        }
      }
    }

    return targetUrl;
  }

  /**
   * Executes an API request protected by per-panel concurrency queueing and exponential retries.
   */
  public async request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T> {
    return this.concurrencyManager.acquire(
      this.sanitizedBaseUrl,
      () => this.executeWithRetry<T>(method, path, options),
      options?.signal,
      options?.concurrency,
    );
  }

  private async executeWithRetry<T>(
    method: HttpMethod,
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const effectiveRetryCodes = this.resolveRetryableStatusCodes(options?.retry);

    const effectiveRetryConfig: Required<RetryConfig> = {
      maxRetries: options?.retry?.maxRetries ?? this.retryConfig.maxRetries,
      baseDelayMs: options?.retry?.baseDelayMs ?? this.retryConfig.baseDelayMs,
      maxDelayMs: options?.retry?.maxDelayMs ?? this.retryConfig.maxDelayMs,
      jitter: options?.retry?.jitter ?? this.retryConfig.jitter,
      retryableStatusCodes: effectiveRetryCodes,
      retryHttp500: options?.retry?.retryHttp500 ?? this.retryConfig.retryHttp500,
      exceededMaxDelayBehavior:
        options?.retry?.exceededMaxDelayBehavior ?? this.retryConfig.exceededMaxDelayBehavior,
    };

    const isIdempotent = isIdempotentMethod(method);
    const allowRetry = isIdempotent || options?.retryUnsafeMethods === true;
    const maxRetries = allowRetry ? effectiveRetryConfig.maxRetries : 0;

    let attempt = 0;
    while (true) {
      if (options?.signal?.aborted) {
        throw new PterodactylAbortError("Request aborted by caller.", {
          attemptCount: attempt + 1,
          apiKeyToRedact: this.apiKey,
          cause: options.signal.reason,
        });
      }

      try {
        return await this.executeSingleRequest<T>(method, path, options);
      } catch (err) {
        const attemptCount = attempt + 1;

        // If cancelled by caller, never retry
        if (options?.signal?.aborted || err instanceof PterodactylAbortError) {
          if (err instanceof PterodactylError) {
            err.attemptCount = attemptCount;
            err.isRetryable = false;
          }
          throw err;
        }

        const isRetryable =
          allowRetry && this.isErrorRetryable(err, effectiveRetryConfig.retryableStatusCodes);

        if (!isRetryable || attempt >= maxRetries) {
          if (err instanceof PterodactylError) {
            err.attemptCount = attemptCount;
            err.isRetryable = isRetryable;
          }
          throw err;
        }

        // Retry permitted: extract server Retry-After delay if present
        const retryAfterSeconds =
          err instanceof PterodactylRateLimitError ? err.retryAfterSeconds : undefined;

        const delayMs = calculateBackoff(attempt, effectiveRetryConfig, retryAfterSeconds);
        if (delayMs < 0) {
          // Server's requested delay exceeds maxDelayMs under "fail" policy; never retry early
          if (err instanceof PterodactylError) {
            err.attemptCount = attemptCount;
            err.isRetryable = false;
          }
          throw err;
        }

        await sleep(delayMs, options?.signal);
        attempt++;
      }
    }
  }

  private resolveRetryableStatusCodes(requestRetry?: RetryConfig): number[] {
    const baseCodes = requestRetry?.retryableStatusCodes ?? this.retryConfig.retryableStatusCodes;
    const retryHttp500 = requestRetry?.retryHttp500 ?? this.retryConfig.retryHttp500;

    if (retryHttp500 && !baseCodes.includes(500)) {
      return [...baseCodes, 500];
    }
    return baseCodes;
  }

  private isErrorRetryable(err: unknown, retryableStatuses: number[]): boolean {
    if (err instanceof PterodactylRateLimitError) {
      return true;
    }
    if (err instanceof PterodactylServerError) {
      return isRetryableStatusCode(err.statusCode, retryableStatuses);
    }
    if (err instanceof PterodactylNetworkError || err instanceof PterodactylTimeoutError) {
      return true;
    }
    return false;
  }

  private async executeSingleRequest<T>(
    method: HttpMethod,
    path: string,
    options?: RequestOptions,
  ): Promise<T> {
    const targetUrl = this.buildRequestUrl(path, options?.query);
    const effectiveTimeout = options?.timeoutMs ?? this.defaultTimeoutMs;

    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: PTERODACTYL_ACCEPT_HEADER,
      ...options?.headers,
    };

    let bodyPayload: string | undefined;
    if (options?.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyPayload = JSON.stringify(options.body);
    }

    const timeoutSignal = AbortSignal.timeout(effectiveTimeout);
    const combinedSignal = options?.signal
      ? AbortSignal.any([options.signal, timeoutSignal])
      : timeoutSignal;

    try {
      let currentUrl = targetUrl;
      let currentMethod = method;
      let currentBody = bodyPayload;
      let redirectCount = 0;
      const visitedUrls = new Set<string>([currentUrl.toString()]);
      let response: Response;

      while (true) {
        response = await fetch(currentUrl.toString(), {
          method: currentMethod,
          headers,
          body: currentBody,
          redirect: "manual",
          signal: combinedSignal,
        });

        // Safe redirect handling with loop detection & cross-origin credential protection
        if (
          response.status >= 301 &&
          response.status <= 308 &&
          response.status !== 304 &&
          response.status !== 305 &&
          response.status !== 306
        ) {
          redirectCount++;
          if (redirectCount > MAX_REDIRECTS) {
            throw new PterodactylUrlError(
              "Too many redirects encountered while connecting to Pterodactyl panel.",
            );
          }

          const locationHeader = response.headers.get("location");
          if (!locationHeader) {
            break;
          }

          let redirectUrl: URL;
          try {
            redirectUrl = new URL(locationHeader, currentUrl);
          } catch {
            throw new PterodactylUrlError(`Invalid redirect Location URL: "${locationHeader}"`);
          }

          // Loop detection
          if (visitedUrls.has(redirectUrl.toString())) {
            throw new PterodactylUrlError(
              `Redirect loop detected: "${redirectUrl.toString()}" was already visited.`,
            );
          }
          visitedUrls.add(redirectUrl.toString());

          // Reject redirect with embedded credentials
          if (redirectUrl.username || redirectUrl.password) {
            throw new PterodactylUrlError("Prevented redirect containing embedded credentials.");
          }

          // Reject redirect to blocked hosts
          if (
            isBlockedHost(redirectUrl.hostname, {
              allowPrivateNetworks: this.allowPrivateNetworks,
            })
          ) {
            throw new PterodactylUrlError(
              `Prevented redirect to blocked host: "${redirectUrl.hostname}".`,
            );
          }

          // Verify host and port match authorized base URL
          const isSameHost =
            redirectUrl.hostname.toLowerCase() === this.baseUrl.hostname.toLowerCase();
          const isPortMatch = redirectUrl.port === this.baseUrl.port;
          const isDowngrade =
            this.baseUrl.protocol === "https:" && redirectUrl.protocol === "http:";

          if (!isSameHost || !isPortMatch || isDowngrade) {
            throw new PterodactylUrlError(
              "Prevented cross-origin redirect to protect API credentials.",
            );
          }

          currentUrl = redirectUrl;

          // Adjust HTTP method according to standard redirect rules
          if (
            response.status === 303 ||
            ((response.status === 301 || response.status === 302) && currentMethod === "POST")
          ) {
            currentMethod = "GET";
            currentBody = undefined;
            delete headers["Content-Type"];
          }

          continue;
        }

        break;
      }

      if (response.status === 204) {
        return undefined as T;
      }

      let responseText = "";
      try {
        responseText = await response.text();
      } catch (readError) {
        throw new PterodactylNetworkError("Failed to read response body from Pterodactyl panel.", {
          apiKeyToRedact: this.apiKey,
          cause: readError,
        });
      }

      let parsedData: unknown = null;
      if (responseText.length > 0) {
        try {
          parsedData = JSON.parse(responseText);
        } catch (jsonErr) {
          if (response.ok) {
            throw new PterodactylInvalidResponseError(
              "Pterodactyl panel returned non-JSON response.",
              {
                statusCode: response.status,
                apiKeyToRedact: this.apiKey,
                cause: jsonErr,
              },
            );
          }
        }
      }

      if (response.ok) {
        return parsedData as T;
      }

      // Handle non-OK HTTP status codes
      const errorDetails = (parsedData as PterodactylErrorResponse | null)?.errors || [];
      const primaryDetail = errorDetails[0]?.detail || errorDetails[0]?.code || response.statusText;

      switch (response.status) {
        case 401:
          throw new PterodactylAuthError(primaryDetail, {
            errors: errorDetails,
            apiKeyToRedact: this.apiKey,
          });
        case 403:
          throw new PterodactylForbiddenError(primaryDetail, {
            errors: errorDetails,
            apiKeyToRedact: this.apiKey,
          });
        case 404:
          throw new PterodactylNotFoundError(primaryDetail, {
            errors: errorDetails,
            apiKeyToRedact: this.apiKey,
          });
        case 422:
          throw new PterodactylValidationError(primaryDetail, {
            errors: errorDetails,
            apiKeyToRedact: this.apiKey,
          });
        case 429: {
          const retryAfterHeader = response.headers.get("retry-after");
          const retryAfterSeconds = parseRetryAfter(retryAfterHeader);
          throw new PterodactylRateLimitError(primaryDetail, {
            retryAfterSeconds,
            errors: errorDetails,
            apiKeyToRedact: this.apiKey,
          });
        }
        default:
          if (response.status >= 500 && response.status <= 599) {
            throw new PterodactylServerError(primaryDetail || "Internal panel server error.", {
              statusCode: response.status,
              errors: errorDetails,
              apiKeyToRedact: this.apiKey,
            });
          }
          throw new PterodactylError(`HTTP ${response.status}: ${primaryDetail}`, {
            statusCode: response.status,
            errors: errorDetails,
            apiKeyToRedact: this.apiKey,
          });
      }
    } catch (err) {
      if (err instanceof PterodactylError) {
        throw err;
      }

      if (options?.signal?.aborted) {
        throw new PterodactylAbortError("Request cancelled by caller.", {
          apiKeyToRedact: this.apiKey,
          cause: options.signal.reason,
        });
      }

      if (err instanceof Error) {
        if (err.name === "TimeoutError" || timeoutSignal.aborted) {
          throw new PterodactylTimeoutError(`Request timed out after ${effectiveTimeout}ms.`, {
            timeoutMs: effectiveTimeout,
            apiKeyToRedact: this.apiKey,
            cause: err,
          });
        }
        if (err.name === "AbortError") {
          throw new PterodactylAbortError("Request was cancelled.", {
            apiKeyToRedact: this.apiKey,
            cause: err,
          });
        }
      }

      throw new PterodactylNetworkError(
        `Network error while communicating with Pterodactyl panel: ${err instanceof Error ? err.message : String(err)}`,
        {
          apiKeyToRedact: this.apiKey,
          cause: err,
        },
      );
    }
  }

  public get<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("GET", path, options);
  }

  public head<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("HEAD", path, options);
  }

  public post<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("POST", path, { ...options, body });
  }

  public put<T>(path: string, body?: unknown, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("PUT", path, { ...options, body });
  }

  public patch<T>(
    path: string,
    body?: unknown,
    options?: Omit<RequestOptions, "body">,
  ): Promise<T> {
    return this.request<T>("PATCH", path, { ...options, body });
  }

  public delete<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("DELETE", path, options);
  }

  public options<T>(path: string, options?: Omit<RequestOptions, "body">): Promise<T> {
    return this.request<T>("OPTIONS", path, options);
  }
}

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
} from "./errors/index.js";
import type {
  PterodactylClientConfig,
  HttpMethod,
  RequestOptions,
  PterodactylErrorResponse,
} from "./types/index.js";
import { AccountEndpoint } from "./endpoints/account.js";
import {
  validateAndNormalizePanelUrl,
  isBlockedHost,
  type UrlValidationOptions,
} from "./security.js";

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
  public readonly allowPrivateNetworks: boolean;

  constructor(config: PterodactylClientConfig & { allowPrivateNetworks?: boolean }) {
    if (!config.apiKey || typeof config.apiKey !== "string" || config.apiKey.trim().length === 0) {
      throw new PterodactylAuthError("API key must be a non-empty string.");
    }

    this.allowPrivateNetworks = config.allowPrivateNetworks === true;
    this.baseUrl = normalizePanelUrl(config.baseUrl, {
      allowPrivateNetworks: this.allowPrivateNetworks,
    });
    this.apiKey = config.apiKey.trim();
    this.defaultTimeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.account = new AccountEndpoint(this);
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

  public async request<T>(method: HttpMethod, path: string, options?: RequestOptions): Promise<T> {
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
          signal: AbortSignal.timeout(effectiveTimeout),
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

          // Reject redirect to blocked hosts (cloud metadata, private networks unless allowed, etc.)
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
          const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : undefined;
          throw new PterodactylRateLimitError(primaryDetail, {
            retryAfterSeconds:
              retryAfterSeconds !== undefined && !isNaN(retryAfterSeconds)
                ? retryAfterSeconds
                : undefined,
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

      if (err instanceof Error) {
        if (err.name === "TimeoutError" || err.name === "AbortError") {
          throw new PterodactylTimeoutError(`Request timed out after ${effectiveTimeout}ms.`, {
            timeoutMs: effectiveTimeout,
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
}

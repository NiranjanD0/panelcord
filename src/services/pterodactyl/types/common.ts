import type { PterodactylApiErrorDetail } from "../errors/base.js";

export interface RetryConfig {
  /** Maximum number of retry attempts for retryable failures (default: 3) */
  maxRetries?: number;
  /** Base delay in ms for exponential backoff (default: 1000) */
  baseDelayMs?: number;
  /** Maximum delay in ms for exponential backoff (default: 30000) */
  maxDelayMs?: number;
  /** Whether to apply randomized jitter to backoff delay (default: true) */
  jitter?: boolean;
  /** HTTP status codes considered retryable (default: [429, 502, 503, 504]) */
  retryableStatusCodes?: number[];
  /**
   * Whether to treat HTTP 500 Internal Server Error as a retryable transient failure.
   * Default: false (Pterodactyl 500s often indicate unrecoverable DB/code exceptions,
   * but some self-hosted panels experience transient internal errors).
   */
  retryHttp500?: boolean;
  /**
   * Policy when a server's Retry-After header exceeds the configured maxDelayMs.
   * - "fail" (default): Never retry earlier than requested; fail immediately with PterodactylRateLimitError.
   * - "defer": Respect the server's full delay without capping at maxDelayMs.
   */
  exceededMaxDelayBehavior?: "fail" | "defer";
}

export interface ConcurrencyConfig {
  /** Maximum concurrent requests per panel origin (default: 5) */
  maxConcurrent?: number;
  /** Maximum queue size for pending requests per panel origin (default: 100) */
  maxQueueSize?: number;
}

export interface PterodactylClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;
  allowPrivateNetworks?: boolean;
  retry?: RetryConfig;
  concurrency?: ConcurrencyConfig;
}

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface RequestOptions {
  query?: Record<string, string | number | boolean | undefined | null>;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  /**
   * Explicitly allow retrying non-idempotent/unsafe HTTP methods (POST, PUT, PATCH, DELETE).
   * Default: false (only safe idempotent GET, HEAD, OPTIONS methods are retried).
   */
  retryUnsafeMethods?: boolean;
  /**
   * Override retry policy for this specific request.
   */
  retry?: RetryConfig;
  /**
   * Override concurrency configuration for this specific request.
   */
  concurrency?: ConcurrencyConfig;
}

export interface PterodactylHttpClient {
  get<T>(path: string, options?: RequestOptions): Promise<T>;
  post<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  put<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  patch<T>(path: string, body?: unknown, options?: RequestOptions): Promise<T>;
  delete<T>(path: string, options?: RequestOptions): Promise<T>;
}

export interface PterodactylPaginationLinks {
  next?: string | null;
  previous?: string | null;
}

export interface PterodactylPagination {
  total: number;
  count: number;
  per_page: number;
  current_page: number;
  total_pages: number;
  links?: PterodactylPaginationLinks;
}

export interface PterodactylMeta {
  pagination?: PterodactylPagination;
  [key: string]: unknown;
}

export interface PterodactylFractalItem<T> {
  object: string;
  attributes: T;
  meta?: Record<string, unknown>;
}

export interface PterodactylFractalList<T> {
  object: "list";
  data: PterodactylFractalItem<T>[];
  meta?: PterodactylMeta;
}

export interface PterodactylErrorResponse {
  errors: PterodactylApiErrorDetail[];
}

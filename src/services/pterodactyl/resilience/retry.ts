import type { HttpMethod } from "../types/common.js";
import { PterodactylAbortError } from "../errors/specific.js";

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_BASE_DELAY_MS = process.env.NODE_ENV === "test" ? 5 : 1000;
export const DEFAULT_MAX_DELAY_MS = 30000;
export const DEFAULT_RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

/**
 * Parses HTTP Retry-After header values supporting both delay-seconds (e.g. "30")
 * and HTTP-date formats (RFC 7231 / IMF-fixdate, e.g. "Wed, 21 Oct 2026 07:28:30 GMT").
 *
 * @param headerValue The raw Retry-After header string from the response
 * @param now Current timestamp in milliseconds (defaults to Date.now())
 * @returns Non-negative number of seconds to wait, or undefined if missing/malformed
 */
export function parseRetryAfter(
  headerValue: string | null | undefined,
  now = Date.now(),
): number | undefined {
  if (!headerValue || typeof headerValue !== "string") {
    return undefined;
  }

  const trimmed = headerValue.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // 1. Check for integer delay-seconds
  if (/^\d+$/.test(trimmed)) {
    const seconds = parseInt(trimmed, 10);
    return !isNaN(seconds) && seconds >= 0 ? seconds : undefined;
  }

  // HTTP-date requires alphabetic components (e.g. day or month name like "Wed", "Oct", "GMT")
  // Reject negative numbers, decimals, or numeric punctuation sequences
  if (!/[a-zA-Z]/.test(trimmed)) {
    return undefined;
  }

  // 2. Check for HTTP-date format (RFC 7231 / RFC 2822)
  const timestamp = Date.parse(trimmed);
  if (!isNaN(timestamp)) {
    const diffMs = timestamp - now;
    return Math.max(0, Math.ceil(diffMs / 1000));
  }

  return undefined;
}

/**
 * Checks whether an HTTP method is safe and idempotent according to RFC 9110.
 * GET, HEAD, and OPTIONS are safe to retry automatically; mutating methods
 * (POST, PUT, PATCH, DELETE) must not be retried blindly.
 */
export function isIdempotentMethod(method: HttpMethod): boolean {
  return method === "GET" || method === "HEAD" || method === "OPTIONS";
}

/**
 * Checks whether an HTTP status code represents a transient, retryable failure.
 */
export function isRetryableStatusCode(
  statusCode?: number,
  customCodes: number[] = DEFAULT_RETRYABLE_STATUS_CODES,
): boolean {
  if (statusCode === undefined) return false;
  return customCodes.includes(statusCode);
}

/**
 * Calculates exponential backoff delay with randomized jitter and respects server Retry-After headers.
 *
 * @param attempt Current retry attempt index (0 for first retry)
 * @param config Retry policy configuration
 * @param retryAfterSeconds Server-provided Retry-After delay in seconds
 * @returns Delay in milliseconds
 */
export function calculateBackoff(
  attempt: number,
  config: { baseDelayMs: number; maxDelayMs: number; jitter: boolean },
  retryAfterSeconds?: number,
): number {
  const safeAttempt = Math.max(0, attempt);
  const exponential = config.baseDelayMs * Math.pow(2, safeAttempt);

  let delay = exponential;
  if (config.jitter) {
    // Bounded jitter factor between 0.5 and 1.0 of the exponential delay
    const jitterFactor = 0.5 + Math.random() * 0.5;
    delay = Math.round(exponential * jitterFactor);
  }

  // Respect server-specified Retry-After header delay if it exceeds calculated backoff
  if (typeof retryAfterSeconds === "number" && !isNaN(retryAfterSeconds) && retryAfterSeconds > 0) {
    const retryAfterMs = retryAfterSeconds * 1000;
    if (retryAfterMs > delay) {
      delay = retryAfterMs;
    }
  }

  return Math.min(delay, config.maxDelayMs);
}

/**
 * Asynchronously pauses execution for a specified duration, supporting immediate cancellation via AbortSignal.
 */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      return reject(
        new PterodactylAbortError("Request aborted while awaiting retry backoff delay.", {
          cause: signal.reason,
        }),
      );
    }

    if (ms <= 0) {
      return resolve();
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const cleanup = () => {
      if (timer !== undefined) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    };

    const onAbort = () => {
      cleanup();
      reject(
        new PterodactylAbortError("Request aborted while awaiting retry backoff delay.", {
          cause: signal?.reason,
        }),
      );
    };

    if (signal) {
      signal.addEventListener("abort", onAbort, { once: true });
    }

    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
  });
}

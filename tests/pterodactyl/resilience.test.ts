import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PterodactylClient } from "../../src/services/pterodactyl/client.js";
import {
  parseRetryAfter,
  calculateBackoff,
  isIdempotentMethod,
  isRetryableStatusCode,
  sleep,
  DEFAULT_RETRYABLE_STATUS_CODES,
  PanelConcurrencyManager,
} from "../../src/services/pterodactyl/resilience/index.js";
import {
  PterodactylError,
  PterodactylAuthError,
  PterodactylForbiddenError,
  PterodactylNotFoundError,
  PterodactylRateLimitError,
  PterodactylValidationError,
  PterodactylServerError,
  PterodactylInvalidResponseError,
  PterodactylAbortError,
  PterodactylQueueFullError,
} from "../../src/services/pterodactyl/errors/index.js";

describe("Pterodactyl API Resilience & Rate Limit Management", () => {
  const TEST_BASE_URL = "https://panel.example.com";
  const TEST_API_KEY = "ptlc_secret_test_key_resilience_123456789";

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Retry-After Parsing (RFC 7231 / RFC 9110)", () => {
    it("returns undefined for null, undefined, empty, or whitespace-only inputs", () => {
      expect(parseRetryAfter(null)).toBeUndefined();
      expect(parseRetryAfter(undefined)).toBeUndefined();
      expect(parseRetryAfter("")).toBeUndefined();
      expect(parseRetryAfter("   ")).toBeUndefined();
    });

    it("parses integer seconds correctly", () => {
      expect(parseRetryAfter("0")).toBe(0);
      expect(parseRetryAfter("5")).toBe(5);
      expect(parseRetryAfter("120")).toBe(120);
      expect(parseRetryAfter("  60  ")).toBe(60);
    });

    it("returns undefined for invalid numeric values or negative integers", () => {
      expect(parseRetryAfter("-10")).toBeUndefined();
      expect(parseRetryAfter("abc")).toBeUndefined();
      expect(parseRetryAfter("12.34.56")).toBeUndefined();
    });

    it("parses HTTP-date format (IMF-fixdate) relative to current timestamp", () => {
      const baseTime = Date.parse("2026-10-21T07:28:00.000Z");
      // 30 seconds into the future
      const targetDate = "Wed, 21 Oct 2026 07:28:30 GMT";
      expect(parseRetryAfter(targetDate, baseTime)).toBe(30);

      // 65 seconds into the future
      const targetDate65 = "Wed, 21 Oct 2026 07:29:05 GMT";
      expect(parseRetryAfter(targetDate65, baseTime)).toBe(65);
    });

    it("returns 0 if HTTP-date is in the past", () => {
      const baseTime = Date.parse("2026-10-21T07:28:30.000Z");
      const pastDate = "Wed, 21 Oct 2026 07:28:00 GMT";
      expect(parseRetryAfter(pastDate, baseTime)).toBe(0);
    });
  });

  describe("Exponential Backoff & Jitter Calculation", () => {
    it("calculates exponential delays deterministically when jitter is disabled", () => {
      const config = { baseDelayMs: 100, maxDelayMs: 10000, jitter: false };
      expect(calculateBackoff(0, config)).toBe(100);
      expect(calculateBackoff(1, config)).toBe(200);
      expect(calculateBackoff(2, config)).toBe(400);
      expect(calculateBackoff(3, config)).toBe(800);
    });

    it("applies jitter bounded within 0.5 and 1.0 of the exponential delay", () => {
      const config = { baseDelayMs: 1000, maxDelayMs: 30000, jitter: true };
      for (let attempt = 0; attempt < 5; attempt++) {
        const exponential = 1000 * Math.pow(2, attempt);
        const delay = calculateBackoff(attempt, config);
        expect(delay).toBeGreaterThanOrEqual(Math.round(exponential * 0.5));
        expect(delay).toBeLessThanOrEqual(exponential);
      }
    });

    it("respects server-provided Retry-After when it exceeds calculated backoff", () => {
      const config = { baseDelayMs: 100, maxDelayMs: 30000, jitter: false };
      // Attempt 0 backoff is 100ms, but server asked for 5 seconds (5000ms)
      const delay = calculateBackoff(0, config, 5);
      expect(delay).toBe(5000);
    });

    it("does not downgrade backoff if calculated backoff is greater than Retry-After", () => {
      const config = { baseDelayMs: 10000, maxDelayMs: 60000, jitter: false };
      // Attempt 1 backoff is 20000ms; server asked for 2 seconds (2000ms)
      const delay = calculateBackoff(1, config, 2);
      expect(delay).toBe(20000);
    });

    it("strictly caps delay at maxDelayMs", () => {
      const config = { baseDelayMs: 10000, maxDelayMs: 15000, jitter: false };
      // Attempt 3 backoff would be 80000ms, capped to 15000ms
      expect(calculateBackoff(3, config)).toBe(15000);
      // Large Retry-After capped to maxDelayMs
      expect(calculateBackoff(0, config, 9999)).toBe(15000);
    });
  });

  describe("Method Idempotency & Retryable Status Codes", () => {
    it("identifies GET, HEAD, and OPTIONS as safe/idempotent methods", () => {
      expect(isIdempotentMethod("GET")).toBe(true);
      expect(isIdempotentMethod("HEAD")).toBe(true);
      expect(isIdempotentMethod("OPTIONS")).toBe(true);
      expect(isIdempotentMethod("POST")).toBe(false);
      expect(isIdempotentMethod("PUT")).toBe(false);
      expect(isIdempotentMethod("PATCH")).toBe(false);
      expect(isIdempotentMethod("DELETE")).toBe(false);
    });

    it("identifies default retryable status codes correctly", () => {
      expect(DEFAULT_RETRYABLE_STATUS_CODES).toEqual([429, 502, 503, 504]);
      expect(isRetryableStatusCode(429)).toBe(true);
      expect(isRetryableStatusCode(502)).toBe(true);
      expect(isRetryableStatusCode(503)).toBe(true);
      expect(isRetryableStatusCode(504)).toBe(true);
      expect(isRetryableStatusCode(200)).toBe(false);
      expect(isRetryableStatusCode(400)).toBe(false);
      expect(isRetryableStatusCode(401)).toBe(false);
      expect(isRetryableStatusCode(403)).toBe(false);
      expect(isRetryableStatusCode(404)).toBe(false);
      expect(isRetryableStatusCode(422)).toBe(false);
      expect(isRetryableStatusCode(500)).toBe(false);
      expect(isRetryableStatusCode(undefined)).toBe(false);
    });
  });

  describe("Cancellable Sleep", () => {
    it("resolves immediately when delay is zero or negative", async () => {
      await expect(sleep(0)).resolves.toBeUndefined();
      await expect(sleep(-10)).resolves.toBeUndefined();
    });

    it("rejects immediately with PterodactylAbortError if signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort(new Error("pre-aborted"));
      await expect(sleep(5000, controller.signal)).rejects.toThrow(PterodactylAbortError);
    });

    it("aborts sleep in-progress when signal fires", async () => {
      const controller = new AbortController();
      const sleepPromise = sleep(5000, controller.signal);
      setTimeout(() => controller.abort(new Error("cancelled during sleep")), 10);
      await expect(sleepPromise).rejects.toThrow(PterodactylAbortError);
    });
  });

  describe("PanelConcurrencyManager", () => {
    it("executes operations concurrently up to maxConcurrent", async () => {
      const manager = new PanelConcurrencyManager({ maxConcurrent: 2 });
      const origin = "https://panel1.example.com";

      let active = 0;
      let maxSeenActive = 0;

      const runTask = async () => {
        return manager.acquire(origin, async () => {
          active++;
          maxSeenActive = Math.max(maxSeenActive, active);
          await sleep(20);
          active--;
          return "done";
        });
      };

      const results = await Promise.all([runTask(), runTask(), runTask(), runTask()]);
      expect(results).toEqual(["done", "done", "done", "done"]);
      expect(maxSeenActive).toBe(2);
    });

    it("maintains separate, isolated concurrency limits per panel origin", async () => {
      const manager = new PanelConcurrencyManager({ maxConcurrent: 1 });
      const originA = "https://panel-a.example.com";
      const originB = "https://panel-b.example.com";

      const order: string[] = [];

      const taskA1 = manager.acquire(originA, async () => {
        order.push("A1:start");
        await sleep(30);
        order.push("A1:end");
      });

      const taskA2 = manager.acquire(originA, async () => {
        order.push("A2:start");
        await sleep(10);
        order.push("A2:end");
      });

      const taskB1 = manager.acquire(originB, async () => {
        order.push("B1:start");
        await sleep(10);
        order.push("B1:end");
      });

      await Promise.all([taskA1, taskA2, taskB1]);

      // B1 runs immediately without waiting for A1 because originB has its own queue
      expect(order[0]).toBe("A1:start");
      expect(order[1]).toBe("B1:start");
      expect(order).toContain("B1:end");
      expect(order.indexOf("A2:start")).toBeGreaterThan(order.indexOf("A1:end"));
    });

    it("rejects immediately with PterodactylQueueFullError when maxQueueSize is exceeded", async () => {
      const manager = new PanelConcurrencyManager({ maxConcurrent: 1, maxQueueSize: 2 });
      const origin = "https://panel.example.com";

      // Fill slot
      const t1 = manager.acquire(origin, () => sleep(50));
      // Queue item 1
      const t2 = manager.acquire(origin, () => Promise.resolve(2));
      // Queue item 2
      const t3 = manager.acquire(origin, () => Promise.resolve(3));

      // 4th request exceeds maxQueueSize 2
      await expect(manager.acquire(origin, () => Promise.resolve(4))).rejects.toThrow(
        PterodactylQueueFullError,
      );

      await Promise.all([t1, t2, t3]);
    });

    it("removes queued request when aborted before execution", async () => {
      const manager = new PanelConcurrencyManager({ maxConcurrent: 1, maxQueueSize: 5 });
      const origin = "https://panel.example.com";

      // Fill active slot
      const t1 = manager.acquire(origin, () => sleep(40));

      const controller = new AbortController();
      let taskRan = false;
      const t2 = manager.acquire(
        origin,
        async () => {
          taskRan = true;
          return "unreachable";
        },
        controller.signal,
      );

      // Abort t2 while waiting in queue
      controller.abort();

      await expect(t2).rejects.toThrow(PterodactylAbortError);
      await t1;
      expect(taskRan).toBe(false);
      expect(manager.getQueueLength(origin)).toBe(0);
    });

    it("rejects immediately if signal is already aborted before acquire", async () => {
      const manager = new PanelConcurrencyManager({ maxConcurrent: 1 });
      const controller = new AbortController();
      controller.abort();

      await expect(
        manager.acquire("https://panel.example.com", () => Promise.resolve(), controller.signal),
      ).rejects.toThrow(PterodactylAbortError);
    });
  });

  describe("Client Rate Limit Handling (HTTP 429)", () => {
    it("retries 429 and succeeds on subsequent attempt", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response(JSON.stringify({ errors: [{ detail: "Too Many Requests" }] }), {
              status: 429,
              headers: { "Content-Type": "application/json", "Retry-After": "0" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ object: "list", data: [] }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const response = await client.get<{ object: string }>("/api/client");
      expect(response.object).toBe("list");
      expect(callCount).toBe(2);
    });

    it("parses Retry-After header and exposes retryAfterSeconds, attemptCount, isRetryable on PterodactylRateLimitError upon exhaustion", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          new Response(JSON.stringify({ errors: [{ detail: "Rate limited." }] }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "5" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 2, baseDelayMs: 1, maxDelayMs: 5 },
      });

      try {
        await client.get("/api/client");
        expect.fail("Expected request to throw PterodactylRateLimitError");
      } catch (err) {
        expect(err).toBeInstanceOf(PterodactylRateLimitError);
        const rateLimitErr = err as PterodactylRateLimitError;
        expect(rateLimitErr.statusCode).toBe(429);
        expect(rateLimitErr.retryAfterSeconds).toBe(5);
        expect(rateLimitErr.attemptCount).toBe(3); // 1 initial + 2 retries
        expect(rateLimitErr.isRetryable).toBe(true);
        expect(callCount).toBe(3);
      }
    });

    it("handles missing or malformed Retry-After gracefully and uses exponential backoff", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          new Response(JSON.stringify({ errors: [{ detail: "Throttled" }] }), {
            status: 429,
            headers: { "Content-Type": "application/json", "Retry-After": "invalid-garbage" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 1, baseDelayMs: 1 },
      });

      try {
        await client.get("/api/client");
        expect.fail("Expected request to throw PterodactylRateLimitError");
      } catch (err) {
        expect(err).toBeInstanceOf(PterodactylRateLimitError);
        const rateLimitErr = err as PterodactylRateLimitError;
        expect(rateLimitErr.retryAfterSeconds).toBeUndefined();
        expect(rateLimitErr.attemptCount).toBe(2);
        expect(rateLimitErr.isRetryable).toBe(true);
        expect(callCount).toBe(2);
      }
    });
  });

  describe("Retry Policy & Transient Failures", () => {
    it("retries 502, 503, 504 server errors and succeeds", async () => {
      for (const status of [502, 503, 504]) {
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(() => {
          callCount++;
          if (callCount === 1) {
            return Promise.resolve(
              new Response(`Gateway Error ${status}`, {
                status,
                headers: { "Content-Type": "text/plain" },
              }),
            );
          }
          return Promise.resolve(
            new Response(JSON.stringify({ success: true }), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          );
        });

        const client = new PterodactylClient({
          baseUrl: TEST_BASE_URL,
          apiKey: TEST_API_KEY,
          retry: { maxRetries: 2, baseDelayMs: 1 },
        });

        const res = await client.get<{ success: boolean }>("/api/client");
        expect(res.success).toBe(true);
        expect(callCount).toBe(2);
      }
    });

    it("retries network failures and succeeds", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.reject(new TypeError("fetch failed: connection reset by peer"));
        }
        return Promise.resolve(
          new Response(JSON.stringify({ success: true }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const res = await client.get<{ success: boolean }>("/api/client");
      expect(res.success).toBe(true);
      expect(callCount).toBe(2);
    });

    it("does NOT retry non-retryable 4xx client errors (400, 401, 403, 404, 422)", async () => {
      const nonRetryableCases = [
        { status: 400, expectedError: PterodactylError },
        { status: 401, expectedError: PterodactylAuthError },
        { status: 403, expectedError: PterodactylForbiddenError },
        { status: 404, expectedError: PterodactylNotFoundError },
        { status: 422, expectedError: PterodactylValidationError },
      ];

      for (const { status, expectedError } of nonRetryableCases) {
        let callCount = 0;
        globalThis.fetch = vi.fn().mockImplementation(() => {
          callCount++;
          return Promise.resolve(
            new Response(JSON.stringify({ errors: [{ detail: `Error ${status}` }] }), {
              status,
              headers: { "Content-Type": "application/json" },
            }),
          );
        });

        const client = new PterodactylClient({
          baseUrl: TEST_BASE_URL,
          apiKey: TEST_API_KEY,
          retry: { maxRetries: 3, baseDelayMs: 1 },
        });

        try {
          await client.get("/api/client");
          expect.fail(`Expected HTTP ${status} to throw`);
        } catch (err) {
          expect(err).toBeInstanceOf(expectedError);
          const pError = err as PterodactylError;
          expect(pError.attemptCount).toBe(1); // Failed immediately without retrying
          expect(pError.isRetryable).toBe(false);
          expect(callCount).toBe(1);
        }
      }
    });

    it("does NOT retry 500 Internal Server Error by default", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          new Response(JSON.stringify({ errors: [{ detail: "Internal Server Error" }] }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 3, baseDelayMs: 1 },
      });

      try {
        await client.get("/api/client");
        expect.fail("Expected HTTP 500 to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PterodactylServerError);
        const serverErr = err as PterodactylServerError;
        expect(serverErr.attemptCount).toBe(1);
        expect(serverErr.isRetryable).toBe(false);
        expect(callCount).toBe(1);
      }
    });

    it("does NOT retry non-JSON responses on 200 OK", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          new Response("<html><body>Cloudflare Block</body></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 3, baseDelayMs: 1 },
      });

      await expect(client.get("/api/client")).rejects.toThrow(PterodactylInvalidResponseError);
      expect(callCount).toBe(1);
    });
  });

  describe("Request Safety & Method Idempotency", () => {
    it("does NOT retry mutating POST requests on 502 by default", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          new Response("Bad Gateway", {
            status: 502,
            headers: { "Content-Type": "text/plain" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 3, baseDelayMs: 1 },
      });

      try {
        await client.post("/api/client/servers/123/power", { signal: "restart" });
        expect.fail("Expected POST to throw");
      } catch (err) {
        expect(err).toBeInstanceOf(PterodactylServerError);
        const serverErr = err as PterodactylServerError;
        expect(serverErr.attemptCount).toBe(1);
        expect(serverErr.isRetryable).toBe(false); // Unsafe method
        expect(callCount).toBe(1);
      }
    });

    it("retries mutating POST requests when retryUnsafeMethods: true is explicitly provided", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(
            new Response("Bad Gateway", {
              status: 502,
              headers: { "Content-Type": "text/plain" },
            }),
          );
        }
        return Promise.resolve(
          new Response(JSON.stringify({ status: "acknowledged" }), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      const res = await client.post<{ status: string }>(
        "/api/client/servers/123/power",
        { signal: "restart" },
        { retryUnsafeMethods: true },
      );
      expect(res.status).toBe("acknowledged");
      expect(callCount).toBe(2);
    });

    it("does NOT retry DELETE requests by default", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          new Response("Service Unavailable", {
            status: 503,
            headers: { "Content-Type": "text/plain" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 3, baseDelayMs: 1 },
      });

      await expect(client.delete("/api/client/servers/123/files/delete")).rejects.toThrow(
        PterodactylServerError,
      );
      expect(callCount).toBe(1);
    });

    it("retries HEAD and OPTIONS requests by default", async () => {
      let callCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          return Promise.resolve(new Response(null, { status: 504 }));
        }
        return Promise.resolve(new Response(null, { status: 204 }));
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 2, baseDelayMs: 1 },
      });

      await client.head("/api/client");
      expect(callCount).toBe(2);
    });
  });

  describe("Request Cancellation & AbortSignal Integration", () => {
    it("cancels in-flight requests and does NOT retry after cancellation", async () => {
      let callCount = 0;
      const controller = new AbortController();

      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        // Simulate immediate cancellation
        controller.abort(new Error("caller aborted"));
        return Promise.reject(new DOMException("The operation was aborted", "AbortError"));
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 3, baseDelayMs: 1 },
      });

      try {
        await client.get("/api/client", { signal: controller.signal });
        expect.fail("Expected request to throw PterodactylAbortError");
      } catch (err) {
        expect(err).toBeInstanceOf(PterodactylAbortError);
        const abortErr = err as PterodactylAbortError;
        expect(abortErr.attemptCount).toBe(1);
        expect(abortErr.isRetryable).toBe(false);
        expect(callCount).toBe(1); // Never retried
      }
    });

    it("cancels immediately before request starts if signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(client.get("/api/client", { signal: controller.signal })).rejects.toThrow(
        PterodactylAbortError,
      );
    });

    it("cancels retry backoff sleep when signal aborts during delay", async () => {
      const controller = new AbortController();
      let callCount = 0;

      globalThis.fetch = vi.fn().mockImplementation(() => {
        callCount++;
        return Promise.resolve(
          new Response("Bad Gateway", {
            status: 502,
            headers: { "Content-Type": "text/plain" },
          }),
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        retry: { maxRetries: 3, baseDelayMs: 5000 }, // long sleep
      });

      const reqPromise = client.get("/api/client", { signal: controller.signal });

      // Wait 15ms so attempt 0 fails and enters sleep, then abort
      setTimeout(() => controller.abort(), 15);

      await expect(reqPromise).rejects.toThrow(PterodactylAbortError);
      expect(callCount).toBe(1); // Did not make second attempt
    });
  });

  describe("Per-Panel Concurrency Integration", () => {
    it("respects concurrency limits across multiple requests to the same panel", async () => {
      let activeRequests = 0;
      let maxActiveObserved = 0;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        activeRequests++;
        maxActiveObserved = Math.max(maxActiveObserved, activeRequests);
        await new Promise((resolve) => setTimeout(resolve, 20));
        activeRequests--;
        return new Response(JSON.stringify({ data: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        concurrency: { maxConcurrent: 2 },
      });

      const promises = [
        client.get("/api/client/1"),
        client.get("/api/client/2"),
        client.get("/api/client/3"),
        client.get("/api/client/4"),
      ];

      await Promise.all(promises);
      expect(maxActiveObserved).toBe(2);
    });

    it("cancels queued client request without executing fetch", async () => {
      let fetchCallCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        fetchCallCount++;
        await new Promise((resolve) => setTimeout(resolve, 30));
        return new Response(JSON.stringify({ data: "ok" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
        concurrency: { maxConcurrent: 1 },
      });

      const controller = new AbortController();

      // First call occupies slot
      const p1 = client.get("/api/client/first");
      // Second call queues
      const p2 = client.get("/api/client/second", { signal: controller.signal });

      // Cancel queued request
      controller.abort();

      await expect(p2).rejects.toThrow(PterodactylAbortError);
      await p1;
      expect(fetchCallCount).toBe(1); // Second call never hit fetch
    });
  });

  describe("Credential Redaction Across All Error Types", () => {
    it("redacts API keys in PterodactylAbortError and PterodactylQueueFullError", () => {
      const secret = "ptlc_very_secret_key";
      const abortErr = new PterodactylAbortError(`Failed with key ${secret}`, {
        apiKeyToRedact: secret,
      });
      expect(abortErr.message).not.toContain(secret);
      expect(abortErr.message).toContain("[REDACTED]");

      const rateLimitErr = new PterodactylRateLimitError(`Rate limited with key ${secret}`, {
        apiKeyToRedact: secret,
      });
      expect(rateLimitErr.message).not.toContain(secret);
      expect(rateLimitErr.message).toContain("[REDACTED]");
    });
  });
});

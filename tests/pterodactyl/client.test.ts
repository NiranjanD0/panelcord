import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  PterodactylClient,
  normalizePanelUrl,
  PTERODACTYL_ACCEPT_HEADER,
} from "../../src/services/pterodactyl/client.js";
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
} from "../../src/services/pterodactyl/errors/index.js";

describe("Pterodactyl API Client Foundation", () => {
  const TEST_BASE_URL = "https://panel.example.com";
  const TEST_API_KEY = "ptlc_secret_test_key_123456789";

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("URL Validation & Normalization", () => {
    it("accepts and normalizes valid HTTPS panel URLs", () => {
      const url = normalizePanelUrl("https://panel.example.com/");
      expect(url.origin).toBe("https://panel.example.com");
      expect(url.pathname).toBe("/");
    });

    it("accepts valid public HTTP panel URLs", () => {
      const url = normalizePanelUrl("http://panel.example.com:8080/");
      expect(url.origin).toBe("http://panel.example.com:8080");
    });

    it("denies loopback and private network URLs by default", () => {
      expect(() => normalizePanelUrl("http://localhost:8080/")).toThrow(PterodactylUrlError);
      expect(() => normalizePanelUrl("http://192.168.1.50:8080/")).toThrow(PterodactylUrlError);
    });

    it("allows loopback and private network URLs when allowPrivateNetworks is explicitly true", () => {
      const url = normalizePanelUrl("http://localhost:8080/", { allowPrivateNetworks: true });
      expect(url.origin).toBe("http://localhost:8080");

      const lanUrl = normalizePanelUrl("http://192.168.1.50:8080/", {
        allowPrivateNetworks: true,
      });
      expect(lanUrl.origin).toBe("http://192.168.1.50:8080");
    });

    it("strips trailing slashes and accidental /api or /api/client paths", () => {
      expect(normalizePanelUrl("https://panel.example.com/api/client/").origin).toBe(
        "https://panel.example.com",
      );
      expect(normalizePanelUrl("https://panel.example.com/api").origin).toBe(
        "https://panel.example.com",
      );
      expect(normalizePanelUrl("https://panel.example.com///").origin).toBe(
        "https://panel.example.com",
      );
    });

    it("rejects non-HTTP/HTTPS protocols", () => {
      expect(() => normalizePanelUrl("ftp://panel.example.com")).toThrow(PterodactylUrlError);
      expect(() => normalizePanelUrl("javascript:alert(1)")).toThrow(PterodactylUrlError);
    });

    it("rejects malformed or empty URLs", () => {
      expect(() => normalizePanelUrl("")).toThrow(PterodactylUrlError);
      expect(() => normalizePanelUrl("not-a-url")).toThrow(PterodactylUrlError);
    });

    it("prevents requests to external hosts (SSRF / credential leakage protection)", async () => {
      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(client.get("https://malicious-external-host.com/steal-creds")).rejects.toThrow(
        PterodactylUrlError,
      );
    });
  });

  describe("Authentication & Credential Redaction", () => {
    it("rejects missing or empty API keys during client creation", () => {
      expect(() => new PterodactylClient({ baseUrl: TEST_BASE_URL, apiKey: "" })).toThrow(
        PterodactylAuthError,
      );
      expect(
        () =>
          new PterodactylClient({
            baseUrl: TEST_BASE_URL,
            apiKey: "   ",
          }),
      ).toThrow(PterodactylAuthError);
    });

    it("redacts API keys in error messages and error details", () => {
      const error = new PterodactylError(`Failed with key ${TEST_API_KEY} on server`, {
        apiKeyToRedact: TEST_API_KEY,
        errors: [{ detail: `Details containing ${TEST_API_KEY}` }],
      });

      expect(error.message).not.toContain(TEST_API_KEY);
      expect(error.message).toContain("[REDACTED]");
      expect(error.errors[0]?.detail).not.toContain(TEST_API_KEY);
      expect(error.errors[0]?.detail).toContain("[REDACTED]");
    });

    it("sends correct Authorization and Accept headers", async () => {
      let capturedHeaders: HeadersInit | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedHeaders = init?.headers;
        return new Response(JSON.stringify({ object: "test", attributes: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await client.get("/api/client/account");

      expect(capturedHeaders).toBeDefined();
      const headers = capturedHeaders as Record<string, string>;
      expect(headers["Authorization"]).toBe(`Bearer ${TEST_API_KEY}`);
      expect(headers["Accept"]).toBe(PTERODACTYL_ACCEPT_HEADER);
    });
  });

  describe("Successful API Operations", () => {
    it("handles successful GET request and returns data", async () => {
      const mockResponse = {
        object: "user",
        attributes: {
          id: 1,
          admin: true,
          username: "admin",
          email: "admin@example.com",
          first_name: "Panel",
          last_name: "Admin",
          language: "en",
        },
      };

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const data = await client.account.getAccountDetails();
      expect(data).toEqual(mockResponse);
      expect(data.attributes.username).toBe("admin");

      const isConnected = await client.account.testConnection();
      expect(isConnected).toBe(true);
    });

    it("appends query parameters safely", async () => {
      let requestedUrl = "";

      globalThis.fetch = vi.fn().mockImplementation(async (url) => {
        requestedUrl = url.toString();
        return new Response(JSON.stringify({ object: "list", data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await client.get("/api/client", {
        query: { page: 2, filter: "minecraft", active: true },
      });

      expect(requestedUrl).toContain("page=2");
      expect(requestedUrl).toContain("filter=minecraft");
      expect(requestedUrl).toContain("active=true");
    });

    it("handles POST requests with JSON payload", async () => {
      let capturedBody: string | undefined;
      let capturedMethod: string | undefined;

      globalThis.fetch = vi.fn().mockImplementation(async (_url, init) => {
        capturedMethod = init?.method;
        capturedBody = init?.body as string;
        return new Response(JSON.stringify({ object: "result", attributes: { ok: true } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await client.post("/api/client/servers/123/power", { signal: "restart" });

      expect(capturedMethod).toBe("POST");
      expect(capturedBody).toBe(JSON.stringify({ signal: "restart" }));
    });

    it("handles 204 No Content responses cleanly", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(null, {
          status: 204,
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const result = await client.post("/api/client/servers/123/command", {
        command: "say hello",
      });
      expect(result).toBeUndefined();
    });
  });

  describe("HTTP Error Status Mapping", () => {
    const client = new PterodactylClient({
      baseUrl: TEST_BASE_URL,
      apiKey: TEST_API_KEY,
    });

    it("maps 401 to PterodactylAuthError", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ code: "Unauthenticated", detail: "Invalid credentials." }],
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(client.get("/api/client/account")).rejects.toThrow(PterodactylAuthError);
    });

    it("maps 403 to PterodactylForbiddenError", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ code: "Forbidden", detail: "This action is unauthorized." }],
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(client.get("/api/client/servers")).rejects.toThrow(PterodactylForbiddenError);
    });

    it("maps 404 to PterodactylNotFoundError", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ code: "NotFoundHttpException", detail: "Server not found." }],
          }),
          { status: 404, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(client.get("/api/client/servers/nonexistent")).rejects.toThrow(
        PterodactylNotFoundError,
      );
    });

    it("maps 422 to PterodactylValidationError", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [
              {
                code: "ValidationException",
                detail: "The name field is required.",
                meta: { source_field: "name", rule: "required" },
              },
            ],
          }),
          { status: 422, headers: { "Content-Type": "application/json" } },
        ),
      );

      const error = await client.post("/api/client/subusers", {}).catch((e) => e);
      expect(error).toBeInstanceOf(PterodactylValidationError);
      expect((error as PterodactylValidationError).statusCode).toBe(422);
      expect((error as PterodactylValidationError).errors[0]?.detail).toBe(
        "The name field is required.",
      );
    });

    it("maps 429 to PterodactylRateLimitError and parses Retry-After header", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ detail: "Too Many Requests" }],
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "60",
            },
          },
        ),
      );

      const error = await client.get("/api/client").catch((e) => e);
      expect(error).toBeInstanceOf(PterodactylRateLimitError);
      expect((error as PterodactylRateLimitError).retryAfterSeconds).toBe(60);
      expect((error as PterodactylRateLimitError).statusCode).toBe(429);
    });

    it("maps 500-599 to PterodactylServerError", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ detail: "Internal Server Error" }],
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        ),
      );

      await expect(client.get("/api/client")).rejects.toThrow(PterodactylServerError);

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("Bad Gateway", {
          status: 502,
        }),
      );

      await expect(client.get("/api/client")).rejects.toThrow(PterodactylServerError);
    });
  });

  describe("Network, Timeout & Response Parsing Failures", () => {
    const client = new PterodactylClient({
      baseUrl: TEST_BASE_URL,
      apiKey: TEST_API_KEY,
      timeoutMs: 1000,
    });

    it("maps AbortError or TimeoutError to PterodactylTimeoutError", async () => {
      const abortError = new Error("The operation was aborted");
      abortError.name = "TimeoutError";

      globalThis.fetch = vi.fn().mockRejectedValue(abortError);

      await expect(client.get("/api/client")).rejects.toThrow(PterodactylTimeoutError);
    });

    it("maps fetch/network failure to PterodactylNetworkError", async () => {
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed: ECONNREFUSED"));

      await expect(client.get("/api/client")).rejects.toThrow(PterodactylNetworkError);
    });

    it("maps non-JSON 200 OK responses to PterodactylInvalidResponseError", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("<!DOCTYPE html><html>Cloudflare Error</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );

      await expect(client.get("/api/client")).rejects.toThrow(PterodactylInvalidResponseError);
    });
  });
});

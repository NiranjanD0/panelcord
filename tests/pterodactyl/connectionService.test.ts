import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PanelConnectionService } from "../../src/services/pterodactyl/connectionService.js";
import { PanelConnectionState } from "../../src/services/pterodactyl/types/connection.js";

describe("PanelConnectionService (Task 02.2)", () => {
  const TEST_PANEL_URL = "https://panel.example.com";
  const TEST_API_KEY = "ptlc_secret_verification_key_9999";

  const originalFetch = globalThis.fetch;
  let service: PanelConnectionService;

  beforeEach(() => {
    vi.restoreAllMocks();
    service = new PanelConnectionService();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Valid Credentials & Successful Connection", () => {
    it("successfully connects and normalizes account info without exposing credentials", async () => {
      const mockAccountResponse = {
        object: "user",
        attributes: {
          id: 42,
          admin: true,
          username: "game_admin",
          email: "admin@mygameserver.com",
          first_name: "Gamer",
          last_name: "Admin",
          language: "en",
        },
      };

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify(mockAccountResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe(PanelConnectionState.CONNECTED);
      expect(result.statusCode).toBe(200);
      expect(result.panelUrl).toBe("https://panel.example.com");
      expect(result.account).toEqual({
        id: 42,
        username: "game_admin",
        email: "admin@mygameserver.com",
        firstName: "Gamer",
        lastName: "Admin",
        language: "en",
      });

      // Strict security check: ensure API key is never present anywhere in the result
      const serialized = JSON.stringify(result);
      expect(serialized).not.toContain(TEST_API_KEY);
    });
  });

  describe("Authentication & Permission Failures", () => {
    it("returns INVALID_CREDENTIALS when panel responds with 401 Unauthorized", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            errors: [{ code: "Unauthenticated", detail: "Invalid API credentials." }],
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: "invalid_key",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.INVALID_CREDENTIALS);
      expect(result.statusCode).toBe(401);
      expect(result.message).toContain("Invalid API credentials");
    });

    it("returns INVALID_CREDENTIALS if API key is blank or whitespace", async () => {
      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: "   ",
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.INVALID_CREDENTIALS);
      expect(result.statusCode).toBe(401);
    });

    it("returns INSUFFICIENT_PERMISSIONS when panel responds with 403 Forbidden", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            errors: [{ code: "Forbidden", detail: "The API key lacks required permissions." }],
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.INSUFFICIENT_PERMISSIONS);
      expect(result.statusCode).toBe(403);
    });
  });

  describe("Network, Timeout & Reachability Failures", () => {
    it("returns PANEL_UNREACHABLE on network connection failure", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        throw new TypeError("fetch failed: ECONNREFUSED");
      });

      const result = await service.verifyConnection({
        panelUrl: "https://offline-panel.local:8080",
        apiKey: TEST_API_KEY,
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.PANEL_UNREACHABLE);
      expect(result.message).toContain("Network error while communicating with Pterodactyl panel");
    });

    it("returns PANEL_UNREACHABLE on 5xx server errors", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            errors: [{ detail: "Database connection failed on panel server." }],
          }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.PANEL_UNREACHABLE);
      expect(result.statusCode).toBe(500);
    });

    it("returns TIMEOUT on request abort/timeout", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        const timeoutError = new Error("The operation was aborted");
        timeoutError.name = "TimeoutError";
        throw timeoutError;
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
        timeoutMs: 500,
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.TIMEOUT);
      expect(result.message).toContain("timed out");
    });
  });

  describe("URL Validation & SSRF Security", () => {
    it("returns INVALID_PANEL_URL for malformed, non-http, or empty URLs", async () => {
      const emptyRes = await service.verifyConnection({
        panelUrl: "",
        apiKey: TEST_API_KEY,
      });
      expect(emptyRes.state).toBe(PanelConnectionState.INVALID_PANEL_URL);

      const badProtoRes = await service.verifyConnection({
        panelUrl: "ftp://panel.example.com",
        apiKey: TEST_API_KEY,
      });
      expect(badProtoRes.state).toBe(PanelConnectionState.INVALID_PANEL_URL);

      const malformedRes = await service.verifyConnection({
        panelUrl: "not_a_valid_url",
        apiKey: TEST_API_KEY,
      });
      expect(malformedRes.state).toBe(PanelConnectionState.INVALID_PANEL_URL);
    });

    it("returns INVALID_PANEL_URL when embedded credentials are present in URL", async () => {
      const credsInUrlRes = await service.verifyConnection({
        panelUrl: "https://admin:password@panel.example.com",
        apiKey: TEST_API_KEY,
      });

      expect(credsInUrlRes.state).toBe(PanelConnectionState.INVALID_PANEL_URL);
      expect(credsInUrlRes.message).toContain("embedded user credentials");
    });
  });

  describe("Malformed Account Responses & HTML Pages", () => {
    it("returns API_ERROR when panel returns valid HTTP 200 with non-user payload", async () => {
      // e.g. panel returning a list or wrong fractal object
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ object: "server", attributes: {} }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.API_ERROR);
      expect(result.message).toContain("malformed account response");
    });

    it("returns API_ERROR when panel returns HTTP 200 with HTML (e.g. Cloudflare / WAF)", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response("<!DOCTYPE html><html>Just a moment...</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        });
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.API_ERROR);
    });
  });

  describe("Redirect Handling & Credential Protection", () => {
    it("follows safe same-origin redirects to complete verification", async () => {
      let callCount = 0;

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        callCount++;
        if (callCount === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: "https://panel.example.com/api/client/account/canonical" },
          });
        }

        return new Response(
          JSON.stringify({
            object: "user",
            attributes: {
              id: 10,
              username: "redirected_user",
              email: "test@panel.com",
              first_name: "Redir",
              last_name: "User",
              language: "en",
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const result = await service.verifyConnection({
        panelUrl: "https://panel.example.com",
        apiKey: TEST_API_KEY,
      });

      expect(result.success).toBe(true);
      expect(result.state).toBe(PanelConnectionState.CONNECTED);
      expect(result.account?.username).toBe("redirected_user");
      expect(callCount).toBe(2);
    });

    it("blocks cross-origin redirects to prevent credential forwarding", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://malicious-external-site.com/steal-auth" },
        });
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.INVALID_PANEL_URL);
      expect(result.message).toContain("cross-origin redirect");

      // Verify API key was not leaked
      expect(JSON.stringify(result)).not.toContain(TEST_API_KEY);
    });
  });
});

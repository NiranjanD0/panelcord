import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PterodactylClient } from "../../src/services/pterodactyl/client.js";
import {
  isBlockedHost,
  validateAndNormalizePanelUrl,
} from "../../src/services/pterodactyl/security.js";
import { PanelConnectionService } from "../../src/services/pterodactyl/connectionService.js";
import { PanelConnectionState } from "../../src/services/pterodactyl/types/connection.js";
import {
  PterodactylUrlError,
  PterodactylAuthError,
  PterodactylForbiddenError,
} from "../../src/services/pterodactyl/errors/index.js";

describe("Security Audit: Pterodactyl Integration", () => {
  const TEST_BASE_URL = "https://panel.example.com";
  const TEST_API_KEY = "ptlc_secret_audit_key_123456";

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("1. Redirect Handling Security", () => {
    it("follows legitimate same-origin redirects", async () => {
      let step = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        step++;
        if (step === 1) {
          return new Response(null, {
            status: 302,
            headers: { Location: "https://panel.example.com/api/client/account/canonical" },
          });
        }
        return new Response(
          JSON.stringify({
            object: "user",
            attributes: { id: 1, username: "admin", email: "a@b.com" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const res = await client.account.getAccountDetails();
      expect(res.attributes.username).toBe("admin");
      expect(step).toBe(2);
    });

    it("blocks cross-origin redirects (different domain)", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://attacker.example.org/api/client/account" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(client.account.getAccountDetails()).rejects.toThrow(PterodactylUrlError);
      await expect(client.account.getAccountDetails()).rejects.toThrow(/cross-origin redirect/);
    });

    it("blocks subdomain redirects (origin mismatch)", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://sub.panel.example.com/api/client/account" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(client.account.getAccountDetails()).rejects.toThrow(PterodactylUrlError);
    });

    it("blocks redirects that change the port", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://panel.example.com:8443/api/client/account" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: "https://panel.example.com:443",
        apiKey: TEST_API_KEY,
      });

      await expect(client.account.getAccountDetails()).rejects.toThrow(PterodactylUrlError);
    });

    it("blocks protocol downgrade redirects (HTTPS -> HTTP)", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://panel.example.com/api/client/account" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: "https://panel.example.com",
        apiKey: TEST_API_KEY,
      });

      await expect(client.account.getAccountDetails()).rejects.toThrow(PterodactylUrlError);
    });

    it("detects and stops redirect loops (A -> B -> A)", async () => {
      let isFirst = true;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        if (isFirst) {
          isFirst = false;
          return new Response(null, {
            status: 302,
            headers: { Location: "https://panel.example.com/api/client/account/loop" },
          });
        }
        return new Response(null, {
          status: 302,
          headers: { Location: "https://panel.example.com/api/client/account" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(client.account.getAccountDetails()).rejects.toThrow(/Redirect loop detected/);
    });

    it("enforces maximum redirect limit (exceeding 3 hops)", async () => {
      let count = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        count++;
        return new Response(null, {
          status: 302,
          headers: { Location: `https://panel.example.com/step-${count}` },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(client.account.getAccountDetails()).rejects.toThrow(
        /Too many redirects encountered/,
      );
    });

    it("blocks redirects containing embedded credentials", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "https://user:pass@panel.example.com/api/client/account" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(client.account.getAccountDetails()).rejects.toThrow(/embedded credentials/);
    });

    it("blocks redirects targeting cloud metadata addresses", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(null, {
          status: 302,
          headers: { Location: "http://169.254.169.254/latest/meta-data/" },
        });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(client.account.getAccountDetails()).rejects.toThrow(
        /Prevented redirect to blocked host/,
      );
    });
  });

  describe("2. SSRF Protection & URL Validation", () => {
    it("strictly blocks AWS/GCP/Azure cloud metadata addresses", () => {
      expect(isBlockedHost("169.254.169.254")).toBe(true);
      expect(isBlockedHost("169.254.170.2")).toBe(true);
      expect(isBlockedHost("fd00:ec2::254")).toBe(true);
      expect(isBlockedHost("metadata.google.internal")).toBe(true);
      expect(isBlockedHost("metadata.goog")).toBe(true);

      expect(() => validateAndNormalizePanelUrl("http://169.254.169.254")).toThrow(
        PterodactylUrlError,
      );
      expect(() => validateAndNormalizePanelUrl("http://metadata.google.internal")).toThrow(
        PterodactylUrlError,
      );
    });

    it("strictly blocks link-local (169.254.0.0/16 and fe80::/10) and broadcast/unspecified IPs", () => {
      expect(isBlockedHost("169.254.1.1")).toBe(true);
      expect(isBlockedHost("169.254.254.254")).toBe(true);
      expect(isBlockedHost("fe80::1")).toBe(true);
      expect(isBlockedHost("0.0.0.0")).toBe(true);
      expect(isBlockedHost("255.255.255.255")).toBe(true);
      expect(isBlockedHost("::")).toBe(true);

      expect(() => validateAndNormalizePanelUrl("http://0.0.0.0")).toThrow(PterodactylUrlError);
      expect(() => validateAndNormalizePanelUrl("http://169.254.50.5")).toThrow(
        PterodactylUrlError,
      );
    });

    it("denies private networks and loopback by default (default-deny for multi-tenant SSRF protection)", () => {
      expect(isBlockedHost("localhost")).toBe(true);
      expect(isBlockedHost("127.0.0.1")).toBe(true);
      expect(isBlockedHost("::1")).toBe(true);
      expect(isBlockedHost("192.168.1.100")).toBe(true);
      expect(isBlockedHost("10.0.0.5")).toBe(true);
      expect(isBlockedHost("172.20.0.2")).toBe(true);
      expect(isBlockedHost("fc00::1")).toBe(true);

      // Public host remains permitted
      expect(isBlockedHost("panel.example.com")).toBe(false);

      expect(() => validateAndNormalizePanelUrl("http://192.168.1.100:8080")).toThrow(
        PterodactylUrlError,
      );
      expect(() => validateAndNormalizePanelUrl("http://localhost:8080")).toThrow(
        PterodactylUrlError,
      );
      expect(() => validateAndNormalizePanelUrl("http://10.0.0.5:8080")).toThrow(
        PterodactylUrlError,
      );
      expect(() => validateAndNormalizePanelUrl("https://panel.example.com")).not.toThrow();
    });

    it("allows private networks when allowPrivateNetworks is explicitly enabled for self-hosted panels", () => {
      const opts = { allowPrivateNetworks: true };
      expect(isBlockedHost("localhost", opts)).toBe(false);
      expect(isBlockedHost("127.0.0.1", opts)).toBe(false);
      expect(isBlockedHost("192.168.1.100", opts)).toBe(false);
      expect(isBlockedHost("10.0.0.5", opts)).toBe(false);
      expect(isBlockedHost("172.20.0.2", opts)).toBe(false);

      expect(() => validateAndNormalizePanelUrl("http://192.168.1.100:8080", opts)).not.toThrow();
      expect(() => validateAndNormalizePanelUrl("http://localhost:8080", opts)).not.toThrow();
      expect(() => validateAndNormalizePanelUrl("http://10.0.0.5:8080", opts)).not.toThrow();
    });

    it("strictly blocks cloud metadata and link-local even when allowPrivateNetworks is true", () => {
      const opts = { allowPrivateNetworks: true };
      expect(isBlockedHost("169.254.169.254", opts)).toBe(true);
      expect(isBlockedHost("metadata.google.internal", opts)).toBe(true);
      expect(isBlockedHost("fe80::1", opts)).toBe(true);
      expect(isBlockedHost("0.0.0.0", opts)).toBe(true);

      expect(() => validateAndNormalizePanelUrl("http://169.254.169.254", opts)).toThrow(
        PterodactylUrlError,
      );
    });

    it("blocks CRLF injection and control characters in URL", () => {
      expect(() =>
        validateAndNormalizePanelUrl("https://panel.example.com\r\nHeader: injected"),
      ).toThrow(PterodactylUrlError);
      expect(() => validateAndNormalizePanelUrl("https://panel.example.com\0")).toThrow(
        PterodactylUrlError,
      );
    });

    it("blocks embedded credentials in panel base URL", () => {
      expect(() => validateAndNormalizePanelUrl("https://admin:secret@panel.example.com")).toThrow(
        PterodactylUrlError,
      );
    });
  });

  describe("3. Authentication State Mapping & Distinction", () => {
    const service = new PanelConnectionService();

    it("maps 401 strictly to INVALID_CREDENTIALS", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            errors: [{ code: "Unauthenticated", detail: "Invalid API credentials." }],
          }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_BASE_URL,
        apiKey: "bad_key",
      });

      expect(result.state).toBe(PanelConnectionState.INVALID_CREDENTIALS);
      expect(result.state).not.toBe(PanelConnectionState.INSUFFICIENT_PERMISSIONS);
      expect(result.statusCode).toBe(401);
      expect(result.success).toBe(false);
    });

    it("maps 403 strictly to INSUFFICIENT_PERMISSIONS (never mistaken for invalid credentials)", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            errors: [
              {
                code: "Forbidden",
                detail: "This API key does not have the required permissions.",
              },
            ],
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        );
      });

      const result = await service.verifyConnection({
        panelUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      expect(result.state).toBe(PanelConnectionState.INSUFFICIENT_PERMISSIONS);
      expect(result.state).not.toBe(PanelConnectionState.INVALID_CREDENTIALS);
      expect(result.statusCode).toBe(403);
      expect(result.success).toBe(false);
    });

    it("ensures error hierarchy distinguishes 401 and 403 cleanly", () => {
      const authErr = new PterodactylAuthError();
      const forbiddenErr = new PterodactylForbiddenError();

      expect(authErr.statusCode).toBe(401);
      expect(forbiddenErr.statusCode).toBe(403);
      expect(authErr).not.toBeInstanceOf(PterodactylForbiddenError);
      expect(forbiddenErr).not.toBeInstanceOf(PterodactylAuthError);
    });

    it("maps network failures, timeouts, and malformed responses correctly", async () => {
      // Network failure
      globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
      const netRes = await service.verifyConnection({
        panelUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      expect(netRes.state).toBe(PanelConnectionState.PANEL_UNREACHABLE);

      // Timeout
      const timeoutErr = new Error("timeout");
      timeoutErr.name = "TimeoutError";
      globalThis.fetch = vi.fn().mockRejectedValue(timeoutErr);
      const timeoutRes = await service.verifyConnection({
        panelUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      expect(timeoutRes.state).toBe(PanelConnectionState.TIMEOUT);

      // Malformed response (non-JSON)
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response("<!DOCTYPE html><html>WAF Challenge</html>", {
          status: 200,
          headers: { "Content-Type": "text/html" },
        }),
      );
      const malformedRes = await service.verifyConnection({
        panelUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      expect(malformedRes.state).toBe(PanelConnectionState.API_ERROR);
    });
  });

  describe("5. Credential Serialization & Masking Hardening", () => {
    it("masks API key in JSON.stringify(client) and util.inspect(client)", async () => {
      const util = await import("node:util");
      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const jsonStr = JSON.stringify(client);
      expect(jsonStr).not.toContain(TEST_API_KEY);
      expect(JSON.parse(jsonStr)).toEqual({
        baseUrl: "https://panel.example.com/",
        defaultTimeoutMs: 10000,
        allowPrivateNetworks: false,
      });

      const inspectStr = util.inspect(client);
      expect(inspectStr).not.toContain(TEST_API_KEY);
    });

    it("masks master encryption key in JSON.stringify(service) and util.inspect(service)", async () => {
      const util = await import("node:util");
      const { CredentialEncryptionService } =
        await import("../../src/services/pterodactyl/encryptionService.js");
      const masterKeyHex = "a".repeat(64);
      const encService = new CredentialEncryptionService({ masterKey: masterKeyHex });

      const jsonStr = JSON.stringify(encService);
      expect(jsonStr).not.toContain(masterKeyHex);
      expect(JSON.parse(jsonStr)).toEqual({
        algorithm: "aes-256-gcm",
        keyVersion: 1,
      });

      const inspectStr = util.inspect(encService);
      expect(inspectStr).not.toContain(masterKeyHex);
    });

    it("sanitizes error cause message and stack when apiKeyToRedact is provided", async () => {
      const { PterodactylError } = await import("../../src/services/pterodactyl/errors/base.js");
      const cause = new Error(`Underlying fetch failed with auth token ${TEST_API_KEY}`);
      const error = new PterodactylError("API request failed", {
        apiKeyToRedact: TEST_API_KEY,
        cause,
      });

      expect(error.message).not.toContain(TEST_API_KEY);
      expect((error.cause as Error).message).not.toContain(TEST_API_KEY);
      expect((error.cause as Error).message).toContain("[REDACTED]");
      if (typeof error.stack === "string") {
        expect(error.stack).not.toContain(TEST_API_KEY);
      }
      if (typeof (error.cause as Error).stack === "string") {
        expect((error.cause as Error).stack).not.toContain(TEST_API_KEY);
      }
    });
  });
});

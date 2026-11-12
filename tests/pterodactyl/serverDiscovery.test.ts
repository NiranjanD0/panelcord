import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PterodactylClient } from "../../src/services/pterodactyl/client.js";
import {
  ServerDiscoveryService,
  normalizeServer,
  validatePaginationUrl,
} from "../../src/services/pterodactyl/serverDiscoveryService.js";
import type { PterodactylServerAttributes } from "../../src/services/pterodactyl/types/server.js";
import {
  PterodactylForbiddenError,
  PterodactylRateLimitError,
  PterodactylInvalidResponseError,
  PterodactylUrlError,
} from "../../src/services/pterodactyl/errors/index.js";

describe("Server Discovery Service (Task 02.3)", () => {
  const TEST_BASE_URL = "https://panel.example.com";
  const TEST_API_KEY = "ptlc_secret_discovery_key_123456";

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockServer(
    identifier: string,
    overrides: Partial<PterodactylServerAttributes> = {},
  ) {
    return {
      object: "server",
      attributes: {
        server_owner: true,
        identifier,
        uuid: `uuid-${identifier}-1234-5678`,
        name: `Server ${identifier}`,
        node: "Node-1",
        sftp_details: {
          ip: "10.0.0.1",
          port: 2022,
        },
        description: `Description for ${identifier}`,
        limits: {
          memory: 2048,
          swap: 512,
          disk: 10240,
          io: 500,
          cpu: 200,
          threads: "0,1",
        },
        feature_limits: {
          databases: 2,
          allocations: 1,
          backups: 3,
        },
        is_suspended: false,
        is_installing: false,
        is_transferring: false,
        permissions: ["control.start", "control.stop"],
        ...overrides,
      },
    };
  }

  describe("Server Normalization", () => {
    it("normalizes a full server attributes payload accurately", () => {
      const raw = createMockServer("srv1").attributes;
      const normalized = normalizeServer(raw);

      expect(normalized.identifier).toBe("srv1");
      expect(normalized.uuid).toBe("uuid-srv1-1234-5678");
      expect(normalized.name).toBe("Server srv1");
      expect(normalized.description).toBe("Description for srv1");
      expect(normalized.node).toBe("Node-1");
      expect(normalized.isOwner).toBe(true);
      expect(normalized.permissions).toEqual(["control.start", "control.stop"]);
      expect(normalized.sftp).toEqual({ ip: "10.0.0.1", port: 2022 });
      expect(normalized.limits).toEqual({
        memory: 2048,
        swap: 512,
        disk: 10240,
        io: 500,
        cpu: 200,
        threads: "0,1",
      });
      expect(normalized.featureLimits).toEqual({
        databases: 2,
        allocations: 1,
        backups: 3,
      });
      expect(normalized.isSuspended).toBe(false);
      expect(normalized.isInstalling).toBe(false);
      expect(normalized.isTransferring).toBe(false);
    });

    it("handles missing optional fields with safe defaults", () => {
      const minimalRaw: PterodactylServerAttributes = {
        identifier: "srv-minimal",
        uuid: "uuid-minimal-0000",
        name: "Minimal Server",
      };

      const normalized = normalizeServer(minimalRaw);

      expect(normalized.identifier).toBe("srv-minimal");
      expect(normalized.uuid).toBe("uuid-minimal-0000");
      expect(normalized.name).toBe("Minimal Server");
      expect(normalized.description).toBeNull();
      expect(normalized.node).toBe("unknown");
      expect(normalized.isOwner).toBe(false);
      expect(normalized.permissions).toEqual([]);
      expect(normalized.sftp).toBeNull();
      expect(normalized.limits).toEqual({
        memory: 0,
        swap: 0,
        disk: 0,
        io: 0,
        cpu: 0,
        threads: null,
      });
      expect(normalized.featureLimits).toEqual({
        databases: 0,
        allocations: 0,
        backups: 0,
      });
      expect(normalized.isSuspended).toBe(false);
      expect(normalized.isInstalling).toBe(false);
      expect(normalized.isTransferring).toBe(false);
    });
  });

  describe("Server Discovery Execution", () => {
    it("successfully retrieves and normalizes a single server response", async () => {
      const mockResponse = {
        object: "list",
        data: [createMockServer("srv1")],
        meta: {
          pagination: {
            total: 1,
            count: 1,
            per_page: 50,
            current_page: 1,
            total_pages: 1,
            links: { next: null, previous: null },
          },
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const result = await ServerDiscoveryService.discoverServers(client);

      expect(result.success).toBe(true);
      expect(result.servers).toHaveLength(1);
      expect(result.servers[0]?.identifier).toBe("srv1");
      expect(result.totalServers).toBe(1);
      expect(result.pagesFetched).toBe(1);
      expect(result.totalPages).toBe(1);
      expect(result.truncated).toBe(false);
    });

    it("successfully handles multiple servers on a single page", async () => {
      const mockResponse = {
        object: "list",
        data: [createMockServer("alpha"), createMockServer("bravo"), createMockServer("charlie")],
        meta: {
          pagination: {
            total: 3,
            count: 3,
            per_page: 50,
            current_page: 1,
            total_pages: 1,
            links: { next: null },
          },
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const result = await ServerDiscoveryService.discoverServers(client);

      expect(result.success).toBe(true);
      expect(result.servers).toHaveLength(3);
      expect(result.servers.map((s) => s.identifier)).toEqual(["alpha", "bravo", "charlie"]);
      expect(result.totalServers).toBe(3);
    });

    it("handles an empty server list gracefully", async () => {
      const mockResponse = {
        object: "list",
        data: [],
        meta: {
          pagination: {
            total: 0,
            count: 0,
            per_page: 50,
            current_page: 1,
            total_pages: 1,
            links: { next: null },
          },
        },
      };

      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify(mockResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const result = await ServerDiscoveryService.discoverServers(client);

      expect(result.success).toBe(true);
      expect(result.servers).toEqual([]);
      expect(result.totalServers).toBe(0);
      expect(result.pagesFetched).toBe(1);
      expect(result.truncated).toBe(false);
    });

    it("follows pagination across multiple pages cleanly", async () => {
      const page1 = {
        object: "list",
        data: [createMockServer("srv-p1-1"), createMockServer("srv-p1-2")],
        meta: {
          pagination: {
            total: 4,
            count: 2,
            per_page: 2,
            current_page: 1,
            total_pages: 2,
            links: { next: "https://panel.example.com/api/client?page=2&per_page=2" },
          },
        },
      };

      const page2 = {
        object: "list",
        data: [createMockServer("srv-p2-1"), createMockServer("srv-p2-2")],
        meta: {
          pagination: {
            total: 4,
            count: 2,
            per_page: 2,
            current_page: 2,
            total_pages: 2,
            links: { next: null },
          },
        },
      };

      let fetchCount = 0;
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        fetchCount++;
        const parsedUrl = new URL(String(url));
        if (parsedUrl.searchParams.get("page") === "2") {
          return new Response(JSON.stringify(page2), { status: 200 });
        }
        return new Response(JSON.stringify(page1), { status: 200 });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const result = await ServerDiscoveryService.discoverServers(client, { perPage: 2 });

      expect(result.success).toBe(true);
      expect(result.servers).toHaveLength(4);
      expect(result.servers.map((s) => s.identifier)).toEqual([
        "srv-p1-1",
        "srv-p1-2",
        "srv-p2-1",
        "srv-p2-2",
      ]);
      expect(result.pagesFetched).toBe(2);
      expect(result.totalPages).toBe(2);
      expect(result.truncated).toBe(false);
      expect(fetchCount).toBe(2);
    });

    it("terminates pagination cleanly when singlePageOnly option is set", async () => {
      const page1 = {
        object: "list",
        data: [createMockServer("p1-server")],
        meta: {
          pagination: {
            total: 10,
            count: 1,
            per_page: 1,
            current_page: 1,
            total_pages: 10,
            links: { next: "https://panel.example.com/api/client?page=2" },
          },
        },
      };

      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify(page1), { status: 200 }));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const result = await ServerDiscoveryService.discoverServers(client, {
        singlePageOnly: true,
      });

      expect(result.success).toBe(true);
      expect(result.servers).toHaveLength(1);
      expect(result.pagesFetched).toBe(1);
      expect(result.totalServers).toBe(10);
      expect(result.truncated).toBe(true);
    });

    it("prevents duplicate servers across pages while preserving deterministic ordering", async () => {
      // Server 'dup' appears on both page 1 and page 2
      const page1 = {
        object: "list",
        data: [createMockServer("first"), createMockServer("dup")],
        meta: {
          pagination: {
            total: 3,
            count: 2,
            per_page: 2,
            current_page: 1,
            total_pages: 2,
            links: { next: "https://panel.example.com/api/client?page=2" },
          },
        },
      };

      const page2 = {
        object: "list",
        data: [createMockServer("dup"), createMockServer("third")],
        meta: {
          pagination: {
            total: 3,
            count: 2,
            per_page: 2,
            current_page: 2,
            total_pages: 2,
            links: { next: null },
          },
        },
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("page=2")) {
          return new Response(JSON.stringify(page2), { status: 200 });
        }
        return new Response(JSON.stringify(page1), { status: 200 });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const result = await ServerDiscoveryService.discoverServers(client);

      expect(result.servers).toHaveLength(3);
      expect(result.servers.map((s) => s.identifier)).toEqual(["first", "dup", "third"]);
    });

    it("enforces maximum page count (maxPages limit)", async () => {
      let currentPageRequested = 1;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        const res = {
          object: "list",
          data: [createMockServer(`srv-page-${currentPageRequested}`)],
          meta: {
            pagination: {
              total: 100,
              count: 1,
              per_page: 1,
              current_page: currentPageRequested,
              total_pages: 100,
              links: {
                next: `https://panel.example.com/api/client?page=${currentPageRequested + 1}`,
              },
            },
          },
        };
        currentPageRequested++;
        return new Response(JSON.stringify(res), { status: 200 });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      // Enforce maxPages of 3
      const result = await ServerDiscoveryService.discoverServers(client, { maxPages: 3 });

      expect(result.pagesFetched).toBe(3);
      expect(result.servers).toHaveLength(3);
      expect(result.truncated).toBe(true);
      expect(result.totalServers).toBe(100);
    });

    it("throws PterodactylInvalidResponseError when API response is not a valid list fractal", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ object: "user", data: [] }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDiscoveryService.discoverServers(client)).rejects.toThrow(
        PterodactylInvalidResponseError,
      );
    });

    it("throws PterodactylInvalidResponseError when a server item in data is malformed", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            object: "list",
            data: [{ object: "server", attributes: { name: "Missing ID and UUID" } }],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDiscoveryService.discoverServers(client)).rejects.toThrow(
        /missing required identifier or uuid/i,
      );
    });

    it("propagates PterodactylForbiddenError on 403 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ code: "HttpForbiddenException", detail: "You do not have access." }],
          }),
          { status: 403, headers: { "Content-Type": "application/json" } },
        ),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDiscoveryService.discoverServers(client)).rejects.toThrow(
        PterodactylForbiddenError,
      );
    });

    it("propagates PterodactylRateLimitError with retry-after header on 429 response", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            errors: [{ detail: "Too Many Requests." }],
          }),
          {
            status: 429,
            headers: {
              "Content-Type": "application/json",
              "Retry-After": "45",
            },
          },
        ),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      try {
        await ServerDiscoveryService.discoverServers(client);
        expect.fail("Should have thrown PterodactylRateLimitError");
      } catch (err) {
        expect(err).toBeInstanceOf(PterodactylRateLimitError);
        expect((err as PterodactylRateLimitError).retryAfterSeconds).toBe(45);
      }
    });
  });

  describe("Pagination URL Security", () => {
    it("validates safe same-origin pagination link URLs", () => {
      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const url = validatePaginationUrl("https://panel.example.com/api/client?page=2", client);
      expect(url.toString()).toBe("https://panel.example.com/api/client?page=2");
    });

    it("blocks cross-origin pagination link URLs", () => {
      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      expect(() =>
        validatePaginationUrl("https://evil.example.org/api/client?page=2", client),
      ).toThrow(PterodactylUrlError);
      expect(() =>
        validatePaginationUrl("https://evil.example.org/api/client?page=2", client),
      ).toThrow(/cross-origin pagination link/i);
    });

    it("blocks protocol downgrades in pagination link URLs (HTTPS -> HTTP)", () => {
      const client = new PterodactylClient({
        baseUrl: "https://panel.example.com",
        apiKey: TEST_API_KEY,
      });

      expect(() =>
        validatePaginationUrl("http://panel.example.com/api/client?page=2", client),
      ).toThrow(/protocol downgrade/i);
    });

    it("blocks pagination links targeting cloud metadata or blocked hosts", () => {
      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      expect(() =>
        validatePaginationUrl("http://169.254.169.254/latest/meta-data", client),
      ).toThrow(PterodactylUrlError);
    });

    it("detects and terminates pagination loops (Page 1 -> Page 2 -> Page 1)", async () => {
      const page1 = {
        object: "list",
        data: [createMockServer("srv1")],
        meta: {
          pagination: {
            total: 2,
            count: 1,
            per_page: 1,
            current_page: 1,
            total_pages: 2,
            links: { next: "https://panel.example.com/api/client?page=2" },
          },
        },
      };

      // Page 2 links back to Page 1
      const page2 = {
        object: "list",
        data: [createMockServer("srv2")],
        meta: {
          pagination: {
            total: 2,
            count: 1,
            per_page: 1,
            current_page: 2,
            total_pages: 2,
            links: { next: "https://panel.example.com/api/client?page=2" }, // loop to itself or page 1
          },
        },
      };

      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.includes("page=2")) {
          return new Response(JSON.stringify(page2), { status: 200 });
        }
        return new Response(JSON.stringify(page1), { status: 200 });
      });

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDiscoveryService.discoverServers(client)).rejects.toThrow(
        /Pagination loop detected/i,
      );
    });
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PterodactylClient } from "../../src/services/pterodactyl/client.js";
import {
  ServerDetailService,
  normalizeServerResources,
  isWingsConnectivityError,
} from "../../src/services/pterodactyl/serverDetailService.js";
import {
  validateServerIdentifier,
  SERVER_IDENTIFIER_REGEX,
} from "../../src/services/pterodactyl/endpoints/servers.js";
import {
  formatBytes,
  formatUptime,
  formatCpu,
  formatResourceLimit,
  formatMemoryUsage,
  type PterodactylResourceStatsAttributes,
  type PterodactylServerAttributes,
  type NormalizedServerLimits,
} from "../../src/services/pterodactyl/types/index.js";
import {
  PterodactylAuthError,
  PterodactylForbiddenError,
  PterodactylNotFoundError,
  PterodactylRateLimitError,
  PterodactylServerError,
  PterodactylValidationError,
  PterodactylInvalidResponseError,
} from "../../src/services/pterodactyl/errors/index.js";

describe("Pterodactyl Server Details & Resource Monitoring (Task 02.4)", () => {
  const TEST_BASE_URL = "https://panel.example.com";
  const TEST_API_KEY = "ptlc_secret_monitoring_key_123456";

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function createMockServerItem(
    identifier = "0d89d908",
    overrides: Partial<PterodactylServerAttributes> = {},
    meta?: { is_server_owner?: boolean; user_permissions?: string[] },
  ) {
    return {
      object: "server",
      attributes: {
        server_owner: true,
        identifier,
        uuid: `${identifier}-4171-4475-a868-fc0c266a2e9b`,
        name: `Production Node ${identifier}`,
        node: "US-East-1",
        sftp_details: {
          ip: "node1.example.com",
          port: 2022,
        },
        description: "Primary Minecraft server",
        limits: {
          memory: 4096,
          swap: 1024,
          disk: 20480,
          io: 500,
          cpu: 200,
          threads: "0,1",
          oom_disabled: false,
        },
        feature_limits: {
          databases: 3,
          allocations: 2,
          backups: 5,
        },
        is_suspended: false,
        is_installing: false,
        is_transferring: false,
        ...overrides,
      },
      meta: meta ?? {
        is_server_owner: true,
        user_permissions: ["*"],
      },
    };
  }

  function createMockStatsItem(
    currentState = "running",
    overrides: Partial<PterodactylResourceStatsAttributes["resources"]> = {},
    isSuspended = false,
  ) {
    return {
      object: "stats",
      attributes: {
        current_state: currentState,
        is_suspended: isSuspended,
        resources: {
          memory_bytes: 2147483648, // 2 GiB
          cpu_absolute: 45.5,
          disk_bytes: 10737418240, // 10 GiB
          network_rx_bytes: 5242880, // 5 MiB
          network_tx_bytes: 10485760, // 10 MiB
          uptime: 3665000, // 1h 1m 5s in ms
          ...overrides,
        },
      },
    };
  }

  function mockJsonResponse(status: number, body: unknown, headers?: Record<string, string>) {
    return Promise.resolve(
      new Response(JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json", ...headers },
      }),
    );
  }

  describe("1. Server Identifier Validation", () => {
    it("validates correct alphanumeric short UUIDs and UUIDs", () => {
      expect(validateServerIdentifier("0d89d908")).toBe("0d89d908");
      expect(validateServerIdentifier("0d89d908-4171-4475-a868-fc0c266a2e9b")).toBe(
        "0d89d908-4171-4475-a868-fc0c266a2e9b",
      );
      expect(validateServerIdentifier("srv-node_01")).toBe("srv-node_01");
      expect(SERVER_IDENTIFIER_REGEX.test("0d89d908")).toBe(true);
    });

    it("trims whitespace from valid identifiers", () => {
      expect(validateServerIdentifier("  0d89d908  ")).toBe("0d89d908");
    });

    it("rejects empty or whitespace-only server identifiers", () => {
      expect(() => validateServerIdentifier("")).toThrow(PterodactylValidationError);
      expect(() => validateServerIdentifier("   ")).toThrow(PterodactylValidationError);
    });

    it("rejects path traversal attempts in server identifier", () => {
      expect(() => validateServerIdentifier("../admin")).toThrow(PterodactylValidationError);
      expect(() => validateServerIdentifier("../../etc/passwd")).toThrow(
        PterodactylValidationError,
      );
      expect(() => validateServerIdentifier("server/resources")).toThrow(
        PterodactylValidationError,
      );
      expect(() => validateServerIdentifier("..\\admin")).toThrow(PterodactylValidationError);
    });

    it("rejects special characters and URL injection in server identifier", () => {
      expect(() => validateServerIdentifier("srv?admin=true")).toThrow(PterodactylValidationError);
      expect(() => validateServerIdentifier("srv#anchor")).toThrow(PterodactylValidationError);
      expect(() => validateServerIdentifier("srv%2fadmin")).toThrow(PterodactylValidationError);
      expect(() => validateServerIdentifier("srv<script>")).toThrow(PterodactylValidationError);
      expect(() => validateServerIdentifier("srv;rm -rf")).toThrow(PterodactylValidationError);
    });

    it("rejects identifiers exceeding 64 characters", () => {
      const longId = "a".repeat(65);
      expect(() => validateServerIdentifier(longId)).toThrow(PterodactylValidationError);
    });
  });

  describe("2. Server Details Endpoint (GET /api/client/servers/{server})", () => {
    it("successfully retrieves and normalizes server details", async () => {
      const mockItem = createMockServerItem("0d89d908");
      globalThis.fetch = vi.fn().mockReturnValue(mockJsonResponse(200, mockItem));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      const service = new ServerDetailService(client);

      const server = await service.getServerDetails("0d89d908");

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [requestedUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(requestedUrl.toString()).toBe("https://panel.example.com/api/client/servers/0d89d908");

      expect(server.identifier).toBe("0d89d908");
      expect(server.uuid).toBe("0d89d908-4171-4475-a868-fc0c266a2e9b");
      expect(server.name).toBe("Production Node 0d89d908");
      expect(server.node).toBe("US-East-1");
      expect(server.isOwner).toBe(true);
      expect(server.permissions).toEqual(["*"]);
      expect(server.sftp).toEqual({
        ip: "node1.example.com",
        port: 2022,
      });
      expect(server.limits).toEqual({
        memory: 4096,
        swap: 1024,
        disk: 20480,
        io: 500,
        cpu: 200,
        threads: "0,1",
      });
      expect(server.featureLimits).toEqual({
        databases: 3,
        allocations: 2,
        backups: 5,
      });
      expect(server.isSuspended).toBe(false);
      expect(server.isInstalling).toBe(false);
      expect(server.isTransferring).toBe(false);
    });

    it("preserves explicit subuser permissions from meta or attributes", async () => {
      const mockItem = createMockServerItem(
        "subuser01",
        { server_owner: false },
        { is_server_owner: false, user_permissions: ["control.start", "control.stop"] },
      );
      globalThis.fetch = vi.fn().mockReturnValue(mockJsonResponse(200, mockItem));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      const server = await ServerDetailService.getServerDetails(client, "subuser01");

      expect(server.isOwner).toBe(false);
      expect(server.permissions).toEqual(["control.start", "control.stop"]);
    });

    it("strictly assigns wildcard ['*'] ONLY when ownership is explicitly verified as true", async () => {
      // Subuser with server_owner: false and omitted user_permissions
      const nonOwnerItem = createMockServerItem(
        "subuser02",
        { server_owner: false },
        { is_server_owner: false },
      );
      globalThis.fetch = vi.fn().mockReturnValue(mockJsonResponse(200, nonOwnerItem));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      const server = await ServerDetailService.getServerDetails(client, "subuser02");

      expect(server.isOwner).toBe(false);
      expect(server.permissions).toEqual([]);
      expect(server.permissions).not.toContain("*");
    });

    it("ensures meta.is_server_owner: false takes precedence and prevents wildcard ['*']", async () => {
      // Conflicting/stale raw.server_owner true, but meta.is_server_owner false
      const conflictItem = createMockServerItem(
        "subuser03",
        { server_owner: true },
        { is_server_owner: false, user_permissions: ["control.restart"] },
      );
      globalThis.fetch = vi.fn().mockReturnValue(mockJsonResponse(200, conflictItem));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      const server = await ServerDetailService.getServerDetails(client, "subuser03");

      expect(server.isOwner).toBe(false);
      expect(server.permissions).toEqual(["control.restart"]);
      expect(server.permissions).not.toContain("*");
    });

    it("throws PterodactylNotFoundError when server does not exist (404)", async () => {
      globalThis.fetch = vi.fn().mockReturnValue(
        mockJsonResponse(404, {
          errors: [
            { code: "NotFoundHttpException", detail: "The requested server was not found." },
          ],
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      const service = new ServerDetailService(client);

      await expect(service.getServerDetails("nonexistent")).rejects.toThrow(
        PterodactylNotFoundError,
      );
    });

    it("throws PterodactylForbiddenError when user has insufficient permissions (403)", async () => {
      globalThis.fetch = vi.fn().mockReturnValue(
        mockJsonResponse(403, {
          errors: [{ code: "AccessDeniedHttpException", detail: "This server is not accessible." }],
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerDetails(client, "forbidden01")).rejects.toThrow(
        PterodactylForbiddenError,
      );
    });

    it("throws PterodactylAuthError when API key is invalid (401)", async () => {
      globalThis.fetch = vi.fn().mockReturnValue(
        mockJsonResponse(401, {
          errors: [{ code: "AuthenticationException", detail: "Unauthenticated." }],
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerDetails(client, "0d89d908")).rejects.toThrow(
        PterodactylAuthError,
      );
    });

    it("throws PterodactylRateLimitError when rate limited (429)", async () => {
      globalThis.fetch = vi
        .fn()
        .mockReturnValue(
          mockJsonResponse(
            429,
            { errors: [{ code: "TooManyRequestsHttpException", detail: "Too Many Requests" }] },
            { "Retry-After": "30" },
          ),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerDetails(client, "0d89d908")).rejects.toThrow(
        PterodactylRateLimitError,
      );
    });

    it("throws PterodactylInvalidResponseError on malformed server details response", async () => {
      globalThis.fetch = vi.fn().mockReturnValue(
        mockJsonResponse(200, {
          object: "not_a_server",
          attributes: {},
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerDetails(client, "0d89d908")).rejects.toThrow(
        PterodactylInvalidResponseError,
      );
    });
  });

  describe("3. Resource Usage Endpoint (GET /api/client/servers/{server}/resources)", () => {
    it("successfully retrieves and normalizes live resource utilization", async () => {
      const mockStats = createMockStatsItem("running", {
        memory_bytes: 1073741824, // 1 GiB
        cpu_absolute: 25.4,
        disk_bytes: 5368709120, // 5 GiB
        network_rx_bytes: 1048576,
        network_tx_bytes: 2097152,
        uptime: 120000,
      });
      globalThis.fetch = vi.fn().mockReturnValue(mockJsonResponse(200, mockStats));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });
      const service = new ServerDetailService(client);

      const limits: NormalizedServerLimits = {
        memory: 2048, // 2048 MB = 2 GiB
        swap: 0,
        disk: 10240, // 10240 MB = 10 GiB
        io: 500,
        cpu: 100,
        threads: null,
      };

      const resources = await service.getServerResources("0d89d908", limits);

      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
      const [requestedUrl] = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(requestedUrl.toString()).toBe(
        "https://panel.example.com/api/client/servers/0d89d908/resources",
      );

      expect(resources.currentState).toBe("running");
      expect(resources.isSuspended).toBe(false);
      expect(resources.memoryBytes).toBe(1073741824);
      expect(resources.cpuPercentage).toBe(25.4);
      expect(resources.diskBytes).toBe(5368709120);
      expect(resources.networkRxBytes).toBe(1048576);
      expect(resources.networkTxBytes).toBe(2097152);
      expect(resources.uptimeMs).toBe(120000);
      expect(resources.memoryLimitBytes).toBe(2048 * 1024 * 1024);
      expect(resources.diskLimitBytes).toBe(10240 * 1024 * 1024);
      expect(resources.isMemoryUnlimited).toBe(false);
      expect(resources.isDiskUnlimited).toBe(false);
      expect(resources.isCpuUnlimited).toBe(false);
    });

    it("accurately models zero limits as unlimited and never represents unlimited RAM as 0 B", async () => {
      const mockStats = createMockStatsItem("running", {
        memory_bytes: 524288000, // 500 MiB used
        cpu_absolute: 12.0,
      });
      globalThis.fetch = vi.fn().mockReturnValue(mockJsonResponse(200, mockStats));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const unlimitedLimits: NormalizedServerLimits = {
        memory: 0, // unlimited RAM
        swap: 0,
        disk: 0, // unlimited Disk
        io: 500,
        cpu: 0, // unlimited CPU
        threads: null,
      };

      const resources = await ServerDetailService.getServerResources(
        client,
        "0d89d908",
        unlimitedLimits,
      );

      // Memory and disk limits should be null (no byte ceiling) when unlimited
      expect(resources.memoryLimitBytes).toBeNull();
      expect(resources.diskLimitBytes).toBeNull();
      expect(resources.isMemoryUnlimited).toBe(true);
      expect(resources.isDiskUnlimited).toBe(true);
      expect(resources.isCpuUnlimited).toBe(true);

      // Verify formatting: RAM limit must format as "Unlimited", never "0 B"
      expect(formatResourceLimit(resources.memoryLimitBytes, resources.isMemoryUnlimited)).toBe(
        "Unlimited",
      );
      expect(formatResourceLimit(resources.diskLimitBytes, resources.isDiskUnlimited)).toBe(
        "Unlimited",
      );

      // Memory usage formatted string: "500.00 MiB / Unlimited" (NOT "500.00 MiB / 0 B")
      const usageDisplay = formatMemoryUsage(
        resources.memoryBytes,
        resources.memoryLimitBytes,
        resources.isMemoryUnlimited,
      );
      expect(usageDisplay).toBe("500.00 MiB / Unlimited");
      expect(usageDisplay).not.toContain("0 B");
    });

    it("leaves limit bytes as null when server limits are omitted", async () => {
      const mockStats = createMockStatsItem("running");
      globalThis.fetch = vi.fn().mockReturnValue(mockJsonResponse(200, mockStats));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const resources = await ServerDetailService.getServerResources(client, "0d89d908");

      expect(resources.memoryLimitBytes).toBeNull();
      expect(resources.diskLimitBytes).toBeNull();
      expect(resources.isMemoryUnlimited).toBe(false);
      expect(resources.isDiskUnlimited).toBe(false);
      expect(resources.isCpuUnlimited).toBe(false);
    });

    it("normalizes negative, non-numeric, or non-finite values safely", () => {
      const rawStats: PterodactylResourceStatsAttributes = {
        current_state: "RUNNING",
        is_suspended: false,
        resources: {
          memory_bytes: -500 as unknown as number,
          cpu_absolute: NaN,
          disk_bytes: Infinity,
          network_rx_bytes: undefined,
          network_tx_bytes: null,
          uptime: -100,
        },
      };

      const normalized = normalizeServerResources(rawStats);

      expect(normalized.currentState).toBe("running");
      expect(normalized.memoryBytes).toBe(0);
      expect(normalized.cpuPercentage).toBe(0);
      expect(normalized.diskBytes).toBe(0);
      expect(normalized.networkRxBytes).toBe(0);
      expect(normalized.networkTxBytes).toBe(0);
      expect(normalized.uptimeMs).toBe(0);
    });

    it("handles offline server with zero uptime and zero resource usage", async () => {
      const mockStats = createMockStatsItem("offline", {
        memory_bytes: 0,
        cpu_absolute: 0,
        disk_bytes: 1048576,
        network_rx_bytes: 0,
        network_tx_bytes: 0,
        uptime: 0,
      });
      globalThis.fetch = vi.fn().mockReturnValue(mockJsonResponse(200, mockStats));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const resources = await ServerDetailService.getServerResources(client, "0d89d908");

      expect(resources.currentState).toBe("offline");
      expect(resources.uptimeMs).toBe(0);
      expect(resources.cpuPercentage).toBe(0);
      expect(resources.memoryBytes).toBe(0);
    });

    it("throws PterodactylInvalidResponseError when stats object is invalid", async () => {
      globalThis.fetch = vi.fn().mockReturnValue(
        mockJsonResponse(200, {
          object: "invalid_stats",
          attributes: {},
        }),
      );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerResources(client, "0d89d908")).rejects.toThrow(
        PterodactylInvalidResponseError,
      );
    });
  });

  describe("4. Combined Retrieval & Error Propagation (getServerWithResources)", () => {
    it("successfully combines server details and live resource metrics", async () => {
      const mockServer = createMockServerItem("0d89d908");
      const mockStats = createMockStatsItem("running", {
        memory_bytes: 2147483648,
        cpu_absolute: 50.0,
      });

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(mockJsonResponse(200, mockStats));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const combined = await ServerDetailService.getServerWithResources(client, "0d89d908");

      expect(combined.server.identifier).toBe("0d89d908");
      expect(combined.resources).not.toBeNull();
      expect(combined.resources?.currentState).toBe("running");
      expect(combined.resources?.memoryBytes).toBe(2147483648);
      expect(combined.resources?.memoryLimitBytes).toBe(4096 * 1024 * 1024);
      expect(combined.resourcesUnavailableReason).toBeNull();
    });

    it("gracefully falls back when Wings daemon is unreachable (502 / 504 / DaemonConnectionException)", async () => {
      const mockServer = createMockServerItem("0d89d908");

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(504, {
            errors: [
              {
                code: "DaemonConnectionException",
                detail: "Could not establish a connection to the machine running this server.",
              },
            ],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const combined = await ServerDetailService.getServerWithResources(client, "0d89d908");

      expect(combined.server.identifier).toBe("0d89d908");
      expect(combined.resources).toBeNull();
      expect(combined.resourcesUnavailableReason).toBe("daemon_unavailable");
    });

    it("detects isWingsConnectivityError correctly for various daemon failure signatures", () => {
      const err502 = new PterodactylServerError("Bad gateway", { statusCode: 502 });
      const err504 = new PterodactylServerError("Gateway timeout", { statusCode: 504 });
      const errDaemonCode = new PterodactylServerError("Remote error", {
        statusCode: 500,
        errors: [{ code: "DaemonConnectionException", detail: "Wings unreachable" }],
      });
      const errDaemonMsg = new PterodactylServerError(
        "Could not establish a connection to the machine running this server.",
        { statusCode: 500 },
      );
      const errGeneric500 = new PterodactylServerError("SQLSTATE[HY000]: Database error", {
        statusCode: 500,
      });

      expect(isWingsConnectivityError(err502)).toBe(true);
      expect(isWingsConnectivityError(err504)).toBe(true);
      expect(isWingsConnectivityError(errDaemonCode)).toBe(true);
      expect(isWingsConnectivityError(errDaemonMsg)).toBe(true);
      expect(isWingsConnectivityError(errGeneric500)).toBe(false);
      expect(isWingsConnectivityError(new Error("Generic"))).toBe(false);
    });

    it("rethrows PterodactylAuthError (401) and does NOT silently swallow it into resourcesUnavailableReason", async () => {
      const mockServer = createMockServerItem("0d89d908");

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(401, {
            errors: [{ code: "AuthenticationException", detail: "Token expired." }],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerWithResources(client, "0d89d908")).rejects.toThrow(
        PterodactylAuthError,
      );
    });

    it("rethrows PterodactylForbiddenError (403) and does NOT silently swallow it", async () => {
      const mockServer = createMockServerItem("0d89d908");

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(403, {
            errors: [
              { code: "AccessDeniedHttpException", detail: "No resource stats permission." },
            ],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerWithResources(client, "0d89d908")).rejects.toThrow(
        PterodactylForbiddenError,
      );
    });

    it("rethrows PterodactylRateLimitError (429) and does NOT silently swallow it", async () => {
      const mockServer = createMockServerItem("0d89d908");

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(429, {
            errors: [{ code: "TooManyRequestsHttpException", detail: "Rate limit exceeded." }],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerWithResources(client, "0d89d908")).rejects.toThrow(
        PterodactylRateLimitError,
      );
    });

    it("rethrows unexpected internal server error (500 non-daemon) and does NOT swallow it", async () => {
      const mockServer = createMockServerItem("0d89d908");

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(500, {
            errors: [{ code: "QueryException", detail: "Database connection failed on panel." }],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerWithResources(client, "0d89d908")).rejects.toThrow(
        PterodactylServerError,
      );
    });

    it("rethrows malformed API response (PterodactylInvalidResponseError) and does NOT swallow it", async () => {
      const mockServer = createMockServerItem("0d89d908");

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(mockJsonResponse(200, { corrupted: true }));

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(ServerDetailService.getServerWithResources(client, "0d89d908")).rejects.toThrow(
        PterodactylInvalidResponseError,
      );
    });

    it("rethrows daemon error when throwOnResourceError option is true", async () => {
      const mockServer = createMockServerItem("0d89d908");

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(502, {
            errors: [{ code: "DaemonConnectionException", detail: "Bad gateway." }],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(
        ServerDetailService.getServerWithResources(client, "0d89d908", {
          throwOnResourceError: true,
        }),
      ).rejects.toThrow(PterodactylServerError);
    });

    it("distinguishes suspended server from regular power state", async () => {
      const mockServer = createMockServerItem("suspended01", { is_suspended: true });

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(500, {
            errors: [{ code: "ServerSuspendedException", detail: "Server is suspended." }],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const combined = await ServerDetailService.getServerWithResources(client, "suspended01");

      expect(combined.server.isSuspended).toBe(true);
      expect(combined.resources).toBeNull();
      expect(combined.resourcesUnavailableReason).toBe("suspended");
    });

    it("distinguishes installing server from regular power state", async () => {
      const mockServer = createMockServerItem("installing01", { is_installing: true });

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(500, {
            errors: [
              { code: "ServerInstallingException", detail: "Server is currently installing." },
            ],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const combined = await ServerDetailService.getServerWithResources(client, "installing01");

      expect(combined.server.isInstalling).toBe(true);
      expect(combined.resources).toBeNull();
      expect(combined.resourcesUnavailableReason).toBe("installing");
    });

    it("distinguishes transferring server from regular power state", async () => {
      const mockServer = createMockServerItem("transfer01", { is_transferring: true });

      globalThis.fetch = vi
        .fn()
        .mockReturnValueOnce(mockJsonResponse(200, mockServer))
        .mockReturnValueOnce(
          mockJsonResponse(500, {
            errors: [{ code: "ServerTransferException", detail: "Server is transferring." }],
          }),
        );

      const client = new PterodactylClient({
        baseUrl: TEST_BASE_URL,
        apiKey: TEST_API_KEY,
      });

      const combined = await ServerDetailService.getServerWithResources(client, "transfer01");

      expect(combined.server.isTransferring).toBe(true);
      expect(combined.resources).toBeNull();
      expect(combined.resourcesUnavailableReason).toBe("transferring");
    });
  });

  describe("5. Telemetry Unit Formatters & Zero-Limit Representation", () => {
    describe("formatBytes", () => {
      it("formats zero bytes", () => {
        expect(formatBytes(0)).toBe("0 B");
        expect(formatBytes(-100)).toBe("0 B");
      });

      it("formats binary bytes (KiB, MiB, GiB, TiB)", () => {
        expect(formatBytes(512)).toBe("512.00 B");
        expect(formatBytes(1024)).toBe("1.00 KiB");
        expect(formatBytes(1048576)).toBe("1.00 MiB");
        expect(formatBytes(1073741824)).toBe("1.00 GiB");
        expect(formatBytes(2147483648)).toBe("2.00 GiB");
        expect(formatBytes(1099511627776)).toBe("1.00 TiB");
      });

      it("formats decimal bytes when configured (KB, MB, GB, TB)", () => {
        expect(formatBytes(1000, { binary: false })).toBe("1.00 KB");
        expect(formatBytes(1000000, { binary: false })).toBe("1.00 MB");
        expect(formatBytes(1000000000, { binary: false })).toBe("1.00 GB");
      });

      it("respects custom decimal places", () => {
        expect(formatBytes(1572864, { decimals: 1 })).toBe("1.5 MiB");
        expect(formatBytes(1572864, { decimals: 0 })).toBe("2 MiB");
      });

      it("supports zeroAsUnlimited option", () => {
        expect(formatBytes(0, { zeroAsUnlimited: true })).toBe("Unlimited");
        expect(formatBytes(null, { zeroAsUnlimited: true })).toBe("Unlimited");
        expect(formatBytes(1048576, { zeroAsUnlimited: true })).toBe("1.00 MiB");
      });
    });

    describe("formatResourceLimit", () => {
      it("formats explicit finite limits as byte strings", () => {
        expect(formatResourceLimit(1073741824, false)).toBe("1.00 GiB");
        expect(formatResourceLimit(4294967296, false)).toBe("4.00 GiB");
      });

      it("formats unlimited resources as 'Unlimited', never '0 B'", () => {
        expect(formatResourceLimit(null, true)).toBe("Unlimited");
        expect(formatResourceLimit(0, true)).toBe("Unlimited");
        expect(formatResourceLimit(null, false)).toBe("Unlimited");
        expect(formatResourceLimit(0, false)).toBe("Unlimited");
        expect(formatResourceLimit(undefined)).toBe("Unlimited");
      });
    });

    describe("formatMemoryUsage", () => {
      it("formats used and limit for finite allocation", () => {
        const result = formatMemoryUsage(1073741824, 4294967296, false);
        expect(result).toBe("1.00 GiB / 4.00 GiB");
      });

      it("formats used and limit for unlimited allocation without displaying '0 B'", () => {
        const result = formatMemoryUsage(2147483648, null, true);
        expect(result).toBe("2.00 GiB / Unlimited");
        expect(result).not.toContain("0 B");
      });
    });

    describe("formatUptime", () => {
      it("formats zero or negative uptime duration", () => {
        expect(formatUptime(0)).toBe("0s");
        expect(formatUptime(-5000)).toBe("0s");
      });

      it("formats seconds only", () => {
        expect(formatUptime(45000)).toBe("45s");
      });

      it("formats minutes and seconds", () => {
        expect(formatUptime(125000)).toBe("2m 5s");
      });

      it("formats hours, minutes and seconds", () => {
        expect(formatUptime(3665000)).toBe("1h 1m 5s");
      });

      it("formats days, hours, minutes and seconds", () => {
        expect(formatUptime(90065000)).toBe("1d 1h 1m 5s");
      });
    });

    describe("formatCpu", () => {
      it("formats CPU percentage with default decimals", () => {
        expect(formatCpu(0)).toBe("0.00%");
        expect(formatCpu(25.4)).toBe("25.40%");
        expect(formatCpu(150.789)).toBe("150.79%");
      });

      it("formats negative or NaN CPU safely", () => {
        expect(formatCpu(-10)).toBe("0.00%");
        expect(formatCpu(NaN)).toBe("0.00%");
      });

      it("respects custom decimal places", () => {
        expect(formatCpu(45.555, 1)).toBe("45.6%");
        expect(formatCpu(45.555, 0)).toBe("46%");
      });
    });
  });
});

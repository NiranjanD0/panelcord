import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PanelCredentialService } from "../../src/services/pterodactyl/panelCredentialService.js";
import { CredentialEncryptionService } from "../../src/services/pterodactyl/encryptionService.js";
import { PanelConnectionService } from "../../src/services/pterodactyl/connectionService.js";
import { ServerDiscoveryService } from "../../src/services/pterodactyl/serverDiscoveryService.js";
import { ServerDetailService } from "../../src/services/pterodactyl/serverDetailService.js";
import { PterodactylClient } from "../../src/services/pterodactyl/client.js";
import { PanelConnectionState } from "../../src/services/pterodactyl/types/connection.js";
import {
  PanelConnectionNotFoundError,
  PterodactylAuthError,
  PterodactylServerError,
  PterodactylAbortError,
  PterodactylDecryptionError,
} from "../../src/services/pterodactyl/errors/index.js";
import type { PrismaClient } from "../../src/database/generated/client.ts";

interface DbPanelConnection {
  id: string;
  guildId: string;
  name: string;
  panelUrl: string;
  encryptedApiKey: string;
  encryptionIv: string;
  encryptionAuthTag: string;
  encryptionKeyVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

describe("End-to-End Integration Workflows (Task 02.7)", () => {
  const MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const GUILD_A = "guild_111111111111111111";
  const GUILD_B = "guild_222222222222222222";
  const PANEL_URL = "https://panel.example.com";
  const API_KEY = "ptlc_secret_e2e_token_1234567890abcdef";

  let store: Map<string, DbPanelConnection>;
  let mockPrisma: PrismaClient;
  let encryptionService: CredentialEncryptionService;
  let connectionService: PanelConnectionService;
  let credentialService: PanelCredentialService;

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    store = new Map<string, DbPanelConnection>();

    const mockPanelConnection = {
      create: vi.fn().mockImplementation(async ({ data }) => {
        for (const existing of store.values()) {
          if (existing.guildId === data.guildId && existing.name === data.name) {
            const err = new Error("Unique constraint failed on the fields: (`guild_id`,`name`)");
            (err as unknown as { code: string }).code = "P2002";
            throw err;
          }
        }
        const now = new Date();
        const record: DbPanelConnection = {
          id: data.id ?? `conn_${Math.random().toString(36).slice(2, 10)}`,
          guildId: data.guildId,
          name: data.name,
          panelUrl: data.panelUrl,
          encryptedApiKey: data.encryptedApiKey,
          encryptionIv: data.encryptionIv,
          encryptionAuthTag: data.encryptionAuthTag,
          encryptionKeyVersion: data.encryptionKeyVersion,
          createdAt: now,
          updatedAt: now,
        };
        store.set(record.id, record);
        return record;
      }),

      findUnique: vi.fn().mockImplementation(async ({ where }) => {
        if (where.id) {
          const rec = store.get(where.id);
          return rec ? { ...rec } : null;
        }
        if (where.guildId_name) {
          for (const rec of store.values()) {
            if (
              rec.guildId === where.guildId_name.guildId &&
              rec.name === where.guildId_name.name
            ) {
              return { ...rec };
            }
          }
        }
        return null;
      }),

      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        for (const rec of store.values()) {
          if (where.id && rec.id !== where.id) continue;
          if (where.guildId && rec.guildId !== where.guildId) continue;
          if (where.name && rec.name !== where.name) continue;
          return { ...rec };
        }
        return null;
      }),

      findMany: vi.fn().mockImplementation(async ({ where }) => {
        const results: DbPanelConnection[] = [];
        for (const rec of store.values()) {
          if (where?.guildId && rec.guildId !== where.guildId) continue;
          results.push({ ...rec });
        }
        return results;
      }),

      update: vi.fn().mockImplementation(async ({ where, data }) => {
        const existing = store.get(where.id);
        if (!existing) {
          const err = new Error("Record to update not found.");
          (err as unknown as { code: string }).code = "P2025";
          throw err;
        }
        const updated: DbPanelConnection = {
          ...existing,
          ...data,
          updatedAt: new Date(),
        };
        store.set(where.id, updated);
        return updated;
      }),

      delete: vi.fn().mockImplementation(async ({ where }) => {
        const existing = store.get(where.id);
        if (!existing) {
          const err = new Error("Record to delete not found.");
          (err as unknown as { code: string }).code = "P2025";
          throw err;
        }
        store.delete(where.id);
        return existing;
      }),
    };

    mockPrisma = {
      panelConnection: mockPanelConnection,
    } as unknown as PrismaClient;

    encryptionService = new CredentialEncryptionService({ masterKey: MASTER_KEY });
    connectionService = new PanelConnectionService();
    credentialService = new PanelCredentialService({
      prismaClient: mockPrisma,
      encryptionService,
      connectionService,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // =========================================================================
  // Workflow A: Panel Connection Lifecycle
  // =========================================================================
  describe("Workflow A: Panel Connection Lifecycle", () => {
    it("validates URL, encrypts API key, persists, and verifies connection", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            object: "user",
            attributes: { id: 101, username: "admin", email: "admin@example.com" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );

      // 1-4. Create and persist
      const created = await credentialService.createConnection({
        guildId: GUILD_A,
        name: "Primary Panel",
        panelUrl: `${PANEL_URL}/`,
        apiKey: API_KEY,
      });

      expect(created.id).toBeDefined();
      expect(created.guildId).toBe(GUILD_A);
      expect(created.name).toBe("Primary Panel");
      expect(created.panelUrl).toBe(PANEL_URL); // Normalized (no trailing slash)

      // 5. Confirm API key is never exposed in metadata
      expect(created).not.toHaveProperty("apiKey");
      expect(created).not.toHaveProperty("encryptedApiKey");
      expect(created).not.toHaveProperty("encryptionIv");
      expect(created).not.toHaveProperty("encryptionAuthTag");
      expect(JSON.stringify(created)).not.toContain(API_KEY);

      // 6. Verify connection against panel
      const verification = await credentialService.verifyStoredConnection(GUILD_A, created.id);
      expect(verification.state).toBe(PanelConnectionState.CONNECTED);
      expect(verification.success).toBe(true);
      expect(verification.account?.username).toBe("admin");

      // Verify fetch was called with Authorization header containing raw key
      const [calledUrl, calledInit] = vi.mocked(globalThis.fetch).mock.calls[0] as [
        string,
        RequestInit & { headers: Record<string, string> },
      ];
      expect(calledUrl).toBe("https://panel.example.com/api/client/account");
      expect(calledInit.headers["Authorization"]).toBe(`Bearer ${API_KEY}`);
    });
  });

  // =========================================================================
  // Workflow B: Server Discovery Flow
  // =========================================================================
  describe("Workflow B: Server Discovery Flow", () => {
    it("decrypts within security boundary and performs paginated server discovery", async () => {
      // Create connection
      const conn = await credentialService.createConnection({
        guildId: GUILD_A,
        name: "Cluster-1",
        panelUrl: PANEL_URL,
        apiKey: API_KEY,
      });

      // Mock 2-page discovery response
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        const parsed = new URL(url);
        const page = parsed.searchParams.get("page") ?? "1";

        if (page === "1") {
          return new Response(
            JSON.stringify({
              object: "list",
              data: [
                {
                  object: "server",
                  attributes: {
                    server_owner: true,
                    identifier: "srv01",
                    uuid: "uuid-001",
                    name: "Minecraft Survival",
                    node: "Node-1",
                    is_suspended: false,
                    is_installing: false,
                    limits: { memory: 2048, swap: 0, disk: 10240, io: 500, cpu: 200 },
                    feature_limits: { databases: 1, allocations: 1, backups: 2 },
                  },
                },
              ],
              meta: {
                pagination: { total: 2, count: 1, per_page: 1, current_page: 1, total_pages: 2 },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            object: "list",
            data: [
              {
                object: "server",
                attributes: {
                  server_owner: false,
                  identifier: "srv02",
                  uuid: "uuid-002",
                  name: "Discord Bot Host",
                  node: "Node-2",
                  is_suspended: false,
                  is_installing: false,
                  limits: { memory: 1024, swap: 0, disk: 5120, io: 500, cpu: 100 },
                  feature_limits: { databases: 0, allocations: 1, backups: 1 },
                },
                meta: {
                  is_server_owner: false,
                  user_permissions: ["control.start", "control.stop"],
                },
              },
            ],
            meta: {
              pagination: { total: 2, count: 1, per_page: 1, current_page: 2, total_pages: 2 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      // Execute within security boundary
      const result = await credentialService.executeWithClient(
        GUILD_A,
        conn.id,
        async (client: PterodactylClient) => {
          const discoveryService = new ServerDiscoveryService(client);
          return discoveryService.discoverServers({ pageSize: 1, maxPages: 5 });
        },
      );

      expect(result.servers).toHaveLength(2);
      expect(result.totalPages).toBe(2);
      expect(result.totalServers).toBe(2);
      expect(result.pagesFetched).toBe(2);

      // Verify server 1 (owner)
      const srv1 = result.servers[0];
      expect(srv1.identifier).toBe("srv01");
      expect(srv1.isOwner).toBe(true);
      expect(srv1.permissions).toEqual(["*"]);

      // Verify server 2 (subuser)
      const srv2 = result.servers[1];
      expect(srv2.identifier).toBe("srv02");
      expect(srv2.isOwner).toBe(false);
      expect(srv2.permissions).toEqual(["control.start", "control.stop"]);
    });
  });

  // =========================================================================
  // Workflow C: Server Detail & Resource Monitoring Flow
  // =========================================================================
  describe("Workflow C: Server Detail & Resource Monitoring Flow", () => {
    let client: PterodactylClient;
    let detailService: ServerDetailService;

    beforeEach(() => {
      client = new PterodactylClient({ baseUrl: PANEL_URL, apiKey: API_KEY });
      detailService = new ServerDetailService(client);
    });

    it("handles online server with normal telemetry", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/resources")) {
          return new Response(
            JSON.stringify({
              object: "stats",
              attributes: {
                current_state: "running",
                is_suspended: false,
                resources: {
                  memory_bytes: 536870912, // 512 MB
                  cpu_absolute: 25.5,
                  disk_bytes: 1073741824, // 1 GB
                  network_rx_bytes: 10000,
                  network_tx_bytes: 20000,
                  uptime: 120000,
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            object: "server",
            attributes: {
              server_owner: true,
              identifier: "srv01",
              uuid: "uuid-001",
              name: "Online Game Server",
              node: "Node-1",
              is_suspended: false,
              is_installing: false,
              limits: { memory: 2048, swap: 0, disk: 10240, io: 500, cpu: 200 },
              feature_limits: { databases: 1, allocations: 1, backups: 2 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const combined = await detailService.getServerWithResources("srv01");
      expect(combined.server.identifier).toBe("srv01");
      expect(combined.resources).not.toBeNull();
      expect(combined.resources?.currentState).toBe("running");
      expect(combined.resources?.memoryBytes).toBe(536870912);
      expect(combined.resources?.cpuPercentage).toBe(25.5);
      expect(combined.resourcesUnavailableReason).toBeNull();
    });

    it("handles stopped / offline server metrics", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/resources")) {
          return new Response(
            JSON.stringify({
              object: "stats",
              attributes: {
                current_state: "offline",
                is_suspended: false,
                resources: {
                  memory_bytes: 0,
                  cpu_absolute: 0,
                  disk_bytes: 1073741824,
                  network_rx_bytes: 0,
                  network_tx_bytes: 0,
                  uptime: 0,
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            object: "server",
            attributes: {
              server_owner: true,
              identifier: "srv01",
              uuid: "uuid-001",
              name: "Stopped Server",
              node: "Node-1",
              is_suspended: false,
              is_installing: false,
              limits: { memory: 1024, swap: 0, disk: 10240, io: 500, cpu: 100 },
              feature_limits: { databases: 1, allocations: 1, backups: 1 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const combined = await detailService.getServerWithResources("srv01");
      expect(combined.resources?.currentState).toBe("offline");
      expect(combined.resources?.memoryBytes).toBe(0);
      expect(combined.resources?.cpuPercentage).toBe(0);
    });

    it("handles Wings daemon outage: preserves server details with resourcesUnavailableReason", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/resources")) {
          // Daemon is down, panel returns 502 Bad Gateway
          return new Response(
            JSON.stringify({
              errors: [
                { code: "DaemonConnectionException", detail: "Could not connect to Wings daemon." },
              ],
            }),
            { status: 502, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            object: "server",
            attributes: {
              server_owner: true,
              identifier: "srv01",
              uuid: "uuid-001",
              name: "Protected Server",
              node: "Node-1",
              is_suspended: false,
              is_installing: false,
              limits: { memory: 2048, swap: 0, disk: 10240, io: 500, cpu: 200 },
              feature_limits: { databases: 1, allocations: 1, backups: 2 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const combined = await detailService.getServerWithResources("srv01");
      expect(combined.server.identifier).toBe("srv01");
      expect(combined.resources).toBeNull();
      expect(combined.resourcesUnavailableReason).toBe("daemon_unavailable");
    });

    it("handles unlimited resource limits (0 = unlimited convention)", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
        if (url.endsWith("/resources")) {
          return new Response(
            JSON.stringify({
              object: "stats",
              attributes: {
                current_state: "running",
                is_suspended: false,
                resources: {
                  memory_bytes: 1048576,
                  cpu_absolute: 5,
                  disk_bytes: 2097152,
                  network_rx_bytes: 0,
                  network_tx_bytes: 0,
                  uptime: 1000,
                },
              },
            }),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        return new Response(
          JSON.stringify({
            object: "server",
            attributes: {
              server_owner: true,
              identifier: "srv_unlimited",
              uuid: "uuid-unlimited",
              name: "Unlimited VPS",
              node: "Node-HQ",
              is_suspended: false,
              is_installing: false,
              limits: { memory: 0, swap: 0, disk: 0, io: 500, cpu: 0 },
              feature_limits: { databases: 0, allocations: 0, backups: 0 },
            },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const server = await detailService.getServerDetails("srv_unlimited");
      expect(server.limits.memory).toBe(0);
      expect(server.limits.disk).toBe(0);
      expect(server.limits.cpu).toBe(0);

      const combined = await detailService.getServerWithResources("srv_unlimited");
      expect(combined.resources?.isMemoryUnlimited).toBe(true);
      expect(combined.resources?.memoryLimitBytes).toBeNull();
      expect(combined.resources?.isDiskUnlimited).toBe(true);
      expect(combined.resources?.diskLimitBytes).toBeNull();
      expect(combined.resources?.isCpuUnlimited).toBe(true);
    });
  });

  // =========================================================================
  // Workflow D: Multi-Tenant Security & Isolation
  // =========================================================================
  describe("Workflow D: Multi-Tenant Security & Isolation", () => {
    it("strictly isolates connections between guilds and prevents AAD swapping", async () => {
      // Guild A creates connection
      const connA = await credentialService.createConnection({
        guildId: GUILD_A,
        name: "Guild A Panel",
        panelUrl: PANEL_URL,
        apiKey: API_KEY,
      });

      // Guild B cannot get Guild A connection
      await expect(credentialService.getConnection(GUILD_B, connA.id)).rejects.toThrow(
        PanelConnectionNotFoundError,
      );

      // Guild B cannot update Guild A connection
      await expect(
        credentialService.updateConnection(GUILD_B, connA.id, { name: "Tampered" }),
      ).rejects.toThrow(PanelConnectionNotFoundError);

      // Guild B cannot delete Guild A connection
      await expect(credentialService.deleteConnection(GUILD_B, connA.id)).rejects.toThrow(
        PanelConnectionNotFoundError,
      );

      // Guild B listing returns empty
      const listB = await credentialService.listConnections(GUILD_B);
      expect(listB).toHaveLength(0);

      // AAD Tamper Detection:
      // If someone moves the ciphertext/iv/authTag from Guild A record to Guild B record
      const rawConnA = store.get(connA.id)!;
      const tamperedRecord: DbPanelConnection = {
        id: "conn_tampered_b",
        guildId: GUILD_B,
        name: "Injected Ciphertext",
        panelUrl: PANEL_URL,
        encryptedApiKey: rawConnA.encryptedApiKey,
        encryptionIv: rawConnA.encryptionIv,
        encryptionAuthTag: rawConnA.encryptionAuthTag,
        encryptionKeyVersion: rawConnA.encryptionKeyVersion,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      store.set(tamperedRecord.id, tamperedRecord);

      // Attempting to execute with client on Guild B using Guild A's ciphertext must fail AAD check
      await expect(
        credentialService.executeWithClient(GUILD_B, tamperedRecord.id, async () => "ok"),
      ).rejects.toThrow(PterodactylDecryptionError);
    });
  });

  // =========================================================================
  // Workflow E: Resilience & Failure Recovery
  // =========================================================================
  describe("Workflow E: Resilience & Failure Recovery", () => {
    it("handles HTTP 429 with Retry-After and recovers on retry", async () => {
      let attempts = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response(
            JSON.stringify({ errors: [{ code: "TooManyRequests", detail: "Slow down." }] }),
            {
              status: 429,
              headers: { "Content-Type": "application/json", "Retry-After": "1" },
            },
          );
        }
        return new Response(
          JSON.stringify({ object: "user", attributes: { id: 1, username: "admin" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client = new PterodactylClient({
        baseUrl: PANEL_URL,
        apiKey: API_KEY,
        retry: { baseDelayMs: 50, maxDelayMs: 2000 },
      });

      const res = await client.account.getAccountDetails();
      expect(res.attributes.username).toBe("admin");
      expect(attempts).toBe(2);
    });

    it("retries on HTTP 502/503/504 and recovers", async () => {
      let attempts = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response("Bad Gateway", { status: 502 });
        }
        return new Response(
          JSON.stringify({ object: "user", attributes: { id: 1, username: "admin" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client = new PterodactylClient({
        baseUrl: PANEL_URL,
        apiKey: API_KEY,
        retry: { baseDelayMs: 10, maxDelayMs: 100 },
      });

      const res = await client.account.getAccountDetails();
      expect(res.attributes.username).toBe("admin");
      expect(attempts).toBe(2);
    });

    it("respects retryHttp500 policy: fails on false, retries on true", async () => {
      // 1. retryHttp500: false (default) -> fails immediately
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response("Internal Server Error", { status: 500 }));
      const defaultClient = new PterodactylClient({
        baseUrl: PANEL_URL,
        apiKey: API_KEY,
        retry: { baseDelayMs: 10 },
      });

      await expect(defaultClient.account.getAccountDetails()).rejects.toThrow(
        PterodactylServerError,
      );
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);

      // 2. retryHttp500: true -> retries
      let attempts = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          return new Response("Internal Server Error", { status: 500 });
        }
        return new Response(
          JSON.stringify({ object: "user", attributes: { id: 1, username: "recovered" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const retry500Client = new PterodactylClient({
        baseUrl: PANEL_URL,
        apiKey: API_KEY,
        retry: { retryHttp500: true, baseDelayMs: 10 },
      });

      const res = await retry500Client.account.getAccountDetails();
      expect(res.attributes.username).toBe("recovered");
      expect(attempts).toBe(2);
    });

    it("retries on transient network errors (TypeError: fetch failed)", async () => {
      let attempts = 0;
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        attempts++;
        if (attempts === 1) {
          throw new TypeError("fetch failed");
        }
        return new Response(
          JSON.stringify({ object: "user", attributes: { id: 1, username: "admin" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const client = new PterodactylClient({
        baseUrl: PANEL_URL,
        apiKey: API_KEY,
        retry: { baseDelayMs: 10 },
      });

      const res = await client.account.getAccountDetails();
      expect(res.attributes.username).toBe("admin");
      expect(attempts).toBe(2);
    });

    it("does NOT retry when request is cancelled via AbortSignal", async () => {
      const controller = new AbortController();
      controller.abort();

      const client = new PterodactylClient({ baseUrl: PANEL_URL, apiKey: API_KEY });

      await expect(client.account.getAccountDetails({ signal: controller.signal })).rejects.toThrow(
        PterodactylAbortError,
      );
    });

    it("does NOT retry 401 or 403 non-retryable errors", async () => {
      globalThis.fetch = vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ errors: [{ code: "Unauthorized" }] }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        }),
      );

      const client = new PterodactylClient({ baseUrl: PANEL_URL, apiKey: API_KEY });

      await expect(client.account.getAccountDetails()).rejects.toThrow(PterodactylAuthError);
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });

    it("does NOT retry unsafe mutating methods (POST) by default", async () => {
      globalThis.fetch = vi
        .fn()
        .mockResolvedValue(new Response("Service Unavailable", { status: 503 }));

      const client = new PterodactylClient({ baseUrl: PANEL_URL, apiKey: API_KEY });

      await expect(
        client.post("/api/client/servers/srv01/power", { signal: "restart" }),
      ).rejects.toThrow(PterodactylServerError);
      // Fails immediately on 1 attempt because POST is not idempotent
      expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    });
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PanelCredentialService } from "../../src/services/pterodactyl/panelCredentialService.js";
import { CredentialEncryptionService } from "../../src/services/pterodactyl/encryptionService.js";
import { PanelConnectionService } from "../../src/services/pterodactyl/connectionService.js";
import { PanelConnectionState } from "../../src/services/pterodactyl/types/connection.js";
import {
  PanelConnectionNotFoundError,
  DuplicateConnectionNameError,
  PterodactylUrlError,
  PterodactylAuthError,
  PterodactylError,
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

describe("PanelCredentialService (Task 02.6)", () => {
  const TEST_MASTER_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const TEST_GUILD_A = "guild_111111111111111111";
  const TEST_GUILD_B = "guild_222222222222222222";
  const TEST_PANEL_URL = "https://panel.example.com";
  const TEST_API_KEY = "ptlc_secret_client_token_test_123456";

  let store: Map<string, DbPanelConnection>;
  let mockPrisma: PrismaClient;
  let encryptionService: CredentialEncryptionService;
  let connectionService: PanelConnectionService;
  let credentialService: PanelCredentialService;

  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.restoreAllMocks();
    store = new Map<string, DbPanelConnection>();

    // High-fidelity in-memory Prisma mock enforcing unique constraints and indexing
    const mockPanelConnection = {
      create: vi.fn().mockImplementation(async ({ data }) => {
        // Enforce @@unique([guildId, name])
        for (const existing of store.values()) {
          if (existing.guildId === data.guildId && existing.name === data.name) {
            const err = new Error("Unique constraint failed on the fields: (`guild_id`,`name`)");
            (err as unknown as { code: string }).code = "P2002";
            throw err;
          }
        }

        const now = new Date();
        const record: DbPanelConnection = {
          id: data.id,
          guildId: data.guildId,
          name: data.name,
          panelUrl: data.panelUrl,
          encryptedApiKey: data.encryptedApiKey,
          encryptionIv: data.encryptionIv,
          encryptionAuthTag: data.encryptionAuthTag,
          encryptionKeyVersion: data.encryptionKeyVersion ?? 1,
          createdAt: now,
          updatedAt: now,
        };
        store.set(record.id, record);
        return { ...record };
      }),

      findFirst: vi.fn().mockImplementation(async ({ where }) => {
        for (const item of store.values()) {
          const matchId = where.id ? item.id === where.id : true;
          const matchGuild = where.guildId ? item.guildId === where.guildId : true;
          const matchName = where.name ? item.name === where.name : true;
          if (matchId && matchGuild && matchName) {
            return { ...item };
          }
        }
        return null;
      }),

      findMany: vi.fn().mockImplementation(async ({ where }) => {
        const results: DbPanelConnection[] = [];
        for (const item of store.values()) {
          if (!where.guildId || item.guildId === where.guildId) {
            results.push({ ...item });
          }
        }
        return results.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
      }),

      update: vi.fn().mockImplementation(async ({ where, data }) => {
        const item = store.get(where.id);
        if (!item) {
          throw new Error("Record to update not found.");
        }

        if (data.name && data.name !== item.name) {
          for (const existing of store.values()) {
            if (
              existing.id !== item.id &&
              existing.guildId === item.guildId &&
              existing.name === data.name
            ) {
              const err = new Error("Unique constraint failed");
              (err as unknown as { code: string }).code = "P2002";
              throw err;
            }
          }
        }

        const updated: DbPanelConnection = {
          ...item,
          ...data,
          updatedAt: new Date(),
        };
        store.set(where.id, updated);
        return { ...updated };
      }),

      delete: vi.fn().mockImplementation(async ({ where }) => {
        const item = store.get(where.id);
        if (!item) {
          throw new Error("Record to delete not found.");
        }
        store.delete(where.id);
        return { ...item };
      }),
    };

    mockPrisma = {
      panelConnection: mockPanelConnection,
    } as unknown as PrismaClient;

    encryptionService = new CredentialEncryptionService({ masterKey: TEST_MASTER_KEY });
    connectionService = new PanelConnectionService({ allowPrivateNetworks: false });

    credentialService = new PanelCredentialService({
      prismaClient: mockPrisma,
      encryptionService,
      connectionService,
      allowPrivateNetworks: false,
    });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe("Create Panel Connection", () => {
    it("creates a connection, encrypts credentials with contextual AAD, and returns sanitized metadata", async () => {
      const metadata = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "EU Production Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(metadata.id).toBeDefined();
      expect(metadata.guildId).toBe(TEST_GUILD_A);
      expect(metadata.name).toBe("EU Production Panel");
      expect(metadata.panelUrl).toBe("https://panel.example.com");
      expect(metadata.createdAt).toBeInstanceOf(Date);
      expect(metadata.updatedAt).toBeInstanceOf(Date);

      // Verify that no raw credentials or ciphertexts are leaked in returned metadata
      expect(JSON.stringify(metadata)).not.toContain(TEST_API_KEY);
      expect((metadata as unknown as Record<string, unknown>).encryptedApiKey).toBeUndefined();
      expect((metadata as unknown as Record<string, unknown>).encryptionIv).toBeUndefined();
      expect((metadata as unknown as Record<string, unknown>).encryptionAuthTag).toBeUndefined();

      // Verify record stored in database
      const stored = store.get(metadata.id);
      expect(stored).toBeDefined();
      expect(stored?.encryptedApiKey).not.toContain(TEST_API_KEY);
      expect(stored?.encryptionIv).toBeDefined();
      expect(stored?.encryptionAuthTag).toBeDefined();
      expect(stored?.encryptionKeyVersion).toBe(1);

      // Verify that the stored ciphertext can be successfully decrypted using matching AAD
      const aad = CredentialEncryptionService.buildAad(TEST_GUILD_A, metadata.id);
      const decrypted = encryptionService.decrypt(
        {
          ciphertext: stored!.encryptedApiKey,
          iv: stored!.encryptionIv,
          authTag: stored!.encryptionAuthTag,
          keyVersion: stored!.encryptionKeyVersion,
        },
        aad,
      );
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("prevents duplicate connection names in the same guild (P2002 handling)", async () => {
      await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Main Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(
        credentialService.createConnection({
          guildId: TEST_GUILD_A,
          name: "Main Panel",
          panelUrl: "https://other.example.com",
          apiKey: "ptlc_other_key",
        }),
      ).rejects.toThrow(DuplicateConnectionNameError);
    });

    it("allows different guilds to use the same connection name", async () => {
      const connA = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Main Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      const connB = await credentialService.createConnection({
        guildId: TEST_GUILD_B,
        name: "Main Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(connA.id).not.toBe(connB.id);
      expect(connA.guildId).toBe(TEST_GUILD_A);
      expect(connB.guildId).toBe(TEST_GUILD_B);
      expect(store.size).toBe(2);
    });

    it("validates input fields strictly", async () => {
      // Empty guildId
      await expect(
        credentialService.createConnection({
          guildId: "",
          name: "Panel",
          panelUrl: TEST_PANEL_URL,
          apiKey: TEST_API_KEY,
        }),
      ).rejects.toThrow(PterodactylError);

      // Empty name
      await expect(
        credentialService.createConnection({
          guildId: TEST_GUILD_A,
          name: "   ",
          panelUrl: TEST_PANEL_URL,
          apiKey: TEST_API_KEY,
        }),
      ).rejects.toThrow(PterodactylError);

      // Invalid panel URL
      await expect(
        credentialService.createConnection({
          guildId: TEST_GUILD_A,
          name: "Panel",
          panelUrl: "not-a-url",
          apiKey: TEST_API_KEY,
        }),
      ).rejects.toThrow(PterodactylUrlError);

      // Private network URL rejected by default
      await expect(
        credentialService.createConnection({
          guildId: TEST_GUILD_A,
          name: "Panel",
          panelUrl: "http://192.168.1.50:8080",
          apiKey: TEST_API_KEY,
        }),
      ).rejects.toThrow(PterodactylUrlError);

      // Empty API key
      await expect(
        credentialService.createConnection({
          guildId: TEST_GUILD_A,
          name: "Panel",
          panelUrl: TEST_PANEL_URL,
          apiKey: "   ",
        }),
      ).rejects.toThrow(PterodactylAuthError);
    });

    it("verifies credentials before saving when verifyBeforeSaving: true", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({ object: "user", attributes: { id: 1, username: "admin" } }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

      const metadata = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Verified Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
        verifyBeforeSaving: true,
      });

      expect(metadata.name).toBe("Verified Panel");
      expect(store.size).toBe(1);
    });

    it("rejects and does NOT persist connection when verifyBeforeSaving fails", async () => {
      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(JSON.stringify({ errors: [{ detail: "Invalid API key" }] }), {
          status: 401,
          headers: { "Content-Type": "application/json" },
        });
      });

      await expect(
        credentialService.createConnection({
          guildId: TEST_GUILD_A,
          name: "Broken Panel",
          panelUrl: TEST_PANEL_URL,
          apiKey: "ptlc_invalid_key",
          verifyBeforeSaving: true,
        }),
      ).rejects.toThrow("connection verification failed");

      // Verify nothing was saved in the database
      expect(store.size).toBe(0);
    });
  });

  describe("Retrieve Connection Metadata & List Connections", () => {
    it("retrieves connection metadata without decrypting credentials", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Production",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      const fetched = await credentialService.getConnection(TEST_GUILD_A, created.id);
      expect(fetched.id).toBe(created.id);
      expect(fetched.name).toBe("Production");
      expect(fetched.panelUrl).toBe("https://panel.example.com");

      // Credential fields are never present in metadata
      expect(JSON.stringify(fetched)).not.toContain(TEST_API_KEY);
      expect((fetched as unknown as Record<string, unknown>).encryptedApiKey).toBeUndefined();
    });

    it("throws PanelConnectionNotFoundError when connection ID does not exist", async () => {
      await expect(
        credentialService.getConnection(TEST_GUILD_A, "non_existent_conn_id"),
      ).rejects.toThrow(PanelConnectionNotFoundError);
    });

    it("strictly prevents cross-guild access (Guild B cannot read Guild A's connection)", async () => {
      const connA = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Guild A Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      // Guild B attempts to fetch Guild A's connection
      await expect(credentialService.getConnection(TEST_GUILD_B, connA.id)).rejects.toThrow(
        PanelConnectionNotFoundError,
      );
    });

    it("lists only connections belonging to the requested guild", async () => {
      await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Guild A Panel 1",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });
      await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Guild A Panel 2",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });
      await credentialService.createConnection({
        guildId: TEST_GUILD_B,
        name: "Guild B Panel 1",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      const listA = await credentialService.listConnections(TEST_GUILD_A);
      expect(listA.length).toBe(2);
      expect(listA.map((x) => x.name)).toEqual(["Guild A Panel 1", "Guild A Panel 2"]);

      const listB = await credentialService.listConnections(TEST_GUILD_B);
      expect(listB.length).toBe(1);
      expect(listB[0]!.name).toBe("Guild B Panel 1");

      const listEmpty = await credentialService.listConnections("unrelated_guild_id");
      expect(listEmpty).toEqual([]);
    });
  });

  describe("Internal Credential Decryption", () => {
    it("decrypts and returns the API key when explicitly requested via getDecryptedConnection", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Decryption Test Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      const decrypted = await credentialService.getDecryptedConnection(TEST_GUILD_A, created.id);
      expect(decrypted.connection.id).toBe(created.id);
      expect(decrypted.apiKey).toBe(TEST_API_KEY);
    });

    it("enforces cross-guild authorization on getDecryptedConnection", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Private Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      // Guild B must not be able to decrypt Guild A's credentials
      await expect(
        credentialService.getDecryptedConnection(TEST_GUILD_B, created.id),
      ).rejects.toThrow(PanelConnectionNotFoundError);
    });
  });

  describe("Update Panel Connection", () => {
    it("updates connection name and panelUrl successfully", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Original Name",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      const updated = await credentialService.updateConnection(TEST_GUILD_A, created.id, {
        name: "Updated Name",
        panelUrl: "https://new-panel.example.com",
      });

      expect(updated.name).toBe("Updated Name");
      expect(updated.panelUrl).toBe("https://new-panel.example.com");

      // Verify DB record updated
      const stored = store.get(created.id);
      expect(stored?.name).toBe("Updated Name");
      expect(stored?.panelUrl).toBe("https://new-panel.example.com");
    });

    it("re-encrypts with new IV when API key is updated", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Key Rotate Test",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      const oldStored = { ...store.get(created.id)! };
      const NEW_KEY = "ptlc_new_secret_key_999888";

      await credentialService.updateConnection(TEST_GUILD_A, created.id, {
        apiKey: NEW_KEY,
      });

      const newStored = store.get(created.id)!;
      expect(newStored.encryptionIv).not.toBe(oldStored.encryptionIv);
      expect(newStored.encryptedApiKey).not.toBe(oldStored.encryptedApiKey);

      // Verify decrypted key matches new key
      const decrypted = await credentialService.getDecryptedConnection(TEST_GUILD_A, created.id);
      expect(decrypted.apiKey).toBe(NEW_KEY);
    });

    it("rejects update if target connection does not belong to the calling guild", async () => {
      const connA = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Guild A Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(
        credentialService.updateConnection(TEST_GUILD_B, connA.id, {
          name: "Hacked Name",
        }),
      ).rejects.toThrow(PanelConnectionNotFoundError);
    });

    it("rejects update if new name conflicts with an existing connection in the guild", async () => {
      await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Panel One",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });
      const connTwo = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Panel Two",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      await expect(
        credentialService.updateConnection(TEST_GUILD_A, connTwo.id, {
          name: "Panel One", // Conflicts with Panel One in Guild A
        }),
      ).rejects.toThrow(DuplicateConnectionNameError);
    });
  });

  describe("Delete Panel Connection", () => {
    it("deletes a connection belonging to the guild", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "To Delete",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      expect(store.has(created.id)).toBe(true);
      await credentialService.deleteConnection(TEST_GUILD_A, created.id);
      expect(store.has(created.id)).toBe(false);

      // Subsequent fetch fails
      await expect(credentialService.getConnection(TEST_GUILD_A, created.id)).rejects.toThrow(
        PanelConnectionNotFoundError,
      );
    });

    it("rejects deletion when guildId does not match (cross-guild deletion prevention)", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Guild A Protected Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      // Guild B attempts to delete Guild A's connection
      await expect(credentialService.deleteConnection(TEST_GUILD_B, created.id)).rejects.toThrow(
        PanelConnectionNotFoundError,
      );
      expect(store.has(created.id)).toBe(true);
    });
  });

  describe("Integration: Verify Stored Connection & Client Factory", () => {
    it("verifies a stored connection successfully and discards decrypted key", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Stored Verification Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({
            object: "user",
            attributes: { id: 7, username: "panel_operator", email: "op@panel.com" },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      });

      const result = await credentialService.verifyStoredConnection(TEST_GUILD_A, created.id);
      expect(result.success).toBe(true);
      expect(result.state).toBe(PanelConnectionState.CONNECTED);
      expect(result.account?.username).toBe("panel_operator");

      // Verify credentials are redacted from result
      expect(JSON.stringify(result)).not.toContain(TEST_API_KEY);
    });

    it("handles invalid credentials on stored connection verification", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Expired Key Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      globalThis.fetch = vi.fn().mockImplementation(async () => {
        return new Response(
          JSON.stringify({ errors: [{ detail: "The credentials are invalid" }] }),
          {
            status: 401,
            headers: { "Content-Type": "application/json" },
          },
        );
      });

      const result = await credentialService.verifyStoredConnection(TEST_GUILD_A, created.id);
      expect(result.success).toBe(false);
      expect(result.state).toBe(PanelConnectionState.INVALID_CREDENTIALS);
      expect(result.statusCode).toBe(401);
      expect(JSON.stringify(result)).not.toContain(TEST_API_KEY);
    });

    it("creates authenticated PterodactylClient instance via createClientForConnection", async () => {
      const created = await credentialService.createConnection({
        guildId: TEST_GUILD_A,
        name: "Client Factory Panel",
        panelUrl: TEST_PANEL_URL,
        apiKey: TEST_API_KEY,
      });

      const client = await credentialService.createClientForConnection(TEST_GUILD_A, created.id);
      expect(client.baseUrl.origin).toBe("https://panel.example.com");
      expect(client.allowPrivateNetworks).toBe(false);
    });
  });
});

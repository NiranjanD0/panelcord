import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  PanelWorkflowService,
  connectModalSchema,
  registerPanelInteractions,
} from "../src/services/panelWorkflowService.js";
import { PanelCredentialService } from "../src/services/pterodactyl/panelCredentialService.js";
import { PanelConnectionService } from "../src/services/pterodactyl/connectionService.js";
import {
  PanelConnectionState,
  type PanelConnectionResult,
} from "../src/services/pterodactyl/types/connection.js";
import {
  DuplicateConnectionNameError,
  PanelConnectionNotFoundError,
} from "../src/services/pterodactyl/errors/index.js";
import { InteractionDispatcher } from "../src/interactions/dispatcher.js";
import {
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type AutocompleteInteraction,
  type ModalBuilder,
} from "discord.js";
import { logger } from "../src/utils/logger.js";

function createMockChatInputInteraction(options: {
  guildId?: string | null;
  subcommand: string;
  subcommandOptions?: Record<string, string | null>;
  hasManageGuild?: boolean;
}): ChatInputCommandInteraction {
  const {
    guildId = "guild_123",
    subcommand,
    subcommandOptions = {},
    hasManageGuild = true,
  } = options;

  const mock = {
    isChatInputCommand: () => true,
    isButton: () => false,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    isAutocomplete: () => false,
    guildId,
    user: { id: "user_456" },
    memberPermissions: {
      has: vi.fn((perm) => {
        if (perm === PermissionFlagsBits.ManageGuild) return hasManageGuild;
        return true;
      }),
    },
    options: {
      getSubcommand: vi.fn().mockReturnValue(subcommand),
      getString: vi.fn((name: string) => subcommandOptions[name] ?? null),
    },
    showModal: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockImplementation(async () => {
      mock.replied = true;
    }),
    deferReply: vi.fn().mockImplementation(async () => {
      mock.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  } as unknown as ChatInputCommandInteraction;

  return mock;
}

function createMockModalInteraction(options: {
  guildId?: string | null;
  name: string;
  panelUrl: string;
  apiKey: string;
  hasManageGuild?: boolean;
}): ModalSubmitInteraction {
  const { guildId = "guild_123", name, panelUrl, apiKey, hasManageGuild = true } = options;

  const fieldsMap = new Map<string, string>([
    ["connection_name", name],
    ["panel_url", panelUrl],
    ["api_key", apiKey],
  ]);

  const mock = {
    isChatInputCommand: () => false,
    isButton: () => false,
    isAnySelectMenu: () => false,
    isModalSubmit: () => true,
    isAutocomplete: () => false,
    customId: "panel_connect_modal",
    guildId,
    user: { id: "user_456" },
    memberPermissions: {
      has: vi.fn((perm) => {
        if (perm === PermissionFlagsBits.ManageGuild) return hasManageGuild;
        return true;
      }),
    },
    fields: {
      getTextInputValue: vi.fn((id: string) => fieldsMap.get(id) ?? ""),
    },
    reply: vi.fn().mockImplementation(async () => {
      mock.replied = true;
    }),
    deferReply: vi.fn().mockImplementation(async () => {
      mock.deferred = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  } as unknown as ModalSubmitInteraction;

  return mock;
}

function createMockButtonInteraction(options: {
  guildId?: string | null;
  customId: string;
  hasManageGuild?: boolean;
}): ButtonInteraction {
  const { guildId = "guild_123", customId, hasManageGuild = true } = options;

  const mock = {
    isChatInputCommand: () => false,
    isButton: () => true,
    isAnySelectMenu: () => false,
    isModalSubmit: () => false,
    isAutocomplete: () => false,
    customId,
    guildId,
    user: { id: "user_456" },
    memberPermissions: {
      has: vi.fn((perm) => {
        if (perm === PermissionFlagsBits.ManageGuild) return hasManageGuild;
        return true;
      }),
    },
    reply: vi.fn().mockImplementation(async () => {
      mock.replied = true;
    }),
    deferReply: vi.fn().mockImplementation(async () => {
      mock.deferred = true;
    }),
    deferUpdate: vi.fn().mockImplementation(async () => {
      mock.deferred = true;
    }),
    update: vi.fn().mockImplementation(async () => {
      mock.replied = true;
    }),
    editReply: vi.fn().mockResolvedValue(undefined),
    followUp: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  } as unknown as ButtonInteraction;

  return mock;
}

describe("Panel Connection Workflow (Phase 03.2)", () => {
  let mockCredentialService: PanelCredentialService;
  let mockConnectionService: PanelConnectionService;
  let workflowService: PanelWorkflowService;

  beforeEach(() => {
    vi.restoreAllMocks();

    mockCredentialService = {
      createConnection: vi.fn(),
      listConnections: vi.fn().mockResolvedValue([]),
      getConnection: vi.fn(),
      verifyStoredConnection: vi.fn(),
      deleteConnection: vi.fn().mockResolvedValue(undefined),
    } as unknown as PanelCredentialService;

    mockConnectionService = {
      verifyConnection: vi.fn(),
    } as unknown as PanelConnectionService;

    workflowService = new PanelWorkflowService({
      credentialService: mockCredentialService,
      connectionService: mockConnectionService,
    });
  });

  describe("Guild & Permission Isolation", () => {
    it("rejects slash command execution outside a guild (e.g. DMs)", async () => {
      const interaction = createMockChatInputInteraction({
        guildId: null,
        subcommand: "list",
      });

      await workflowService.handleCommand(interaction);
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("only be used within a Discord server"),
        }),
      );
    });

    it("rejects users lacking Manage Server permission for connect subcommand", async () => {
      const interaction = createMockChatInputInteraction({
        subcommand: "connect",
        hasManageGuild: false,
      });

      await workflowService.handleCommand(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Manage Server"),
          ephemeral: true,
        }),
      );
      expect(interaction.showModal).not.toHaveBeenCalled();
    });

    it("rejects modal submission when user lacks Manage Server permission", async () => {
      const interaction = createMockModalInteraction({
        hasManageGuild: false,
        name: "TestPanel",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_validkey",
      });

      await workflowService.handleConnectModalSubmit(interaction);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Manage Server"),
        }),
      );
      expect(mockConnectionService.verifyConnection).not.toHaveBeenCalled();
    });

    it("rejects button interactions when user lacks Manage Server permission", async () => {
      const interaction = createMockButtonInteraction({
        hasManageGuild: false,
        customId: "panel_disconnect_confirm:conn_123",
      });

      await workflowService.handleDisconnectButton(interaction, {
        action: "confirm",
        connectionId: "conn_123",
      });

      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Manage Server"),
          ephemeral: true,
        }),
      );
      expect(mockCredentialService.deleteConnection).not.toHaveBeenCalled();
    });
  });

  describe("Connect Modal Structure & Input Validation", () => {
    it("opens a Discord modal with required fields on /panel connect", async () => {
      const interaction = createMockChatInputInteraction({ subcommand: "connect" });

      await workflowService.handleCommand(interaction);
      expect(interaction.showModal).toHaveBeenCalledTimes(1);

      const modalArg = (interaction.showModal as unknown as { mock: { calls: unknown[][] } }).mock
        .calls[0]![0] as ModalBuilder;
      const modalJson = modalArg.toJSON();

      expect(modalJson.custom_id).toBe("panel_connect_modal");
      expect(modalJson.title).toBe("Connect Pterodactyl Panel");
      expect(modalJson.components).toHaveLength(3);
    });

    it("validates modal inputs using Zod schema", () => {
      expect(
        connectModalSchema.safeParse({
          name: "Prod-Panel",
          panelUrl: "https://panel.example.com",
          apiKey: "ptlc_validkey123",
        }).success,
      ).toBe(true);

      // Name too long (>64)
      expect(
        connectModalSchema.safeParse({
          name: "a".repeat(65),
          panelUrl: "https://panel.example.com",
          apiKey: "ptlc_key",
        }).success,
      ).toBe(false);

      // Empty URL
      expect(
        connectModalSchema.safeParse({
          name: "Prod",
          panelUrl: "   ",
          apiKey: "ptlc_key",
        }).success,
      ).toBe(false);

      // Empty API key
      expect(
        connectModalSchema.safeParse({
          name: "Prod",
          panelUrl: "https://panel.example.com",
          apiKey: "   ",
        }).success,
      ).toBe(false);
    });
  });

  describe("Panel Connection & Verification Workflow", () => {
    it("successfully verifies and persists a valid panel connection", async () => {
      const interaction = createMockModalInteraction({
        name: "Production EU",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_secretkey123",
      });

      const mockVerification: PanelConnectionResult = {
        state: PanelConnectionState.CONNECTED,
        success: true,
        message: "Connected",
        account: {
          id: 1,
          username: "admin_user",
          email: "admin@example.com",
          firstName: "Admin",
          lastName: "User",
          language: "en",
        },
      };
      vi.mocked(mockConnectionService.verifyConnection).mockResolvedValue(mockVerification);

      vi.mocked(mockCredentialService.createConnection).mockResolvedValue({
        id: "conn_eu_1",
        guildId: "guild_123",
        name: "Production EU",
        panelUrl: "https://panel.example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await workflowService.handleConnectModalSubmit(interaction);

      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(mockConnectionService.verifyConnection).toHaveBeenCalledWith({
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_secretkey123",
        timeoutMs: 10000,
      });

      expect(mockCredentialService.createConnection).toHaveBeenCalledWith({
        guildId: "guild_123",
        name: "Production EU",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_secretkey123",
        verifyBeforeSaving: false,
      });

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "✅ Pterodactyl Panel Connected",
              }),
            }),
          ],
        }),
      );
    });

    it("handles invalid credentials (HTTP 401) with user-friendly error", async () => {
      const interaction = createMockModalInteraction({
        name: "BadCreds",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_badkey",
      });

      vi.mocked(mockConnectionService.verifyConnection).mockResolvedValue({
        state: PanelConnectionState.INVALID_CREDENTIALS,
        success: false,
        message: "Unauthorized",
      });

      await workflowService.handleConnectModalSubmit(interaction);

      expect(mockCredentialService.createConnection).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Invalid API key"),
        }),
      );
    });

    it("handles insufficient API permissions (HTTP 403) with clear message", async () => {
      const interaction = createMockModalInteraction({
        name: "NoPerms",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_noperms",
      });

      vi.mocked(mockConnectionService.verifyConnection).mockResolvedValue({
        state: PanelConnectionState.INSUFFICIENT_PERMISSIONS,
        success: false,
        message: "Forbidden",
      });

      await workflowService.handleConnectModalSubmit(interaction);

      expect(mockCredentialService.createConnection).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Insufficient API permissions"),
        }),
      );
    });

    it("handles unreachable panel (network failure) gracefully", async () => {
      const interaction = createMockModalInteraction({
        name: "Unreachable",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_key",
      });

      vi.mocked(mockConnectionService.verifyConnection).mockResolvedValue({
        state: PanelConnectionState.PANEL_UNREACHABLE,
        success: false,
        message: "ECONNREFUSED",
      });

      await workflowService.handleConnectModalSubmit(interaction);

      expect(mockCredentialService.createConnection).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Panel is unreachable"),
        }),
      );
    });

    it("handles connection timeout (10s) with clear message", async () => {
      const interaction = createMockModalInteraction({
        name: "TimeoutPanel",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_key",
      });

      vi.mocked(mockConnectionService.verifyConnection).mockResolvedValue({
        state: PanelConnectionState.TIMEOUT,
        success: false,
        message: "Request timed out",
      });

      await workflowService.handleConnectModalSubmit(interaction);

      expect(mockCredentialService.createConnection).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Connection timed out"),
        }),
      );
    });

    it("handles invalid panel URL or SSRF block with specific error message", async () => {
      const interaction = createMockModalInteraction({
        name: "PrivateIp",
        panelUrl: "http://192.168.1.1",
        apiKey: "ptlc_key",
      });

      vi.mocked(mockConnectionService.verifyConnection).mockResolvedValue({
        state: PanelConnectionState.INVALID_PANEL_URL,
        success: false,
        message: "Access to private or internal network address is restricted.",
      });

      await workflowService.handleConnectModalSubmit(interaction);

      expect(mockCredentialService.createConnection).not.toHaveBeenCalled();
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Invalid panel URL"),
        }),
      );
    });

    it("handles duplicate connection names within the same guild", async () => {
      const interaction = createMockModalInteraction({
        name: "ExistingName",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_key",
      });

      vi.mocked(mockConnectionService.verifyConnection).mockResolvedValue({
        state: PanelConnectionState.CONNECTED,
        success: true,
        message: "Connected",
      });

      vi.mocked(mockCredentialService.createConnection).mockRejectedValue(
        new DuplicateConnectionNameError("ExistingName", "guild_123"),
      );

      await workflowService.handleConnectModalSubmit(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining('named "ExistingName" already exists in this server'),
        }),
      );
    });

    it("prevents duplicate concurrent connection submissions using in-flight lock", async () => {
      const interaction1 = createMockModalInteraction({
        name: "ConcurrentTest",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_key",
      });

      const interaction2 = createMockModalInteraction({
        name: "ConcurrentTest",
        panelUrl: "https://panel.example.com",
        apiKey: "ptlc_key",
      });

      let resolveVerify: (val: PanelConnectionResult) => void;
      const verifyPromise = new Promise<PanelConnectionResult>((res) => {
        resolveVerify = res;
      });

      vi.mocked(mockConnectionService.verifyConnection).mockReturnValue(verifyPromise);

      // Start first connection attempt
      const promise1 = workflowService.handleConnectModalSubmit(interaction1);

      // Attempt second connection with identical name concurrently
      await workflowService.handleConnectModalSubmit(interaction2);

      expect(interaction2.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining(
            'connection attempt for "ConcurrentTest" is already in progress',
          ),
        }),
      );

      // Resolve first attempt
      resolveVerify!({
        state: PanelConnectionState.CONNECTED,
        success: true,
        message: "Connected",
      });

      vi.mocked(mockCredentialService.createConnection).mockResolvedValue({
        id: "conn_1",
        guildId: "guild_123",
        name: "ConcurrentTest",
        panelUrl: "https://panel.example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await promise1;
      expect(interaction1.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: expect.any(Array),
        }),
      );
    });

    it("ensures API key never appears in logged outputs or Discord responses", async () => {
      const secretKey = "ptlc_SUPER_SECRET_TOKEN_DO_NOT_LEAK";
      const interaction = createMockModalInteraction({
        name: "SecretPanel",
        panelUrl: "https://panel.example.com",
        apiKey: secretKey,
      });

      const loggerSpy = vi.spyOn(logger, "info");

      vi.mocked(mockConnectionService.verifyConnection).mockResolvedValue({
        state: PanelConnectionState.CONNECTED,
        success: true,
        message: "Connected",
      });

      vi.mocked(mockCredentialService.createConnection).mockResolvedValue({
        id: "conn_secret",
        guildId: "guild_123",
        name: "SecretPanel",
        panelUrl: "https://panel.example.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await workflowService.handleConnectModalSubmit(interaction);

      // Verify Discord response does NOT contain the secret
      const editReplyCall = (interaction.editReply as unknown as { mock: { calls: unknown[][] } })
        .mock.calls[0]![0];
      const stringifiedReply = JSON.stringify(editReplyCall);
      expect(stringifiedReply).not.toContain(secretKey);

      // Verify logs do NOT contain the secret
      for (const call of loggerSpy.mock.calls) {
        expect(JSON.stringify(call)).not.toContain(secretKey);
      }
    });
  });

  describe("Multi-Panel Listing (/panel list)", () => {
    it("returns info message when no panels are connected", async () => {
      const interaction = createMockChatInputInteraction({ subcommand: "list" });
      vi.mocked(mockCredentialService.listConnections).mockResolvedValue([]);

      await workflowService.handleCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("No Pterodactyl panels are currently connected"),
        }),
      );
    });

    it("displays all panels connected to the current guild with metadata", async () => {
      const interaction = createMockChatInputInteraction({
        guildId: "guild_target",
        subcommand: "list",
      });

      vi.mocked(mockCredentialService.listConnections).mockResolvedValue([
        {
          id: "p1",
          guildId: "guild_target",
          name: "EU-Gaming",
          panelUrl: "https://eu.panel.com",
          createdAt: new Date("2026-01-01T00:00:00Z"),
          updatedAt: new Date("2026-01-01T00:00:00Z"),
        },
        {
          id: "p2",
          guildId: "guild_target",
          name: "US-Testing",
          panelUrl: "https://us.panel.com",
          createdAt: new Date("2026-02-01T00:00:00Z"),
          updatedAt: new Date("2026-02-01T00:00:00Z"),
        },
      ]);

      await workflowService.handleCommand(interaction);

      expect(mockCredentialService.listConnections).toHaveBeenCalledWith("guild_target");
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "Connected Pterodactyl Panels (2)",
                fields: expect.arrayContaining([
                  expect.objectContaining({ name: "🖥️ EU-Gaming" }),
                  expect.objectContaining({ name: "🖥️ US-Testing" }),
                ]),
              }),
            }),
          ],
        }),
      );
    });
  });

  describe("Panel Status Live Verification (/panel status)", () => {
    it("verifies and displays online status for selected panel", async () => {
      const interaction = createMockChatInputInteraction({
        subcommand: "status",
        subcommandOptions: { name: "Prod-Panel" },
      });

      vi.mocked(mockCredentialService.listConnections).mockResolvedValue([
        {
          id: "conn_prod",
          guildId: "guild_123",
          name: "Prod-Panel",
          panelUrl: "https://prod.panel.com",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.mocked(mockCredentialService.verifyStoredConnection).mockResolvedValue({
        state: PanelConnectionState.CONNECTED,
        success: true,
        message: "OK",
        account: {
          id: 1,
          username: "sysadmin",
          email: "ops@panel.com",
          firstName: "Sys",
          lastName: "Admin",
          language: "en",
        },
      });

      await workflowService.handleCommand(interaction);

      expect(mockCredentialService.verifyStoredConnection).toHaveBeenCalledWith(
        "guild_123",
        "conn_prod",
        { timeoutMs: 10000 },
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "🟢 Panel Status: Prod-Panel",
              }),
            }),
          ],
        }),
      );
    });

    it("displays error details when live status verification fails", async () => {
      const interaction = createMockChatInputInteraction({
        subcommand: "status",
        subcommandOptions: { name: "Stale-Panel" },
      });

      vi.mocked(mockCredentialService.listConnections).mockResolvedValue([
        {
          id: "conn_stale",
          guildId: "guild_123",
          name: "Stale-Panel",
          panelUrl: "https://stale.panel.com",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      vi.mocked(mockCredentialService.verifyStoredConnection).mockResolvedValue({
        state: PanelConnectionState.INVALID_CREDENTIALS,
        success: false,
        message: "API key was revoked",
      });

      await workflowService.handleCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "🔴 Panel Status: Stale-Panel",
              }),
            }),
          ],
        }),
      );
    });
  });

  describe("Panel Settings (/panel settings)", () => {
    it("displays configuration metadata for requested panel", async () => {
      const interaction = createMockChatInputInteraction({
        subcommand: "settings",
        subcommandOptions: { name: "SettingsTest" },
      });

      vi.mocked(mockCredentialService.listConnections).mockResolvedValue([
        {
          id: "conn_settings_1",
          guildId: "guild_123",
          name: "SettingsTest",
          panelUrl: "https://settings.panel.com",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await workflowService.handleCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "⚙️ Panel Settings: SettingsTest",
                fields: expect.arrayContaining([
                  expect.objectContaining({ name: "Connection Name", value: "SettingsTest" }),
                  expect.objectContaining({
                    name: "Encryption",
                    value: "AES-256-GCM (Authenticated)",
                  }),
                ]),
              }),
            }),
          ],
        }),
      );
    });
  });

  describe("Panel Disconnection Workflow (/panel disconnect & Buttons)", () => {
    it("presents confirmation dialog with Confirm and Cancel buttons", async () => {
      const interaction = createMockChatInputInteraction({
        subcommand: "disconnect",
        subcommandOptions: { name: "PanelToDelete" },
      });

      vi.mocked(mockCredentialService.listConnections).mockResolvedValue([
        {
          id: "conn_to_delete",
          guildId: "guild_123",
          name: "PanelToDelete",
          panelUrl: "https://delete.panel.com",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await workflowService.handleCommand(interaction);

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "⚠️ Confirm Panel Disconnection",
              }),
            }),
          ],
          components: expect.arrayContaining([expect.anything()]),
        }),
      );
    });

    it("cancels disconnection when user clicks Cancel button", async () => {
      const interaction = createMockButtonInteraction({
        customId: "panel_disconnect_cancel:conn_123",
      });

      await workflowService.handleDisconnectButton(interaction, {
        action: "cancel",
        connectionId: "conn_123",
      });

      expect(mockCredentialService.deleteConnection).not.toHaveBeenCalled();
      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "Disconnection Cancelled",
              }),
            }),
          ],
          components: [],
        }),
      );
    });

    it("confirms and deletes connection and writes audit log on Confirm button", async () => {
      const interaction = createMockButtonInteraction({
        customId: "panel_disconnect_confirm:conn_123",
      });

      vi.mocked(mockCredentialService.getConnection).mockResolvedValue({
        id: "conn_123",
        guildId: "guild_123",
        name: "DeadPanel",
        panelUrl: "https://dead.panel.com",
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const loggerSpy = vi.spyOn(logger, "info");

      await workflowService.handleDisconnectButton(interaction, {
        action: "confirm",
        connectionId: "conn_123",
      });

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(mockCredentialService.deleteConnection).toHaveBeenCalledWith("guild_123", "conn_123");
      expect(loggerSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          guildId: "guild_123",
          connectionId: "conn_123",
          panelName: "DeadPanel",
        }),
        expect.stringContaining("deleted by user"),
      );

      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          embeds: [
            expect.objectContaining({
              data: expect.objectContaining({
                title: "✅ Panel Disconnected",
              }),
            }),
          ],
          components: [],
        }),
      );
    });

    it("handles already disconnected panel gracefully", async () => {
      const interaction = createMockButtonInteraction({
        customId: "panel_disconnect_confirm:conn_missing",
      });

      vi.mocked(mockCredentialService.deleteConnection).mockRejectedValue(
        new PanelConnectionNotFoundError("conn_missing", "guild_123"),
      );

      await workflowService.handleDisconnectButton(interaction, {
        action: "confirm",
        connectionId: "conn_missing",
      });

      expect(interaction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(interaction.editReply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("no longer exists or has already been disconnected"),
          components: [],
        }),
      );
    });
  });

  describe("Autocomplete Support", () => {
    it("suggests matching panel names based on focused input", async () => {
      const respondFn = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        guildId: "guild_123",
        options: {
          getFocused: vi.fn().mockReturnValue({ name: "name", value: "pro" }),
        },
        respond: respondFn,
      } as unknown as AutocompleteInteraction;

      vi.mocked(mockCredentialService.listConnections).mockResolvedValue([
        {
          id: "p1",
          guildId: "guild_123",
          name: "Production-US",
          panelUrl: "https://us.panel.com",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: "p2",
          guildId: "guild_123",
          name: "Staging-EU",
          panelUrl: "https://eu.panel.com",
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ]);

      await workflowService.handleAutocomplete(interaction);

      expect(respondFn).toHaveBeenCalledWith([
        {
          name: "Production-US (https://us.panel.com)",
          value: "Production-US",
        },
      ]);
    });

    it("handles autocomplete outside of guild context by responding with empty list", async () => {
      const respondFn = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        guildId: null,
        respond: respondFn,
      } as unknown as AutocompleteInteraction;

      await workflowService.handleAutocomplete(interaction);
      expect(respondFn).toHaveBeenCalledWith([]);
    });

    it("handles database errors during autocomplete without throwing", async () => {
      const respondFn = vi.fn().mockResolvedValue(undefined);
      const interaction = {
        guildId: "guild_123",
        options: {
          getFocused: vi.fn().mockReturnValue({ name: "name", value: "test" }),
        },
        respond: respondFn,
      } as unknown as AutocompleteInteraction;

      vi.mocked(mockCredentialService.listConnections).mockRejectedValue(
        new Error("Database disconnected"),
      );

      await expect(workflowService.handleAutocomplete(interaction)).resolves.not.toThrow();
      expect(respondFn).toHaveBeenCalledWith([]);
    });
  });

  describe("Subcommand Routing Guard", () => {
    it("safely handles interaction with missing subcommand", async () => {
      const interaction = createMockChatInputInteraction({ subcommand: "" });
      interaction.options.getSubcommand = vi.fn().mockReturnValue(null);

      await workflowService.handleCommand(interaction);
      expect(interaction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: expect.stringContaining("Please specify a valid subcommand"),
          ephemeral: true,
        }),
      );
    });
  });

  describe("Interaction Dispatcher Registration & End-to-End Routing", () => {
    it("registers and routes modal and button interactions through dispatcher", async () => {
      const dispatcher = new InteractionDispatcher();
      registerPanelInteractions(dispatcher, workflowService);

      const modalSubmitSpy = vi
        .spyOn(workflowService, "handleConnectModalSubmit")
        .mockResolvedValue(undefined);

      const modalInteraction = createMockModalInteraction({
        name: "Test",
        panelUrl: "https://panel.com",
        apiKey: "ptlc_key",
      });

      await dispatcher.dispatch(modalInteraction);
      expect(modalSubmitSpy).toHaveBeenCalledWith(modalInteraction);

      const buttonSpy = vi
        .spyOn(workflowService, "handleDisconnectButton")
        .mockResolvedValue(undefined);

      const buttonInteraction = createMockButtonInteraction({
        customId: "panel_disconnect_confirm:conn_456",
      });

      await dispatcher.dispatch(buttonInteraction);
      expect(buttonSpy).toHaveBeenCalledWith(buttonInteraction, {
        action: "confirm",
        connectionId: "conn_456",
      });
    });
  });
});

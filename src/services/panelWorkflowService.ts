import {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  EmbedBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type ModalSubmitInteraction,
  type ButtonInteraction,
  type AutocompleteInteraction,
} from "discord.js";
import { z } from "zod";
import { PanelCredentialService } from "./pterodactyl/panelCredentialService.js";
import { PanelConnectionService } from "./pterodactyl/connectionService.js";
import {
  PanelConnectionState,
  type PanelConnectionResult,
} from "./pterodactyl/types/connection.js";
import {
  DuplicateConnectionNameError,
  PanelConnectionNotFoundError,
  PterodactylUrlError,
  PterodactylAuthError,
} from "./pterodactyl/errors/index.js";
import {
  safeReply,
  safeDefer,
  safeDeferUpdate,
  safeUpdate,
  createErrorPayload,
  createInfoPayload,
} from "../interactions/responses.js";
import { interactionDispatcher, type InteractionDispatcher } from "../interactions/dispatcher.js";
import { logger } from "../utils/logger.js";

export const connectModalSchema = z.object({
  name: z
    .string({ required_error: "Connection name is required." })
    .trim()
    .min(1, "Connection name cannot be empty.")
    .max(64, "Connection name must be at most 64 characters.")
    .regex(
      /^[a-zA-Z0-9_\-\s]+$/,
      "Connection name can only contain letters, numbers, hyphens, underscores, and spaces.",
    ),
  panelUrl: z
    .string({ required_error: "Panel URL is required." })
    .trim()
    .min(1, "Panel URL cannot be empty."),
  apiKey: z
    .string({ required_error: "API key is required." })
    .trim()
    .min(1, "API key cannot be empty."),
});

export interface PanelWorkflowServiceOptions {
  credentialService?: PanelCredentialService;
  connectionService?: PanelConnectionService;
}

/**
 * Service managing the Discord-facing Pterodactyl panel connection workflow,
 * handling modals, multi-panel listing, status checks, settings, and disconnection.
 */
export class PanelWorkflowService {
  private readonly credentialService: PanelCredentialService;
  private readonly connectionService: PanelConnectionService;
  private readonly inFlightConnections = new Set<string>();

  constructor(options?: PanelWorkflowServiceOptions) {
    this.credentialService = options?.credentialService ?? new PanelCredentialService();
    this.connectionService = options?.connectionService ?? new PanelConnectionService();
  }

  private getLockKey(guildId: string, name: string): string {
    return `${guildId}:${name.trim().toLowerCase()}`;
  }

  private acquireLock(guildId: string, name: string): boolean {
    const key = this.getLockKey(guildId, name);
    if (this.inFlightConnections.has(key)) {
      return false;
    }
    this.inFlightConnections.add(key);
    return true;
  }

  private releaseLock(guildId: string, name: string): void {
    const key = this.getLockKey(guildId, name);
    this.inFlightConnections.delete(key);
  }

  public async validateGuildAndPermissions(
    interaction: ChatInputCommandInteraction | ModalSubmitInteraction | ButtonInteraction,
    requireManageGuild = true,
  ): Promise<{ valid: true; guildId: string } | { valid: false }> {
    if (!interaction.guildId) {
      await safeReply(
        interaction,
        createErrorPayload("❌ This command can only be used within a Discord server.", true),
      );
      return { valid: false };
    }

    if (requireManageGuild) {
      const hasPermission = interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild);
      if (!hasPermission) {
        await safeReply(
          interaction,
          createErrorPayload(
            "❌ You need the 'Manage Server' permission to manage panel connections.",
            true,
          ),
        );
        return { valid: false };
      }
    }

    return { valid: true, guildId: interaction.guildId };
  }

  public buildConnectModal(): ModalBuilder {
    const modal = new ModalBuilder()
      .setCustomId("panel_connect_modal")
      .setTitle("Connect Pterodactyl Panel");

    const nameInput = new TextInputBuilder()
      .setCustomId("connection_name")
      .setLabel("Connection Name")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("e.g. Production, US-Node-1")
      .setMinLength(1)
      .setMaxLength(64)
      .setRequired(true);

    const urlInput = new TextInputBuilder()
      .setCustomId("panel_url")
      .setLabel("Panel URL")
      .setStyle(TextInputStyle.Short)
      .setPlaceholder("https://panel.example.com")
      .setRequired(true);

    const apiKeyInput = new TextInputBuilder()
      .setCustomId("api_key")
      .setLabel("Pterodactyl Client API Key")
      .setStyle(TextInputStyle.Paragraph)
      .setPlaceholder("ptlc_...")
      .setRequired(true);

    modal.addComponents(
      new ActionRowBuilder<TextInputBuilder>().addComponents(nameInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(urlInput),
      new ActionRowBuilder<TextInputBuilder>().addComponents(apiKeyInput),
    );

    return modal;
  }

  public async handleConnectCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const check = await this.validateGuildAndPermissions(interaction, true);
    if (!check.valid) return;

    const modal = this.buildConnectModal();
    await interaction.showModal(modal);
  }

  public async handleConnectModalSubmit(interaction: ModalSubmitInteraction): Promise<void> {
    await safeDefer(interaction, { ephemeral: true });

    const check = await this.validateGuildAndPermissions(interaction, true);
    if (!check.valid) return;

    const rawName = interaction.fields.getTextInputValue("connection_name")?.trim();
    const rawUrl = interaction.fields.getTextInputValue("panel_url")?.trim();
    const rawApiKey = interaction.fields.getTextInputValue("api_key")?.trim();

    const parseResult = connectModalSchema.safeParse({
      name: rawName,
      panelUrl: rawUrl,
      apiKey: rawApiKey,
    });

    if (!parseResult.success) {
      const errorMsg = parseResult.error.errors[0]?.message ?? "Invalid form input.";
      await safeReply(interaction, createErrorPayload(`❌ ${errorMsg}`, true));
      return;
    }

    const { name, panelUrl, apiKey } = parseResult.data;

    if (!this.acquireLock(check.guildId, name)) {
      await safeReply(
        interaction,
        createErrorPayload(
          `⚠️ A connection attempt for "${name}" is already in progress. Please wait for it to complete.`,
          true,
        ),
      );
      return;
    }

    try {
      // Test connectivity and credentials with Pterodactyl panel
      const verification = await this.connectionService.verifyConnection({
        panelUrl,
        apiKey,
        timeoutMs: 10000,
      });

      if (!verification.success) {
        const userMessage = this.mapConnectionStateToMessage(
          verification.state,
          verification.message,
        );
        await safeReply(interaction, createErrorPayload(userMessage, true));
        return;
      }

      // Persist encrypted connection
      const connection = await this.credentialService.createConnection({
        guildId: check.guildId,
        name,
        panelUrl,
        apiKey,
        verifyBeforeSaving: false,
      });

      logger.info(
        { guildId: check.guildId, connectionId: connection.id, name: connection.name },
        "Successfully created new encrypted Pterodactyl panel connection",
      );

      const embed = new EmbedBuilder()
        .setColor(0x57f287)
        .setTitle("✅ Pterodactyl Panel Connected")
        .setDescription(`Successfully connected panel **${connection.name}**!`)
        .addFields(
          { name: "Connection Name", value: connection.name, inline: true },
          { name: "Panel URL", value: connection.panelUrl, inline: true },
          {
            name: "Connected Account",
            value: verification.account
              ? `${verification.account.username} (${verification.account.email})`
              : "Verified",
            inline: false,
          },
        )
        .setFooter({
          text: "Zero Plaintext Storage • API Key encrypted with AES-256-GCM",
        })
        .setTimestamp();

      await safeReply(interaction, { embeds: [embed], ephemeral: true });
    } catch (error) {
      if (error instanceof DuplicateConnectionNameError) {
        await safeReply(
          interaction,
          createErrorPayload(
            `❌ A panel connection named "${name}" already exists in this server. Please choose a different name.`,
            true,
          ),
        );
        return;
      }

      if (error instanceof PterodactylUrlError) {
        await safeReply(
          interaction,
          createErrorPayload(`❌ Invalid panel URL: ${error.message}`, true),
        );
        return;
      }

      if (error instanceof PterodactylAuthError) {
        await safeReply(
          interaction,
          createErrorPayload(`❌ Authentication failed: ${error.message}`, true),
        );
        return;
      }

      logger.error(
        { error, guildId: check.guildId, connectionName: name },
        "Error occurred during panel connection workflow",
      );

      await safeReply(
        interaction,
        createErrorPayload(
          "❌ An unexpected error occurred while saving the panel connection. Please try again later.",
          true,
        ),
      );
    } finally {
      this.releaseLock(check.guildId, name);
    }
  }

  public async handleListCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await safeDefer(interaction, { ephemeral: true });

    const check = await this.validateGuildAndPermissions(interaction, false);
    if (!check.valid) return;

    try {
      const connections = await this.credentialService.listConnections(check.guildId);
      if (connections.length === 0) {
        await safeReply(
          interaction,
          createInfoPayload(
            "No Pterodactyl panels are currently connected to this server.\n\nUse `/panel connect` to connect your panel.",
            true,
          ),
        );
        return;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`Connected Pterodactyl Panels (${connections.length})`)
        .setDescription("List of Pterodactyl panels connected to this server.")
        .setTimestamp();

      for (const conn of connections.slice(0, 25)) {
        embed.addFields({
          name: `🖥️ ${conn.name}`,
          value: `• **URL:** ${conn.panelUrl}\n• **Connected:** <t:${Math.floor(conn.createdAt.getTime() / 1000)}:R>\n• **Linked Servers:** 0 (mapping not linked)`,
          inline: false,
        });
      }

      embed.setFooter({ text: "Use /panel status [name] to check live connectivity" });

      await safeReply(interaction, { embeds: [embed], ephemeral: true });
    } catch (error) {
      logger.error({ error, guildId: check.guildId }, "Failed to list panel connections");
      await safeReply(
        interaction,
        createErrorPayload(
          "❌ Unable to retrieve panel connections due to a database error. Please try again later.",
          true,
        ),
      );
    }
  }

  public async handleStatusCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await safeDefer(interaction, { ephemeral: true });

    const check = await this.validateGuildAndPermissions(interaction, false);
    if (!check.valid) return;

    try {
      const connections = await this.credentialService.listConnections(check.guildId);
      if (connections.length === 0) {
        await safeReply(
          interaction,
          createInfoPayload(
            "No Pterodactyl panels are currently connected to this server.\n\nUse `/panel connect` to connect your panel.",
            true,
          ),
        );
        return;
      }

      const requestedName = interaction.options.getString("name")?.trim();
      let target = connections[0]!;

      if (requestedName) {
        const found = connections.find((c) => c.name.toLowerCase() === requestedName.toLowerCase());
        if (!found) {
          await safeReply(
            interaction,
            createErrorPayload(
              `❌ No connected panel found with name "${requestedName}". Use \`/panel list\` to view available panels.`,
              true,
            ),
          );
          return;
        }
        target = found;
      }

      // Live verification of stored credentials
      const result: PanelConnectionResult = await this.credentialService.verifyStoredConnection(
        check.guildId,
        target.id,
        { timeoutMs: 10000 },
      );

      const embed = new EmbedBuilder().setTimestamp();

      if (result.success) {
        embed
          .setColor(0x57f287)
          .setTitle(`🟢 Panel Status: ${target.name}`)
          .addFields(
            { name: "Status", value: "Online & Authenticated", inline: true },
            { name: "Panel URL", value: target.panelUrl, inline: true },
            {
              name: "Authenticated Account",
              value: result.account
                ? `${result.account.username} (${result.account.email})`
                : "Verified",
              inline: false,
            },
          )
          .setFooter({ text: "Live verification succeeded" });
      } else {
        embed
          .setColor(0xed4245)
          .setTitle(`🔴 Panel Status: ${target.name}`)
          .addFields(
            { name: "Status", value: result.state, inline: true },
            { name: "Panel URL", value: target.panelUrl, inline: true },
            {
              name: "Details",
              value: this.mapConnectionStateToMessage(result.state, result.message),
              inline: false,
            },
          )
          .setFooter({ text: "Live verification failed" });
      }

      await safeReply(interaction, { embeds: [embed], ephemeral: true });
    } catch (error) {
      logger.error({ error, guildId: check.guildId }, "Error checking panel status");
      await safeReply(
        interaction,
        createErrorPayload(
          "❌ An error occurred while testing panel status. Please try again later.",
          true,
        ),
      );
    }
  }

  public async handleSettingsCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await safeDefer(interaction, { ephemeral: true });

    const check = await this.validateGuildAndPermissions(interaction, true);
    if (!check.valid) return;

    try {
      const connections = await this.credentialService.listConnections(check.guildId);
      if (connections.length === 0) {
        await safeReply(
          interaction,
          createInfoPayload(
            "No Pterodactyl panels are currently connected to this server.\n\nUse `/panel connect` to connect your panel.",
            true,
          ),
        );
        return;
      }

      const requestedName = interaction.options.getString("name")?.trim();
      let target = connections[0]!;

      if (requestedName) {
        const found = connections.find((c) => c.name.toLowerCase() === requestedName.toLowerCase());
        if (!found) {
          await safeReply(
            interaction,
            createErrorPayload(`❌ No connected panel found with name "${requestedName}".`, true),
          );
          return;
        }
        target = found;
      }

      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle(`⚙️ Panel Settings: ${target.name}`)
        .addFields(
          { name: "Connection Name", value: target.name, inline: true },
          { name: "Connection ID", value: `\`${target.id}\``, inline: true },
          { name: "Encryption", value: "AES-256-GCM (Authenticated)", inline: true },
          { name: "Panel URL", value: target.panelUrl, inline: false },
          { name: "SSRF Protection", value: "Enforced (Private networks blocked)", inline: true },
          {
            name: "Created",
            value: `<t:${Math.floor(target.createdAt.getTime() / 1000)}:R>`,
            inline: true,
          },
          {
            name: "Last Updated",
            value: `<t:${Math.floor(target.updatedAt.getTime() / 1000)}:R>`,
            inline: true,
          },
        )
        .setFooter({
          text: "Zero Plaintext Storage • Credentials isolated per guild",
        })
        .setTimestamp();

      await safeReply(interaction, { embeds: [embed], ephemeral: true });
    } catch (error) {
      logger.error({ error, guildId: check.guildId }, "Failed to get panel settings");
      await safeReply(
        interaction,
        createErrorPayload(
          "❌ Unable to retrieve panel settings due to a database error. Please try again later.",
          true,
        ),
      );
    }
  }

  public async handleDisconnectCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await safeDefer(interaction, { ephemeral: true });

    const check = await this.validateGuildAndPermissions(interaction, true);
    if (!check.valid) return;

    try {
      const connections = await this.credentialService.listConnections(check.guildId);
      if (connections.length === 0) {
        await safeReply(
          interaction,
          createInfoPayload("No Pterodactyl panels are currently connected to this server.", true),
        );
        return;
      }

      const requestedName = interaction.options.getString("name")?.trim();
      let target = connections[0]!;

      if (requestedName) {
        const found = connections.find((c) => c.name.toLowerCase() === requestedName.toLowerCase());
        if (!found) {
          await safeReply(
            interaction,
            createErrorPayload(`❌ No connected panel found with name "${requestedName}".`, true),
          );
          return;
        }
        target = found;
      }

      const embed = new EmbedBuilder()
        .setColor(0xfee75c)
        .setTitle("⚠️ Confirm Panel Disconnection")
        .setDescription(
          `Are you sure you want to disconnect panel **${target.name}**?\n\n` +
            `• **Panel URL:** ${target.panelUrl}\n` +
            `• **Connection ID:** \`${target.id}\`\n\n` +
            `*This will permanently delete the encrypted credentials for this panel. You will need to re-enter your API key to reconnect.*`,
        )
        .setFooter({ text: "Please confirm or cancel this action" });

      const confirmBtn = new ButtonBuilder()
        .setCustomId(`panel_disconnect_confirm:${target.id}`)
        .setLabel("Disconnect Panel")
        .setStyle(ButtonStyle.Danger)
        .setEmoji("🗑️");

      const cancelBtn = new ButtonBuilder()
        .setCustomId(`panel_disconnect_cancel:${target.id}`)
        .setLabel("Cancel")
        .setStyle(ButtonStyle.Secondary)
        .setEmoji("✖️");

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(confirmBtn, cancelBtn);

      await safeReply(interaction, {
        embeds: [embed],
        components: [row],
        ephemeral: true,
      });
    } catch (error) {
      logger.error({ error, guildId: check.guildId }, "Error preparing panel disconnection");
      await safeReply(
        interaction,
        createErrorPayload(
          "❌ Unable to initiate disconnection due to a database error. Please try again later.",
          true,
        ),
      );
    }
  }

  public async handleDisconnectButton(
    interaction: ButtonInteraction,
    params: { action?: string; connectionId?: string },
  ): Promise<void> {
    const check = await this.validateGuildAndPermissions(interaction, true);
    if (!check.valid) return;

    await safeDeferUpdate(interaction);

    const { action, connectionId } = params;
    if (!action || !connectionId) {
      await safeUpdate(interaction, {
        ...createErrorPayload("Invalid button parameters.", true),
        components: [],
      });
      return;
    }

    if (action === "cancel") {
      const embed = new EmbedBuilder()
        .setColor(0x5865f2)
        .setTitle("Disconnection Cancelled")
        .setDescription("The panel remains connected and active.")
        .setTimestamp();

      await safeUpdate(interaction, { embeds: [embed], components: [] });
      return;
    }

    if (action === "confirm") {
      try {
        let panelName = "Unknown";
        try {
          const metadata = await this.credentialService.getConnection(check.guildId, connectionId);
          panelName = metadata.name;
        } catch {
          // Metadata fetch failed or connection already deleted
        }

        await this.credentialService.deleteConnection(check.guildId, connectionId);

        logger.info(
          {
            guildId: check.guildId,
            connectionId,
            userId: interaction.user.id,
            panelName,
          },
          "Panel connection deleted by user",
        );

        const embed = new EmbedBuilder()
          .setColor(0x57f287)
          .setTitle("✅ Panel Disconnected")
          .setDescription(
            `Successfully disconnected panel **${panelName}** and removed stored credentials.`,
          )
          .setTimestamp();

        await safeUpdate(interaction, { embeds: [embed], components: [] });
      } catch (error) {
        if (error instanceof PanelConnectionNotFoundError) {
          await safeUpdate(interaction, {
            ...createErrorPayload(
              "⚠️ This panel connection no longer exists or has already been disconnected.",
              true,
            ),
            components: [],
          });
          return;
        }

        logger.error(
          { error, guildId: check.guildId, connectionId },
          "Failed to delete panel connection",
        );

        await safeUpdate(interaction, {
          ...createErrorPayload("❌ Failed to disconnect panel. Please try again later.", true),
          components: [],
        });
      }
    }
  }

  public async handleAutocomplete(interaction: AutocompleteInteraction): Promise<void> {
    if (!interaction.guildId) {
      try {
        if (!interaction.responded) await interaction.respond([]);
      } catch {
        // Token expired or cancelled
      }
      return;
    }

    const focused = interaction.options.getFocused(true);
    if (focused.name === "name") {
      try {
        const connections = await this.credentialService.listConnections(interaction.guildId);
        const query = focused.value.toLowerCase();
        const filtered = connections
          .filter((c) => c.name.toLowerCase().includes(query))
          .slice(0, 25)
          .map((c) => ({
            name: `${c.name} (${c.panelUrl})`.slice(0, 100),
            value: c.name,
          }));
        if (!interaction.responded) {
          await interaction.respond(filtered);
        }
      } catch (err) {
        logger.debug({ err }, "Autocomplete failed or expired");
        if (!interaction.responded) {
          try {
            await interaction.respond([]);
          } catch {
            // Expired autocomplete token
          }
        }
      }
    }
  }

  public async handleCommand(interaction: ChatInputCommandInteraction): Promise<void> {
    const subcommand = interaction.options.getSubcommand(false);

    if (!subcommand) {
      await safeReply(
        interaction,
        createErrorPayload(
          "Please specify a valid subcommand (connect, list, status, settings, disconnect).",
          true,
        ),
      );
      return;
    }

    switch (subcommand) {
      case "connect":
        await this.handleConnectCommand(interaction);
        break;
      case "list":
        await this.handleListCommand(interaction);
        break;
      case "status":
        await this.handleStatusCommand(interaction);
        break;
      case "settings":
        await this.handleSettingsCommand(interaction);
        break;
      case "disconnect":
        await this.handleDisconnectCommand(interaction);
        break;
      default:
        await safeReply(
          interaction,
          createErrorPayload(`Unknown panel subcommand "${subcommand}".`, true),
        );
        break;
    }
  }

  private mapConnectionStateToMessage(state: PanelConnectionState, details?: string): string {
    switch (state) {
      case PanelConnectionState.INVALID_CREDENTIALS:
        return "❌ Invalid API key. Please generate a valid Client API key from your Pterodactyl account settings.";
      case PanelConnectionState.INSUFFICIENT_PERMISSIONS:
        return "❌ Insufficient API permissions. The provided API key does not have access to view account details or servers.";
      case PanelConnectionState.PANEL_UNREACHABLE:
        return `❌ Panel is unreachable. Could not connect to the panel. Please verify the URL and network connectivity.`;
      case PanelConnectionState.TIMEOUT:
        return "❌ Connection timed out. The Pterodactyl panel did not respond within 10 seconds.";
      case PanelConnectionState.INVALID_PANEL_URL:
        return `❌ Invalid panel URL: ${details ?? "Please verify the URL format and protocol (https://)."}`;
      case PanelConnectionState.API_ERROR:
        return `❌ Panel API error: ${details ?? "The panel returned an error response."}`;
      default:
        return `❌ Connection failed: ${details ?? "Unknown error."}`;
    }
  }
}

export const panelWorkflowService = new PanelWorkflowService();

/**
 * Registers modal and button handlers for the panel connection workflow.
 */
export function registerPanelInteractions(
  dispatcher: InteractionDispatcher = interactionDispatcher,
  workflowService: PanelWorkflowService = panelWorkflowService,
): void {
  dispatcher.registerModal({
    customId: "panel_connect_modal",
    execute: (interaction) => workflowService.handleConnectModalSubmit(interaction),
  });

  dispatcher.registerButton({
    customId: /^panel_disconnect_(?<action>confirm|cancel):(?<connectionId>[a-zA-Z0-9_-]+)$/,
    execute: (interaction, params) => workflowService.handleDisconnectButton(interaction, params),
  });
}

// Register on default dispatcher on module load
registerPanelInteractions();

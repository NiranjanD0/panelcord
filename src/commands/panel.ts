import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import type { Command } from "../types/command.js";
import { panelWorkflowService } from "../services/panelWorkflowService.js";

export const panelCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("panel")
    .setDescription("Manage Pterodactyl panel connections")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName("connect").setDescription("Connect a new Pterodactyl panel to this server"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("disconnect")
        .setDescription("Disconnect a Pterodactyl panel from this server")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Name of the panel connection to disconnect")
            .setRequired(false)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List all connected Pterodactyl panels for this server"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Check live connectivity and authentication status for a panel")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Name of the panel connection to check (default: first connected)")
            .setRequired(false)
            .setAutocomplete(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("settings")
        .setDescription("View configuration settings for a connected panel")
        .addStringOption((opt) =>
          opt
            .setName("name")
            .setDescription("Name of the panel connection")
            .setRequired(false)
            .setAutocomplete(true),
        ),
    ),
  category: "Pterodactyl",
  execute: async (interaction) => {
    await panelWorkflowService.handleCommand(interaction);
  },
  autocomplete: async (interaction) => {
    await panelWorkflowService.handleAutocomplete(interaction);
  },
};

export default panelCommand;

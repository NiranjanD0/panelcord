import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types/command.js";
import { BotInfoService } from "../../services/botInfoService.js";

export const aboutCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("about")
    .setDescription("Displays information, uptime, and system status of PanelCord"),
  category: "Utility",
  async execute(interaction) {
    const info = BotInfoService.getBotInfo(interaction.client);

    const embed = new EmbedBuilder()
      .setColor(0x00a8fc)
      .setTitle(`About ${info.name}`)
      .setDescription(info.description)
      .addFields(
        { name: "Version", value: `v${info.version}`, inline: true },
        { name: "Node.js", value: info.nodeVersion, inline: true },
        { name: "discord.js", value: `v${info.discordJsVersion}`, inline: true },
        { name: "Uptime", value: info.uptimeFormatted, inline: true },
        { name: "Servers", value: `${info.guildCount}`, inline: true },
        { name: "Memory Usage", value: `${info.memoryUsageMb} MB`, inline: true },
        { name: "Database", value: info.databaseStatus, inline: true },
      )
      .setFooter({ text: "PanelCord • Pterodactyl Discord Manager" })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });
  },
};

export default aboutCommand;

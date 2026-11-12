import { EmbedBuilder, SlashCommandBuilder } from "discord.js";
import type { Command } from "../../types/command.js";

export const pingCommand: Command = {
  data: new SlashCommandBuilder()
    .setName("ping")
    .setDescription("Replies with bot latency and Discord API heartbeat"),
  category: "Utility",
  async execute(interaction) {
    const sent = await interaction.deferReply({ fetchReply: true });
    const roundtripLatency = sent.createdTimestamp - interaction.createdTimestamp;
    const wsPing = interaction.client.ws.ping;

    const embed = new EmbedBuilder()
      .setColor(0x5865f2)
      .setTitle("🏓 Pong!")
      .addFields(
        { name: "Roundtrip Latency", value: `${roundtripLatency}ms`, inline: true },
        {
          name: "WebSocket Heartbeat",
          value: `${wsPing >= 0 ? `${wsPing}ms` : "Calculating..."}`,
          inline: true,
        },
      )
      .setTimestamp();

    await interaction.editReply({ embeds: [embed] });
  },
};

export default pingCommand;

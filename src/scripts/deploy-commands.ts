import { REST, Routes } from "discord.js";
import { env } from "../config/env.js";
import { commands } from "../commands/index.js";
import { logger } from "../utils/logger.js";

async function deploy(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
  const payload = commands.map((cmd) => cmd.data.toJSON());

  logger.info({ commandCount: payload.length }, "Started refreshing application (/) commands.");

  try {
    if (env.DISCORD_GUILD_ID) {
      logger.info(
        { guildId: env.DISCORD_GUILD_ID },
        "Deploying commands to specific development guild.",
      );
      await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), {
        body: payload,
      });
      logger.info("Successfully registered guild application commands.");
    } else {
      logger.info("Deploying commands globally.");
      await rest.put(Routes.applicationCommands(env.DISCORD_CLIENT_ID), { body: payload });
      logger.info("Successfully registered global application commands.");
    }
  } catch (error) {
    logger.error({ error }, "Failed to deploy application commands.");
    process.exit(1);
  }
}

deploy().catch((err) => {
  logger.error({ err }, "Fatal error during command deployment.");
  process.exit(1);
});

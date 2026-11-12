import { REST } from "discord.js";
import { env } from "../config/env.js";
import { commands } from "../commands/index.js";
import { deployCommands } from "../lib/commandRegistration.js";
import { logger } from "../utils/logger.js";

async function run(): Promise<void> {
  const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);

  await deployCommands({
    rest,
    clientId: env.DISCORD_CLIENT_ID,
    commands,
    guildId: env.DISCORD_GUILD_ID,
  });
}

run().catch((err) => {
  logger.error({ err }, "Fatal error during command deployment.");
  process.exit(1);
});

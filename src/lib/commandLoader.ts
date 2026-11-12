import type { ExtendedClient } from "./client.js";
import { commands } from "../commands/index.js";
import { logger } from "../utils/logger.js";

export function loadCommands(client: ExtendedClient): void {
  for (const command of commands) {
    if (!command.data?.name) {
      logger.warn("Skipping command without a valid name.");
      continue;
    }

    client.commands.set(command.data.name, command);
    logger.debug({ command: command.data.name }, "Loaded slash command");
  }

  logger.info({ count: client.commands.size }, "Successfully loaded slash commands.");
}

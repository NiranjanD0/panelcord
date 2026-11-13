import type { ExtendedClient } from "./client.js";
import { commands as defaultCommands } from "../commands/index.js";
import type { Command } from "../types/command.js";
import { validateCommand } from "./commandRegistration.js";
import { logger } from "../utils/logger.js";

export function loadCommands(
  client: ExtendedClient,
  commandList: Command[] = defaultCommands,
): void {
  for (const command of commandList) {
    try {
      validateCommand(command);
      client.commands.set(command.data.name, command);
      logger.debug({ command: command.data.name }, "Loaded slash command");
    } catch (error) {
      logger.warn(
        { error, commandName: command?.data?.name || "unnamed" },
        "Skipping invalid slash command during loading.",
      );
    }
  }

  logger.info({ count: client.commands.size }, "Successfully loaded slash commands.");
}

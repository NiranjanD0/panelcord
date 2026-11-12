import { REST, Routes } from "discord.js";
import { z } from "zod";
import type { Command } from "../types/command.js";
import { logger } from "../utils/logger.js";

// Discord Slash Command naming specification: 1-32 lowercase characters, numbers, dashes, underscores
export const DISCORD_COMMAND_NAME_REGEX =
  /^[-_\p{Ll}\p{Lm}\p{Lo}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

export const commandDataSchema = z.object({
  name: z
    .string()
    .min(1, "Command name must be at least 1 character.")
    .max(32, "Command name must be at most 32 characters.")
    .regex(
      DISCORD_COMMAND_NAME_REGEX,
      "Command name must match Discord specification (1-32 characters, no spaces).",
    ),
  description: z
    .string()
    .min(1, "Command description must be at least 1 character.")
    .max(100, "Command description must be at most 100 characters."),
});

export interface CommandDeployOptions {
  rest: REST;
  clientId: string;
  commands: Command[];
  guildId?: string;
}

export interface CommandDeployResult {
  success: boolean;
  commandCount: number;
  target: "guild" | "global";
  guildId?: string;
}

/**
 * Validates a single slash command against Discord application command constraints.
 */
export function validateCommand(command: Command): void {
  if (!command || !command.data) {
    throw new Error("Command is missing required 'data' property.");
  }

  if (typeof command.execute !== "function") {
    throw new Error(`Command "${command.data.name || "unnamed"}" is missing an execute function.`);
  }

  commandDataSchema.parse({
    name: command.data.name,
    description: command.data.description,
  });
}

/**
 * Validates a list of commands and ensures there are no duplicate names.
 */
export function validateCommands(commands: Command[]): void {
  const seenNames = new Set<string>();

  for (const command of commands) {
    validateCommand(command);

    const name = command.data.name.toLowerCase();
    if (seenNames.has(name)) {
      throw new Error(`Duplicate command name detected: "${name}".`);
    }
    seenNames.add(name);
  }
}

/**
 * Registers application slash commands globally or to a specific development guild.
 */
export async function deployCommands(options: CommandDeployOptions): Promise<CommandDeployResult> {
  const { rest, clientId, commands, guildId } = options;

  if (!clientId || clientId.trim().length === 0) {
    throw new Error("Cannot deploy commands: clientId is required.");
  }

  validateCommands(commands);

  const payload = commands.map((cmd) => cmd.data.toJSON());
  const target: "guild" | "global" = guildId && guildId.trim().length > 0 ? "guild" : "global";

  logger.info(
    { count: payload.length, target, guildId: target === "guild" ? guildId : undefined },
    "Deploying slash commands to Discord...",
  );

  if (target === "guild" && guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId.trim()), {
      body: payload,
    });
  } else {
    await rest.put(Routes.applicationCommands(clientId), {
      body: payload,
    });
  }

  logger.info(
    { count: payload.length, target, guildId: target === "guild" ? guildId : undefined },
    "Successfully registered slash commands.",
  );

  return {
    success: true,
    commandCount: payload.length,
    target,
    guildId: target === "guild" ? guildId : undefined,
  };
}

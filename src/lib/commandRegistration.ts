import { REST, Routes } from "discord.js";
import { z } from "zod";
import type { Command } from "../types/command.js";
import { logger } from "../utils/logger.js";

// Discord Slash Command naming specification: 1-32 lowercase characters, numbers, dashes, underscores
export const DISCORD_COMMAND_NAME_REGEX =
  /^[-_\p{Ll}\p{Lm}\p{Lo}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

// Discord Snowflake specification: 17-20 digit numeric string
export const DISCORD_SNOWFLAKE_REGEX = /^\d{17,20}$/;

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
  allowEmpty?: boolean;
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
  const { rest, clientId, commands, guildId, allowEmpty } = options;

  if (!clientId || clientId.trim().length === 0) {
    throw new Error("Cannot deploy commands: clientId is required.");
  }

  const cleanClientId = clientId.trim();
  if (!DISCORD_SNOWFLAKE_REGEX.test(cleanClientId)) {
    throw new Error(
      `Cannot deploy commands: clientId "${clientId}" is not a valid Discord Snowflake (must be a 17-20 digit numeric string).`,
    );
  }

  let cleanGuildId: string | undefined;
  if (guildId && guildId.trim().length > 0) {
    cleanGuildId = guildId.trim();
    if (!DISCORD_SNOWFLAKE_REGEX.test(cleanGuildId)) {
      throw new Error(
        `Cannot deploy commands: guildId "${guildId}" is not a valid Discord Snowflake (must be a 17-20 digit numeric string).`,
      );
    }
  }

  if (commands.length === 0 && !allowEmpty) {
    throw new Error(
      "Cannot deploy empty command list without explicit allowEmpty: true flag. This prevents accidentally deleting all registered application commands on Discord.",
    );
  }

  validateCommands(commands);

  const payload = commands.map((cmd) => cmd.data.toJSON());
  const target: "guild" | "global" = cleanGuildId ? "guild" : "global";

  logger.info(
    { count: payload.length, target, guildId: cleanGuildId },
    "Deploying slash commands to Discord...",
  );

  if (target === "guild" && cleanGuildId) {
    await rest.put(Routes.applicationGuildCommands(cleanClientId, cleanGuildId), {
      body: payload,
    });
  } else {
    await rest.put(Routes.applicationCommands(cleanClientId), {
      body: payload,
    });
  }

  logger.info(
    { count: payload.length, target, guildId: cleanGuildId },
    "Successfully registered slash commands.",
  );

  return {
    success: true,
    commandCount: payload.length,
    target,
    guildId: cleanGuildId,
  };
}

import { DiscordAPIError, type Interaction } from "discord.js";
import { DatabaseUnavailableError } from "../database/index.js";
import { logger } from "../utils/logger.js";
import {
  DISCORD_ERROR_UNKNOWN_INTERACTION,
  DISCORD_ERROR_MISSING_PERMISSIONS,
  createErrorPayload,
  safeReply,
  type RespondingInteraction,
} from "./responses.js";

export interface InteractionErrorContext {
  interactionId?: string;
  type?: number;
  commandName?: string;
  customId?: string;
  userId?: string;
  guildId?: string | null;
  channelId?: string | null;
}

/**
 * Extracts structured, sanitized context from an interaction for logging.
 */
export function extractInteractionContext(interaction: Interaction): InteractionErrorContext {
  const context: InteractionErrorContext = {
    interactionId: interaction.id,
    type: interaction.type,
    userId: interaction.user?.id,
    guildId: interaction.guildId,
    channelId: interaction.channelId,
  };

  if (interaction.isChatInputCommand?.() || interaction.isAutocomplete?.()) {
    context.commandName = (interaction as unknown as { commandName?: string }).commandName;
  }

  if (
    interaction.isButton?.() ||
    interaction.isAnySelectMenu?.() ||
    interaction.isModalSubmit?.()
  ) {
    context.customId = (interaction as unknown as { customId?: string }).customId;
  }

  return context;
}

/**
 * Formats a user-friendly error message based on the exception type.
 * Guarantees zero leakage of stack traces, database credentials, or internal details.
 */
export function getUserFriendlyErrorMessage(error: unknown): string {
  if (error instanceof DatabaseUnavailableError) {
    return "Database service is currently unavailable. Please try again later.";
  }

  if (error instanceof DiscordAPIError) {
    if (error.code === DISCORD_ERROR_MISSING_PERMISSIONS) {
      return "PanelCord does not have the required Discord permissions to perform this action.";
    }
  }

  return "An error occurred while executing this command. Please try again later.";
}

/**
 * Centralized error handler for all Discord interactions.
 * Logs structured error context and sends a safe, sanitized ephemeral notice to the user.
 */
export async function handleInteractionError(
  error: unknown,
  interaction: Interaction,
): Promise<void> {
  const context = extractInteractionContext(interaction);

  // If the interaction expired, attempting to respond will only fail with another 10062
  if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_UNKNOWN_INTERACTION) {
    logger.warn(context, "Interaction token expired or unknown; unable to respond.");
    return;
  }

  logger.error({ error, ...context }, "Interaction execution encountered an error");

  // Only attempt to respond if the interaction is repliable
  const responding = interaction as unknown as RespondingInteraction;
  if (typeof responding.reply === "function" || typeof responding.followUp === "function") {
    try {
      const friendlyMessage = getUserFriendlyErrorMessage(error);
      const payload = createErrorPayload(friendlyMessage, true);

      if (responding.replied || responding.deferred) {
        if (typeof responding.followUp === "function") {
          await responding.followUp(payload);
        } else if (typeof responding.editReply === "function") {
          await responding.editReply(payload);
        }
      } else {
        await safeReply(responding, payload);
      }
    } catch (replyError) {
      logger.warn({ error: replyError, ...context }, "Failed to send error response to user.");
    }
  }
}

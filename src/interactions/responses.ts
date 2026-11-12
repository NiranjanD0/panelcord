import {
  type InteractionReplyOptions,
  type InteractionUpdateOptions,
  type MessagePayload,
  type BaseInteraction,
  DiscordAPIError,
} from "discord.js";
import { logger } from "../utils/logger.js";

// Discord API Error Codes
export const DISCORD_ERROR_UNKNOWN_INTERACTION = 10062;
export const DISCORD_ERROR_INTERACTION_ALREADY_ACKNOWLEDGED = 40060;
export const DISCORD_ERROR_MISSING_PERMISSIONS = 50013;

export interface RespondingInteraction extends BaseInteraction {
  replied: boolean;
  deferred: boolean;
  reply(options: string | MessagePayload | InteractionReplyOptions): Promise<unknown>;
  editReply(options: string | MessagePayload | InteractionReplyOptions): Promise<unknown>;
  followUp(options: string | MessagePayload | InteractionReplyOptions): Promise<unknown>;
  update?(options: string | MessagePayload | InteractionUpdateOptions): Promise<unknown>;
  deferUpdate?(): Promise<unknown>;
  deferReply?(options?: { ephemeral?: boolean }): Promise<unknown>;
}

/**
 * Safely defers an interaction within Discord's 3-second acknowledgement window.
 * Avoids errors if the interaction is already acknowledged or expired.
 */
export async function safeDefer(
  interaction: RespondingInteraction,
  options?: { ephemeral?: boolean },
): Promise<boolean> {
  if (interaction.deferred || interaction.replied) {
    return true;
  }

  if (typeof interaction.deferReply !== "function") {
    return false;
  }

  try {
    await interaction.deferReply(options);
    return true;
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      if (error.code === DISCORD_ERROR_UNKNOWN_INTERACTION) {
        logger.debug(
          { interactionId: interaction.id },
          "Cannot defer interaction: token expired or unknown.",
        );
        return false;
      }
      if (error.code === DISCORD_ERROR_INTERACTION_ALREADY_ACKNOWLEDGED) {
        logger.debug(
          { interactionId: interaction.id },
          "Interaction was already deferred or acknowledged.",
        );
        return true;
      }
    }
    logger.warn({ error, interactionId: interaction.id }, "Failed to defer interaction");
    return false;
  }
}

/**
 * Safely defers a component update (e.g. button or select menu click) silently.
 */
export async function safeDeferUpdate(interaction: RespondingInteraction): Promise<boolean> {
  if (interaction.deferred || interaction.replied) {
    return true;
  }

  if (typeof interaction.deferUpdate !== "function") {
    return false;
  }

  try {
    await interaction.deferUpdate();
    return true;
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      if (error.code === DISCORD_ERROR_UNKNOWN_INTERACTION) {
        return false;
      }
      if (error.code === DISCORD_ERROR_INTERACTION_ALREADY_ACKNOWLEDGED) {
        return true;
      }
    }
    logger.warn({ error, interactionId: interaction.id }, "Failed to defer component update");
    return false;
  }
}

/**
 * Safely replies to an interaction, automatically selecting `reply`, `editReply`, or `followUp`
 * based on current interaction state without throwing duplicate acknowledgement errors.
 */
export async function safeReply(
  interaction: RespondingInteraction,
  options: string | InteractionReplyOptions,
): Promise<unknown> {
  try {
    if (interaction.replied) {
      if (typeof interaction.followUp === "function") {
        return await interaction.followUp(options);
      }
      return null;
    }

    if (interaction.deferred) {
      if (typeof interaction.editReply === "function") {
        return await interaction.editReply(options);
      }
      if (typeof interaction.followUp === "function") {
        return await interaction.followUp(options);
      }
      return null;
    }

    if (typeof interaction.reply === "function") {
      return await interaction.reply(options);
    }

    return null;
  } catch (error) {
    if (error instanceof DiscordAPIError) {
      if (error.code === DISCORD_ERROR_UNKNOWN_INTERACTION) {
        logger.warn(
          { interactionId: interaction.id },
          "Cannot send response: interaction token expired.",
        );
        return null;
      }

      if (error.code === DISCORD_ERROR_INTERACTION_ALREADY_ACKNOWLEDGED) {
        // Race condition: acknowledged concurrently, fallback to followUp
        try {
          return await interaction.followUp(options);
        } catch {
          return null;
        }
      }
    }

    logger.error({ error, interactionId: interaction.id }, "Error while replying to interaction");
    throw error;
  }
}

/**
 * Safely updates a component interaction (button, select menu) or falls back to editReply/safeReply.
 */
export async function safeUpdate(
  interaction: RespondingInteraction,
  options: string | InteractionUpdateOptions,
): Promise<unknown> {
  try {
    if (interaction.deferred) {
      return await interaction.editReply(options as InteractionReplyOptions);
    }

    if (interaction.replied) {
      return await interaction.followUp(options as InteractionReplyOptions);
    }

    if (typeof interaction.update === "function") {
      return await interaction.update(options);
    }

    return await safeReply(interaction, options as InteractionReplyOptions);
  } catch (error) {
    if (error instanceof DiscordAPIError && error.code === DISCORD_ERROR_UNKNOWN_INTERACTION) {
      logger.warn({ interactionId: interaction.id }, "Cannot update: interaction expired.");
      return null;
    }
    logger.error(
      { error, interactionId: interaction.id },
      "Error while updating component interaction",
    );
    throw error;
  }
}

/**
 * Creates a standardized user-friendly error payload.
 */
export function createErrorPayload(message: string, ephemeral = true): InteractionReplyOptions {
  return {
    content: `⚠️ ${message}`,
    ephemeral,
  };
}

/**
 * Creates a standardized user-friendly success payload.
 */
export function createSuccessPayload(message: string, ephemeral = false): InteractionReplyOptions {
  return {
    content: `✅ ${message}`,
    ephemeral,
  };
}

/**
 * Creates a standardized user-friendly info payload.
 */
export function createInfoPayload(message: string, ephemeral = false): InteractionReplyOptions {
  return {
    content: `ℹ️ ${message}`,
    ephemeral,
  };
}

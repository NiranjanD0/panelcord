import {
  type Interaction,
  type ChatInputCommandInteraction,
  type ButtonInteraction,
  type AnySelectMenuInteraction,
  type ModalSubmitInteraction,
} from "discord.js";
import type { ExtendedClient } from "../lib/client.js";
import type {
  ButtonHandler,
  ModalHandler,
  SelectMenuHandler,
  InteractionRouteParams,
} from "../types/interaction.js";
import { safeReply, safeDefer, createErrorPayload } from "./responses.js";
import { handleInteractionError } from "./errorHandler.js";
import { logger } from "../utils/logger.js";

interface HandlerMatch<T> {
  handler: T;
  params: InteractionRouteParams;
}

function findHandler<T extends { customId: string | RegExp }>(
  handlers: T[],
  customId: string,
): HandlerMatch<T> | null {
  for (const item of handlers) {
    if (typeof item.customId === "string") {
      if (item.customId === customId) {
        return { handler: item, params: {} };
      }
    } else {
      const match = item.customId.exec(customId);
      if (match) {
        const params: InteractionRouteParams = { ...(match.groups ?? {}) };
        return { handler: item, params };
      }
    }
  }
  return null;
}

/**
 * Centralized interaction dispatcher that routes incoming Discord interactions
 * (slash commands, buttons, select menus, and modals) to their registered handlers.
 */
export class InteractionDispatcher {
  private readonly buttonHandlers: ButtonHandler[] = [];
  private readonly modalHandlers: ModalHandler[] = [];
  private readonly selectMenuHandlers: SelectMenuHandler[] = [];

  public registerButton(handler: ButtonHandler): void {
    this.buttonHandlers.push(handler);
  }

  public registerModal(handler: ModalHandler): void {
    this.modalHandlers.push(handler);
  }

  public registerSelectMenu(handler: SelectMenuHandler): void {
    this.selectMenuHandlers.push(handler);
  }

  /**
   * Dispatches an interaction to its corresponding handler with centralized error catching.
   */
  public async dispatch(interaction: Interaction): Promise<void> {
    try {
      if (interaction.isChatInputCommand()) {
        await this.handleChatInputCommand(interaction);
        return;
      }

      if (interaction.isButton()) {
        const handled = await this.handleButton(interaction);
        if (!handled) {
          logger.debug({ customId: interaction.customId }, "Unhandled button interaction");
          await this.handleUnknownComponent(interaction);
        }
        return;
      }

      if (interaction.isAnySelectMenu()) {
        const handled = await this.handleSelectMenu(interaction);
        if (!handled) {
          logger.debug({ customId: interaction.customId }, "Unhandled select menu interaction");
          await this.handleUnknownComponent(interaction);
        }
        return;
      }

      if (interaction.isModalSubmit()) {
        const handled = await this.handleModal(interaction);
        if (!handled) {
          logger.debug({ customId: interaction.customId }, "Unhandled modal submission");
          await this.handleUnknownComponent(interaction);
        }
        return;
      }

      logger.debug(
        { type: interaction.type },
        "Received unsupported or unhandled interaction type",
      );
    } catch (error) {
      await handleInteractionError(error, interaction);
    }
  }

  public async handleChatInputCommand(interaction: ChatInputCommandInteraction): Promise<boolean> {
    const client = interaction.client as ExtendedClient;
    const command = client.commands?.get(interaction.commandName);

    if (!command) {
      logger.warn(
        { commandName: interaction.commandName, userId: interaction.user.id },
        "Received interaction for unregistered slash command",
      );
      await safeReply(interaction, {
        content: "❌ Unknown command.",
        ephemeral: true,
      });
      return false;
    }

    if (command.defer || command.deferEphemeral) {
      await safeDefer(interaction, { ephemeral: command.deferEphemeral });
    }

    logger.debug(
      {
        commandName: interaction.commandName,
        userId: interaction.user.id,
        guildId: interaction.guildId,
      },
      "Executing slash command",
    );

    await command.execute(interaction);
    return true;
  }

  public async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    const match = findHandler(this.buttonHandlers, interaction.customId);
    if (!match) return false;

    if (Object.keys(match.params).length > 0) {
      await match.handler.execute(interaction, match.params);
    } else {
      await (match.handler.execute as (btn: ButtonInteraction) => Promise<void>)(interaction);
    }
    return true;
  }

  public async handleSelectMenu(interaction: AnySelectMenuInteraction): Promise<boolean> {
    const match = findHandler(this.selectMenuHandlers, interaction.customId);
    if (!match) return false;

    if (Object.keys(match.params).length > 0) {
      await match.handler.execute(interaction, match.params);
    } else {
      await (match.handler.execute as (menu: AnySelectMenuInteraction) => Promise<void>)(
        interaction,
      );
    }
    return true;
  }

  public async handleModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const match = findHandler(this.modalHandlers, interaction.customId);
    if (!match) return false;

    if (Object.keys(match.params).length > 0) {
      await match.handler.execute(interaction, match.params);
    } else {
      await (match.handler.execute as (mod: ModalSubmitInteraction) => Promise<void>)(interaction);
    }
    return true;
  }

  private async handleUnknownComponent(
    interaction: ButtonInteraction | AnySelectMenuInteraction | ModalSubmitInteraction,
  ): Promise<void> {
    if (!interaction.replied && !interaction.deferred) {
      await safeReply(
        interaction,
        createErrorPayload("This interactive component is no longer recognized or active.", true),
      );
    }
  }
}

export const interactionDispatcher = new InteractionDispatcher();
// Backward-compatible alias for existing imports
export const interactionManager = interactionDispatcher;
export { InteractionDispatcher as InteractionManager };

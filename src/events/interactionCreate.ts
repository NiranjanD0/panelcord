import { Events } from "discord.js";
import type { Interaction } from "discord.js";
import type { Event } from "../types/event.js";
import type { ExtendedClient } from "../lib/client.js";
import { interactionManager } from "../interactions/index.js";
import { DatabaseUnavailableError } from "../database/index.js";
import { logger } from "../utils/logger.js";

export const interactionCreateEvent: Event<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(interaction: Interaction) {
    const client = interaction.client as ExtendedClient;

    if (interaction.isChatInputCommand()) {
      const command = client.commands.get(interaction.commandName);

      if (!command) {
        logger.warn(
          { commandName: interaction.commandName, userId: interaction.user.id },
          "Received interaction for unregistered command",
        );
        await interaction.reply({
          content: "❌ Unknown command.",
          ephemeral: true,
        });
        return;
      }

      try {
        logger.debug(
          {
            commandName: interaction.commandName,
            userId: interaction.user.id,
            guildId: interaction.guildId,
          },
          "Executing command",
        );
        await command.execute(interaction);
      } catch (error) {
        logger.error(
          { error, commandName: interaction.commandName, userId: interaction.user.id },
          "Failed to execute command",
        );

        const errorMessage =
          error instanceof DatabaseUnavailableError
            ? "⚠️ Database service is currently unavailable. Please try again later."
            : "⚠️ An error occurred while executing this command. Please try again later.";
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp({ content: errorMessage, ephemeral: true }).catch(() => {});
        } else {
          await interaction.reply({ content: errorMessage, ephemeral: true }).catch(() => {});
        }
      }
      return;
    }

    if (interaction.isButton()) {
      try {
        const handled = await interactionManager.handleButton(interaction);
        if (!handled) {
          logger.debug({ customId: interaction.customId }, "Unhandled button interaction");
        }
      } catch (error) {
        logger.error(
          { error, customId: interaction.customId },
          "Error processing button interaction",
        );
      }
      return;
    }

    if (interaction.isModalSubmit()) {
      try {
        const handled = await interactionManager.handleModal(interaction);
        if (!handled) {
          logger.debug({ customId: interaction.customId }, "Unhandled modal submission");
        }
      } catch (error) {
        logger.error(
          { error, customId: interaction.customId },
          "Error processing modal interaction",
        );
      }
      return;
    }

    if (interaction.isAnySelectMenu()) {
      try {
        const handled = await interactionManager.handleSelectMenu(interaction);
        if (!handled) {
          logger.debug({ customId: interaction.customId }, "Unhandled select menu interaction");
        }
      } catch (error) {
        logger.error(
          { error, customId: interaction.customId },
          "Error processing select menu interaction",
        );
      }
      return;
    }
  },
};

export default interactionCreateEvent;

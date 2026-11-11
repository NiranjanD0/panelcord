import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";
import type { ButtonHandler, ModalHandler, SelectMenuHandler } from "../types/interaction.js";
import { logger } from "../utils/logger.js";

class InteractionManager {
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

  public async handleButton(interaction: ButtonInteraction): Promise<boolean> {
    const handler = this.buttonHandlers.find((h) =>
      typeof h.customId === "string"
        ? h.customId === interaction.customId
        : h.customId.test(interaction.customId),
    );

    if (!handler) return false;

    try {
      await handler.execute(interaction);
      return true;
    } catch (error) {
      logger.error({ error, customId: interaction.customId }, "Error handling button interaction");
      throw error;
    }
  }

  public async handleModal(interaction: ModalSubmitInteraction): Promise<boolean> {
    const handler = this.modalHandlers.find((h) =>
      typeof h.customId === "string"
        ? h.customId === interaction.customId
        : h.customId.test(interaction.customId),
    );

    if (!handler) return false;

    try {
      await handler.execute(interaction);
      return true;
    } catch (error) {
      logger.error({ error, customId: interaction.customId }, "Error handling modal submission");
      throw error;
    }
  }

  public async handleSelectMenu(interaction: AnySelectMenuInteraction): Promise<boolean> {
    const handler = this.selectMenuHandlers.find((h) =>
      typeof h.customId === "string"
        ? h.customId === interaction.customId
        : h.customId.test(interaction.customId),
    );

    if (!handler) return false;

    try {
      await handler.execute(interaction);
      return true;
    } catch (error) {
      logger.error(
        { error, customId: interaction.customId },
        "Error handling select menu interaction",
      );
      throw error;
    }
  }
}

export const interactionManager = new InteractionManager();

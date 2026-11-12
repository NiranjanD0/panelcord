import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
} from "discord.js";

export interface ButtonHandler {
  customId: string | RegExp;
  execute: (interaction: ButtonInteraction) => Promise<void>;
}

export interface ModalHandler {
  customId: string | RegExp;
  execute: (interaction: ModalSubmitInteraction) => Promise<void>;
}

export interface SelectMenuHandler {
  customId: string | RegExp;
  execute: (interaction: AnySelectMenuInteraction) => Promise<void>;
}

import type {
  AnySelectMenuInteraction,
  ButtonInteraction,
  ModalSubmitInteraction,
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  MentionableSelectMenuInteraction,
} from "discord.js";

export type InteractionRouteParams = Record<string, string>;

export interface ButtonHandler {
  customId: string | RegExp;
  execute: (interaction: ButtonInteraction, params?: InteractionRouteParams) => Promise<void>;
}

export interface ModalHandler {
  customId: string | RegExp;
  execute: (interaction: ModalSubmitInteraction, params?: InteractionRouteParams) => Promise<void>;
}

export interface SelectMenuHandler {
  customId: string | RegExp;
  execute: (
    interaction: AnySelectMenuInteraction,
    params?: InteractionRouteParams,
  ) => Promise<void>;
}

export type {
  StringSelectMenuInteraction,
  UserSelectMenuInteraction,
  RoleSelectMenuInteraction,
  ChannelSelectMenuInteraction,
  MentionableSelectMenuInteraction,
};

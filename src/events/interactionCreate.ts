import { Events, type Interaction } from "discord.js";
import type { Event } from "../types/event.js";
import { interactionDispatcher } from "../interactions/index.js";

export const interactionCreateEvent: Event<Events.InteractionCreate> = {
  name: Events.InteractionCreate,
  async execute(interaction: Interaction) {
    await interactionDispatcher.dispatch(interaction);
  },
};

export default interactionCreateEvent;

import { ActivityType, Events } from "discord.js";
import type { Client } from "discord.js";
import type { Event } from "../types/event.js";
import { logger } from "../utils/logger.js";
import { APP_NAME, APP_VERSION } from "../config/constants.js";

export const readyEvent: Event<Events.ClientReady> = {
  name: Events.ClientReady,
  once: true,
  execute(client: Client<true>) {
    logger.info(
      {
        botTag: client.user.tag,
        guildCount: client.guilds.cache.size,
        version: APP_VERSION,
      },
      `⚡ ${APP_NAME} is online and connected to Discord Gateway!`,
    );

    client.user.setActivity({
      name: "Pterodactyl servers | /about",
      type: ActivityType.Custom,
    });
  },
};

export default readyEvent;

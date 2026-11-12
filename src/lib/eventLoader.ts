import type { ExtendedClient } from "./client.js";
import { events } from "../events/index.js";
import { logger } from "../utils/logger.js";

export function loadEvents(client: ExtendedClient): void {
  for (const event of events) {
    if (event.once) {
      client.once(event.name, (...args) => event.execute(...args));
    } else {
      client.on(event.name, (...args) => event.execute(...args));
    }

    logger.debug({ event: event.name, once: !!event.once }, "Registered event listener");
  }

  logger.info({ count: events.length }, "Successfully registered event listeners.");
}

import type { Event } from "../types/event.js";
import { readyEvent } from "./ready.js";
import { interactionCreateEvent } from "./interactionCreate.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const events: Event<any>[] = [readyEvent, interactionCreateEvent];

export { readyEvent, interactionCreateEvent };

import type { Command } from "../types/command.js";
import { pingCommand } from "./utility/ping.js";
import { aboutCommand } from "./utility/about.js";

export const commands: Command[] = [pingCommand, aboutCommand];

export { pingCommand, aboutCommand };

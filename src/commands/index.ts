import type { Command } from "../types/command.js";
import { pingCommand } from "./utility/ping.js";
import { aboutCommand } from "./utility/about.js";
import { panelCommand } from "./panel.js";

export const commands: Command[] = [pingCommand, aboutCommand, panelCommand];

export { pingCommand, aboutCommand, panelCommand };

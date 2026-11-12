import { Client, Collection, GatewayIntentBits } from "discord.js";
import type { Command } from "../types/command.js";

export class ExtendedClient extends Client {
  public readonly commands: Collection<string, Command> = new Collection();

  constructor() {
    super({
      intents: [GatewayIntentBits.Guilds],
    });
  }
}

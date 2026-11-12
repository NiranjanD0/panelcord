import { describe, expect, it, vi } from "vitest";
import { interactionCreateEvent } from "../src/events/interactionCreate.js";
import { ExtendedClient } from "../src/lib/client.js";
import type { ChatInputCommandInteraction } from "discord.js";
import type { SlashCommandData } from "../src/types/command.js";

describe("Error Handling", () => {
  it("handles command execution failure by replying ephemeral error to user", async () => {
    const client = new ExtendedClient();
    const failingCommand = {
      data: { name: "failcmd", description: "test" } as unknown as SlashCommandData,
      execute: vi.fn().mockRejectedValue(new Error("Simulated command failure")),
    };
    client.commands.set("failcmd", failingCommand);

    const mockInteraction = {
      isChatInputCommand: () => true,
      isButton: () => false,
      isModalSubmit: () => false,
      isAnySelectMenu: () => false,
      client,
      commandName: "failcmd",
      user: { id: "user_123" },
      guildId: "guild_123",
      replied: false,
      deferred: false,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await interactionCreateEvent.execute(mockInteraction);

    expect(failingCommand.execute).toHaveBeenCalled();
    expect(mockInteraction.reply).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("An error occurred while executing this command"),
        ephemeral: true,
      }),
    );
  });

  it("handles command failure when interaction was already deferred/replied", async () => {
    const client = new ExtendedClient();
    const failingCommand = {
      data: { name: "deferfail", description: "test" } as unknown as SlashCommandData,
      execute: vi.fn().mockRejectedValue(new Error("Deferred failure")),
    };
    client.commands.set("deferfail", failingCommand);

    const mockInteraction = {
      isChatInputCommand: () => true,
      isButton: () => false,
      isModalSubmit: () => false,
      isAnySelectMenu: () => false,
      client,
      commandName: "deferfail",
      user: { id: "user_123" },
      guildId: "guild_123",
      replied: false,
      deferred: true,
      reply: vi.fn().mockResolvedValue(undefined),
      followUp: vi.fn().mockResolvedValue(undefined),
    } as unknown as ChatInputCommandInteraction;

    await interactionCreateEvent.execute(mockInteraction);

    expect(mockInteraction.followUp).toHaveBeenCalledWith(
      expect.objectContaining({
        content: expect.stringContaining("An error occurred while executing this command"),
        ephemeral: true,
      }),
    );
  });
});

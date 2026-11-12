import { describe, expect, it, vi, beforeEach } from "vitest";
import { SlashCommandBuilder, REST } from "discord.js";
import {
  validateCommand,
  validateCommands,
  deployCommands,
  commandDataSchema,
} from "../src/lib/commandRegistration.js";
import type { Command } from "../src/types/command.js";

describe("Command Registration & Validation (Phase 03.1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("Schema Validation", () => {
    it("validates valid command names and descriptions", () => {
      const valid = commandDataSchema.safeParse({
        name: "server-status",
        description: "Checks the status of a server",
      });
      expect(valid.success).toBe(true);
    });

    it("rejects command names with spaces or uppercase letters", () => {
      const withSpaces = commandDataSchema.safeParse({
        name: "server status",
        description: "test",
      });
      expect(withSpaces.success).toBe(false);

      const withUppercase = commandDataSchema.safeParse({
        name: "ServerStatus",
        description: "test",
      });
      expect(withUppercase.success).toBe(false);
    });

    it("rejects empty names or descriptions exceeding 100 characters", () => {
      const emptyName = commandDataSchema.safeParse({
        name: "",
        description: "test",
      });
      expect(emptyName.success).toBe(false);

      const longDesc = commandDataSchema.safeParse({
        name: "test",
        description: "a".repeat(101),
      });
      expect(longDesc.success).toBe(false);
    });
  });

  describe("validateCommand", () => {
    it("accepts a well-formed Command object", () => {
      const cmd: Command = {
        data: new SlashCommandBuilder().setName("ping").setDescription("Replies with pong"),
        execute: async () => {},
      };
      expect(() => validateCommand(cmd)).not.toThrow();
    });

    it("throws if command is missing execute function", () => {
      const cmd = {
        data: new SlashCommandBuilder().setName("ping").setDescription("Replies with pong"),
      } as unknown as Command;
      expect(() => validateCommand(cmd)).toThrow(/missing an execute function/);
    });

    it("throws if command is missing data property", () => {
      const cmd = {
        execute: async () => {},
      } as unknown as Command;
      expect(() => validateCommand(cmd)).toThrow(/missing required 'data' property/);
    });
  });

  describe("validateCommands", () => {
    it("accepts a list of unique valid commands", () => {
      const cmd1: Command = {
        data: new SlashCommandBuilder().setName("cmd1").setDescription("Command 1"),
        execute: async () => {},
      };
      const cmd2: Command = {
        data: new SlashCommandBuilder().setName("cmd2").setDescription("Command 2"),
        execute: async () => {},
      };
      expect(() => validateCommands([cmd1, cmd2])).not.toThrow();
    });

    it("detects and throws on duplicate command names", () => {
      const cmd1: Command = {
        data: new SlashCommandBuilder().setName("duplicate").setDescription("First"),
        execute: async () => {},
      };
      const cmd2: Command = {
        data: new SlashCommandBuilder().setName("duplicate").setDescription("Second"),
        execute: async () => {},
      };
      expect(() => validateCommands([cmd1, cmd2])).toThrow(
        /Duplicate command name detected: "duplicate"/,
      );
    });
  });

  describe("deployCommands", () => {
    it("deploys commands to a specific guild when guildId is provided", async () => {
      const mockRest = {
        put: vi.fn().mockResolvedValue([]),
      } as unknown as REST;

      const cmd: Command = {
        data: new SlashCommandBuilder().setName("ping").setDescription("Ping pong"),
        execute: async () => {},
      };

      const result = await deployCommands({
        rest: mockRest,
        clientId: "123456789",
        commands: [cmd],
        guildId: "987654321",
      });

      expect(result.success).toBe(true);
      expect(result.target).toBe("guild");
      expect(result.guildId).toBe("987654321");
      expect(result.commandCount).toBe(1);

      expect(mockRest.put).toHaveBeenCalledWith(
        "/applications/123456789/guilds/987654321/commands",
        expect.objectContaining({
          body: [expect.objectContaining({ name: "ping" })],
        }),
      );
    });

    it("deploys commands globally when guildId is omitted", async () => {
      const mockRest = {
        put: vi.fn().mockResolvedValue([]),
      } as unknown as REST;

      const cmd: Command = {
        data: new SlashCommandBuilder().setName("about").setDescription("Bot info"),
        execute: async () => {},
      };

      const result = await deployCommands({
        rest: mockRest,
        clientId: "123456789",
        commands: [cmd],
      });

      expect(result.success).toBe(true);
      expect(result.target).toBe("global");
      expect(result.guildId).toBeUndefined();
      expect(result.commandCount).toBe(1);

      expect(mockRest.put).toHaveBeenCalledWith(
        "/applications/123456789/commands",
        expect.objectContaining({
          body: [expect.objectContaining({ name: "about" })],
        }),
      );
    });

    it("fails early if clientId is missing or empty", async () => {
      const mockRest = { put: vi.fn() } as unknown as REST;
      await expect(
        deployCommands({
          rest: mockRest,
          clientId: "",
          commands: [],
        }),
      ).rejects.toThrow(/clientId is required/);
    });
  });
});

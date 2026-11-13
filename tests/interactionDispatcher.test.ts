import { describe, expect, it, vi, beforeEach } from "vitest";
import { InteractionDispatcher, interactionDispatcher } from "../src/interactions/dispatcher.js";
import { ExtendedClient } from "../src/lib/client.js";
import { logger } from "../src/utils/logger.js";
import type {
  ChatInputCommandInteraction,
  ButtonInteraction,
  AnySelectMenuInteraction,
  ModalSubmitInteraction,
  AutocompleteInteraction,
} from "discord.js";
import type { Command, SlashCommandData } from "../src/types/command.js";

describe("InteractionDispatcher (Phase 03.1)", () => {
  let dispatcher: InteractionDispatcher;
  let client: ExtendedClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    dispatcher = new InteractionDispatcher();
    client = new ExtendedClient();
  });

  describe("Slash Command Dispatching", () => {
    it("routes and executes registered slash command", async () => {
      const executeFn = vi.fn().mockResolvedValue(undefined);
      const testCommand: Command = {
        data: { name: "testcmd", description: "Test" } as unknown as SlashCommandData,
        execute: executeFn,
      };
      client.commands.set("testcmd", testCommand);

      const mockInteraction = {
        isChatInputCommand: () => true,
        isButton: () => false,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        commandName: "testcmd",
        client,
        user: { id: "user_1" },
        guildId: "guild_1",
      } as unknown as ChatInputCommandInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(executeFn).toHaveBeenCalledWith(mockInteraction);
    });

    it("replies ephemeral error for unregistered command", async () => {
      const mockInteraction = {
        isChatInputCommand: () => true,
        isButton: () => false,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        commandName: "unregistered",
        client,
        user: { id: "user_1" },
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatInputCommandInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith({
        content: "❌ Unknown command.",
        ephemeral: true,
      });
    });

    it("automatically defers when command specifies defer: true", async () => {
      const executeFn = vi.fn().mockResolvedValue(undefined);
      const testCommand: Command = {
        data: { name: "deferredcmd", description: "Test" } as unknown as SlashCommandData,
        defer: true,
        execute: executeFn,
      };
      client.commands.set("deferredcmd", testCommand);

      const mockInteraction = {
        isChatInputCommand: () => true,
        isButton: () => false,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        commandName: "deferredcmd",
        client,
        user: { id: "user_1" },
        replied: false,
        deferred: false,
        deferReply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatInputCommandInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: undefined });
      expect(executeFn).toHaveBeenCalledWith(mockInteraction);
    });

    it("automatically defers ephemerally when command specifies deferEphemeral: true", async () => {
      const executeFn = vi.fn().mockResolvedValue(undefined);
      const testCommand: Command = {
        data: { name: "ephcmd", description: "Test" } as unknown as SlashCommandData,
        deferEphemeral: true,
        execute: executeFn,
      };
      client.commands.set("ephcmd", testCommand);

      const mockInteraction = {
        isChatInputCommand: () => true,
        isButton: () => false,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        commandName: "ephcmd",
        client,
        user: { id: "user_1" },
        replied: false,
        deferred: false,
        deferReply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ChatInputCommandInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(mockInteraction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
      expect(executeFn).toHaveBeenCalledWith(mockInteraction);
    });
  });

  describe("Autocomplete Dispatching", () => {
    it("routes autocomplete interaction to registered command's autocomplete handler", async () => {
      const autocompleteFn = vi.fn().mockResolvedValue(undefined);
      const testCommand: Command = {
        data: { name: "autocmd", description: "Test" } as unknown as SlashCommandData,
        execute: vi.fn(),
        autocomplete: autocompleteFn,
      };
      client.commands.set("autocmd", testCommand);

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => false,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => true,
        commandName: "autocmd",
        client,
        user: { id: "user_1" },
      } as unknown as AutocompleteInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(autocompleteFn).toHaveBeenCalledWith(mockInteraction);
    });

    it("returns false and does not throw if command has no autocomplete handler", async () => {
      const testCommand: Command = {
        data: { name: "no_auto", description: "Test" } as unknown as SlashCommandData,
        execute: vi.fn(),
      };
      client.commands.set("no_auto", testCommand);

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => false,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => true,
        commandName: "no_auto",
        client,
        user: { id: "user_1" },
      } as unknown as AutocompleteInteraction;

      const handled = await dispatcher.handleAutocomplete(mockInteraction);
      expect(handled).toBe(false);
    });
  });

  describe("Button Dispatching", () => {
    it("routes button by exact string customId", async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerButton({
        customId: "btn_exact",
        execute: handlerFn,
      });

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "btn_exact",
      } as unknown as ButtonInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(handlerFn).toHaveBeenCalledWith(mockInteraction);
    });

    it("routes button by RegExp customId with extracted parameters", async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerButton({
        customId: /^server_(?<action>restart|kill):(?<serverId>[a-zA-Z0-9]+)$/,
        execute: handlerFn,
      });

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "server_restart:srv42",
      } as unknown as ButtonInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(handlerFn).toHaveBeenCalledWith(mockInteraction, {
        action: "restart",
        serverId: "srv42",
      });
    });

    it("handles repeated executions when RegExp uses global flag (/g) without state pollution", async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerButton({
        customId: /^server_action:[a-z]+$/g,
        execute: handlerFn,
      });

      const mockInteraction1 = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "server_action:restart",
      } as unknown as ButtonInteraction;

      const mockInteraction2 = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "server_action:restart",
      } as unknown as ButtonInteraction;

      await dispatcher.dispatch(mockInteraction1);
      await dispatcher.dispatch(mockInteraction2);

      expect(handlerFn).toHaveBeenCalledTimes(2);
    });

    it("automatically calls deferUpdate when button specifies deferUpdate: true", async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerButton({
        customId: "btn_defer_update",
        deferUpdate: true,
        execute: handlerFn,
      });

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "btn_defer_update",
        replied: false,
        deferred: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
      } as unknown as ButtonInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(mockInteraction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(handlerFn).toHaveBeenCalledTimes(1);
    });

    it("handles unmatched button by responding with inactive notice", async () => {
      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "unknown_button_id",
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ButtonInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "⚠️ This interactive component is no longer recognized or active.",
          ephemeral: true,
        }),
      );
    });
  });

  describe("Select Menu Dispatching", () => {
    it("routes select menu by regex pattern and extracts parameters", async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerSelectMenu({
        customId: /^select_node:(?<cluster>[a-z]+)$/,
        execute: handlerFn,
      });

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => false,
        isAnySelectMenu: () => true,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "select_node:eu",
        values: ["node_1"],
      } as unknown as AnySelectMenuInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(handlerFn).toHaveBeenCalledWith(mockInteraction, { cluster: "eu" });
    });

    it("automatically calls deferUpdate when select menu specifies deferUpdate: true", async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerSelectMenu({
        customId: "menu_defer_update",
        deferUpdate: true,
        execute: handlerFn,
      });

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => false,
        isAnySelectMenu: () => true,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "menu_defer_update",
        replied: false,
        deferred: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
      } as unknown as AnySelectMenuInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(mockInteraction.deferUpdate).toHaveBeenCalledTimes(1);
      expect(handlerFn).toHaveBeenCalledTimes(1);
    });
  });

  describe("Modal Dispatching", () => {
    it("routes modal submission by customId", async () => {
      const handlerFn = vi.fn().mockResolvedValue(undefined);
      dispatcher.registerModal({
        customId: "create_panel_modal",
        execute: handlerFn,
      });

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => false,
        isAnySelectMenu: () => false,
        isModalSubmit: () => true,
        isAutocomplete: () => false,
        customId: "create_panel_modal",
      } as unknown as ModalSubmitInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(handlerFn).toHaveBeenCalledWith(mockInteraction);
    });
  });

  describe("Handler Registration, Warnings, and Test Isolation", () => {
    it("logs a warning when duplicate string customId is registered", () => {
      const warnSpy = vi.spyOn(logger, "warn");

      dispatcher.registerButton({ customId: "dup_btn", execute: vi.fn() });
      dispatcher.registerButton({ customId: "dup_btn", execute: vi.fn() });
      expect(warnSpy).toHaveBeenCalledWith(
        { customId: "dup_btn" },
        expect.stringContaining("Duplicate button handler registered"),
      );

      dispatcher.registerModal({ customId: "dup_modal", execute: vi.fn() });
      dispatcher.registerModal({ customId: "dup_modal", execute: vi.fn() });
      expect(warnSpy).toHaveBeenCalledWith(
        { customId: "dup_modal" },
        expect.stringContaining("Duplicate modal handler registered"),
      );

      dispatcher.registerSelectMenu({ customId: "dup_select", execute: vi.fn() });
      dispatcher.registerSelectMenu({ customId: "dup_select", execute: vi.fn() });
      expect(warnSpy).toHaveBeenCalledWith(
        { customId: "dup_select" },
        expect.stringContaining("Duplicate select menu handler registered"),
      );
    });

    it("clears all component and modal handlers when clearHandlers() is called", async () => {
      dispatcher.registerButton({ customId: "clear_btn", execute: vi.fn() });
      dispatcher.registerModal({ customId: "clear_modal", execute: vi.fn() });
      dispatcher.registerSelectMenu({ customId: "clear_menu", execute: vi.fn() });

      dispatcher.clearHandlers();

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "clear_btn",
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ButtonInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "⚠️ This interactive component is no longer recognized or active.",
        }),
      );
    });
  });

  describe("Centralized Error Catching", () => {
    it("catches errors in handlers and sends safe error reply", async () => {
      dispatcher.registerButton({
        customId: "failing_button",
        execute: vi.fn().mockRejectedValue(new Error("Database connection dropped")),
      });

      const mockInteraction = {
        isChatInputCommand: () => false,
        isButton: () => true,
        isAnySelectMenu: () => false,
        isModalSubmit: () => false,
        isAutocomplete: () => false,
        customId: "failing_button",
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
      } as unknown as ButtonInteraction;

      await dispatcher.dispatch(mockInteraction);
      expect(mockInteraction.reply).toHaveBeenCalledWith(
        expect.objectContaining({
          content: "⚠️ An error occurred while executing this command. Please try again later.",
          ephemeral: true,
        }),
      );
    });
  });

  describe("Singleton Instance", () => {
    it("exports initialized interactionDispatcher singleton", () => {
      expect(interactionDispatcher).toBeInstanceOf(InteractionDispatcher);
    });
  });
});

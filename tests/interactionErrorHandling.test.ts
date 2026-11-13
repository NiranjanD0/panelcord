import { describe, expect, it, vi, beforeEach } from "vitest";
import { DiscordAPIError, type Interaction } from "discord.js";
import {
  getUserFriendlyErrorMessage,
  extractInteractionContext,
  handleInteractionError,
} from "../src/interactions/errorHandler.js";
import { DatabaseUnavailableError } from "../src/database/index.js";
import {
  DISCORD_ERROR_UNKNOWN_INTERACTION,
  DISCORD_ERROR_MISSING_PERMISSIONS,
  type RespondingInteraction,
} from "../src/interactions/responses.js";

function createMockDiscordAPIError(code: number, message = "Discord API Error"): DiscordAPIError {
  const rawError = { message, code, global: false };
  const response = {
    status: 400,
    statusText: "Bad Request",
    headers: new Headers(),
    body: null,
    bodyUsed: false,
    ok: false,
    redirected: false,
    type: "basic" as ResponseType,
    url: "https://discord.com/api/v10",
    clone: vi.fn(),
    arrayBuffer: vi.fn(),
    blob: vi.fn(),
    formData: vi.fn(),
    json: vi.fn(),
    text: vi.fn(),
    bytes: vi.fn(),
  };
  return new DiscordAPIError(rawError, code, 400, "POST", "https://discord.com/api/v10", response);
}

describe("Centralized Interaction Error Handling (Phase 03.1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("getUserFriendlyErrorMessage", () => {
    it("maps DatabaseUnavailableError to a clear user-facing message", () => {
      const msg = getUserFriendlyErrorMessage(new DatabaseUnavailableError());
      expect(msg).toContain("Database service is currently unavailable");
    });

    it("maps DiscordAPIError 50013 (Missing Permissions) to a clear permission message", () => {
      const err = createMockDiscordAPIError(DISCORD_ERROR_MISSING_PERMISSIONS);
      const msg = getUserFriendlyErrorMessage(err);
      expect(msg).toContain("does not have the required Discord permissions");
    });

    it("masks internal errors, SQL errors, and stack traces from arbitrary exceptions", () => {
      const internalErr = new Error(
        'FATAL: relation "users" does not exist at postgres.internal:5432',
      );
      const msg = getUserFriendlyErrorMessage(internalErr);
      expect(msg).toBe("An error occurred while executing this command. Please try again later.");
      expect(msg).not.toContain("relation");
      expect(msg).not.toContain("postgres");
    });

    it("handles non-Error objects safely", () => {
      expect(getUserFriendlyErrorMessage("string error")).toBe(
        "An error occurred while executing this command. Please try again later.",
      );
      expect(getUserFriendlyErrorMessage(null)).toBe(
        "An error occurred while executing this command. Please try again later.",
      );
    });
  });

  describe("extractInteractionContext", () => {
    it("extracts commandName for slash command interactions", () => {
      const interaction = {
        id: "int_cmd",
        type: 2,
        commandName: "ping",
        user: { id: "user_42" },
        guildId: "guild_100",
        channelId: "channel_200",
        isChatInputCommand: () => true,
        isAutocomplete: () => false,
      } as unknown as Interaction;

      const ctx = extractInteractionContext(interaction);
      expect(ctx.interactionId).toBe("int_cmd");
      expect(ctx.commandName).toBe("ping");
      expect(ctx.userId).toBe("user_42");
      expect(ctx.guildId).toBe("guild_100");
      expect(ctx.channelId).toBe("channel_200");
    });

    it("extracts customId for component interactions", () => {
      const interaction = {
        id: "int_btn",
        type: 3,
        customId: "btn_action",
        user: { id: "user_42" },
        guildId: "guild_100",
        channelId: "channel_200",
        isChatInputCommand: () => false,
        isButton: () => true,
      } as unknown as Interaction;

      const ctx = extractInteractionContext(interaction);
      expect(ctx.customId).toBe("btn_action");
    });
  });

  describe("handleInteractionError", () => {
    it("does not attempt to reply if error is 10062 (Unknown/expired interaction)", async () => {
      const expiredErr = createMockDiscordAPIError(DISCORD_ERROR_UNKNOWN_INTERACTION);
      const interaction = {
        id: "int_expired",
        reply: vi.fn(),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      await handleInteractionError(expiredErr, interaction);
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it("sends ephemeral error reply when interaction is unacknowledged", async () => {
      const error = new Error("Simulated failure");
      const interaction = {
        id: "int_err",
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      await handleInteractionError(error, interaction);
      expect(interaction.reply).toHaveBeenCalledWith({
        content: "⚠️ An error occurred while executing this command. Please try again later.",
        ephemeral: true,
      });
    });

    it("sends followUp error reply when interaction is deferred or replied", async () => {
      const error = new Error("Simulated deferred failure");
      const interaction = {
        id: "int_def_err",
        replied: false,
        deferred: true,
        reply: vi.fn(),
        followUp: vi.fn().mockResolvedValue(undefined),
      } as unknown as RespondingInteraction;

      await handleInteractionError(error, interaction);
      expect(interaction.followUp).toHaveBeenCalledWith({
        content: "⚠️ An error occurred while executing this command. Please try again later.",
        ephemeral: true,
      });
      expect(interaction.reply).not.toHaveBeenCalled();
    });

    it("catches secondary response delivery failures without throwing unhandled rejection", async () => {
      const error = new Error("Primary failure");
      const interaction = {
        id: "int_reply_fail",
        replied: false,
        deferred: false,
        reply: vi.fn().mockRejectedValue(new Error("Connection reset while sending error reply")),
      } as unknown as RespondingInteraction;

      await expect(handleInteractionError(error, interaction)).resolves.not.toThrow();
    });
  });
});

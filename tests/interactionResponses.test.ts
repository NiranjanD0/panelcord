import { describe, expect, it, vi, beforeEach } from "vitest";
import { DiscordAPIError } from "discord.js";
import {
  safeReply,
  safeDefer,
  safeUpdate,
  safeDeferUpdate,
  createErrorPayload,
  createSuccessPayload,
  createInfoPayload,
  DISCORD_ERROR_UNKNOWN_INTERACTION,
  DISCORD_ERROR_INTERACTION_ALREADY_ACKNOWLEDGED,
  type RespondingInteraction,
} from "../src/interactions/responses.js";

function createMockDiscordAPIError(code: number, message = "Discord API Error"): DiscordAPIError {
  const rawError = {
    message,
    code,
    global: false,
  };
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

describe("Interaction Response Utilities (Phase 03.1)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("safeReply", () => {
    it("calls interaction.reply when unacknowledged", async () => {
      const interaction = {
        id: "int_1",
        replied: false,
        deferred: false,
        reply: vi.fn().mockResolvedValue({ id: "msg_1" }),
        editReply: vi.fn(),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      await safeReply(interaction, { content: "Hello", ephemeral: true });

      expect(interaction.reply).toHaveBeenCalledWith({ content: "Hello", ephemeral: true });
      expect(interaction.editReply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it("calls interaction.editReply when deferred", async () => {
      const interaction = {
        id: "int_2",
        replied: false,
        deferred: true,
        reply: vi.fn(),
        editReply: vi.fn().mockResolvedValue({ id: "msg_1" }),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      await safeReply(interaction, { content: "Deferred update" });

      expect(interaction.editReply).toHaveBeenCalledWith({ content: "Deferred update" });
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.followUp).not.toHaveBeenCalled();
    });

    it("calls interaction.followUp when already replied", async () => {
      const interaction = {
        id: "int_3",
        replied: true,
        deferred: false,
        reply: vi.fn(),
        editReply: vi.fn(),
        followUp: vi.fn().mockResolvedValue({ id: "msg_2" }),
      } as unknown as RespondingInteraction;

      await safeReply(interaction, { content: "Follow-up message" });

      expect(interaction.followUp).toHaveBeenCalledWith({ content: "Follow-up message" });
      expect(interaction.reply).not.toHaveBeenCalled();
      expect(interaction.editReply).not.toHaveBeenCalled();
    });

    it("gracefully catches and silences 10062 Unknown Interaction (expired)", async () => {
      const error10062 = createMockDiscordAPIError(DISCORD_ERROR_UNKNOWN_INTERACTION);
      const interaction = {
        id: "int_expired",
        replied: false,
        deferred: false,
        reply: vi.fn().mockRejectedValue(error10062),
        editReply: vi.fn(),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      const result = await safeReply(interaction, "Late reply");
      expect(result).toBeNull();
    });

    it("falls back to followUp on 40060 Already Acknowledged race condition", async () => {
      const error40060 = createMockDiscordAPIError(DISCORD_ERROR_INTERACTION_ALREADY_ACKNOWLEDGED);
      const interaction = {
        id: "int_race",
        replied: false,
        deferred: false,
        reply: vi.fn().mockRejectedValue(error40060),
        editReply: vi.fn(),
        followUp: vi.fn().mockResolvedValue({ id: "msg_fallback" }),
      } as unknown as RespondingInteraction;

      const result = await safeReply(interaction, "Race reply");
      expect(interaction.followUp).toHaveBeenCalledWith("Race reply");
      expect(result).toEqual({ id: "msg_fallback" });
    });

    it("rethrows unexpected runtime errors", async () => {
      const interaction = {
        id: "int_err",
        replied: false,
        deferred: false,
        reply: vi.fn().mockRejectedValue(new Error("Fatal network drop")),
        editReply: vi.fn(),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      await expect(safeReply(interaction, "Test")).rejects.toThrow("Fatal network drop");
    });
  });

  describe("safeDefer", () => {
    it("defers unacknowledged interaction", async () => {
      const interaction = {
        id: "int_defer",
        replied: false,
        deferred: false,
        deferReply: vi.fn().mockResolvedValue(undefined),
      } as unknown as RespondingInteraction;

      const success = await safeDefer(interaction, { ephemeral: true });
      expect(success).toBe(true);
      expect(interaction.deferReply).toHaveBeenCalledWith({ ephemeral: true });
    });

    it("returns early if already deferred or replied", async () => {
      const interaction = {
        id: "int_already",
        replied: false,
        deferred: true,
        deferReply: vi.fn(),
      } as unknown as RespondingInteraction;

      const success = await safeDefer(interaction);
      expect(success).toBe(true);
      expect(interaction.deferReply).not.toHaveBeenCalled();
    });

    it("handles 10062 error by returning false without throwing", async () => {
      const error10062 = createMockDiscordAPIError(DISCORD_ERROR_UNKNOWN_INTERACTION);
      const interaction = {
        id: "int_defer_expired",
        replied: false,
        deferred: false,
        deferReply: vi.fn().mockRejectedValue(error10062),
      } as unknown as RespondingInteraction;

      const success = await safeDefer(interaction);
      expect(success).toBe(false);
    });
  });

  describe("safeUpdate", () => {
    it("calls interaction.update when unacknowledged", async () => {
      const interaction = {
        id: "btn_update",
        replied: false,
        deferred: false,
        update: vi.fn().mockResolvedValue(undefined),
        editReply: vi.fn(),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      await safeUpdate(interaction, { content: "Updated message" });
      expect(interaction.update).toHaveBeenCalledWith({ content: "Updated message" });
    });

    it("calls interaction.editReply when deferred", async () => {
      const interaction = {
        id: "btn_deferred",
        replied: false,
        deferred: true,
        update: vi.fn(),
        editReply: vi.fn().mockResolvedValue(undefined),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      await safeUpdate(interaction, { content: "Deferred update" });
      expect(interaction.editReply).toHaveBeenCalledWith({ content: "Deferred update" });
      expect(interaction.update).not.toHaveBeenCalled();
    });

    it("falls back to followUp on 40060 Already Acknowledged error during update", async () => {
      const error40060 = createMockDiscordAPIError(DISCORD_ERROR_INTERACTION_ALREADY_ACKNOWLEDGED);
      const interaction = {
        id: "btn_race",
        replied: false,
        deferred: false,
        update: vi.fn().mockRejectedValue(error40060),
        editReply: vi.fn(),
        followUp: vi.fn().mockResolvedValue({ id: "msg_fallback" }),
      } as unknown as RespondingInteraction;

      const result = await safeUpdate(interaction, { content: "Fallback update" });
      expect(interaction.followUp).toHaveBeenCalledWith({ content: "Fallback update" });
      expect(result).toEqual({ id: "msg_fallback" });
    });

    it("handles 10062 Unknown Interaction during update by returning null", async () => {
      const error10062 = createMockDiscordAPIError(DISCORD_ERROR_UNKNOWN_INTERACTION);
      const interaction = {
        id: "btn_expired",
        replied: false,
        deferred: false,
        update: vi.fn().mockRejectedValue(error10062),
        editReply: vi.fn(),
        followUp: vi.fn(),
      } as unknown as RespondingInteraction;

      const result = await safeUpdate(interaction, { content: "Expired update" });
      expect(result).toBeNull();
    });
  });

  describe("safeDeferUpdate", () => {
    it("calls interaction.deferUpdate when not deferred or replied", async () => {
      const interaction = {
        id: "btn_defer_update",
        replied: false,
        deferred: false,
        deferUpdate: vi.fn().mockResolvedValue(undefined),
      } as unknown as RespondingInteraction;

      const success = await safeDeferUpdate(interaction);
      expect(success).toBe(true);
      expect(interaction.deferUpdate).toHaveBeenCalled();
    });

    it("skips if already deferred", async () => {
      const interaction = {
        id: "btn_already_def",
        replied: false,
        deferred: true,
        deferUpdate: vi.fn(),
      } as unknown as RespondingInteraction;

      const success = await safeDeferUpdate(interaction);
      expect(success).toBe(true);
      expect(interaction.deferUpdate).not.toHaveBeenCalled();
    });
  });

  describe("Payload Formatters", () => {
    it("creates standardized error payload", () => {
      const payload = createErrorPayload("Invalid server identifier");
      expect(payload).toEqual({
        content: "⚠️ Invalid server identifier",
        ephemeral: true,
      });
    });

    it("creates standardized success payload", () => {
      const payload = createSuccessPayload("Server rebooted successfully");
      expect(payload).toEqual({
        content: "✅ Server rebooted successfully",
        ephemeral: false,
      });
    });

    it("creates standardized info payload", () => {
      const payload = createInfoPayload("Fetching resource metrics...", true);
      expect(payload).toEqual({
        content: "ℹ️ Fetching resource metrics...",
        ephemeral: true,
      });
    });
  });
});

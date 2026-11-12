import { describe, expect, it, vi } from "vitest";
import { interactionManager } from "../src/interactions/index.js";
import type { ButtonInteraction } from "discord.js";

describe("InteractionManager", () => {
  it("registers and routes button interactions", async () => {
    const handlerFn = vi.fn().mockResolvedValue(undefined);

    interactionManager.registerButton({
      customId: "test_btn",
      execute: handlerFn,
    });

    const mockInteraction = {
      customId: "test_btn",
    } as unknown as ButtonInteraction;

    const handled = await interactionManager.handleButton(mockInteraction);
    expect(handled).toBe(true);
    expect(handlerFn).toHaveBeenCalledWith(mockInteraction);
  });

  it("returns false for unregistered customId", async () => {
    const mockInteraction = {
      customId: "unknown_btn",
    } as unknown as ButtonInteraction;

    const handled = await interactionManager.handleButton(mockInteraction);
    expect(handled).toBe(false);
  });
});

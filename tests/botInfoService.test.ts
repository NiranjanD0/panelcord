import { describe, expect, it } from "vitest";
import { formatUptime, BotInfoService } from "../src/services/botInfoService.js";
import type { Client } from "discord.js";

describe("BotInfoService", () => {
  it("formats uptime seconds correctly", () => {
    expect(formatUptime(45)).toBe("45s");
    expect(formatUptime(125)).toBe("2m 5s");
    expect(formatUptime(3665)).toBe("1h 1m 5s");
    expect(formatUptime(90065)).toBe("1d 1h 1m 5s");
  });

  it("extracts bot info from mock client including database status", () => {
    const mockClient = {
      uptime: 60000,
      guilds: {
        cache: {
          size: 5,
        },
      },
    } as unknown as Client;

    const info = BotInfoService.getBotInfo(mockClient);
    expect(info.name).toBe("PanelCord");
    expect(info.version).toBe("0.4.1");
    expect(info.uptimeSeconds).toBe(60);
    expect(info.guildCount).toBe(5);
    expect(info.nodeVersion).toBe(process.version);
    expect(typeof info.databaseStatus).toBe("string");
  });
});

import process from "node:process";
import { version as djsVersion } from "discord.js";
import type { Client } from "discord.js";
import { APP_NAME, APP_VERSION, APP_DESCRIPTION } from "../config/constants.js";
import { isDatabaseConnected } from "../database/index.js";

export interface BotInfo {
  name: string;
  version: string;
  description: string;
  nodeVersion: string;
  discordJsVersion: string;
  uptimeSeconds: number;
  uptimeFormatted: string;
  guildCount: number;
  memoryUsageMb: number;
  databaseStatus: "Connected" | "Degraded / Offline";
}

export function formatUptime(totalSeconds: number): string {
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);

  return parts.join(" ");
}

export class BotInfoService {
  public static getBotInfo(client: Client): BotInfo {
    const uptimeSeconds = client.uptime ? client.uptime / 1000 : process.uptime();
    const memory = process.memoryUsage().rss / (1024 * 1024);

    return {
      name: APP_NAME,
      version: APP_VERSION,
      description: APP_DESCRIPTION,
      nodeVersion: process.version,
      discordJsVersion: djsVersion,
      uptimeSeconds,
      uptimeFormatted: formatUptime(uptimeSeconds),
      guildCount: client.guilds.cache.size,
      memoryUsageMb: Math.round(memory * 100) / 100,
      databaseStatus: isDatabaseConnected() ? "Connected" : "Degraded / Offline",
    };
  }
}

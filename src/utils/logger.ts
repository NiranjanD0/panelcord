import pino from "pino";
import { env } from "../config/env.js";

export const logger = pino({
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV === "development"
      ? {
          target: "pino-pretty",
          options: {
            colorize: true,
            ignore: "pid,hostname",
            translateTime: "SYS:standard",
          },
        }
      : undefined,
  redact: {
    paths: [
      "token",
      "DISCORD_TOKEN",
      "password",
      "secret",
      "authorization",
      "DATABASE_URL",
      "apiKey",
      "PANELCORD_ENCRYPTION_KEY",
      "encryptedApiKey",
      "encryptionIv",
      "encryptionAuthTag",
      "masterKey",
      "*.token",
      "*.password",
      "*.secret",
      "*.authorization",
      "*.apiKey",
      "*.*.apiKey",
      "*.encryptedApiKey",
      "*.encryptionIv",
      "*.encryptionAuthTag",
      "*.masterKey",
      "headers.Authorization",
      "headers.authorization",
      "*.headers.Authorization",
      "*.headers.authorization",
      "*.*.authorization",
    ],
    remove: false,
  },
});

export default logger;

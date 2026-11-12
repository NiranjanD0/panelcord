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
      "*.token",
      "*.password",
      "*.secret",
      "*.authorization",
    ],
    remove: false,
  },
});

export default logger;

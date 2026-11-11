import process from "node:process";
import { env } from "./config/env.js";
import { logger } from "./utils/logger.js";
import { connectDatabase, disconnectDatabase } from "./database/index.js";
import { ExtendedClient } from "./lib/client.js";
import { loadCommands } from "./lib/commandLoader.js";
import { loadEvents } from "./lib/eventLoader.js";

async function main(): Promise<void> {
  logger.info({ nodeEnv: env.NODE_ENV, logLevel: env.LOG_LEVEL }, "Starting PanelCord bot...");

  // Initialize Database Connection
  try {
    await connectDatabase();
  } catch (dbError) {
    logger.warn(
      { error: dbError },
      "Database initialization failed or skipped. Continuing bot startup...",
    );
  }

  // Initialize Discord Client
  const client = new ExtendedClient();

  // Load Commands and Events
  loadCommands(client);
  loadEvents(client);

  // Graceful Shutdown Handler
  let isShuttingDown = false;
  const handleShutdown = async (signal: string): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal }, "Graceful shutdown initiated...");

    try {
      client.destroy();
      logger.info("Discord gateway connection closed.");
    } catch (clientErr) {
      logger.error({ error: clientErr }, "Error destroying Discord client.");
    }

    try {
      await disconnectDatabase();
    } catch (dbErr) {
      logger.error({ error: dbErr }, "Error disconnecting database during shutdown.");
    }

    logger.info("PanelCord shutdown complete. Goodbye!");
    process.exit(0);
  };

  process.on("SIGINT", () => void handleShutdown("SIGINT"));
  process.on("SIGTERM", () => void handleShutdown("SIGTERM"));

  process.on("unhandledRejection", (reason: unknown) => {
    logger.error({ reason }, "Unhandled promise rejection detected.");
  });

  process.on("uncaughtException", (error: Error) => {
    logger.fatal({ error }, "Uncaught exception detected. Exiting...");
    void handleShutdown("uncaughtException");
  });

  // Login to Discord Gateway
  try {
    await client.login(env.DISCORD_TOKEN);
  } catch (error) {
    logger.fatal({ error }, "Failed to connect to Discord Gateway. Verify your DISCORD_TOKEN.");
    process.exit(1);
  }
}

main().catch((error) => {
  logger.fatal({ error }, "Fatal startup error.");
  process.exit(1);
});

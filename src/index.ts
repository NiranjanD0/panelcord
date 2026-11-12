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
      "Database initialization failed or PostgreSQL is unreachable. Bot will operate in database-degraded mode.",
    );
  }

  // Initialize Discord Client
  const client = new ExtendedClient();

  // Load Commands and Events
  loadCommands(client);
  loadEvents(client);

  // Graceful Shutdown Handler
  let isShuttingDown = false;
  const handleShutdown = async (signal: string, exitCode = 0): Promise<void> => {
    if (isShuttingDown) return;
    isShuttingDown = true;

    logger.info({ signal, exitCode }, "Graceful shutdown initiated...");

    // Force process exit if cleanup hangs
    const forceExitTimeout = setTimeout(() => {
      logger.error("Graceful shutdown timed out after 10s. Forcing exit.");
      process.exit(exitCode || 1);
    }, 10000);
    forceExitTimeout.unref();

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

    logger.info({ exitCode }, "PanelCord shutdown complete. Goodbye!");
    process.exit(exitCode);
  };

  process.on("SIGINT", () => void handleShutdown("SIGINT", 0));
  process.on("SIGTERM", () => void handleShutdown("SIGTERM", 0));

  process.on("unhandledRejection", (reason: unknown) => {
    logger.fatal(
      { reason },
      "Unhandled promise rejection detected. Initiating graceful shutdown to prevent unsafe process state...",
    );
    void handleShutdown("unhandledRejection", 1);
  });

  process.on("uncaughtException", (error: Error) => {
    logger.fatal(
      { error },
      "Uncaught exception detected. Initiating graceful shutdown to prevent unsafe process state...",
    );
    void handleShutdown("uncaughtException", 1);
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

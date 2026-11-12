import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

export class DatabaseUnavailableError extends Error {
  constructor(message = "Database is currently unavailable. Please try again later.") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
});

let isConnected = false;

export function isDatabaseConnected(): boolean {
  return isConnected;
}

export function assertDatabaseAvailable(): void {
  if (!isConnected) {
    throw new DatabaseUnavailableError();
  }
}

export async function connectDatabase(): Promise<void> {
  try {
    const client = await pool.connect();
    client.release();
    isConnected = true;
    logger.info("Database connection established successfully.");
  } catch (error) {
    isConnected = false;
    logger.error({ error }, "Failed to connect to PostgreSQL database.");
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    await pool.end();
    isConnected = false;
    logger.info("Database connection closed.");
  } catch (error) {
    isConnected = false;
    logger.error({ error }, "Error while disconnecting database.");
  }
}

export { pool };

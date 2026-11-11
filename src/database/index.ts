import pg from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/client.ts";
import { env } from "../config/env.js";
import { logger } from "../utils/logger.js";

const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
});

const adapter = new PrismaPg(pool);

export const prisma = new PrismaClient({
  adapter,
});

export async function connectDatabase(): Promise<void> {
  try {
    const client = await pool.connect();
    client.release();
    logger.info("Database connection established successfully.");
  } catch (error) {
    logger.error({ error }, "Failed to connect to PostgreSQL database.");
    throw error;
  }
}

export async function disconnectDatabase(): Promise<void> {
  try {
    await prisma.$disconnect();
    await pool.end();
    logger.info("Database connection closed.");
  } catch (error) {
    logger.error({ error }, "Error while disconnecting database.");
  }
}

export { pool };

import "dotenv/config";
import { z } from "zod";

export const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: z.string().optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  PTERODACTYL_ALLOW_PRIVATE_NETWORKS: z
    .union([z.boolean(), z.string()])
    .optional()
    .default(false)
    .transform((val) => {
      if (typeof val === "boolean") return val;
      return val.toLowerCase() === "true" || val === "1";
    }),
  PANELCORD_ENCRYPTION_KEY: z.string().optional(),
});

export type Env = z.infer<typeof envSchema>;

export function parseEnv(rawEnv: Record<string, unknown> = process.env): Env {
  const result = envSchema.safeParse(rawEnv);

  if (!result.success) {
    const formattedErrors = result.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Environment variable validation failed:\n${formattedErrors}`);
  }

  return result.data;
}

// Lazy initialization or loaded default
let cachedEnv: Env | null = null;

export function getEnv(): Env {
  if (!cachedEnv) {
    cachedEnv = parseEnv(process.env);
  }
  return cachedEnv;
}

export const env = getEnv();

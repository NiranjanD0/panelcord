import { describe, expect, it } from "vitest";
import { parseEnv } from "../src/config/env.js";

describe("Environment Validation", () => {
  const baseValidConfig = {
    DISCORD_TOKEN: "mock_test_token",
    DISCORD_CLIENT_ID: "1234567890",
    DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    NODE_ENV: "test",
    LOG_LEVEL: "debug",
  };

  it("validates valid environment configuration successfully", () => {
    const parsed = parseEnv(baseValidConfig);
    expect(parsed.DISCORD_TOKEN).toBe("mock_test_token");
    expect(parsed.NODE_ENV).toBe("test");
    expect(parsed.LOG_LEVEL).toBe("debug");
  });

  it("applies defaults for NODE_ENV, LOG_LEVEL, and PTERODACTYL_ALLOW_PRIVATE_NETWORKS", () => {
    const minimalConfig = {
      DISCORD_TOKEN: "mock_test_token",
      DISCORD_CLIENT_ID: "1234567890",
      DATABASE_URL: "postgresql://user:pass@localhost:5432/db",
    };

    const parsed = parseEnv(minimalConfig);
    expect(parsed.NODE_ENV).toBe("development");
    expect(parsed.LOG_LEVEL).toBe("info");
    expect(parsed.PTERODACTYL_ALLOW_PRIVATE_NETWORKS).toBe(false);
  });

  it("parses PTERODACTYL_ALLOW_PRIVATE_NETWORKS correctly for opt-in and deny values", () => {
    expect(
      parseEnv({
        ...baseValidConfig,
        PTERODACTYL_ALLOW_PRIVATE_NETWORKS: "true",
      }).PTERODACTYL_ALLOW_PRIVATE_NETWORKS,
    ).toBe(true);

    expect(
      parseEnv({
        ...baseValidConfig,
        PTERODACTYL_ALLOW_PRIVATE_NETWORKS: "1",
      }).PTERODACTYL_ALLOW_PRIVATE_NETWORKS,
    ).toBe(true);

    expect(
      parseEnv({
        ...baseValidConfig,
        PTERODACTYL_ALLOW_PRIVATE_NETWORKS: "false",
      }).PTERODACTYL_ALLOW_PRIVATE_NETWORKS,
    ).toBe(false);

    expect(
      parseEnv({
        ...baseValidConfig,
        PTERODACTYL_ALLOW_PRIVATE_NETWORKS: false,
      }).PTERODACTYL_ALLOW_PRIVATE_NETWORKS,
    ).toBe(false);
  });

  it("throws when required variables are missing", () => {
    const invalidConfig = {
      NODE_ENV: "development",
    };

    expect(() => parseEnv(invalidConfig)).toThrow("Environment variable validation failed");
  });

  it("throws when NODE_ENV is an invalid enum value", () => {
    const invalidConfig = {
      ...baseValidConfig,
      NODE_ENV: "invalid_env",
    };

    expect(() => parseEnv(invalidConfig)).toThrow("Environment variable validation failed");
  });

  it("throws when LOG_LEVEL is an invalid enum value", () => {
    const invalidConfig = {
      ...baseValidConfig,
      LOG_LEVEL: "invalid_level",
    };

    expect(() => parseEnv(invalidConfig)).toThrow("Environment variable validation failed");
  });

  it("throws when DISCORD_TOKEN is empty string", () => {
    const invalidConfig = {
      ...baseValidConfig,
      DISCORD_TOKEN: "",
    };

    expect(() => parseEnv(invalidConfig)).toThrow("DISCORD_TOKEN is required");
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";

// Mock pg
const mockClient = { release: vi.fn() };
const mockPool = {
  connect: vi.fn(),
  end: vi.fn().mockResolvedValue(undefined),
};

vi.mock("pg", () => {
  return {
    default: {
      Pool: vi.fn().mockImplementation(function () {
        return mockPool;
      }),
    },
  };
});

// Mock PrismaClient
const mockPrisma = {
  $disconnect: vi.fn().mockResolvedValue(undefined),
};

vi.mock("../src/database/generated/client.ts", () => {
  return {
    PrismaClient: vi.fn().mockImplementation(function () {
      return mockPrisma;
    }),
  };
});

describe("Database Lifecycle (connectDatabase & disconnectDatabase)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("connects to PostgreSQL successfully when pool.connect succeeds", async () => {
    mockPool.connect.mockResolvedValueOnce(mockClient);

    const { connectDatabase } = await import("../src/database/index.js");
    await expect(connectDatabase()).resolves.toBeUndefined();
    expect(mockPool.connect).toHaveBeenCalled();
    expect(mockClient.release).toHaveBeenCalled();
  });

  it("throws when pool.connect fails", async () => {
    const error = new Error("Connection failed");
    mockPool.connect.mockRejectedValueOnce(error);

    const { connectDatabase } = await import("../src/database/index.js");
    await expect(connectDatabase()).rejects.toThrow("Connection failed");
  });

  it("disconnects both prisma and pg pool during disconnectDatabase", async () => {
    const { disconnectDatabase } = await import("../src/database/index.js");
    await expect(disconnectDatabase()).resolves.toBeUndefined();
    expect(mockPrisma.$disconnect).toHaveBeenCalled();
    expect(mockPool.end).toHaveBeenCalled();
  });
});

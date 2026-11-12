import crypto from "node:crypto";
import { prisma as defaultPrisma } from "../../database/index.js";
import type { PrismaClient } from "../../database/generated/client.ts";
import { CredentialEncryptionService } from "./encryptionService.js";
import { PanelConnectionService } from "./connectionService.js";
import { PterodactylClient } from "./client.js";
import { validateAndNormalizePanelUrl, type UrlValidationOptions } from "./security.js";
import {
  PanelConnectionNotFoundError,
  DuplicateConnectionNameError,
  PterodactylUrlError,
  PterodactylAuthError,
  PterodactylError,
} from "./errors/index.js";
import type {
  CreatePanelConnectionInput,
  UpdatePanelConnectionInput,
  PanelConnectionMetadata,
  DecryptedPanelConnection,
} from "./types/credential.js";
import type { PanelConnectionResult, PterodactylClientConfig } from "./types/index.js";

export interface PanelCredentialServiceOptions {
  prismaClient?: PrismaClient;
  encryptionService?: CredentialEncryptionService;
  connectionService?: PanelConnectionService;
  allowPrivateNetworks?: boolean;
}

/**
 * Service managing secure, multi-tenant persistence and lifecycle for Pterodactyl
 * panel connections and Client API credentials using Prisma and AES-256-GCM.
 */
export class PanelCredentialService {
  private readonly prisma: PrismaClient;
  private readonly encryptionService: CredentialEncryptionService;
  private readonly connectionService: PanelConnectionService;
  public readonly allowPrivateNetworks: boolean;

  constructor(options?: PanelCredentialServiceOptions) {
    this.allowPrivateNetworks =
      options?.allowPrivateNetworks ??
      (process.env.PTERODACTYL_ALLOW_PRIVATE_NETWORKS === "true" ||
        process.env.PTERODACTYL_ALLOW_PRIVATE_NETWORKS === "1");

    this.prisma = options?.prismaClient ?? defaultPrisma;
    this.encryptionService = options?.encryptionService ?? new CredentialEncryptionService();
    this.connectionService =
      options?.connectionService ??
      new PanelConnectionService({ allowPrivateNetworks: this.allowPrivateNetworks });
  }

  /**
   * Creates and stores a new encrypted panel connection for a Discord guild.
   *
   * @param input Connection details including guildId, name, panelUrl, and API key
   * @returns Sanitized connection metadata (without raw or encrypted secrets)
   */
  public async createConnection(
    input: CreatePanelConnectionInput,
  ): Promise<PanelConnectionMetadata> {
    const guildId = this.validateGuildId(input.guildId);
    const name = this.validateConnectionName(input.name);
    const normalizedUrl = this.validatePanelUrl(input.panelUrl);
    const apiKey = this.validateApiKey(input.apiKey);

    // Optional verification before persisting to prevent storing broken/invalid credentials
    if (input.verifyBeforeSaving) {
      const verificationResult = await this.connectionService.verifyConnection({
        panelUrl: normalizedUrl,
        apiKey,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });

      if (!verificationResult.success) {
        throw new PterodactylError(
          `Cannot create panel connection "${name}": connection verification failed (${verificationResult.state}): ${verificationResult.message}`,
          { apiKeyToRedact: apiKey },
        );
      }
    }

    // Generate unique ID upfront to bind into contextual AAD
    const connectionId = crypto.randomUUID();
    const aad = CredentialEncryptionService.buildAad(guildId, connectionId);

    // Encrypt API key using AES-256-GCM with AAD
    const encrypted = this.encryptionService.encrypt(apiKey, aad);

    try {
      const record = await this.prisma.panelConnection.create({
        data: {
          id: connectionId,
          guildId,
          name,
          panelUrl: normalizedUrl,
          encryptedApiKey: encrypted.ciphertext,
          encryptionIv: encrypted.iv,
          encryptionAuthTag: encrypted.authTag,
          encryptionKeyVersion: encrypted.keyVersion,
        },
      });

      return this.mapToMetadata(record);
    } catch (error) {
      this.handlePrismaError(error, name, guildId);
    }
  }

  /**
   * Retrieves connection metadata for a specific guild connection without decrypting credentials.
   * Scoped strictly by both guildId and connectionId.
   */
  public async getConnection(
    guildId: string,
    connectionId: string,
  ): Promise<PanelConnectionMetadata> {
    const validGuildId = this.validateGuildId(guildId);
    const validConnectionId = this.validateConnectionId(connectionId);

    const record = await this.prisma.panelConnection.findFirst({
      where: {
        id: validConnectionId,
        guildId: validGuildId,
      },
    });

    if (!record) {
      throw new PanelConnectionNotFoundError(validConnectionId, validGuildId);
    }

    return this.mapToMetadata(record);
  }

  /**
   * Lists all stored panel connections belonging to a Discord guild.
   * Returns sanitized metadata only, never decrypting secrets.
   */
  public async listConnections(guildId: string): Promise<PanelConnectionMetadata[]> {
    const validGuildId = this.validateGuildId(guildId);

    const records = await this.prisma.panelConnection.findMany({
      where: {
        guildId: validGuildId,
      },
      orderBy: {
        createdAt: "asc",
      },
    });

    return records.map((record) => this.mapToMetadata(record));
  }

  /**
   * Explicit internal method: retrieves and decrypts the Pterodactyl API key.
   * Only authorized internal callers should invoke this method, and the returned
   * decrypted API key must be discarded immediately after use.
   */
  public async getDecryptedConnection(
    guildId: string,
    connectionId: string,
  ): Promise<DecryptedPanelConnection> {
    const validGuildId = this.validateGuildId(guildId);
    const validConnectionId = this.validateConnectionId(connectionId);

    const record = await this.prisma.panelConnection.findFirst({
      where: {
        id: validConnectionId,
        guildId: validGuildId,
      },
    });

    if (!record) {
      throw new PanelConnectionNotFoundError(validConnectionId, validGuildId);
    }

    const aad = CredentialEncryptionService.buildAad(validGuildId, validConnectionId);
    const decryptedKey = this.encryptionService.decrypt(
      {
        ciphertext: record.encryptedApiKey,
        iv: record.encryptionIv,
        authTag: record.encryptionAuthTag,
        keyVersion: record.encryptionKeyVersion,
      },
      aad,
    );

    return {
      connection: this.mapToMetadata(record),
      apiKey: decryptedKey,
    };
  }

  /**
   * Updates an existing panel connection. If a new API key is provided, it is
   * re-encrypted with a fresh random IV and contextual AAD.
   */
  public async updateConnection(
    guildId: string,
    connectionId: string,
    input: UpdatePanelConnectionInput,
  ): Promise<PanelConnectionMetadata> {
    const validGuildId = this.validateGuildId(guildId);
    const validConnectionId = this.validateConnectionId(connectionId);

    // Verify existing connection ownership
    const existing = await this.prisma.panelConnection.findFirst({
      where: {
        id: validConnectionId,
        guildId: validGuildId,
      },
    });

    if (!existing) {
      throw new PanelConnectionNotFoundError(validConnectionId, validGuildId);
    }

    const newName = input.name ? this.validateConnectionName(input.name) : undefined;
    const newUrl = input.panelUrl ? this.validatePanelUrl(input.panelUrl) : undefined;
    const newApiKey = input.apiKey ? this.validateApiKey(input.apiKey) : undefined;

    // Optional verification of updated credentials/URL
    if (input.verifyBeforeSaving) {
      let testKey = newApiKey;
      if (!testKey) {
        const decrypted = await this.getDecryptedConnection(validGuildId, validConnectionId);
        testKey = decrypted.apiKey;
      }

      const verificationResult = await this.connectionService.verifyConnection({
        panelUrl: newUrl ?? existing.panelUrl,
        apiKey: testKey,
        timeoutMs: input.timeoutMs,
        signal: input.signal,
      });

      if (!verificationResult.success) {
        throw new PterodactylError(
          `Cannot update panel connection: verification failed (${verificationResult.state}): ${verificationResult.message}`,
          { apiKeyToRedact: testKey },
        );
      }
    }

    const dataToUpdate: Record<string, unknown> = {};
    if (newName) dataToUpdate["name"] = newName;
    if (newUrl) dataToUpdate["panelUrl"] = newUrl;

    if (newApiKey) {
      const aad = CredentialEncryptionService.buildAad(validGuildId, validConnectionId);
      const encrypted = this.encryptionService.encrypt(newApiKey, aad);
      dataToUpdate["encryptedApiKey"] = encrypted.ciphertext;
      dataToUpdate["encryptionIv"] = encrypted.iv;
      dataToUpdate["encryptionAuthTag"] = encrypted.authTag;
      dataToUpdate["encryptionKeyVersion"] = encrypted.keyVersion;
    }

    try {
      const updated = await this.prisma.panelConnection.update({
        where: {
          id: validConnectionId,
        },
        data: dataToUpdate,
      });

      return this.mapToMetadata(updated);
    } catch (error) {
      this.handlePrismaError(error, newName ?? existing.name, validGuildId);
    }
  }

  /**
   * Deletes a panel connection, strictly verified by guildId.
   */
  public async deleteConnection(guildId: string, connectionId: string): Promise<void> {
    const validGuildId = this.validateGuildId(guildId);
    const validConnectionId = this.validateConnectionId(connectionId);

    const existing = await this.prisma.panelConnection.findFirst({
      where: {
        id: validConnectionId,
        guildId: validGuildId,
      },
    });

    if (!existing) {
      throw new PanelConnectionNotFoundError(validConnectionId, validGuildId);
    }

    await this.prisma.panelConnection.delete({
      where: {
        id: validConnectionId,
      },
    });
  }

  /**
   * Verifies an existing stored connection against the Pterodactyl API.
   * Decrypts the API key strictly for the execution scope of the test and
   * discards it immediately without long-lived caching.
   */
  public async verifyStoredConnection(
    guildId: string,
    connectionId: string,
    options?: { timeoutMs?: number; signal?: AbortSignal },
  ): Promise<PanelConnectionResult> {
    const { connection, apiKey } = await this.getDecryptedConnection(guildId, connectionId);

    try {
      return await this.connectionService.verifyConnection({
        panelUrl: connection.panelUrl,
        apiKey,
        timeoutMs: options?.timeoutMs,
        signal: options?.signal,
      });
    } finally {
      // apiKey goes out of scope and is eligible for garbage collection
    }
  }

  /**
   * Factory method: creates an authenticated PterodactylClient instance for a stored connection.
   */
  public async createClientForConnection(
    guildId: string,
    connectionId: string,
    options?: Partial<PterodactylClientConfig>,
  ): Promise<PterodactylClient> {
    const { connection, apiKey } = await this.getDecryptedConnection(guildId, connectionId);

    return new PterodactylClient({
      baseUrl: connection.panelUrl,
      apiKey,
      allowPrivateNetworks: this.allowPrivateNetworks,
      timeoutMs: options?.timeoutMs,
      retry: options?.retry,
      concurrency: options?.concurrency,
      concurrencyManager: options?.concurrencyManager,
    });
  }

  /**
   * Executes an operation with an authenticated Pterodactyl client scoped to the connection,
   * ensuring decrypted credentials remain strictly within the operational boundary.
   */
  public async executeWithClient<T>(
    guildId: string,
    connectionId: string,
    fn: (client: PterodactylClient) => Promise<T>,
    options?: Partial<PterodactylClientConfig>,
  ): Promise<T> {
    const client = await this.createClientForConnection(guildId, connectionId, options);
    return fn(client);
  }

  private validateGuildId(guildId: unknown): string {
    if (!guildId || typeof guildId !== "string" || guildId.trim().length === 0) {
      throw new PterodactylError("guildId is required and must be a non-empty string.");
    }
    return guildId.trim();
  }

  private validateConnectionId(connectionId: unknown): string {
    if (!connectionId || typeof connectionId !== "string" || connectionId.trim().length === 0) {
      throw new PterodactylError("connectionId is required and must be a non-empty string.");
    }
    return connectionId.trim();
  }

  private validateConnectionName(name: unknown): string {
    if (!name || typeof name !== "string" || name.trim().length === 0) {
      throw new PterodactylError("Connection name is required and cannot be empty.");
    }
    const trimmed = name.trim();
    if (trimmed.length > 100) {
      throw new PterodactylError("Connection name cannot exceed 100 characters.");
    }
    return trimmed;
  }

  private validatePanelUrl(rawUrl: unknown): string {
    if (!rawUrl || typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
      throw new PterodactylUrlError("Panel URL is required and cannot be empty.");
    }
    const validationOptions: UrlValidationOptions = {
      allowPrivateNetworks: this.allowPrivateNetworks,
    };
    const url = validateAndNormalizePanelUrl(rawUrl, validationOptions);
    return url.origin + (url.pathname === "/" ? "" : url.pathname);
  }

  private validateApiKey(apiKey: unknown): string {
    if (!apiKey || typeof apiKey !== "string" || apiKey.trim().length === 0) {
      throw new PterodactylAuthError("API key is required and cannot be empty.");
    }
    return apiKey.trim();
  }

  private mapToMetadata(record: {
    id: string;
    guildId: string;
    name: string;
    panelUrl: string;
    createdAt: Date;
    updatedAt: Date;
  }): PanelConnectionMetadata {
    return {
      id: record.id,
      guildId: record.guildId,
      name: record.name,
      panelUrl: record.panelUrl,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
  }

  private handlePrismaError(error: unknown, name: string, guildId: string): never {
    // Prisma unique constraint code P2002
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      (error as { code: string }).code === "P2002"
    ) {
      throw new DuplicateConnectionNameError(name, guildId);
    }
    if (error instanceof PterodactylError) {
      throw error;
    }
    throw new PterodactylError(
      `Database operation failed: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
}

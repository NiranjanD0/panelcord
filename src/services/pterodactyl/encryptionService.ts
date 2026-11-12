import crypto from "node:crypto";
import {
  PterodactylEncryptionConfigError,
  PterodactylEncryptionError,
  PterodactylDecryptionError,
  PterodactylUnsupportedKeyVersionError,
} from "./errors/index.js";
import type { EncryptedCredentialData } from "./types/credential.js";

export const CURRENT_ENCRYPTION_KEY_VERSION = 1;
export const AES_GCM_ALGORITHM = "aes-256-gcm";
export const GCM_IV_LENGTH_BYTES = 12; // 96-bit IV recommended by NIST SP 800-38D
export const GCM_AUTH_TAG_LENGTH_BYTES = 16; // 128-bit authentication tag
export const MASTER_KEY_LENGTH_BYTES = 32; // 256-bit AES key

export interface EncryptionServiceOptions {
  /**
   * 32-byte master key as a 64-character hexadecimal string, 32-character utf8 string,
   * or 32-byte Buffer. If omitted, defaults to process.env.PANELCORD_ENCRYPTION_KEY.
   */
  masterKey?: string | Buffer;
}

/**
 * Dedicated encryption service using AES-256-GCM authenticated encryption.
 * Encrypts sensitive Pterodactyl API tokens at rest with unique 12-byte IVs,
 * 16-byte authentication tags, key versioning, and contextual AAD binding.
 */
export class CredentialEncryptionService {
  private readonly masterKey: Buffer;

  constructor(options?: EncryptionServiceOptions) {
    const rawKey = options?.masterKey ?? process.env.PANELCORD_ENCRYPTION_KEY;
    this.masterKey = CredentialEncryptionService.validateAndNormalizeKey(rawKey);
  }

  /**
   * Constructs contextual Additional Authenticated Data (AAD) binding ciphertext
   * to a specific guild and panel connection record. Prevents ciphertext swapping
   * across guilds or between connection rows without detection.
   *
   * Format: "panelcord:aad:v1:<guildId>:<connectionId>"
   */
  public static buildAad(guildId: string, connectionId: string): string {
    if (!guildId || typeof guildId !== "string" || guildId.trim().length === 0) {
      throw new PterodactylEncryptionError("Cannot construct AAD: guildId is required.");
    }
    if (!connectionId || typeof connectionId !== "string" || connectionId.trim().length === 0) {
      throw new PterodactylEncryptionError("Cannot construct AAD: connectionId is required.");
    }
    return `panelcord:aad:v1:${guildId.trim()}:${connectionId.trim()}`;
  }

  /**
   * Validates and parses the 32-byte master encryption key.
   * Accepts 64-character hex strings, 32-byte Buffers, or 32-byte UTF-8 strings.
   * Fails closed if the key is missing, empty, or not exactly 32 bytes.
   */
  public static validateAndNormalizeKey(rawKey?: string | Buffer | null): Buffer {
    if (!rawKey) {
      throw new PterodactylEncryptionConfigError(
        "Master encryption key is not configured. Set the PANELCORD_ENCRYPTION_KEY environment variable (e.g. openssl rand -hex 32).",
      );
    }

    let keyBuffer: Buffer;
    if (Buffer.isBuffer(rawKey)) {
      keyBuffer = rawKey;
    } else if (typeof rawKey === "string") {
      const trimmed = rawKey.trim();
      if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
        keyBuffer = Buffer.from(trimmed, "hex");
      } else if (trimmed.length === MASTER_KEY_LENGTH_BYTES) {
        keyBuffer = Buffer.from(trimmed, "utf8");
      } else {
        // Attempt base64 decoding if 44 characters ending with =
        const b64Buf = Buffer.from(trimmed, "base64");
        if (b64Buf.length === MASTER_KEY_LENGTH_BYTES) {
          keyBuffer = b64Buf;
        } else {
          throw new PterodactylEncryptionConfigError(
            `Invalid PANELCORD_ENCRYPTION_KEY format: expected a 64-character hex string (32 bytes), but received length ${trimmed.length}.`,
          );
        }
      }
    } else {
      throw new PterodactylEncryptionConfigError(
        "Invalid PANELCORD_ENCRYPTION_KEY type: expected a string or Buffer.",
      );
    }

    if (keyBuffer.length !== MASTER_KEY_LENGTH_BYTES) {
      throw new PterodactylEncryptionConfigError(
        `Invalid PANELCORD_ENCRYPTION_KEY length: master key must be exactly ${MASTER_KEY_LENGTH_BYTES} bytes, received ${keyBuffer.length} bytes.`,
      );
    }

    return keyBuffer;
  }

  /**
   * Encrypts plaintext using AES-256-GCM with a newly generated, cryptographically secure 12-byte IV.
   *
   * @param plaintext Sensitive data to encrypt (e.g. Pterodactyl API Key)
   * @param aad Contextual Additional Authenticated Data string (e.g. guild:connection binding)
   * @returns Base64-encoded ciphertext, IV, authentication tag, and key version
   */
  public encrypt(plaintext: string, aad?: string): EncryptedCredentialData {
    if (typeof plaintext !== "string" || plaintext.length === 0) {
      throw new PterodactylEncryptionError("Plaintext must be a non-empty string.");
    }

    try {
      // 1. Generate unique 12-byte IV for every encryption call
      const iv = crypto.randomBytes(GCM_IV_LENGTH_BYTES);

      // 2. Initialize AES-256-GCM cipher
      const cipher = crypto.createCipheriv(AES_GCM_ALGORITHM, this.masterKey, iv, {
        authTagLength: GCM_AUTH_TAG_LENGTH_BYTES,
      });

      // 3. Attach AAD if provided
      if (aad) {
        cipher.setAAD(Buffer.from(aad, "utf8"));
      }

      // 4. Encrypt plaintext
      const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);

      // 5. Retrieve 16-byte authentication tag
      const authTag = cipher.getAuthTag();

      return {
        ciphertext: ciphertext.toString("base64"),
        iv: iv.toString("base64"),
        authTag: authTag.toString("base64"),
        keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
      };
    } catch (error) {
      throw new PterodactylEncryptionError("Failed to encrypt credentials.", {
        apiKeyToRedact: plaintext,
        cause: error,
      });
    }
  }

  /**
   * Decrypts ciphertext and verifies the GCM authentication tag and AAD.
   * Fails closed if the key, ciphertext, auth tag, or AAD do not match.
   *
   * @param encrypted Container holding ciphertext, IV, authTag, and keyVersion
   * @param aad Expected Additional Authenticated Data bound during encryption
   * @returns Decrypted plaintext string
   */
  public decrypt(encrypted: EncryptedCredentialData, aad?: string): string {
    if (!encrypted) {
      throw new PterodactylDecryptionError("Encrypted data container is missing.");
    }

    if (encrypted.keyVersion !== CURRENT_ENCRYPTION_KEY_VERSION) {
      throw new PterodactylUnsupportedKeyVersionError(encrypted.keyVersion);
    }

    try {
      const iv = Buffer.from(encrypted.iv, "base64");
      const authTag = Buffer.from(encrypted.authTag, "base64");
      const ciphertext = Buffer.from(encrypted.ciphertext, "base64");

      if (iv.length !== GCM_IV_LENGTH_BYTES) {
        throw new PterodactylDecryptionError(
          `Invalid IV length: expected ${GCM_IV_LENGTH_BYTES} bytes, received ${iv.length}.`,
        );
      }
      if (authTag.length !== GCM_AUTH_TAG_LENGTH_BYTES) {
        throw new PterodactylDecryptionError(
          `Invalid authentication tag length: expected ${GCM_AUTH_TAG_LENGTH_BYTES} bytes, received ${authTag.length}.`,
        );
      }

      const decipher = crypto.createDecipheriv(AES_GCM_ALGORITHM, this.masterKey, iv, {
        authTagLength: GCM_AUTH_TAG_LENGTH_BYTES,
      });

      decipher.setAuthTag(authTag);

      if (aad) {
        decipher.setAAD(Buffer.from(aad, "utf8"));
      }

      const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

      return decrypted.toString("utf8");
    } catch (error) {
      if (error instanceof PterodactylUnsupportedKeyVersionError) {
        throw error;
      }
      throw new PterodactylDecryptionError(
        "Failed to decrypt credentials: authentication tag mismatch or corrupted ciphertext.",
        { cause: error },
      );
    }
  }

  /**
   * Sanitized JSON serialization that masks the raw master encryption key.
   */
  public toJSON(): Record<string, unknown> {
    return {
      algorithm: AES_GCM_ALGORITHM,
      keyVersion: CURRENT_ENCRYPTION_KEY_VERSION,
    };
  }

  /**
   * Sanitized custom Node.js inspect representation that prevents master key leaks in logs.
   */
  public [Symbol.for("nodejs.util.inspect.custom")](): Record<string, unknown> {
    return this.toJSON();
  }
}

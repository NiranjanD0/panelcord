import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  CredentialEncryptionService,
  CURRENT_ENCRYPTION_KEY_VERSION,
  GCM_IV_LENGTH_BYTES,
  GCM_AUTH_TAG_LENGTH_BYTES,
} from "../../src/services/pterodactyl/encryptionService.js";
import {
  PterodactylEncryptionConfigError,
  PterodactylEncryptionError,
  PterodactylDecryptionError,
  PterodactylUnsupportedKeyVersionError,
} from "../../src/services/pterodactyl/errors/index.js";

describe("CredentialEncryptionService (AES-256-GCM)", () => {
  // 32-byte hexadecimal test key
  const VALID_HEX_KEY = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
  const SECOND_VALID_HEX_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";
  const TEST_API_KEY = "ptlc_secret_client_token_abc123xyz";
  const TEST_GUILD_ID = "guild_123456789012345678";
  const TEST_CONN_ID = "conn_abcdef12-3456-7890-abcd-ef1234567890";

  describe("Master Key Validation & Configuration", () => {
    it("accepts a valid 64-character hex key string", () => {
      const service = new CredentialEncryptionService({ masterKey: VALID_HEX_KEY });
      expect(service).toBeInstanceOf(CredentialEncryptionService);
    });

    it("accepts a valid 32-byte Buffer", () => {
      const bufferKey = crypto.randomBytes(32);
      const service = new CredentialEncryptionService({ masterKey: bufferKey });
      expect(service).toBeInstanceOf(CredentialEncryptionService);
    });

    it("throws PterodactylEncryptionConfigError if master key is missing or empty", () => {
      expect(() => new CredentialEncryptionService({ masterKey: "" })).toThrow(
        PterodactylEncryptionConfigError,
      );
      expect(
        () => new CredentialEncryptionService({ masterKey: null as unknown as string }),
      ).toThrow(PterodactylEncryptionConfigError);
      expect(
        () => new CredentialEncryptionService({ masterKey: undefined as unknown as string }),
      ).toThrow(PterodactylEncryptionConfigError);
    });

    it("throws PterodactylEncryptionConfigError for invalid key length or format", () => {
      // 31 bytes (62 hex chars)
      expect(
        () =>
          new CredentialEncryptionService({
            masterKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcd",
          }),
      ).toThrow(PterodactylEncryptionConfigError);

      // 33 bytes (66 hex chars)
      expect(
        () =>
          new CredentialEncryptionService({
            masterKey: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef0011",
          }),
      ).toThrow(PterodactylEncryptionConfigError);

      // Short buffer (16 bytes)
      expect(() => new CredentialEncryptionService({ masterKey: crypto.randomBytes(16) })).toThrow(
        PterodactylEncryptionConfigError,
      );
    });
  });

  describe("Encryption & Decryption Round-trip", () => {
    const service = new CredentialEncryptionService({ masterKey: VALID_HEX_KEY });

    it("successfully encrypts and decrypts without AAD", () => {
      const encrypted = service.encrypt(TEST_API_KEY);

      expect(encrypted.ciphertext).toBeDefined();
      expect(encrypted.iv).toBeDefined();
      expect(encrypted.authTag).toBeDefined();
      expect(encrypted.keyVersion).toBe(CURRENT_ENCRYPTION_KEY_VERSION);

      // Ensure ciphertext is not plaintext
      expect(encrypted.ciphertext).not.toContain(TEST_API_KEY);

      // Decrypt
      const decrypted = service.decrypt(encrypted);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("successfully encrypts and decrypts with contextual AAD binding", () => {
      const aad = CredentialEncryptionService.buildAad(TEST_GUILD_ID, TEST_CONN_ID);
      expect(aad).toBe(`panelcord:aad:v1:${TEST_GUILD_ID}:${TEST_CONN_ID}`);

      const encrypted = service.encrypt(TEST_API_KEY, aad);
      const decrypted = service.decrypt(encrypted, aad);
      expect(decrypted).toBe(TEST_API_KEY);
    });

    it("generates a unique cryptographically secure 12-byte IV on every encryption call", () => {
      const enc1 = service.encrypt(TEST_API_KEY);
      const enc2 = service.encrypt(TEST_API_KEY);

      // IVs must never be reused
      expect(enc1.iv).not.toBe(enc2.iv);
      expect(enc1.ciphertext).not.toBe(enc2.ciphertext);
      expect(enc1.authTag).not.toBe(enc2.authTag);

      const iv1Buf = Buffer.from(enc1.iv, "base64");
      const iv2Buf = Buffer.from(enc2.iv, "base64");
      expect(iv1Buf.length).toBe(GCM_IV_LENGTH_BYTES);
      expect(iv2Buf.length).toBe(GCM_IV_LENGTH_BYTES);
    });

    it("produces a 16-byte authentication tag", () => {
      const encrypted = service.encrypt(TEST_API_KEY);
      const authTagBuf = Buffer.from(encrypted.authTag, "base64");
      expect(authTagBuf.length).toBe(GCM_AUTH_TAG_LENGTH_BYTES);
    });

    it("rejects encryption of empty plaintext", () => {
      expect(() => service.encrypt("")).toThrow(PterodactylEncryptionError);
    });
  });

  describe("Security, Tamper & Authentication Verification", () => {
    const service = new CredentialEncryptionService({ masterKey: VALID_HEX_KEY });
    const aad = CredentialEncryptionService.buildAad(TEST_GUILD_ID, TEST_CONN_ID);

    it("fails decryption when attempted with the wrong encryption key", () => {
      const otherService = new CredentialEncryptionService({ masterKey: SECOND_VALID_HEX_KEY });
      const encrypted = service.encrypt(TEST_API_KEY, aad);

      expect(() => otherService.decrypt(encrypted, aad)).toThrow(PterodactylDecryptionError);
    });

    it("fails decryption when ciphertext has been modified or tampered with", () => {
      const encrypted = service.encrypt(TEST_API_KEY, aad);

      // Modify ciphertext byte
      const rawCipher = Buffer.from(encrypted.ciphertext, "base64");
      rawCipher[0] = rawCipher[0]! ^ 0x01; // flip bit
      const tampered = { ...encrypted, ciphertext: rawCipher.toString("base64") };

      expect(() => service.decrypt(tampered, aad)).toThrow(PterodactylDecryptionError);
    });

    it("fails decryption when authentication tag has been modified", () => {
      const encrypted = service.encrypt(TEST_API_KEY, aad);

      // Modify auth tag byte
      const rawTag = Buffer.from(encrypted.authTag, "base64");
      rawTag[0] = rawTag[0]! ^ 0xff;
      const tampered = { ...encrypted, authTag: rawTag.toString("base64") };

      expect(() => service.decrypt(tampered, aad)).toThrow(PterodactylDecryptionError);
    });

    it("fails decryption when AAD does not match (cross-guild / cross-record tampering)", () => {
      const encrypted = service.encrypt(TEST_API_KEY, aad);

      // Mismatched guild in AAD
      const wrongGuildAad = CredentialEncryptionService.buildAad(
        "other_guild_999999",
        TEST_CONN_ID,
      );
      expect(() => service.decrypt(encrypted, wrongGuildAad)).toThrow(PterodactylDecryptionError);

      // Mismatched connectionId in AAD
      const wrongConnAad = CredentialEncryptionService.buildAad(TEST_GUILD_ID, "other_conn_8888");
      expect(() => service.decrypt(encrypted, wrongConnAad)).toThrow(PterodactylDecryptionError);

      // Missing AAD during decryption when encrypted with AAD
      expect(() => service.decrypt(encrypted)).toThrow(PterodactylDecryptionError);
    });

    it("fails decryption when IV length is invalid", () => {
      const encrypted = service.encrypt(TEST_API_KEY, aad);
      const badIv = { ...encrypted, iv: Buffer.from("short").toString("base64") };
      expect(() => service.decrypt(badIv, aad)).toThrow(PterodactylDecryptionError);
    });

    it("fails decryption when auth tag length is invalid", () => {
      const encrypted = service.encrypt(TEST_API_KEY, aad);
      const badTag = { ...encrypted, authTag: Buffer.from("short").toString("base64") };
      expect(() => service.decrypt(badTag, aad)).toThrow(PterodactylDecryptionError);
    });

    it("throws PterodactylUnsupportedKeyVersionError for unknown key versions", () => {
      const encrypted = service.encrypt(TEST_API_KEY, aad);
      const futureVersion = { ...encrypted, keyVersion: 99 };

      expect(() => service.decrypt(futureVersion, aad)).toThrow(
        PterodactylUnsupportedKeyVersionError,
      );
    });

    it("redacts API keys from error messages if encryption fails", () => {
      const secret = "ptlc_super_sensitive_api_token_123456";
      const err = new PterodactylEncryptionError("Failed with secret " + secret, {
        apiKeyToRedact: secret,
      });

      expect(err.message).not.toContain(secret);
      expect(err.message).toContain("[REDACTED]");
    });
  });

  describe("AAD Builder Validation", () => {
    it("rejects empty guildId or connectionId", () => {
      expect(() => CredentialEncryptionService.buildAad("", TEST_CONN_ID)).toThrow(
        PterodactylEncryptionError,
      );
      expect(() => CredentialEncryptionService.buildAad(TEST_GUILD_ID, "")).toThrow(
        PterodactylEncryptionError,
      );
    });
  });
});

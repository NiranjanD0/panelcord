/**
 * Internal container for AES-256-GCM encrypted credential fields.
 */
export interface EncryptedCredentialData {
  ciphertext: string;
  iv: string;
  authTag: string;
  keyVersion: number;
}

/**
 * Public metadata for a stored panel connection.
 * Explicitly excludes all raw and encrypted credential secrets.
 */
export interface PanelConnectionMetadata {
  id: string;
  guildId: string;
  name: string;
  panelUrl: string;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Input parameters for creating a new panel connection.
 */
export interface CreatePanelConnectionInput {
  guildId: string;
  name: string;
  panelUrl: string;
  apiKey: string;
  /**
   * If true, tests connectivity with the panel using the provided API key before
   * saving to the database. If verification fails, the connection is not created.
   * Default: false (saves without testing).
   */
  verifyBeforeSaving?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Input parameters for updating an existing panel connection.
 */
export interface UpdatePanelConnectionInput {
  name?: string;
  panelUrl?: string;
  apiKey?: string;
  verifyBeforeSaving?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Decrypted connection container returned exclusively by authorized internal methods.
 */
export interface DecryptedPanelConnection {
  connection: PanelConnectionMetadata;
  apiKey: string;
}

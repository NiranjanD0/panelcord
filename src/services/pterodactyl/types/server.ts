export interface PterodactylServerLimits {
  memory: number;
  swap?: number;
  disk: number;
  io?: number;
  cpu: number;
  threads?: string | null;
  oom_disabled?: boolean;
}

export interface PterodactylServerFeatureLimits {
  databases: number;
  allocations: number;
  backups: number;
}

export interface PterodactylServerSftpDetails {
  ip: string;
  port: number;
}

export interface PterodactylServerAttributes {
  server_owner: boolean;
  identifier: string;
  uuid: string;
  name: string;
  node: string;
  sftp_details?: PterodactylServerSftpDetails;
  description?: string | null;
  limits: PterodactylServerLimits;
  feature_limits: PterodactylServerFeatureLimits;
  is_suspended?: boolean;
  is_installing?: boolean;
  is_transferring?: boolean;
  invocation?: string;
  docker_image?: string;
  egg_features?: string[] | null;
  status?: string | null;
  permissions?: string[];
  relationships?: Record<string, unknown>;
}

export interface NormalizedServerLimits {
  memory: number;
  swap: number;
  disk: number;
  io: number;
  cpu: number;
  threads: string | null;
}

export interface NormalizedServerFeatureLimits {
  databases: number;
  allocations: number;
  backups: number;
}

export interface NormalizedServerSftp {
  ip: string;
  port: number;
}

export interface NormalizedServer {
  identifier: string;
  uuid: string;
  name: string;
  description: string | null;
  node: string;
  isOwner: boolean;
  permissions: string[];
  sftp: NormalizedServerSftp | null;
  limits: NormalizedServerLimits;
  featureLimits: NormalizedServerFeatureLimits;
  isSuspended: boolean;
  isInstalling: boolean;
  isTransferring: boolean;
  relationships?: Record<string, unknown>;
}

export interface GetServersParams {
  page?: number;
  perPage?: number;
}

export interface ServerDiscoveryOptions {
  /**
   * Only fetch the specified page and stop (no automatic following of next pages).
   * Default: false
   */
  singlePageOnly?: boolean;

  /**
   * Initial page number to request.
   * Default: 1
   */
  page?: number;

  /**
   * Number of servers per page to request from Pterodactyl.
   * Default: 50
   */
  perPage?: number;

  /**
   * Maximum number of pages to follow during multi-page pagination.
   * Prevents runaway or infinite loops on compromised/misconfigured panels.
   * Default: 50
   */
  maxPages?: number;
}

export interface ServerDiscoveryResult {
  success: boolean;
  servers: NormalizedServer[];
  totalServers: number;
  pagesFetched: number;
  totalPages: number;
  truncated: boolean;
  message?: string;
}

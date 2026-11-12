import type { PterodactylClient } from "./client.js";
import type {
  NormalizedServer,
  NormalizedServerLimits,
  NormalizedServerResources,
  NormalizedServerDetails,
  GetServerWithResourcesOptions,
  PterodactylResourceStatsAttributes,
} from "./types/index.js";
import { safeNonNegativeNumber } from "./types/resources.js";
import { normalizeServer } from "./serverDiscoveryService.js";
import { PterodactylServerError } from "./errors/index.js";

/**
 * Normalizes raw Pterodactyl resource utilization stats into a clean, strongly typed model.
 * If server limits are provided, correlates memory, disk, and CPU limits into bytes and flags.
 */
export function normalizeServerResources(
  raw: PterodactylResourceStatsAttributes,
  limits?: NormalizedServerLimits,
): NormalizedServerResources {
  const currentState = (raw.current_state || "offline").trim().toLowerCase();
  const isSuspended = Boolean(raw.is_suspended);

  const memoryBytes = safeNonNegativeNumber(raw.resources.memory_bytes, 0);
  const cpuPercentage = safeNonNegativeNumber(raw.resources.cpu_absolute, 0);
  const diskBytes = safeNonNegativeNumber(raw.resources.disk_bytes, 0);
  const networkRxBytes = safeNonNegativeNumber(raw.resources.network_rx_bytes, 0);
  const networkTxBytes = safeNonNegativeNumber(raw.resources.network_tx_bytes, 0);
  const uptimeMs = safeNonNegativeNumber(raw.resources.uptime, 0);

  let memoryLimitBytes: number | null = null;
  let isMemoryUnlimited = false;
  if (limits !== undefined) {
    if (limits.memory === 0) {
      memoryLimitBytes = 0;
      isMemoryUnlimited = true;
    } else {
      memoryLimitBytes = limits.memory * 1024 * 1024;
      isMemoryUnlimited = false;
    }
  }

  let diskLimitBytes: number | null = null;
  let isDiskUnlimited = false;
  if (limits !== undefined) {
    if (limits.disk === 0) {
      diskLimitBytes = 0;
      isDiskUnlimited = true;
    } else {
      diskLimitBytes = limits.disk * 1024 * 1024;
      isDiskUnlimited = false;
    }
  }

  const isCpuUnlimited = limits !== undefined ? limits.cpu === 0 : false;

  return {
    currentState,
    isSuspended,
    memoryBytes,
    cpuPercentage,
    diskBytes,
    networkRxBytes,
    networkTxBytes,
    uptimeMs,
    memoryLimitBytes,
    diskLimitBytes,
    isMemoryUnlimited,
    isDiskUnlimited,
    isCpuUnlimited,
  };
}

export class ServerDetailService {
  constructor(private readonly client: PterodactylClient) {}

  /**
   * Retrieves and normalizes server details for the given identifier.
   *
   * @param identifier Server short UUID or full UUID
   */
  public async getServerDetails(identifier: string): Promise<NormalizedServer> {
    const response = await this.client.servers.getServer(identifier);
    const meta = response.meta as
      { is_server_owner?: boolean; user_permissions?: string[] } | undefined;
    return normalizeServer(response.attributes, meta);
  }

  /**
   * Retrieves and normalizes live resource utilization for the given identifier.
   *
   * @param identifier Server short UUID or full UUID
   * @param serverLimits Optional server limits to correlate memory and disk limits
   */
  public async getServerResources(
    identifier: string,
    serverLimits?: NormalizedServerLimits,
  ): Promise<NormalizedServerResources> {
    const response = await this.client.servers.getServerResources(identifier);
    return normalizeServerResources(response.attributes, serverLimits);
  }

  /**
   * Retrieves server details and live resource utilization combined into a single result.
   * Clearly separates static metadata from dynamic resource metrics and handles
   * suspended, installing, or daemon-unavailable scenarios.
   *
   * @param identifier Server short UUID or full UUID
   * @param options Configuration for resource error handling
   */
  public async getServerWithResources(
    identifier: string,
    options?: GetServerWithResourcesOptions,
  ): Promise<NormalizedServerDetails> {
    const server = await this.getServerDetails(identifier);

    let resources: NormalizedServerResources | null = null;
    let resourcesUnavailableReason: string | null = null;

    try {
      resources = await this.getServerResources(identifier, server.limits);
    } catch (error) {
      if (options?.throwOnResourceError) {
        throw error;
      }

      if (server.isSuspended) {
        resourcesUnavailableReason = "suspended";
      } else if (server.isInstalling) {
        resourcesUnavailableReason = "installing";
      } else if (server.isTransferring) {
        resourcesUnavailableReason = "transferring";
      } else if (error instanceof PterodactylServerError) {
        resourcesUnavailableReason = "daemon_unavailable";
      } else {
        resourcesUnavailableReason = error instanceof Error ? error.message : "unavailable";
      }
    }

    return {
      server,
      resources,
      resourcesUnavailableReason,
    };
  }

  /**
   * Convenience static method to retrieve server details.
   */
  public static async getServerDetails(
    client: PterodactylClient,
    identifier: string,
  ): Promise<NormalizedServer> {
    const service = new ServerDetailService(client);
    return service.getServerDetails(identifier);
  }

  /**
   * Convenience static method to retrieve server resource statistics.
   */
  public static async getServerResources(
    client: PterodactylClient,
    identifier: string,
    serverLimits?: NormalizedServerLimits,
  ): Promise<NormalizedServerResources> {
    const service = new ServerDetailService(client);
    return service.getServerResources(identifier, serverLimits);
  }

  /**
   * Convenience static method to retrieve combined server details and resources.
   */
  public static async getServerWithResources(
    client: PterodactylClient,
    identifier: string,
    options?: GetServerWithResourcesOptions,
  ): Promise<NormalizedServerDetails> {
    const service = new ServerDetailService(client);
    return service.getServerWithResources(identifier, options);
  }
}

import type { PterodactylClient } from "./client.js";
import type {
  NormalizedServer,
  NormalizedServerSftp,
  PterodactylServerAttributes,
  ServerDiscoveryOptions,
  ServerDiscoveryResult,
  PterodactylFractalItem,
} from "./types/index.js";
import { PterodactylUrlError } from "./errors/index.js";
import { isBlockedHost } from "./security.js";
import { validateServerItem } from "./endpoints/servers.js";

export { validateServerItem };

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_MAX_PAGES = 50;

/**
 * Normalizes a raw Pterodactyl server attribute payload into a strongly typed,
 * clean data model. Critical fields (isOwner, limits, featureLimits) must be present
 * and validated before calling this function; missing critical fields are never
 * silently turned into misleading defaults.
 */
export function normalizeServer(
  raw: PterodactylServerAttributes,
  meta?: { is_server_owner?: boolean; user_permissions?: string[] },
): NormalizedServer {
  let sftp: NormalizedServerSftp | null = null;
  if (
    raw.sftp_details &&
    typeof raw.sftp_details.ip === "string" &&
    raw.sftp_details.ip.trim().length > 0 &&
    typeof raw.sftp_details.port === "number" &&
    !isNaN(raw.sftp_details.port)
  ) {
    sftp = {
      ip: raw.sftp_details.ip.trim(),
      port: raw.sftp_details.port,
    };
  }

  // Strict ownership verification:
  // Ownership must be explicitly verified as boolean true by the API response.
  const isOwner =
    typeof meta?.is_server_owner === "boolean"
      ? meta.is_server_owner === true
      : raw.server_owner === true;

  // Permissions in Pterodactyl:
  // Server owners have implicit full access to all server capabilities.
  // Subusers receive explicit permission strings assigned to their account.
  // Wildcard ["*"] is strictly assigned ONLY when ownership is explicitly verified as true.
  let permissions: string[];
  if (Array.isArray(meta?.user_permissions)) {
    permissions = meta.user_permissions.map(String);
  } else if (Array.isArray(raw.permissions)) {
    permissions = raw.permissions.map(String);
  } else if (isOwner === true) {
    permissions = ["*"];
  } else {
    permissions = [];
  }

  return {
    identifier: String(raw.identifier).trim(),
    uuid: String(raw.uuid).trim(),
    name: String(raw.name).trim(),
    description:
      typeof raw.description === "string" && raw.description.trim().length > 0
        ? raw.description.trim()
        : null,
    node: String(raw.node || "unknown"),
    isOwner,
    permissions,
    sftp,
    limits: {
      memory: raw.limits.memory,
      swap: typeof raw.limits.swap === "number" && !isNaN(raw.limits.swap) ? raw.limits.swap : 0,
      disk: raw.limits.disk,
      io: typeof raw.limits.io === "number" && !isNaN(raw.limits.io) ? raw.limits.io : 500,
      cpu: raw.limits.cpu,
      threads:
        raw.limits.threads !== undefined && raw.limits.threads !== null
          ? String(raw.limits.threads)
          : null,
    },
    featureLimits: {
      databases: raw.feature_limits.databases,
      allocations: raw.feature_limits.allocations,
      backups: raw.feature_limits.backups,
    },
    isSuspended: Boolean(raw.is_suspended),
    isInstalling: Boolean(raw.is_installing),
    isTransferring: Boolean(raw.is_transferring),
    relationships:
      raw.relationships && typeof raw.relationships === "object" ? raw.relationships : undefined,
  };
}

/**
 * Validates pagination link URLs to prevent SSRF or cross-origin credential bleeding.
 */
export function validatePaginationUrl(rawUrl: string, client: PterodactylClient): URL {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new PterodactylUrlError("Pagination link URL must be a non-empty string.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl, client.baseUrl);
  } catch {
    throw new PterodactylUrlError(`Malformed pagination link URL: "${rawUrl}"`);
  }

  // Reject protocol downgrades (e.g. https -> http)
  if (client.baseUrl.protocol === "https:" && parsed.protocol === "http:") {
    throw new PterodactylUrlError(
      `Prevented protocol downgrade in pagination link: "${parsed.toString()}"`,
    );
  }

  // Reject cross-origin or port differences
  const isSameHost = parsed.hostname.toLowerCase() === client.baseUrl.hostname.toLowerCase();
  const isSamePort = parsed.port === client.baseUrl.port;
  if (!isSameHost || !isSamePort) {
    throw new PterodactylUrlError(
      `Prevented cross-origin pagination link to "${parsed.origin}" (expected "${client.baseUrl.origin}").`,
    );
  }

  // Reject blocked hosts (cloud metadata, etc.)
  if (isBlockedHost(parsed.hostname, { allowPrivateNetworks: client.allowPrivateNetworks })) {
    throw new PterodactylUrlError(
      `Prevented pagination link targeting blocked host: "${parsed.hostname}".`,
    );
  }

  return parsed;
}

export class ServerDiscoveryService {
  constructor(private readonly client: PterodactylClient) {}

  /**
   * Discovers all accessible servers for the authenticated account, handling
   * pagination, deduplication, URL validation, and normalization.
   *
   * @param options Discovery and pagination configuration
   */
  public async discoverServers(options?: ServerDiscoveryOptions): Promise<ServerDiscoveryResult> {
    const singlePageOnly = options?.singlePageOnly ?? false;
    const initialPage = options?.page ?? 1;
    const perPage = options?.perPage ?? DEFAULT_PAGE_SIZE;
    const maxPages = options?.maxPages ?? DEFAULT_MAX_PAGES;

    const serverMap = new Map<string, NormalizedServer>();
    const visitedUrls = new Set<string>();
    const visitedPages = new Set<number>();

    let currentPage = initialPage;
    let pagesFetched = 0;
    let nextPathOrUrl: string | null = null;
    let totalServers = 0;
    let totalPages = 1;
    let truncated = false;

    while (pagesFetched < maxPages) {
      visitedPages.add(currentPage);
      pagesFetched++;

      const response = nextPathOrUrl
        ? await this.client.servers.getServersByPath(nextPathOrUrl)
        : await this.client.servers.getServers({ page: currentPage, perPage });

      // Extract and normalize servers
      for (const item of response.data) {
        this.validateServerItem(item);
        const normalized = normalizeServer(
          item.attributes,
          item.meta as { is_server_owner?: boolean; user_permissions?: string[] } | undefined,
        );

        // Deduplicate across pages while preserving deterministic initial order
        if (!serverMap.has(normalized.identifier)) {
          serverMap.set(normalized.identifier, normalized);
        }
      }

      const pagination = response.meta?.pagination;
      if (pagination) {
        totalServers = pagination.total ?? serverMap.size;
        totalPages = pagination.total_pages ?? 1;
      } else {
        totalServers = serverMap.size;
        totalPages = 1;
      }

      // If single-page discovery requested, terminate immediately
      if (singlePageOnly) {
        truncated = totalPages > 1 && currentPage < totalPages;
        break;
      }

      // Pagination efficiency: terminate immediately when all pages indicated by the API
      // have been fetched, or when an empty page is returned
      if (currentPage >= totalPages || pagesFetched >= totalPages || response.data.length === 0) {
        break;
      }

      // Determine next page URL or parameter
      const rawNext = pagination?.links?.next;
      if (rawNext && typeof rawNext === "string" && rawNext.trim().length > 0) {
        const validatedUrl = validatePaginationUrl(rawNext, this.client);
        const urlStr = validatedUrl.toString();

        if (visitedUrls.has(urlStr)) {
          throw new PterodactylUrlError(
            `Pagination loop detected: "${urlStr}" was already visited.`,
          );
        }
        visitedUrls.add(urlStr);

        nextPathOrUrl = `${validatedUrl.pathname}${validatedUrl.search}`;
        currentPage++;
      } else if (currentPage < totalPages) {
        // Fallback to page-based increment if panel does not provide explicit links.next
        currentPage++;
        if (visitedPages.has(currentPage)) {
          throw new PterodactylUrlError(`Pagination loop detected on page number ${currentPage}.`);
        }
        nextPathOrUrl = null;
      } else {
        // All pages fetched
        break;
      }
    }

    // Check if pagination was capped by maxPages limit
    if (pagesFetched >= maxPages && (nextPathOrUrl !== null || currentPage <= totalPages)) {
      if (serverMap.size < totalServers || totalPages > pagesFetched) {
        truncated = true;
      }
    }

    return {
      success: true,
      servers: Array.from(serverMap.values()),
      totalServers: totalServers || serverMap.size,
      pagesFetched,
      totalPages: Math.max(totalPages, pagesFetched),
      truncated,
    };
  }

  /**
   * Convenience static discovery method.
   */
  public static async discoverServers(
    client: PterodactylClient,
    options?: ServerDiscoveryOptions,
  ): Promise<ServerDiscoveryResult> {
    const service = new ServerDiscoveryService(client);
    return service.discoverServers(options);
  }

  private validateServerItem(
    item: unknown,
  ): asserts item is PterodactylFractalItem<PterodactylServerAttributes> {
    validateServerItem(item);
  }
}

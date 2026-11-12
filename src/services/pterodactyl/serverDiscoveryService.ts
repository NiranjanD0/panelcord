import type { PterodactylClient } from "./client.js";
import type {
  NormalizedServer,
  NormalizedServerSftp,
  PterodactylServerAttributes,
  ServerDiscoveryOptions,
  ServerDiscoveryResult,
  PterodactylFractalItem,
} from "./types/index.js";
import { PterodactylInvalidResponseError, PterodactylUrlError } from "./errors/index.js";
import { isBlockedHost } from "./security.js";

export const DEFAULT_PAGE_SIZE = 50;
export const DEFAULT_MAX_PAGES = 50;

/**
 * Normalizes a raw Pterodactyl server attribute payload into a strongly typed,
 * clean data model with safe defaults for missing optional fields.
 */
export function normalizeServer(raw: PterodactylServerAttributes): NormalizedServer {
  const limits = raw.limits ?? {};
  const featureLimits = raw.feature_limits ?? {};

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

  return {
    identifier: String(raw.identifier || ""),
    uuid: String(raw.uuid || ""),
    name: String(raw.name || "Unnamed Server"),
    description: raw.description ? String(raw.description) : null,
    node: String(raw.node || "unknown"),
    isOwner: Boolean(raw.server_owner),
    permissions: Array.isArray(raw.permissions) ? raw.permissions.map(String) : [],
    sftp,
    limits: {
      memory: typeof limits.memory === "number" ? limits.memory : 0,
      swap: typeof limits.swap === "number" ? limits.swap : 0,
      disk: typeof limits.disk === "number" ? limits.disk : 0,
      io: typeof limits.io === "number" ? limits.io : 0,
      cpu: typeof limits.cpu === "number" ? limits.cpu : 0,
      threads:
        limits.threads !== undefined && limits.threads !== null ? String(limits.threads) : null,
    },
    featureLimits: {
      databases: typeof featureLimits.databases === "number" ? featureLimits.databases : 0,
      allocations: typeof featureLimits.allocations === "number" ? featureLimits.allocations : 0,
      backups: typeof featureLimits.backups === "number" ? featureLimits.backups : 0,
    },
    isSuspended: Boolean(raw.is_suspended),
    isInstalling: Boolean(raw.is_installing),
    isTransferring: Boolean(raw.is_transferring),
    relationships: raw.relationships,
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
        const normalized = normalizeServer(item.attributes);

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
    if (
      !item ||
      typeof item !== "object" ||
      (item as Record<string, unknown>).object !== "server" ||
      !(item as Record<string, unknown>).attributes ||
      typeof (item as Record<string, unknown>).attributes !== "object"
    ) {
      throw new PterodactylInvalidResponseError(
        'Expected a Fractal item with object "server" and valid attributes in server list.',
        item,
      );
    }

    const attrs = (item as Record<string, unknown>).attributes as Record<string, unknown>;
    if (!attrs.identifier || !attrs.uuid) {
      throw new PterodactylInvalidResponseError(
        "Server item is missing required identifier or uuid.",
        attrs,
      );
    }
  }
}

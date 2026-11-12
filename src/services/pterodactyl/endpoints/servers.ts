import type { PterodactylClient } from "../client.js";
import type {
  PterodactylFractalList,
  PterodactylFractalItem,
  PterodactylServerAttributes,
  PterodactylResourceStatsAttributes,
  GetServersParams,
} from "../types/index.js";
import { PterodactylInvalidResponseError, PterodactylValidationError } from "../errors/index.js";
import { validateServerItem } from "../serverDiscoveryService.js";

export const SERVER_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validates a server identifier to prevent path traversal or injection.
 */
export function validateServerIdentifier(identifier: string): string {
  if (typeof identifier !== "string" || identifier.trim().length === 0) {
    throw new PterodactylValidationError("Server identifier must be a non-empty string.");
  }

  const clean = identifier.trim();
  if (!SERVER_IDENTIFIER_REGEX.test(clean)) {
    throw new PterodactylValidationError(
      `Invalid server identifier: "${identifier}". Must be an alphanumeric string containing only letters, numbers, dashes, or underscores (1-64 characters).`,
    );
  }

  return clean;
}

export class ServersEndpoint {
  constructor(private readonly client: PterodactylClient) {}

  /**
   * Retrieves accessible servers from the Pterodactyl Client API.
   * Endpoint: GET /api/client
   *
   * @param params Optional pagination parameters (page, perPage)
   */
  public async getServers(
    params?: GetServersParams,
  ): Promise<PterodactylFractalList<PterodactylServerAttributes>> {
    const query: Record<string, string | number> = {};
    if (params?.page !== undefined) {
      query.page = params.page;
    }
    if (params?.perPage !== undefined) {
      query.per_page = params.perPage;
    }

    const response = await this.client.get<PterodactylFractalList<PterodactylServerAttributes>>(
      "/api/client",
      { query },
    );

    this.validateServerListResponse(response);
    return response;
  }

  /**
   * Fetches servers from a specific relative path or query string (e.g. from a validated pagination link).
   *
   * @param path Relative path with query parameters (e.g., "/api/client?page=2")
   */
  public async getServersByPath(
    path: string,
  ): Promise<PterodactylFractalList<PterodactylServerAttributes>> {
    const response =
      await this.client.get<PterodactylFractalList<PterodactylServerAttributes>>(path);

    this.validateServerListResponse(response);
    return response;
  }

  /**
   * Retrieves single server details by its identifier.
   * Endpoint: GET /api/client/servers/{server}
   *
   * @param serverIdentifier Server short UUID or full UUID
   */
  public async getServer(
    serverIdentifier: string,
  ): Promise<PterodactylFractalItem<PterodactylServerAttributes>> {
    const cleanId = validateServerIdentifier(serverIdentifier);
    const response = await this.client.get<PterodactylFractalItem<PterodactylServerAttributes>>(
      `/api/client/servers/${encodeURIComponent(cleanId)}`,
    );

    validateServerItem(response);
    return response;
  }

  /**
   * Retrieves live resource statistics for a server.
   * Endpoint: GET /api/client/servers/{server}/resources
   *
   * @param serverIdentifier Server short UUID or full UUID
   */
  public async getServerResources(
    serverIdentifier: string,
  ): Promise<PterodactylFractalItem<PterodactylResourceStatsAttributes>> {
    const cleanId = validateServerIdentifier(serverIdentifier);
    const response = await this.client.get<
      PterodactylFractalItem<PterodactylResourceStatsAttributes>
    >(`/api/client/servers/${encodeURIComponent(cleanId)}/resources`);

    this.validateResourceStatsResponse(response);
    return response;
  }

  private validateServerListResponse(
    response: unknown,
  ): asserts response is PterodactylFractalList<PterodactylServerAttributes> {
    if (
      !response ||
      typeof response !== "object" ||
      (response as Record<string, unknown>).object !== "list" ||
      !Array.isArray((response as Record<string, unknown>).data)
    ) {
      throw new PterodactylInvalidResponseError(
        'Expected a Fractal "list" response from GET /api/client.',
        response,
      );
    }
  }

  private validateResourceStatsResponse(
    response: unknown,
  ): asserts response is PterodactylFractalItem<PterodactylResourceStatsAttributes> {
    if (
      !response ||
      typeof response !== "object" ||
      ((response as Record<string, unknown>).object !== "stats" &&
        (response as Record<string, unknown>).object !== "server_stats") ||
      !(response as Record<string, unknown>).attributes ||
      typeof (response as Record<string, unknown>).attributes !== "object"
    ) {
      throw new PterodactylInvalidResponseError(
        'Expected a Fractal item with object "stats" from GET /api/client/servers/{server}/resources.',
        response,
      );
    }

    const attrs = (response as Record<string, unknown>).attributes as Record<string, unknown>;
    if (!attrs.resources || typeof attrs.resources !== "object") {
      throw new PterodactylInvalidResponseError(
        'Resource statistics item is missing required "resources" object.',
        attrs,
      );
    }
  }
}

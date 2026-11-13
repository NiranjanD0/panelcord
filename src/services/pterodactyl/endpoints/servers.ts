import type {
  PterodactylHttpClient,
  PterodactylFractalList,
  PterodactylFractalItem,
  PterodactylServerAttributes,
  PterodactylResourceStatsAttributes,
  GetServersParams,
} from "../types/index.js";
import { PterodactylInvalidResponseError, PterodactylValidationError } from "../errors/index.js";

export const SERVER_IDENTIFIER_REGEX = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * Validates a Pterodactyl Fractal server item structure and ensures critical fields exist.
 */
export function validateServerItem(
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
      'Expected a Fractal item with object "server" and valid attributes in server response.',
      item,
    );
  }

  const attrs = (item as Record<string, unknown>).attributes as Record<string, unknown>;

  // Validate critical identification fields
  if (
    !attrs.identifier ||
    typeof attrs.identifier !== "string" ||
    attrs.identifier.trim().length === 0
  ) {
    throw new PterodactylInvalidResponseError(
      "Server item is missing required non-empty string identifier.",
      attrs,
    );
  }
  if (!attrs.uuid || typeof attrs.uuid !== "string" || attrs.uuid.trim().length === 0) {
    throw new PterodactylInvalidResponseError(
      "Server item is missing required non-empty string uuid.",
      attrs,
    );
  }
  if (!attrs.name || typeof attrs.name !== "string") {
    throw new PterodactylInvalidResponseError(
      "Server item is missing required string name.",
      attrs,
    );
  }

  // Validate server_owner critical boolean field (prevents misclassifying subusers/owners)
  if (typeof attrs.server_owner !== "boolean") {
    throw new PterodactylInvalidResponseError(
      "Server item is missing required boolean server_owner field.",
      attrs,
    );
  }

  // Validate limits critical configuration object
  if (!attrs.limits || typeof attrs.limits !== "object") {
    throw new PterodactylInvalidResponseError(
      "Server item is missing required limits configuration object.",
      attrs,
    );
  }
  const limits = attrs.limits as Record<string, unknown>;
  if (
    typeof limits.memory !== "number" ||
    isNaN(limits.memory) ||
    typeof limits.disk !== "number" ||
    isNaN(limits.disk) ||
    typeof limits.cpu !== "number" ||
    isNaN(limits.cpu)
  ) {
    throw new PterodactylInvalidResponseError(
      "Server item limits configuration contains missing or non-numeric values.",
      attrs,
    );
  }

  // Validate feature_limits critical configuration object
  if (!attrs.feature_limits || typeof attrs.feature_limits !== "object") {
    throw new PterodactylInvalidResponseError(
      "Server item is missing required feature_limits configuration object.",
      attrs,
    );
  }
  const featLimits = attrs.feature_limits as Record<string, unknown>;
  if (
    typeof featLimits.databases !== "number" ||
    isNaN(featLimits.databases) ||
    typeof featLimits.allocations !== "number" ||
    isNaN(featLimits.allocations) ||
    typeof featLimits.backups !== "number" ||
    isNaN(featLimits.backups)
  ) {
    throw new PterodactylInvalidResponseError(
      "Server item feature_limits configuration contains missing or non-numeric values.",
      attrs,
    );
  }
}

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
  constructor(private readonly client: PterodactylHttpClient) {}

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

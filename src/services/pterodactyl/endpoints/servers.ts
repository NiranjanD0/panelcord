import type { PterodactylClient } from "../client.js";
import type {
  PterodactylFractalList,
  PterodactylServerAttributes,
  GetServersParams,
} from "../types/index.js";
import { PterodactylInvalidResponseError } from "../errors/index.js";

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
}

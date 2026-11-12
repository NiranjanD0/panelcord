import type { PterodactylClient } from "../client.js";
import type { PterodactylFractalItem, PterodactylAccountAttributes } from "../types/index.js";

export class AccountEndpoint {
  constructor(private readonly client: PterodactylClient) {}

  /**
   * Retrieves the current user's account details from the Pterodactyl Client API.
   * Endpoint: GET /api/client/account
   */
  public async getAccountDetails(): Promise<PterodactylFractalItem<PterodactylAccountAttributes>> {
    return this.client.get<PterodactylFractalItem<PterodactylAccountAttributes>>(
      "/api/client/account",
    );
  }

  /**
   * Tests whether the API key and Base URL are valid and have connectivity.
   */
  public async testConnection(): Promise<boolean> {
    try {
      const account = await this.getAccountDetails();
      return Boolean(account && account.attributes?.id);
    } catch {
      return false;
    }
  }
}

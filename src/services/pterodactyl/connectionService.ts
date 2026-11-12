import { PterodactylClient } from "./client.js";
import {
  PterodactylAuthError,
  PterodactylForbiddenError,
  PterodactylTimeoutError,
  PterodactylNetworkError,
  PterodactylUrlError,
  PterodactylServerError,
  PterodactylError,
} from "./errors/index.js";
import {
  PanelConnectionState,
  type PanelConnectionParams,
  type PanelConnectionResult,
  type NormalizedAccountInfo,
} from "./types/index.js";

export class PanelConnectionService {
  /**
   * Verifies connectivity and credentials with a Pterodactyl panel using the Client API.
   *
   * @param params Panel URL, Client API Key, and optional timeout
   * @returns Structured PanelConnectionResult (never containing raw API credentials)
   */
  public async verifyConnection(params: PanelConnectionParams): Promise<PanelConnectionResult> {
    if (
      !params.panelUrl ||
      typeof params.panelUrl !== "string" ||
      params.panelUrl.trim().length === 0
    ) {
      return {
        state: PanelConnectionState.INVALID_PANEL_URL,
        success: false,
        message: "Panel URL must be provided and cannot be empty.",
      };
    }

    if (!params.apiKey || typeof params.apiKey !== "string" || params.apiKey.trim().length === 0) {
      return {
        state: PanelConnectionState.INVALID_CREDENTIALS,
        success: false,
        statusCode: 401,
        message: "API key must be provided and cannot be empty.",
      };
    }

    let client: PterodactylClient;
    try {
      client = new PterodactylClient({
        baseUrl: params.panelUrl,
        apiKey: params.apiKey,
        timeoutMs: params.timeoutMs,
      });
    } catch (clientInitError) {
      if (clientInitError instanceof PterodactylUrlError) {
        return {
          state: PanelConnectionState.INVALID_PANEL_URL,
          success: false,
          message: clientInitError.message,
        };
      }

      if (clientInitError instanceof PterodactylAuthError) {
        return {
          state: PanelConnectionState.INVALID_CREDENTIALS,
          success: false,
          statusCode: 401,
          message: clientInitError.message,
        };
      }

      return {
        state: PanelConnectionState.INVALID_PANEL_URL,
        success: false,
        message:
          clientInitError instanceof Error
            ? clientInitError.message
            : "Failed to initialize Pterodactyl client configuration.",
      };
    }

    try {
      const accountResponse = await client.account.getAccountDetails();

      // Ensure response conforms to Pterodactyl Client Account Fractal structure
      if (
        !accountResponse ||
        accountResponse.object !== "user" ||
        !accountResponse.attributes ||
        typeof accountResponse.attributes.id !== "number"
      ) {
        return {
          state: PanelConnectionState.API_ERROR,
          success: false,
          panelUrl: client.sanitizedBaseUrl,
          message: "The panel returned an unexpected or malformed account response payload.",
        };
      }

      const attr = accountResponse.attributes;
      const account: NormalizedAccountInfo = {
        id: attr.id,
        username: String(attr.username || "Unknown"),
        email: String(attr.email || ""),
        firstName: String(attr.first_name || ""),
        lastName: String(attr.last_name || ""),
        language: String(attr.language || "en"),
      };

      return {
        state: PanelConnectionState.CONNECTED,
        success: true,
        panelUrl: client.sanitizedBaseUrl,
        statusCode: 200,
        account,
        message: `Successfully connected to Pterodactyl panel as ${account.username} (ID: ${account.id}).`,
      };
    } catch (error) {
      return this.mapErrorToConnectionResult(error, client.sanitizedBaseUrl);
    }
  }

  private mapErrorToConnectionResult(error: unknown, panelUrl?: string): PanelConnectionResult {
    if (error instanceof PterodactylAuthError) {
      return {
        state: PanelConnectionState.INVALID_CREDENTIALS,
        success: false,
        panelUrl,
        statusCode: 401,
        message: error.message,
        details: error.errors[0]?.detail,
      };
    }

    if (error instanceof PterodactylForbiddenError) {
      return {
        state: PanelConnectionState.INSUFFICIENT_PERMISSIONS,
        success: false,
        panelUrl,
        statusCode: 403,
        message: error.message,
        details: error.errors[0]?.detail,
      };
    }

    if (error instanceof PterodactylTimeoutError) {
      return {
        state: PanelConnectionState.TIMEOUT,
        success: false,
        panelUrl,
        message: error.message,
      };
    }

    if (error instanceof PterodactylNetworkError) {
      return {
        state: PanelConnectionState.PANEL_UNREACHABLE,
        success: false,
        panelUrl,
        message: error.message,
      };
    }

    if (error instanceof PterodactylServerError) {
      return {
        state: PanelConnectionState.PANEL_UNREACHABLE,
        success: false,
        panelUrl,
        statusCode: error.statusCode,
        message: error.message,
        details: error.errors[0]?.detail,
      };
    }

    if (error instanceof PterodactylUrlError) {
      return {
        state: PanelConnectionState.INVALID_PANEL_URL,
        success: false,
        panelUrl,
        message: error.message,
      };
    }

    if (error instanceof PterodactylError) {
      return {
        state: PanelConnectionState.API_ERROR,
        success: false,
        panelUrl,
        statusCode: error.statusCode,
        message: error.message,
        details: error.errors[0]?.detail,
      };
    }

    return {
      state: PanelConnectionState.API_ERROR,
      success: false,
      panelUrl,
      message: error instanceof Error ? error.message : "Unexpected connection error.",
    };
  }
}

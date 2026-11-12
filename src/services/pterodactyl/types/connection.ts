export const PanelConnectionState = {
  CONNECTED: "CONNECTED",
  INVALID_CREDENTIALS: "INVALID_CREDENTIALS",
  INSUFFICIENT_PERMISSIONS: "INSUFFICIENT_PERMISSIONS",
  PANEL_UNREACHABLE: "PANEL_UNREACHABLE",
  TIMEOUT: "TIMEOUT",
  INVALID_PANEL_URL: "INVALID_PANEL_URL",
  API_ERROR: "API_ERROR",
} as const;

export type PanelConnectionState = (typeof PanelConnectionState)[keyof typeof PanelConnectionState];

export interface NormalizedAccountInfo {
  id: number;
  username: string;
  email: string;
  firstName: string;
  lastName: string;
  language: string;
}

export interface PanelConnectionParams {
  panelUrl: string;
  apiKey: string;
  timeoutMs?: number;
  signal?: AbortSignal;
}

export interface PanelConnectionResult {
  state: PanelConnectionState;
  success: boolean;
  message: string;
  panelUrl?: string;
  account?: NormalizedAccountInfo;
  statusCode?: number;
  details?: string;
}

import type { NormalizedServer } from "./server.js";

/**
 * Standard container power/process states emitted by Pterodactyl and Wings daemon.
 */
export type ServerPowerState = "running" | "starting" | "stopping" | "offline" | "stopped" | string;

/**
 * Raw utilization block inside Pterodactyl's stats response.
 */
export interface PterodactylRawResources {
  memory_bytes?: number | null;
  cpu_absolute?: number | null;
  disk_bytes?: number | null;
  network_rx_bytes?: number | null;
  network_tx_bytes?: number | null;
  uptime?: number | null;
}

/**
 * Raw attributes payload returned by GET /api/client/servers/{server}/resources.
 */
export interface PterodactylResourceStatsAttributes {
  current_state: ServerPowerState;
  is_suspended?: boolean;
  resources: PterodactylRawResources;
}

/**
 * Clean, strongly typed representation of live server resource metrics.
 */
export interface NormalizedServerResources {
  currentState: ServerPowerState;
  isSuspended: boolean;
  memoryBytes: number;
  cpuPercentage: number;
  diskBytes: number;
  networkRxBytes: number;
  networkTxBytes: number;
  uptimeMs: number;
  /**
   * Configured memory limit in bytes.
   * 0 indicates explicitly unlimited memory.
   * null indicates limit was not available or not linked.
   */
  memoryLimitBytes: number | null;
  /**
   * Configured disk limit in bytes.
   * 0 indicates explicitly unlimited disk.
   * null indicates limit was not available or not linked.
   */
  diskLimitBytes: number | null;
  /**
   * True if memory limit is 0 (unlimited).
   */
  isMemoryUnlimited: boolean;
  /**
   * True if disk limit is 0 (unlimited).
   */
  isDiskUnlimited: boolean;
  /**
   * True if CPU limit is 0 (unlimited).
   */
  isCpuUnlimited: boolean;
}

/**
 * Combined view holding server metadata and live resource metrics,
 * keeping static configuration and live container telemetry clearly separated.
 */
export interface NormalizedServerDetails {
  server: NormalizedServer;
  resources: NormalizedServerResources | null;
  resourcesUnavailableReason?: string | null;
}

/**
 * Options for combined server and resource retrieval.
 */
export interface GetServerWithResourcesOptions {
  /**
   * When true, rethrows any error encountered when fetching live resources.
   * When false (default), gracefully falls back to returning server details
   * with `resources: null` and populates `resourcesUnavailableReason`.
   */
  throwOnResourceError?: boolean;
}

/**
 * Safely parses and guarantees a non-negative finite number.
 */
export function safeNonNegativeNumber(value: unknown, defaultValue = 0): number {
  if (typeof value !== "number" || isNaN(value) || !isFinite(value) || value < 0) {
    return defaultValue;
  }
  return value;
}

/**
 * Formats a byte quantity into a human-readable string without fabricating data.
 *
 * @param bytes Number of bytes (e.g. 1048576)
 * @param options Configuration for decimals and binary (1024) vs decimal (1000) base
 */
export function formatBytes(
  bytes: number,
  options?: { decimals?: number; binary?: boolean },
): string {
  const safe = safeNonNegativeNumber(bytes, 0);
  if (safe === 0) {
    return "0 B";
  }

  const decimals = options?.decimals ?? 2;
  const binary = options?.binary ?? true;
  const k = binary ? 1024 : 1000;
  const units = binary
    ? ["B", "KiB", "MiB", "GiB", "TiB", "PiB"]
    : ["B", "KB", "MB", "GB", "TB", "PB"];

  const i = Math.min(Math.floor(Math.log(safe) / Math.log(k)), units.length - 1);
  const formatted = (safe / Math.pow(k, i)).toFixed(decimals);
  return `${formatted} ${units[i]}`;
}

/**
 * Formats an uptime duration in milliseconds into a readable "Xd Yh Zm Ws" string.
 */
export function formatUptime(uptimeMs: number): string {
  const safe = safeNonNegativeNumber(uptimeMs, 0);
  if (safe <= 0) {
    return "0s";
  }

  const totalSeconds = Math.floor(safe / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (seconds > 0 || parts.length === 0) parts.push(`${seconds}s`);

  return parts.join(" ");
}

/**
 * Formats CPU utilization percentage into a readable percentage string.
 */
export function formatCpu(cpuPercentage: number, decimals = 2): string {
  const safe = safeNonNegativeNumber(cpuPercentage, 0);
  return `${safe.toFixed(decimals)}%`;
}

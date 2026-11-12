import { PterodactylUrlError } from "./errors/index.js";

// Cloud metadata IPs and hostnames that must NEVER be accessed
const BLOCKED_HOSTNAMES = new Set([
  "metadata.google.internal",
  "metadata.goog",
  "169.254.169.254",
  "169.254.170.2",
  "fd00:ec2::254",
]);

/**
 * Checks if an IP or hostname is a cloud metadata, link-local, or invalid broadcast address.
 * By default, permits private RFC 1918 and loopback addresses for self-hosted home-lab panels,
 * but strictly blocks cloud metadata and link-local ranges.
 */
export function isBlockedHost(
  hostname: string,
  options?: { allowPrivateNetworks?: boolean },
): boolean {
  const cleanHost = hostname
    .toLowerCase()
    .trim()
    .replace(/^\[|\]$/g, "");

  // 1. Direct Cloud Metadata match
  if (BLOCKED_HOSTNAMES.has(cleanHost)) {
    return true;
  }

  // 2. Unspecified / Broadcast addresses
  if (cleanHost === "0.0.0.0" || cleanHost === "::" || cleanHost === "255.255.255.255") {
    return true;
  }

  // 3. IPv4 Link-Local / Cloud Metadata range (169.254.0.0/16)
  if (cleanHost.startsWith("169.254.")) {
    return true;
  }

  // 4. IPv6 Link-Local (fe80::/10) and Multicast (ff00::/8)
  if (cleanHost.startsWith("fe80:") || cleanHost.startsWith("ff")) {
    return true;
  }

  // 5. If private networks are explicitly disallowed (e.g. strict public multi-tenant mode)
  if (options?.allowPrivateNetworks === false) {
    // Loopback
    if (cleanHost === "localhost" || cleanHost.startsWith("127.") || cleanHost === "::1") {
      return true;
    }

    // RFC 1918 Private IPv4 ranges
    // 10.0.0.0/8
    if (cleanHost.startsWith("10.")) {
      return true;
    }

    // 172.16.0.0/12 (172.16.x.x - 172.31.x.x)
    const match172 = cleanHost.match(/^172\.(\d+)\./);
    if (match172 && match172[1]) {
      const secondOctet = parseInt(match172[1], 10);
      if (secondOctet >= 16 && secondOctet <= 31) {
        return true;
      }
    }

    // 192.168.0.0/16
    if (cleanHost.startsWith("192.168.")) {
      return true;
    }

    // Unique Local IPv6 (fc00::/7 - fc00 to fdff)
    if (cleanHost.startsWith("fc") || cleanHost.startsWith("fd")) {
      return true;
    }
  }

  return false;
}

export interface UrlValidationOptions {
  allowPrivateNetworks?: boolean;
}

/**
 * Validates and normalizes a Pterodactyl panel base URL.
 * Enforces protocol safety, strips credentials, normalizes path, and guards against SSRF.
 */
export function validateAndNormalizePanelUrl(rawUrl: string, options?: UrlValidationOptions): URL {
  if (!rawUrl || typeof rawUrl !== "string") {
    throw new PterodactylUrlError("Panel URL must be a non-empty string.");
  }

  // Disallow CRLF or control characters (header injection protection)
  if (/[\r\n\0\t]/.test(rawUrl)) {
    throw new PterodactylUrlError("Panel URL contains invalid control characters.");
  }

  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    throw new PterodactylUrlError(`Invalid panel URL format: "${rawUrl.substring(0, 30)}"`);
  }

  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    throw new PterodactylUrlError(
      `Unsupported protocol "${parsed.protocol}". Panel URL must use HTTP or HTTPS.`,
    );
  }

  // Strictly disallow embedded credentials in the URL
  if (parsed.username || parsed.password) {
    throw new PterodactylUrlError("Panel URL must not contain embedded user credentials.");
  }

  if (!parsed.hostname) {
    throw new PterodactylUrlError("Panel URL must include a valid hostname.");
  }

  // Check SSRF blocked host list (cloud metadata, link-local, etc.)
  if (isBlockedHost(parsed.hostname, options)) {
    throw new PterodactylUrlError(
      `Panel URL host "${parsed.hostname}" is blocked for security reasons (reserved/cloud metadata address).`,
    );
  }

  // Strip query and hash
  parsed.search = "";
  parsed.hash = "";

  // Normalize path (strip trailing slashes and accidental /api or /api/client suffixes)
  let pathname = parsed.pathname.replace(/\/+$/, "");
  if (pathname.endsWith("/api/client")) {
    pathname = pathname.slice(0, -"/api/client".length);
  } else if (pathname.endsWith("/api")) {
    pathname = pathname.slice(0, -"/api".length);
  }
  parsed.pathname = pathname;

  return parsed;
}

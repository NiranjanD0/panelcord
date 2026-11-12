# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.6.0] - 2026-11-12

### Added

- **Pterodactyl API Resilience & Rate Limit Handling**:
  - Implemented `parseRetryAfter` in `src/services/pterodactyl/resilience/retry.ts` supporting both delay-seconds and HTTP-date formats (RFC 7231 / RFC 9110), respecting server delays with fallback to exponential backoff when missing or malformed.
  - Implemented `calculateBackoff` providing configurable exponential backoff (`baseDelayMs * 2^attempt`) with randomized jitter bounded within [0.5, 1.0] and maximum delay capping (`maxDelayMs`).
  - Implemented `sleep` with cancellable `AbortSignal` support, immediately aborting backoff delays when requested by the caller.
  - Enriched `PterodactylError` hierarchy with `attemptCount`, `retryAfterSeconds`, and `isRetryable`, maintaining credential redaction across all error types.
  - Added specialized error classes `PterodactylAbortError` and `PterodactylQueueFullError`.
- **Request Safety & Method Idempotency**:
  - Restricted automated retries strictly to safe/idempotent HTTP methods (`GET`, `HEAD`, `OPTIONS`) by default.
  - Guarded mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) against blind retries, allowing retries only when explicitly opted in via `retryUnsafeMethods: true`.
  - Automatic retries targeted exclusively at transient failures (HTTP 429, 502, 503, 504, connection drops, and request timeouts). Permanent failures (HTTP 400, 401, 403, 404, 422, 500, non-JSON responses, URL validation failures) fail immediately on attempt 1.
- **Per-Panel Concurrency Management**:
  - Implemented `PanelConcurrencyManager` in `src/services/pterodactyl/resilience/concurrency.ts` to manage request concurrency (`maxConcurrent: 5`) and bounded queuing (`maxQueueSize: 100`) isolated per panel origin.
  - Ensures slow or unresponsive panels never block or delay operations targeting other panels.
  - Supports `AbortSignal` cancellation for queued requests, immediately removing them from the pending queue and rejecting with `PterodactylAbortError` without consuming concurrency capacity.
- **Automated Test Suite**:
  - Added 38 automated tests in `tests/pterodactyl/resilience.test.ts` covering Retry-After parsing, exponential backoff, jitter distribution, retryable status codes, method idempotency, concurrency slot limits, queue exhaustion, per-panel isolation, cancellation during queueing and sleep, and credential redaction.

## [0.5.1] - 2026-11-12

### Fixed

- **Unlimited Limits Representation**: Accurately represented Pterodactyl's zero-limit convention where `memory: 0` or `disk: 0` indicates unlimited resources. In `NormalizedServerResources`, unlimited memory and disk limits are represented with `memoryLimitBytes: null` and `diskLimitBytes: null` alongside `isMemoryUnlimited: true` and `isDiskUnlimited: true`, preventing unlimited allocations from ever being displayed as "0 B" or causing division-by-zero errors in utilization calculations. Added `formatResourceLimit` and `formatMemoryUsage` helpers (e.g. "500.00 MiB / Unlimited").
- **Strict Owner Permission Verification**: Hardened `normalizeServer` in `src/services/pterodactyl/serverDiscoveryService.ts` to assert that wildcard `["*"]` permissions are assigned strictly when ownership is verified as boolean `true` (`isOwner === true`). Non-owners and subusers without assigned permissions now strictly resolve to an empty array `[]` and can never receive wildcard permissions by default or through ambiguous truthy attributes.
- **Daemon Error Isolation & Propagation**: Hardened `getServerWithResources` in `src/services/pterodactyl/serverDetailService.ts` with `isWingsConnectivityError`. Authentication failures (HTTP 401), permission failures (HTTP 403), validation errors (HTTP 422), rate limits (HTTP 429), and unexpected API/server errors are now strictly re-thrown rather than swallowed into `resourcesUnavailableReason`. Only verified Wings connectivity errors (HTTP 502 Bad Gateway, HTTP 504 Gateway Timeout, `DaemonConnectionException`) or expected container lifecycle states (suspended, installing, transferring) produce `resourcesUnavailableReason`.

## [0.5.0] - 2026-11-12

### Added

- **Server Details & Resource Monitoring Endpoints**:
  - Implemented `getServer` in `src/services/pterodactyl/endpoints/servers.ts` for `GET /api/client/servers/{server}`, retrieving full server configuration metadata, ownership, user permissions, resource limits, and feature limits.
  - Implemented `getServerResources` in `src/services/pterodactyl/endpoints/servers.ts` for `GET /api/client/servers/{server}/resources`, retrieving container process state, CPU utilization percentage, memory usage, disk usage, network RX/TX bytes, and container uptime.
  - Added strict server identifier validation (`validateServerIdentifier`) enforcing alphanumeric, dash, and underscore identifiers (1-64 characters) to guard against path traversal, query injection, and SSRF attacks before network requests are dispatched.
- **Server Detail Service (`ServerDetailService`)**:
  - Implemented `ServerDetailService` in `src/services/pterodactyl/serverDetailService.ts` providing methods `getServerDetails`, `getServerResources`, and `getServerWithResources`.
  - Added `normalizeServerResources` to normalize raw daemon stats, handling nullable/missing metrics, non-finite values, and correlating server limits into byte representations.
  - Handled Pterodactyl's zero-limit convention where `memory: 0`, `disk: 0`, or `cpu: 0` indicates unlimited resources (`isMemoryUnlimited`, `isDiskUnlimited`, `isCpuUnlimited`).
  - Separated server metadata and live container power states, preventing confusion between container process states (`"running"`, `"starting"`, `"stopping"`, `"offline"`) and server lifecycle states (`isSuspended`, `isInstalling`, `isTransferring`).
  - Implemented resilient fallback in `getServerWithResources` when the remote Wings daemon is unreachable (HTTP 502/504 `DaemonConnectionException`), preserving server configuration details while marking resources as unavailable (`resourcesUnavailableReason: "daemon_unavailable"`).
- **Telemetry Formatting Helpers**:
  - Added `formatBytes`, `formatUptime`, and `formatCpu` in `src/services/pterodactyl/types/resources.ts` for clean human-readable representations (binary KiB/MiB/GiB/TiB or decimal KB/MB/GB/TB, readable durations "1d 2h 3m 4s", formatted percentages) without fabricating omitted data.
- **Automated Test Suite**:
  - Added 37 automated tests in `tests/pterodactyl/serverDetails.test.ts` covering server details retrieval, live resource monitoring, zero-limit handling, telemetry unit formatting, path traversal/injection guards, server states (suspended, installing, transferring, offline), daemon connection errors, and permission failures.

## [0.4.1] - 2026-11-12

### Fixed

- **Critical Field Validation in Server Normalization**: Hardened `validateServerItem` in `src/services/pterodactyl/serverDiscoveryService.ts` to strictly assert boolean `server_owner`, limits configuration object with numeric `memory`, `disk`, `cpu`, and feature limits object with numeric `databases`, `allocations`, `backups`. Missing or malformed critical fields now throw `PterodactylInvalidResponseError` instead of silently falling back to misleading defaults (`isOwner: false` or `memory: 0`).
- **Owner vs. Subuser Permission Accuracy**: Explicitly granted wildcard `["*"]` permissions to verified server owners (`server_owner: true`) to reflect Pterodactyl's full implicit owner access model, while preserving explicit assigned permissions for subusers.
- **Relationship Integrity**: Preserved `relationships` directly as returned by Pterodactyl, keeping missing relations as `undefined` rather than an empty object `{}`.
- **Pagination Early Termination Efficiency**: Updated `discoverServers` loop to immediately terminate once `currentPage >= totalPages` or `pagesFetched >= totalPages`, preventing redundant fetch attempts up to `maxPages` (50) when the API indicates a smaller page count.

## [0.4.0] - 2026-11-12

### Added

- **Pterodactyl Server Discovery**:
  - Implemented `ServersEndpoint` in `src/services/pterodactyl/endpoints/servers.ts` for interacting with the `GET /api/client` endpoint.
  - Added strongly-typed raw fractal server data contracts and clean normalized server data model (`NormalizedServer`) in `src/services/pterodactyl/types/server.ts`.
  - Implemented `ServerDiscoveryService` in `src/services/pterodactyl/serverDiscoveryService.ts` for paginated server discovery across Pterodactyl panels.
  - Implemented safe pagination link parsing with `validatePaginationUrl`, enforcing same-origin validation, protocol downgrade protection, blocked-host denial, and cyclic pagination loop detection.
  - Enforced server deduplication preserving deterministic initial ordering, configurable page sizes, and max page caps (`maxPages`).
  - Unit test suite (`tests/pterodactyl/serverDiscovery.test.ts`) with 18 automated tests covering single server responses, multiple servers, empty lists, pagination loops, multi-page retrieval, deduplication, missing optional fields, malformed responses, permission failures, rate limiting, and invalid pagination URLs.

## [0.3.2] - 2026-11-12

### Security

- **Default-Deny Private Network Access**: Inverted default SSRF behavior for `allowPrivateNetworks` from permissive to default-deny. Centrally hosted multi-tenant deployments now strictly block loopback (`127.0.0.0/8`, `localhost`, `::1`), RFC 1918 private IPv4 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`), and IPv6 Unique Local (`fc00::/7`) addresses out-of-the-box.
- **Untrusted User Override Prevention**: Enforced that `allowPrivateNetworks` is strictly immutable on `PanelConnectionService` and initialized solely via host environment variable (`PTERODACTYL_ALLOW_PRIVATE_NETWORKS`) or host constructor parameters, preventing untrusted Discord users from overriding SSRF policies.
- **Self-Hosted Opt-In**: Added `PTERODACTYL_ALLOW_PRIVATE_NETWORKS` environment variable configuration and documentation in `.env.example` and `README.md` to allow self-hosted home-lab instances to safely opt in.
- **SSRF Architecture Documentation**: Documented DNS rebinding limitations inherent to Node.js system resolution and outlined required production egress firewall rules (e.g. AWS Security Groups, Calico policies dropping `169.254.169.254` and RFC 1918 egress).

## [0.3.1] - 2026-11-12

### Fixed

- **SSRF Protection & Host Validation**: Introduced `isBlockedHost` and `validateAndNormalizePanelUrl` in `src/services/pterodactyl/security.ts` to strictly block cloud metadata services (`169.254.169.254`, `metadata.google.internal`, `fd00:ec2::254`), link-local IPs (`169.254.0.0/16`, `fe80::/10`), and unspecified/broadcast addresses (`0.0.0.0`, `255.255.255.255`, `::`) while safely allowing legitimate self-hosted panels on local/private subnets.
- **Redirect Loop & Max Hop Guards**: Enforced strict maximum redirect limit of 3 hops and implemented visited URL set tracking to detect and terminate redirect loops (e.g. A -> B -> A or self-redirects).
- **Cross-Origin & Credential Sanitization**: Hardened redirect validation to prevent protocol downgrades (HTTPS -> HTTP), port changes, subdomain hops, and embedded credentials (`user:pass@`) in redirect targets.
- **Authentication State Mapping**: Validated and tested strict mapping of HTTP 401 directly to `INVALID_CREDENTIALS` and HTTP 403 strictly to `INSUFFICIENT_PERMISSIONS` (preventing permission errors from ever being misdiagnosed as invalid API keys).

### Added

- Security audit test suite (`tests/pterodactyl/securityAudit.test.ts`) covering 19 distinct attack and edge-case vectors across redirect handling, SSRF defense, and auth state mapping.

## [0.3.0] - 2026-11-12

### Added

- Dedicated `PanelConnectionService` in `src/services/pterodactyl/connectionService.ts` for panel connection verification.
- Supported connection states: `CONNECTED`, `INVALID_CREDENTIALS`, `INSUFFICIENT_PERMISSIONS`, `PANEL_UNREACHABLE`, `TIMEOUT`, `INVALID_PANEL_URL`, `API_ERROR`.
- Account normalization extracting ID, username, email, first name, last name, and language.
- Deterministic redirect protection enforcing same-host origin integrity and preventing cross-origin credential forwarding during redirects.
- Rejection of embedded credentials in panel base URLs (`user:pass@`).
- Unit test suite (`tests/pterodactyl/connectionService.test.ts`) covering all 7 connection states, redirect handling, and credential safety (13 tests).

## [0.2.0] - 2026-11-12

### Added

- Foundational Pterodactyl Client API integration in `src/services/pterodactyl/`.
- `PterodactylClient` transport implementation using native `fetch` with configurable timeouts and Pterodactyl headers.
- Safe panel URL normalization and origin-based SSRF/credential leakage guards.
- Comprehensive typed errors: `PterodactylAuthError` (401), `PterodactylForbiddenError` (403), `PterodactylNotFoundError` (404), `PterodactylValidationError` (422), `PterodactylRateLimitError` (429 with `Retry-After`), `PterodactylServerError` (5xx), `PterodactylNetworkError`, `PterodactylTimeoutError`, `PterodactylInvalidResponseError`, and `PterodactylUrlError`.
- Automatic API key redaction in error messages and error details.
- Account endpoint module (`/api/client/account`) with `getAccountDetails` and `testConnection`.
- Full unit test coverage (22 tests) mocking HTTP requests for all status codes, timeouts, network faults, SSRF guards, and redactions.

## [0.1.1] - 2026-11-12

### Added

- Architectural Decision Record ([ADR 0001](docs/adr/0001-architecture-vanilla-discordjs.md)) documenting the decision to retain modular vanilla `discord.js` v14 over Sapphire Framework.
- `DatabaseUnavailableError` class and connection state tracking (`isDatabaseConnected`, `assertDatabaseAvailable`) in database module.
- Live database health status reporting in `/about` command embed via `BotInfoService`.
- 10-second unref force-exit safety timer for process shutdown handling.

### Changed

- `unhandledRejection` and `uncaughtException` process listeners now initiate graceful shutdown with exit code `1` rather than continuing in an unsafe process state or exiting with code 0.
- Command execution catches `DatabaseUnavailableError` to provide clear user-friendly ephemeral notifications without exposing raw database errors or stack traces.

### Fixed

- Created missing `.dockerignore` to keep development artifacts, sensitive environment files, and `node_modules` out of Docker build contexts.
- Hardened Docker runner image stage permissions with `RUN chown -R node:node /app`.

## [0.1.0] - 2026-11-12

### Added

- Initial project architecture and boilerplate for PanelCord.
- TypeScript strict configuration with ESM support and path aliases.
- Discord.js v14 client initialization, gateway lifecycle, and modular command and event loaders.
- Core slash commands:
  - `/ping`: Measures latency and WebSocket heartbeat.
  - `/about`: System status, uptime, node version, and bot metadata.
- Modular interaction routing system for buttons, modals, and select menus.
- Business logic service layer (`BotInfoService`) decoupled from Discord interactions.
- Structured logging with Pino, including automatic secret redaction and dev pretty-printing.
- Environment variable validation using Zod schemas (`envSchema`).
- Prisma 7 ORM setup with PostgreSQL and dedicated database connection module.
- Slash command deployment script (`pnpm deploy:commands`).
- Graceful shutdown handling for `SIGINT`, `SIGTERM`, `unhandledRejection`, and `uncaughtException`.
- Comprehensive unit test suite with Vitest.
- Code quality tooling with ESLint v10 (flat config) and Prettier.
- Multi-stage `Dockerfile` and `docker-compose.yml` for local containerized development and deployment.

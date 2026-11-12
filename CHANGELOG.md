# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2026-11-13

### Fixed

- **Slash Command Deployment Safety (`src/lib/commandRegistration.ts`)**:
  - Guarded against accidental global slash command deletion by throwing an error when an empty command array is supplied without explicit `allowEmpty: true`.
  - Added Discord snowflake format validation (`/^\d{17,20}$/`) for `clientId` and `guildId`.
- **RegExp State Pollution (`src/interactions/dispatcher.ts`)**:
  - Ensured `customId.lastIndex = 0` is reset prior to `.exec()` matching, preventing handler failure on alternating executions when RegExp routes use `/g` or `/y` flags.
- **Component Update Race Conditions (`src/interactions/responses.ts`)**:
  - Handled Discord error `40060` (Interaction Already Acknowledged) in `safeUpdate` by gracefully falling back to `followUp`.
  - Handled Discord error `10062` (Unknown Interaction) in `safeUpdate` by returning `null` to prevent unhandled rejections on expired tokens.
- **Fail-Safe Interaction Error Handling (`src/interactions/errorHandler.ts`)**:
  - Wrapped `handleInteractionError` in a top-level try/catch block so that unexpected exceptions or Discord API rejections during error reporting cannot trigger unhandled process rejections.
- **Structured Error Serialization (`src/utils/logger.ts`)**:
  - Bound standard Pino error serializers to both `err` and `error` keys so nested error causes and stack traces are properly structured in logs.

### Added

- **Interaction Handler Isolation & Warnings (`src/interactions/dispatcher.ts`)**:
  - Added `clearHandlers()` to reset registered component and modal handlers for test isolation.
  - Added warning log emits when registering duplicate string `customId` handlers.
- **Declarative Deferral for Components (`src/types/interaction.ts`, `src/interactions/dispatcher.ts`)**:
  - Added `defer`, `deferEphemeral`, and `deferUpdate` configuration options to button and select menu handlers.
- **Autocomplete Interaction Routing (`src/types/command.ts`, `src/interactions/dispatcher.ts`)**:
  - Added optional `autocomplete` callback on `Command` and wired interaction dispatching for autocomplete events.

## [0.8.0] - 2026-11-13

### Added

- **Slash Command Registration Infrastructure (`src/lib/commandRegistration.ts`)**:
  - Implemented `validateCommand` and `validateCommands` enforcing Discord slash command specifications (1-32 lowercase characters matching Unicode regex, non-empty descriptions up to 100 characters, duplicate name prevention) using Zod.
  - Implemented `deployCommands` service supporting both development guild-specific and production global deployment via Discord REST API.
  - Refactored `src/scripts/deploy-commands.ts` CLI deployment script to use the centralized, testable `deployCommands` service.
- **Interaction Response Utilities (`src/interactions/responses.ts`)**:
  - Implemented state-aware response helpers: `safeReply`, `safeDefer`, `safeUpdate`, `safeDeferUpdate`, and `safeFollowUp`.
  - Added race condition and duplicate acknowledgement protection (Discord error `40060`).
  - Added silent handling for expired interactions (Discord error `10062`) to prevent unhandled promise rejections when the 3-second acknowledgement deadline is exceeded.
  - Implemented standardized visual response payload formatters: `createErrorPayload`, `createSuccessPayload`, and `createInfoPayload`.
- **Centralized Interaction Error Handling (`src/interactions/errorHandler.ts`)**:
  - Implemented centralized exception handler `handleInteractionError` and `getUserFriendlyErrorMessage`.
  - Guaranteed zero information leakage: internal error messages, database credentials, and stack traces are never exposed to Discord users.
  - Mapped specific error scenarios including `DatabaseUnavailableError` and Discord error `50013` (Missing Permissions).
  - Enriched structured Pino logging with sanitized interaction context (`interactionId`, `userId`, `guildId`, `channelId`, `commandName`/`customId`).
- **Centralized Interaction Dispatcher (`src/interactions/dispatcher.ts`)**:
  - Implemented `InteractionDispatcher` routing slash commands, buttons, select menus (string, user, role, channel, mentionable), and modal submissions.
  - Supported dynamic routing via RegExp patterns with named capture groups forwarded as route parameters.
  - Added safe fallback handling for unknown or inactive interactive components.
  - Maintained full backward compatibility with the existing `interactionManager` export.
  - Streamlined `src/events/interactionCreate.ts` to delegate all interaction routing to `interactionDispatcher.dispatch()`.
- **Automated Test Suite**:
  - Added 48 unit tests across `tests/commandRegistration.test.ts`, `tests/interactionDispatcher.test.ts`, `tests/interactionResponses.test.ts`, and `tests/interactionErrorHandling.test.ts`.

## [0.7.1] - 2026-11-12

### Added

- **Prisma SQL Migration & Environment**:
  - Generated initial Prisma migration `prisma/migrations/20261112204500_init/migration.sql` creating the `panel_connections` table, `guild_id` index, and `(guild_id, name)` unique constraint.
  - Added `migration_lock.toml` for Postgres provider tracking.
  - Updated `docker-compose.yml` to pass `PANELCORD_ENCRYPTION_KEY` to the bot service.
- **End-to-End Integration Test Suite**:
  - Implemented comprehensive automated test suite in `tests/pterodactyl/e2eWorkflow.test.ts` covering Workflows A through E:
    - Workflow A: Panel Connection Lifecycle (URL validation, API key validation, encryption, persistence, sanitized metadata retrieval, panel verification, credential non-exposure).
    - Workflow B: Server Discovery Flow (persisted connection retrieval, in-boundary decryption, multi-page discovery, server normalization, account ownership & permission verification).
    - Workflow C: Server Details & Telemetry (online telemetry, offline/stopped metrics, Wings daemon outage isolation with `resourcesUnavailableReason`, Pterodactyl 0-limit unlimited convention).
    - Workflow D: Multi-Tenant Security & Isolation (cross-guild read/update/delete rejection, scoped querying, AAD tamper detection and ciphertext swapping protection).
    - Workflow E: Resilience & Failure Recovery (HTTP 429 Retry-After parsing and retry recovery, 502/503/504 backoff retries, configurable `retryHttp500` behavior, transient network error retries, `AbortSignal` cancellation non-retry, non-retryable 401/403 protection, safe non-idempotent POST protection).
  - Added `executeWithClient` operational boundary method to `PanelCredentialService`.

### Fixed

- **Accidental Credential Exposure during Object Serialization**:
  - Implemented sanitized `toJSON()` and `[Symbol.for("nodejs.util.inspect.custom")]()` methods on `PterodactylClient` and `CredentialEncryptionService` to prevent leaking API keys or master keys during `JSON.stringify` or `console.log` / `util.inspect`.
- **Logger Redaction Paths**:
  - Expanded `pino` redaction paths in `src/utils/logger.ts` to include `apiKey`, `PANELCORD_ENCRYPTION_KEY`, `encryptedApiKey`, `encryptionIv`, `encryptionAuthTag`, `masterKey`, `headers.Authorization`, and their wildcard variants.
- **Error Cause & Stack Trace Sanitization**:
  - Enhanced `PterodactylError` in `src/services/pterodactyl/errors/base.ts` to sanitize underlying `cause.message`, `cause.stack`, and `this.stack` against `apiKeyToRedact`.
- **Circular Module Dependencies**:
  - Eliminated circular dependencies between `client.ts`, `endpoints/servers.ts`, and `serverDiscoveryService.ts` by introducing `PterodactylHttpClient` interface in `types/common.ts` and moving `validateServerItem` into `endpoints/servers.ts`.
- **Server Discovery Subuser Permissions Normalization**:
  - Fixed `ServerDiscoveryService.discoverServers` to forward Fractal item-level `meta` (`user_permissions`, `is_server_owner`) to `normalizeServer`, ensuring subuser permissions are correctly preserved instead of defaulting to empty arrays.

## [0.7.0] - 2026-11-12

### Added

- **Prisma Database Schema (`PanelConnection`)**:
  - Implemented `PanelConnection` model in `prisma/schema.prisma` with `id`, `guildId`, `name`, `panelUrl`, `encryptedApiKey`, `encryptionIv`, `encryptionAuthTag`, `encryptionKeyVersion`, and timestamps.
  - Enforced `@@unique([guildId, name])` constraint ensuring unique connection names per Discord guild while permitting multiple connections per guild.
  - Indexed `guildId` (`@@index([guildId])`) for fast multi-tenant query performance.
  - Designed schema with forward compatibility for future Pterodactyl server-to-Discord mappings.
- **AES-256-GCM Credential Encryption Service (`CredentialEncryptionService`)**:
  - Implemented `CredentialEncryptionService` in `src/services/pterodactyl/encryptionService.ts` using `node:crypto`.
  - Enforced 32-byte master encryption keys validated from `PANELCORD_ENCRYPTION_KEY` (format `openssl rand -hex 32`).
  - Generated unique 12-byte (96-bit) cryptographically secure random IVs per encryption operation.
  - Implemented 16-byte (128-bit) GCM authentication tag verification on decryption, failing closed on tampered ciphertext or tags.
  - Implemented contextual Additional Authenticated Data (AAD) binding (`panelcord:aad:v1:<guildId>:<connectionId>`), preventing ciphertext swapping across guilds or records without detection.
  - Supported ciphertext key versioning (`encryptionKeyVersion: 1`) for future key rotation compatibility.
  - Strict fail-closed design with guaranteed credential redaction and zero plaintext fallback.
- **Panel Credential Service (`PanelCredentialService`)**:
  - Implemented `PanelCredentialService` in `src/services/pterodactyl/panelCredentialService.ts` providing multi-tenant scoped lifecycle management (`createConnection`, `getConnection`, `listConnections`, `updateConnection`, `deleteConnection`).
  - Enforced mandatory guild scoping on all operations, rejecting cross-guild access attempts.
  - Restricted credential decryption to an explicit internal method (`getDecryptedConnection`).
  - Integrated `verifyBeforeSaving` to prevent storing broken or invalid credentials.
  - Implemented `verifyStoredConnection` and `createClientForConnection` factory, scoping decrypted API keys strictly to execution time without long-lived shared memory caching.
- **Automated Test Suite**:
  - Added 39 automated tests across `tests/pterodactyl/encryptionService.test.ts` and `tests/pterodactyl/panelCredentialService.test.ts` covering encryption round-trips, unique IVs, tampered ciphertexts/tags, AAD mismatches, key length validation, cross-guild isolation, CRUD lifecycle, duplicate name handling, and stored connection verification.

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
  - Guarded mutating methods (`POST`, `PUT`, `PATCH`, `DELETE`) against blind retries, ensuring `retryUnsafeMethods: true` is strictly an explicit per-operation decision in `RequestOptions`, never a client-wide default.
  - Automatic retries targeted exclusively at transient failures (HTTP 429, 502, 503, 504, connection drops, and request timeouts). Added configurable `retryHttp500` and `retryableStatusCodes` overrides for panels experiencing transient internal errors.
  - Guarded against early retries when `Retry-After` exceeds `maxDelayMs` via `exceededMaxDelayBehavior: "fail" | "defer"`. The client never retries earlier than the panel requested, failing immediately by default instead of silently retrying early.
- **Per-Panel Concurrency Management**:
  - Implemented `PanelConcurrencyManager` in `src/services/pterodactyl/resilience/concurrency.ts` to manage request concurrency (`maxConcurrent: 5`) and bounded queuing (`maxQueueSize: 100`) isolated per panel origin.
  - Ensures slow or unresponsive panels never block or delay operations targeting other panels.
  - Supports `AbortSignal` cancellation for queued requests, immediately removing them from the pending queue and releasing idle queues from memory without consuming concurrency capacity.
  - Guarantees concurrency slots are freed in `finally` even after exceptions.
- **Panel Connection Service Lifecycle**:
  - Wired `AbortSignal` cancellation through `verifyConnection` and `AccountEndpoint.getAccountDetails`, allowing callers to abort connection testing immediately while preserving fast diagnostics (`maxRetries: 0`) and custom `timeoutMs` handling.
- **Automated Test Suite**:
  - Added 46 automated tests in `tests/pterodactyl/resilience.test.ts` and 18 in `tests/pterodactyl/connectionService.test.ts` covering Retry-After parsing, exponential backoff, jitter distribution, retryable status codes, HTTP 500 configurability, method idempotency, concurrency slot limits, queue exhaustion, idle queue cleanup, cancellation during queueing/sleep, connection timeout/abort, and credential redaction.

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

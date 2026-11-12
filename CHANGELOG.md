# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

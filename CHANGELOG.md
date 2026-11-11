# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

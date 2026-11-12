# ADR 0001: Retention of Vanilla Discord.js Architecture over Sapphire Framework

## Status

**Accepted** (2026-11-12)

## Context

During the completion and audit of Task 01 (Initialize PanelCord Boilerplate), an evaluation was conducted on whether to adopt the opinionated Sapphire Framework (`@sapphire/framework`) or retain a modular, vanilla `discord.js` v14 architecture.

The bot's objective is to manage Pterodactyl game servers via Discord slash commands, interactive UI components (buttons, select menus, modals), background tasks, and PostgreSQL persistence via Prisma ORM.

## Decision

We have decided to **retain the custom modular vanilla discord.js v14 architecture** and **not migrate to Sapphire Framework**.

Specifically, PanelCord will continue using:

1. **Direct `discord.js` v14 Client:** Extending `Client` (`ExtendedClient`) with custom collections.
2. **Modular Directory Structure:** Feature-oriented layout separating `commands/`, `events/`, `interactions/`, `services/`, `database/`, and `config/`.
3. **Explicit Type Contracts:** Typed [`Command`](../../src/types/command.ts), [`Event`](../../src/types/event.ts), and [`ButtonHandler`](../../src/types/interaction.ts) interfaces rather than class-based Piece inheritance.
4. **Structured Logging via Pino:** Native Pino logger with automated credential redaction instead of Sapphire plugins.
5. **Decoupled Service Layer:** Core business logic (such as future Pterodactyl API clients and server orchestration) remains completely decoupled from Discord Gateway event lifecycles.

## Rationale

- **Minimal Dependency Overhead:** Direct `discord.js` avoids unnecessary abstraction layers, external framework lock-in, and heavy piece/store registries.
- **Explicit Lifecycle Control:** Full control over Gateway reconnection, rate limits, REST deployment scripts, Prisma pooling, and graceful `SIGINT`/`SIGTERM`/`uncaughtException` process lifecycles without framework magic.
- **Fast Build & Startup:** Zero reflection or dynamic store crawling overhead at startup. Bundles via `tsup` in under 30ms.
- **Architectural Clarity:** The existing structure is clean, fully typed with TypeScript strict mode, and 100% covered by automated tests.

## Consequences

- Command and event registration requires maintaining our lightweight loaders (`loadCommands`, `loadEvents`).
- Future preconditions (e.g. administrator/permission gates) will be implemented as modular middleware functions rather than Sapphire `Precondition` pieces.

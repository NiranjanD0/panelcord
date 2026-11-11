# PanelCord

> A modern, scalable, production-ready Discord bot designed to manage Pterodactyl game servers through Discord.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue.svg)](https://www.typescriptlang.org/)
[![discord.js](https://img.shields.io/badge/discord.js-v14-5865F2.svg)](https://discord.js.org/)
[![Prisma](https://img.shields.io/badge/Prisma-ORM-2D3748.svg)](https://www.prisma.io/)
[![Vitest](https://img.shields.io/badge/tested%20with-vitest-6E9F18.svg)](https://vitest.dev/)

---

## Architecture Overview

PanelCord follows a modular, feature-oriented architecture separating Discord interaction handling from business logic, data access, and future external API integrations:

```
src/
├── commands/         # Slash command definitions (e.g. /ping, /about)
├── events/           # Discord Gateway event handlers (e.g. ready, interactionCreate)
├── interactions/     # Handlers for buttons, modals, and select menus
├── services/         # Core business logic isolated from Discord APIs
├── database/         # Prisma client and database lifecycle utilities
├── config/           # Type-safe environment validation and constants
├── lib/              # Client extensions and command/event loaders
├── types/            # Shared TypeScript interfaces and types
├── utils/            # Shared utilities (structured logger with redaction)
└── index.ts          # Main bot entry point and graceful shutdown
```

---

## Features (Boilerplate)

- **Discord Gateway Connection**: Built with `discord.js` v14 with gateway intents configured.
- **Modular Loaders**: Dynamic registration of slash commands and gateway event listeners.
- **Core Commands**:
  - `/ping`: Measures roundtrip latency and WebSocket heartbeat.
  - `/about`: Displays bot information, system status, uptime, and versions.
- **Structured Logging**: Uses `pino` with pretty-printing in development and automatic credential redaction (tokens, passwords, database URLs).
- **Graceful Shutdown**: Handles `SIGINT` and `SIGTERM` signals, ensuring clean Discord gateway disconnection and database connection pool termination.
- **Environment Validation**: Validates all configuration at runtime using `zod` to prevent silent misconfigurations.
- **Database Integration**: PostgreSQL database integration prepared with Prisma ORM.
- **Containerization**: Multi-stage `Dockerfile` (distroless/alpine, non-root user) and `docker-compose.yml` with healthchecks.

---

## Getting Started

### Prerequisites

- **Node.js** >= 22.0.0
- **pnpm** >= 12.0.0
- **PostgreSQL** >= 15 (or Docker)

### 1. Installation

Clone the repository and install dependencies:

```bash
pnpm install
```

### 2. Environment Configuration

Copy the example environment configuration file and provide your credentials:

```bash
cp .env.example .env
```

| Variable            | Description                                                             | Default / Example                                               |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------- |
| `DISCORD_TOKEN`     | Discord Bot Token from Developer Portal                                 | Required                                                        |
| `DISCORD_CLIENT_ID` | Application ID from Developer Portal                                    | Required                                                        |
| `DISCORD_GUILD_ID`  | Guild ID for instant development command sync                           | Optional                                                        |
| `DATABASE_URL`      | PostgreSQL connection URL                                               | `postgresql://user:pass@localhost:5432/panelcord?schema=public` |
| `NODE_ENV`          | Application environment (`development`, `test`, `production`)           | `development`                                                   |
| `LOG_LEVEL`         | Pino logging level (`fatal`, `error`, `warn`, `info`, `debug`, `trace`) | `info`                                                          |

### 3. Generate Database Client

```bash
pnpm prisma:generate
```

### 4. Deploy Slash Commands

Register application slash commands with Discord:

```bash
pnpm deploy:commands
```

### 5. Start Development Server

```bash
pnpm dev
```

---

## Available Scripts

| Command                | Description                                                             |
| ---------------------- | ----------------------------------------------------------------------- |
| `pnpm dev`             | Starts bot in watch mode with `tsx`                                     |
| `pnpm build`           | Compiles TypeScript into self-contained bundles in `dist/` using `tsup` |
| `pnpm start`           | Runs the compiled production build from `dist/index.js`                 |
| `pnpm lint`            | Checks code with ESLint                                                 |
| `pnpm lint:fix`        | Automatically fixes ESLint warnings and errors                          |
| `pnpm format`          | Formats all code with Prettier                                          |
| `pnpm format:check`    | Checks code formatting with Prettier                                    |
| `pnpm test`            | Runs the unit test suite with Vitest                                    |
| `pnpm deploy:commands` | Registers slash commands with Discord API                               |
| `pnpm prisma:generate` | Generates the Prisma client                                             |

---

## Running with Docker Compose

Run the entire stack (PostgreSQL database + PanelCord bot):

```bash
docker compose up -d --build
```

View logs:

```bash
docker compose logs -f bot
```

---

## License

This project is licensed under the [MIT License](LICENSE).

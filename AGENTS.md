# Repository Guidelines

## Project Overview

This is a TypeScript, ESM, Node 24 Discord bot built on `discord.js`. Runtime code lives in `src/`, tests live in `tests/`, language strings live in `lang/`, and deployment/runtime config examples live in `config/` plus `env.example`.

Important entry points:

- `src/start-bot.ts` wires the bot process, Discord handlers, commands, triggers, and bot-side jobs.
- `src/start-manager.ts` wires the shard manager process.
- `src/commands/metadata.ts` defines Discord command registration metadata.
- `src/models/bot.ts` owns Discord client event listener registration and interaction routing.
- `src/database/schema.ts` defines the Drizzle schema.

## Local Setup

- Use the pinned Node version: `nvm use` (`.nvmrc` currently pins `24.15.0`).
- Install dependencies with `npm ci` for normal development. Use `npm install` only when intentionally changing dependencies.
- Local config can be initialized with `npm run copyconfig`.
- Do not commit secrets from `.env`, local config, service account keys, or generated database files.

## Common Commands

- `npm run build` - compile TypeScript into `dist/`.
- `npm run check-types` - run `tsc --noEmit`.
- `npm test` - run the Vitest suite once.
- `npm run test:watch` - run Vitest in watch mode.
- `npm run lint` - run ESLint.
- `npm run lint:fix` - auto-fix lint issues where possible.
- `npm run format` - check Prettier formatting.
- `npm run format:fix` - apply Prettier formatting.
- `npm run commands:register` - build and register Discord commands after command metadata/name/shape changes.
- `npm run db:push` - push Drizzle schema changes directly to a local database (dev convenience, no migration file).
- `npm run db:migrate` - apply committed migrations under `drizzle/` to `SQLITE_PATH`. Snapshots the database first (`*.bak`, last 10 kept) and exits non-zero on failure.

### Schema changes

After editing `src/database/schema.ts`:

1. `npx drizzle-kit generate` - write a migration file under `drizzle/` from the schema diff, then **commit it**. Review the SQL for destructive/table-rebuild changes (SQLite drops/renames columns by rebuilding the table).
2. Apply it: run `npm run db:migrate` locally (or `db:push` for quick throwaway iteration).

`createDatabase()` does **not** migrate on startup — each shard is its own
process, so migrating there would race. Migrations run as a single-process deploy
gate instead:

- **Production (Coolify):** the pre-deployment command is `node dist/migrate.js`.
  It runs once, before the new containers take over, so a failed migration aborts
  the deploy and the previous version keeps serving. If you recreate the Coolify
  app, re-set this command.

## Required Verification

Run `npm run check-types` after risky code changes. If it reports type errors, treat those errors as input and fix them before stopping. Only stop for user input when the correct type fix depends on a product or design decision that cannot be inferred from the code.

For behavioral changes, also run the narrowest relevant tests. Use full `npm test` when touching shared services, command routing, event handlers, database code, or utilities used broadly.

## Code Style

- TypeScript modules are ESM (`"type": "module"`).
- Follow the existing style: single quotes, no semicolons, trailing commas for multiline constructs.
- Prefer explicit module boundary types in `src/**/*.ts`; ESLint enforces this.
- Avoid `any`; ESLint treats explicit `any` as an error.
- Keep imports and exports consistent with nearby files. Use existing barrel files only when the surrounding code already does.
- Keep edits scoped. Do not reformat unrelated files or churn `package-lock.json` unless dependency changes require it.

## Project Structure Notes

- `src/commands/chat`, `src/commands/user`, and `src/commands/message` contain command implementations by Discord command type.
- `src/events` contains Discord event handlers.
- `src/triggers` contains message-triggered behaviors.
- `src/jobs` contains scheduled jobs run through `src/services/job-service.ts`.
- `src/services` contains app/domain services and integrations used by handlers and commands.
- `src/integrations` contains external integration implementations.
- `src/utils` contains shared helpers with existing focused tests in `tests/utils`.

## Testing Notes

- Vitest is configured for Node and includes `tests/**/*.test.ts`.
- Test helpers live under `tests/helpers`.
- Prefer focused unit tests for utilities and services; use integration-style tests where existing coverage already uses that pattern.
- When command metadata or command behavior changes, consider whether both implementation tests and Discord registration metadata need updates.

## Discord And External Services

- Slash command names/descriptions are language-driven; check `lang/lang.en-US.json` and `src/commands/metadata.ts` together.
- Register commands only when needed and only with valid Discord credentials/config.
- Google Calendar, Google Groups, Discord, and CRM flows may depend on environment variables or service credentials. Prefer tests/mocks over live calls unless the user explicitly asks for live verification.

## Git Hygiene

- Treat local config files and generated artifacts as user/environment state.
- Do not revert unrelated working tree changes.
- If `package-lock.json` changes unexpectedly after a dependency install, verify the Node/npm version with `nvm use` before deciding whether the lockfile change is intentional.

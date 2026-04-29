# Repo Overview + Familiarization Map

## What this repo is

This is a TypeScript `discord.js` bot for the DGG Political Action Discord server.

- Primary runtime entrypoint: `src/start-bot.ts`
- Core event router: `src/models/bot.ts`
- Optional sharding/manager process: `src/start-manager.ts`
- Optional manager HTTP API (for shards/integrations): `src/models/api.ts` + `src/controllers/**`
- Commands: `src/commands/**`
- Event handlers: `src/events/**`
- Message triggers: `src/triggers/**`
- Jobs/scheduled automation: `src/jobs/**` + `src/services/job-service.ts`
- Service layer: `src/services/**`
- Runtime config: `config/config.json`
- Secrets/env contract: `.env.example`
- Localization/copy/log strings: `lang/**`

## Suggested way to learn it fast

### 1) Setup + sanity checks (15-20 min)

1. Run `npm install`
2. Run `npm run copyconfig` (creates `config/debug.json`, `config/bot-sites.json`, and `.env`)
3. Fill `.env` with real Discord credentials
4. Run `npm run check-types`
5. Run `npm test`

Why first: this verifies your local environment and catches config issues before code exploration.

### 2) Understand composition first (20 min)

Read in this order:

1. `src/start-bot.ts` (what gets instantiated)
2. `src/models/bot.ts` (which Discord events get listened to + how routed)
3. `src/events/index.ts` and `src/commands/index.ts` (public surfaces)

Goal: know where new behavior plugs in.

### 3) Trace one command end-to-end (30 min)

Recommended path:

- `src/commands/chat/attendance-track-command.ts`
- `src/services/attendance-service.ts`
- `src/events/voice-state-update-handler.ts`

This gives a full command + stateful service + event-driven completion flow.

### 4) Trace one trigger + one job (30-45 min)

- Trigger: `src/triggers/cta-post.ts`
- Job: `src/jobs/auto-close-welcome-threads-job.ts`
- Scheduler mechanics: `src/services/job-service.ts`

Goal: understand autonomous behavior outside slash commands.

### 5) Understand integration boundaries (20-30 min)

- Google Calendar sync logic: `src/services/sync-dggp-google-calendar.ts`
- Calendar API wrapper: `src/services/google-calendar-service.ts`
- Integration webhooks: `src/controllers/integrations-controller.ts` and `src/integrations/**`

Goal: understand where external APIs are isolated.

## Contributor map (where to change what)

### Add a new slash command

1. Implement command class in `src/commands/chat/` (or nested area)
2. Add metadata in `src/commands/metadata.ts`
3. Export from `src/commands/chat/index.ts` and/or `src/commands/index.ts`
4. Instantiate in `src/start-bot.ts` command list
5. Add language strings in `lang/lang.en-US.json` (name/desc/embeds)
6. Register with Discord: `npm run commands:register`

### Add a user context-menu command

1. Create command in `src/commands/user/`
2. Add metadata in `src/commands/metadata.ts` (`UserCommandMetadata`)
3. Wire it in `src/start-bot.ts`
4. Register with `npm run commands:register`

### Add a new Discord event behavior

1. Add/extend handler in `src/events/`
2. If needed, add service in `src/services/`
3. Inject handler/service wiring in `src/start-bot.ts`
4. Ensure listener registration path exists in `src/models/bot.ts`

### Add a message trigger

1. Implement `Trigger` in `src/triggers/`
2. Add to trigger list in `src/start-bot.ts`
3. Validate flow via `src/events/message-handler.ts` and `src/events/trigger-handler.ts`

### Add a scheduled job

1. Implement class in `src/jobs/` extending expected `Job` shape
2. Read schedule/log settings from `config/config.json`
3. Add job instance in `src/start-bot.ts` (or `src/start-manager.ts` if manager-side)
4. Confirm it starts through `JobService.start()` in runtime logs

### Add or modify integration endpoint

1. Implement `Integration` in `src/integrations/`
2. Add to list in `src/start-manager.ts`
3. Set required env var key `INTEGRATION_<NAME_SLUG>`
4. Verify route registration in logs (`src/controllers/integrations-controller.ts`)

### Change onboarding/welcome flow

1. Entry event: `src/events/guild-member-add-handler.ts`
2. Thread behavior: `src/services/welcome-thread-service.ts`
3. Constants/templates: `src/constants/**`, `lang/**`
4. Auto-close policy: `config/config.json` + `src/jobs/auto-close-welcome-threads-job.ts`

## Helpful runbook commands

- Start bot: `npm start`
- Start manager: `npm run start:manager`
- Type-check only: `npm run check-types`
- Tests: `npm test`
- Lint: `npm run lint`
- Register slash/user commands: `npm run commands:register`
- View registered command payload: `npm run commands:view`

## Common pitfalls

- Bot token/client ID mismatch between app and env.
- Missing privileged intents in the Discord Developer Portal (especially with this config).
- Forgetting to run `npm run commands:register` after command metadata changes.
- Missing `config/debug.json` if `npm run copyconfig` was skipped.
- Missing integration API keys (`INTEGRATION_*`) so endpoints silently do not register.

# DGG Discord Bot

Uses the [discord.js](https://discord.js.org/) framework.

## Upstream Template

This template for a Discord bot was based upon this public template. https://github.com/KevinNovak/Discord-Bot-TypeScript-Template

## Setup

0. Use the pinned Node version.

   ```
   nvm use
   ```

   If you do not have that version yet:

   ```
   nvm install
   ```

1. Copy example config files.

   Run this command to create your local config and .env files:

   ```
   npm run copyconfig
   ```

2. Fill your .env - see below.

3. Install dependencies with a lockfile-stable workflow:

   - Use `npm ci` for normal development and CI (preferred).
   - Use `npm install` only when you intentionally add/update/remove dependencies.

4. Register commands.
   - In order to use slash commands, they first [have to be registered](https://discordjs.guide/creating-your-bot/command-deployment.html).
   - Type `npm run commands:register` to register the bot's commands.
     - Run this script any time you change a command name, structure, or add/remove commands.
     - This is so Discord knows what your commands look like.
     - It may take up to an hour for command changes to appear.
5. `npm start`

## Contributing With Low Lockfile Noise

When contributors use different Node/npm versions, `package-lock.json` often churns (including platform/libc metadata). To reduce noise:

1. Use the pinned runtime in `.nvmrc`:

   ```
   nvm use
   ```

2. Keep dependency installs on consistent tooling (`npm` bundled with that Node version).
3. In CI, use the same Node version and run `npm ci` (not `npm install`).
4. If you changed only app code but `package-lock.json` is noisy, re-run install after `nvm use` and re-check the diff.

## Environment Variables

The bot requires certain environment variables to be set. In development, these can be set in an `.env` file in the root of the discord-bot directory. In production, these should be set in your deployment environment.

### Required

Go here for the first two https://discord.com/developers/applications/

Find this under OAuth2

```
DISCORD_CLIENT_ID="your-discord-client-id"
```

Find this under Bot

```
DISCORD_BOT_TOKEN="your-discord-bot-token"
```

Get this from inside of the Discord app. Enable developer mode -> right click user name -> Copy ID. https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID

```
DISCORD_BOT_DEVELOPER_IDS="123456789012345678,987654321098765432" # comma-separated list of Discord user IDs
```

### Optional: Google Calendar sync

To mirror Discord scheduled events from **DGG Political Action** into the DGGP group calendar, the bot runs an **hourly** job that reconciles with Google Calendar.

1. Create a [Google Cloud project](https://console.cloud.google.com/) and enable the **Google Calendar API**.

2. Create a **service account**, download its JSON key, and share the target Google Calendar with the service account email (**Make changes to events**).

3. In `.env`: `GOOGLE_CALENDAR_ID` and `GOOGLE_APPLICATION_CREDENTIALS` (path to that JSON), or `GOOGLE_CALENDAR_CREDENTIALS` instead of `GOOGLE_APPLICATION_CREDENTIALS` if you prefer. Share the target calendar with the **service account email** from that JSON (`client_email`), unless you use Workspace delegation (then set `GOOGLE_CALENDAR_IMPERSONATION_SUBJECT` and share the calendar with that user instead).

The bot lists Google Calendar events in a fixed time window and compares them to Discord scheduled events. Discord is the source of truth: each new Google event’s description includes the Discord scheduled event id so the next run can tell what is already synced—no separate state file on disk.

### Not used

Clustering Configuration (only needed if clustering.enabled is true), we will likely never cluster because it's for bots that serve 2,500+ guilds.

```
DISCORD_BOT_MASTER_API_TOKEN="token"
```

```
DISCORD_BOT_API_SECRET="secret"
```

## Bot reference

This section lists slash and context-menu commands, which Discord events the bot handles, scheduled jobs, and message-based triggers. The **composition** of the bot (which instances are wired together) lives in [`src/start-bot.ts`](src/start-bot.ts). Discord API shapes for registering commands are in [`src/commands/metadata.ts`](src/commands/metadata.ts). User-visible command names and descriptions default to English strings in [`lang/lang.en-US.json`](lang/lang.en-US.json) (`chatCommands`, `commandDescs`, `userCommands`).

### Commands

All commands below are registered with Discord via `npm run commands:register` (see [Setup](#setup)). Slash names shown are the default English values from the lang file.

| Command               | Type      | What it does                                                                                                                                                                                                                                                                                                      | Code                                                                                                                                                                         |
| --------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/dev`                | Slash     | Required option `command` (currently `info`): shows bot developer diagnostics (Node, TypeScript, discord.js versions, shard/server counts, memory, hostname, IDs). Restricted to users in `DISCORD_BOT_DEVELOPER_IDS`. Discord also marks the command as Administrator-only; the bot double-checks developer IDs. | [`src/commands/chat/dev-command.ts`](src/commands/chat/dev-command.ts)                                                                                                       |
| `/help`               | Slash     | Options: contact support embed, or commands overview embed (mentions `/test` and `/info`).                                                                                                                                                                                                                        | [`src/commands/chat/help-command.ts`](src/commands/chat/help-command.ts)                                                                                                     |
| `/info`               | Slash     | Options: **About** (bot info embed) or **Translate** (lists enabled languages and translators).                                                                                                                                                                                                                   | [`src/commands/chat/info-command.ts`](src/commands/chat/info-command.ts)                                                                                                     |
| `/test`               | Slash     | Smoke test: replies with a short “test works” embed. Rate limited.                                                                                                                                                                                                                                                | [`src/commands/chat/test-command.ts`](src/commands/chat/test-command.ts)                                                                                                     |
| `/rules`              | Slash     | Optional rule number: shows all server rules from [`src/constants/rules.ts`](src/constants/rules.ts) or a single rule.                                                                                                                                                                                            | [`src/commands/chat/rules-command.ts`](src/commands/chat/rules-command.ts)                                                                                                   |
| `/prag-papers`        | Slash     | Sends the Pragmatic Papers embed.                                                                                                                                                                                                                                                                                 | [`src/commands/chat/prag-papers-command.ts`](src/commands/chat/prag-papers-command.ts)                                                                                       |
| `/census`             | Slash     | Sends the Census embed.                                                                                                                                                                                                                                                                                           | [`src/commands/chat/census-command.ts`](src/commands/chat/census-command.ts)                                                                                                 |
| `/attendance`         | Slash     | While you are in a voice or stage channel, DMs you an immediate snapshot of everyone currently in that channel (names and user IDs).                                                                                                                                                                              | [`src/commands/chat/attendance-command.ts`](src/commands/chat/attendance-command.ts)                                                                                         |
| `/attendance-track`   | Slash     | Seeds the list with **everyone currently in** that voice/stage channel, then adds anyone who joins later (cumulative; leavers stay on the list). Final DM when **you** leave.                                                                                                                                     | [`src/commands/chat/attendance-track-command.ts`](src/commands/chat/attendance-track-command.ts), [`src/services/attendance-service.ts`](src/services/attendance-service.ts) |
| `Send Dev Onboarding` | User menu | Right-click a user → Apps. Sends the dev-team onboarding embed to that user’s DMs (content from [`src/constants/dev-onboarding.ts`](src/constants/dev-onboarding.ts)). Requires staff roles listed on the command class.                                                                                          | [`src/commands/user/send-dev-onboarding.ts`](src/commands/user/send-dev-onboarding.ts)                                                                                       |

**Not used yet:** message (context-menu) commands are not defined ([`MessageCommandMetadata`](src/commands/metadata.ts) is empty). **Buttons** and **reaction** handlers are wired up in [`src/start-bot.ts`](src/start-bot.ts) but the arrays are empty, so no custom button IDs or reaction handlers are active.

**Interaction routing:** [`src/models/bot.ts`](src/models/bot.ts) (`onInteraction`) sends slash and autocomplete traffic to [`CommandHandler`](src/events/command-handler.ts) and button interactions to [`ButtonHandler`](src/events/button-handler.ts).

### Discord event triggers

These are discord.js events the bot subscribes to in [`src/models/bot.ts`](src/models/bot.ts) (`registerListeners`). Each entry is gated on startup/`dummyMode` where noted in that file.

| Discord event        | Role                                                                                                                                                                                                                     | Handler                                                                                                                                                                |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ClientReady`        | Starts scheduled jobs (unless dummy mode), logs in, then for guild **DGG Political Action** and announcement channel **call-to-action**, loads CTA threads and refetches recent CTA messages to sync charts (see below). | [`src/models/bot.ts`](src/models/bot.ts)                                                                                                                               |
| `ShardReady`         | Sets shard id for logging.                                                                                                                                                                                               | [`src/models/bot.ts`](src/models/bot.ts)                                                                                                                               |
| `GuildCreate`        | Welcome flow: log, notify channel embed, DM guild owner.                                                                                                                                                                 | [`src/events/guild-join-handler.ts`](src/events/guild-join-handler.ts)                                                                                                 |
| `GuildDelete`        | Log that the bot left the server.                                                                                                                                                                                        | [`src/events/guild-leave-handler.ts`](src/events/guild-leave-handler.ts)                                                                                               |
| `GuildMemberAdd`     | Creates a per-member welcome thread (bots skipped).                                                                                                                                                                      | [`src/events/guild-member-add-handler.ts`](src/events/guild-member-add-handler.ts), [`src/services/welcome-thread-service.ts`](src/services/welcome-thread-service.ts) |
| `GuildMemberUpdate`  | Runs a list of “member update” use cases. Currently **no use cases** are registered ([`start-bot.ts`](src/start-bot.ts) passes `[]`).                                                                                    | [`src/events/guild-member-update-handler.ts`](src/events/guild-member-update-handler.ts)                                                                               |
| `MessageCreate`      | Runs message **triggers** (see next subsection). Skips system messages and the bot’s own messages.                                                                                                                       | [`src/events/message-handler.ts`](src/events/message-handler.ts) → [`TriggerHandler`](src/events/trigger-handler.ts)                                                   |
| `InteractionCreate`  | Commands (incl. autocomplete) and buttons.                                                                                                                                                                               | [`src/events/command-handler.ts`](src/events/command-handler.ts), [`src/events/button-handler.ts`](src/events/button-handler.ts)                                       |
| `MessageReactionAdd` | Custom reaction handlers (none configured).                                                                                                                                                                              | [`src/events/reaction-handler.ts`](src/events/reaction-handler.ts)                                                                                                     |
| `VoiceStateUpdate`   | Keeps attendance sessions in sync; when the tracking user leaves their channel, sends the attendance DM.                                                                                                                 | [`src/events/voice-state-update-handler.ts`](src/events/voice-state-update-handler.ts)                                                                                 |
| REST `RateLimited`   | Logs severe API rate limits (per `config.json` threshold).                                                                                                                                                               | [`src/models/bot.ts`](src/models/bot.ts)                                                                                                                               |

### Message triggers

Triggers implement [`Trigger`](src/triggers/trigger.ts): `triggered(msg)` and `execute(msg)`. They are evaluated on every incoming message that passes [`MessageHandler`](src/events/message-handler.ts).

| Trigger                  | When it runs                                                                              | What it does                                                                                                                                                                                                                                                                                                                                                      | Code                                                   |
| ------------------------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------ |
| **CTA (Call to Action)** | Message is in a guild channel named `call-to-action` (same channel the trigger resolves). | On new posts in that announcement channel: creates a public thread, prompts members to react with ✅ when done, collects regional squad roles, and posts/updates a pie chart of completions by region. Restarts an hourly reaction collector cycle. If the bot restarts, [`ClientReady`](src/models/bot.ts) reloads threads and re-processes recent CTA messages. | [`src/triggers/cta-post.ts`](src/triggers/cta-post.ts) |

### Jobs

Scheduled work uses [`node-schedule`](https://github.com/schedule/node-schedule) via [`JobService`](src/services/job-service.ts). Jobs are started when the client becomes ready (unless `debug.json` dummy mode is on).

| Job                            | Schedule (default)                                                                                               | What it does                                                                                                                                                                                            | Code                                                                                       |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **Auto Close Welcome Threads** | `0 0 * * * *` (top of every hour); see [`config/config.json`](config/config.json) `jobs.autoCloseWelcomeThreads` | Scans welcome channel threads in each guild, and deletes threads whose last message (or thread creation time) is older than `welcomeThread.inactivityDays` (default 5), after posting a closing notice. | [`src/jobs/auto-close-welcome-threads-job.ts`](src/jobs/auto-close-welcome-threads-job.ts) |

**Shard manager process:** [`src/start-manager.ts`](src/start-manager.ts) can run a separate set of manager-only jobs; that list is currently empty (only commented placeholders). The welcome-thread job runs on the **bot** process started by `start-bot.ts`, not on the manager.

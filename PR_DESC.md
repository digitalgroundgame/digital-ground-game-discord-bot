# Persist attendance tracking to Postgres + symmetric stop

## Summary

Reimplements `AttendanceService` on top of Postgres + Drizzle ORM. State now lives entirely in the database — there is no in-memory tracking map. Adds a symmetric stop path: `/attendance-stop`, plus a 5‑minute grace period after the leader leaves the tracked channel before the session auto‑finalizes. Also captures the meeting subject at session start (instead of at DM time) so the DM survives grace periods and bot restarts.

## What changed

### Database

- New `docker-compose.yml` with a Postgres 17 service for local dev.
- New `drizzle.config.ts`; `drizzle-orm`, `pg`, `drizzle-kit`, `@types/pg` added.
- Schema in `src/database/schema.ts`:
  - `session(id, session_leader, channel_id, channel_name, meeting_subject?, start_time, end_time?, leader_left_at?)`
  - `user_session(id, session_id → session.id ON DELETE CASCADE, user_id, display_name, start_time, end_time?)`
  - Snowflake columns are `varchar(20)` (max uint64 is 20 digits). `channel_name` is `varchar(100)` (Discord channel-name max). `display_name` is `varchar(32)` (Discord username/nickname/global-display-name max). `meeting_subject` is `varchar(120)` (covers stage topics, max 120, and scheduled-event names, max 100).
- `npm run db:push` / `npm run db:studio` scripts. Migrations are intentionally not used — schema changes are applied via `drizzle-kit push`.
- `DATABASE_URL` added to `.env.example` and `environment.d.ts`.
- `guildId` added to `config/config.json` and read by the service via `createRequire` (matches the pattern in `welcome-thread-service.ts`); guild id is no longer stored per session.

### `AttendanceService` (`src/services/attendance-service.ts`)

- DB is the only source of truth for "is a session active" — an active session is a `session` row whose `end_time` is null.
- Each enter/leave produces one `user_session` row, so a user can have multiple non‑overlapping intervals per `session`.
- The cumulative roster used for the DM is reconstructed via `SELECT DISTINCT ON (user_id) ...` from `user_session`, taking each user's most recent `display_name`.
- `startTracking` now also captures the active scheduled-event name (or stage topic) and stores it in `session.meeting_subject`.
- Finalization:
  - Single internal path (`finalizeAndEmit`) used by every trigger. Bails if the session is already ended (handles stop + timer races).
  - `stopTracking(userId)` is the explicit, symmetric counterpart to `startTracking`, used by `/attendance-stop`.
  - Leader leaves the tracked channel → `leader_left_at = now()` and a 5‑minute `setTimeout` is scheduled. Leader rejoins the same tracked channel → `leader_left_at = null` and the timer is cancelled.
  - Timers are kept in an in-memory `Map<sessionId, Timeout>`, but the source of truth is the persisted `leader_left_at` so grace periods survive restarts.
- `reconcileOnStartup()` runs after `ClientReady` and, for every active session with `leader_left_at IS NOT NULL`, either finalizes immediately (grace already elapsed) or re-arms the timer with the remaining time. Active sessions where the leader was still present at shutdown are left as-is.
- New `onFinalized(listener)` callback API — the DM listener is registered once in `start-bot.ts` and is reused by all three finalize triggers (stop command, grace timer, startup reconciliation).

### Commands & events

- New `/attendance-stop` command (`src/commands/chat/attendance-stop-command.ts`) — calls `stopTracking`, returns `attendanceTrackStopped` or `attendanceNotTracking`.
- `VoiceStateUpdateHandler` simplified — it now just delegates to `attendanceService.handleVoiceStateUpdate` and no longer owns DM logic.
- DM logic moved into the `onFinalized` listener wired in `start-bot.ts`. It uses the persisted `meeting_subject` instead of resolving at DM time (which was fragile across grace periods and restarts).
- `lang.en-US.json`: added `chatCommands.attendanceStop`, `commandDescs.attendanceStop`, `displayEmbeds.attendanceTrackStopped`, `displayEmbeds.attendanceNotTracking`. Updated `attendanceTrackStarted` and `attendanceAlreadyTracking` to mention `/attendance-stop`.
- `commands/metadata.ts` registers `ATTENDANCE_STOP`.

## Behavior changes (vs. previous in-memory implementation)

- Sessions persist across restarts; in-flight grace periods are resumed.
- Leader leaving no longer immediately finalizes — they have 5 minutes to come back. Either `/attendance-stop` or the timer firing finalizes.
- `user_session` rows now record actual presence intervals (open on join, close on leave). The cumulative roster shown in the DM is unchanged — still everyone who was ever in the session.
- The meeting subject is captured at session start, not at DM time.

## Migration / rollout

- `docker compose up -d` to start local Postgres.
- `npm run db:push` to create the tables.
- `npm run commands:register` to publish `/attendance-stop` to Discord.
- Set `guildId` in `config/config.json` and `DATABASE_URL` in `.env`.

## Test plan

- [ ] `docker compose up -d` and `npm run db:push` create the schema.
- [ ] `/attendance-track` in a VC inserts a `session` row + one `user_session` row per current member; the embed mentions `/attendance-stop`.
- [ ] A user joining the tracked channel inserts a `user_session` row; leaving closes it (`end_time` set). Multiple enter/leave cycles produce multiple non-overlapping rows.
- [ ] Leader leaves → `session.leader_left_at` is set, no DM yet. Leader rejoins within 5 min → `leader_left_at` cleared, no DM. Leader leaves and stays away 5 min → timer fires, DM sent, `session.end_time` set.
- [ ] `/attendance-stop` while tracking → session finalized immediately, DM sent. `/attendance-stop` while not tracking → "not currently tracking" reply.
- [ ] Restart bot mid-grace-period → session finalizes at the originally scheduled time (or immediately if grace already elapsed).
- [ ] DM includes `Subject: …` line when an active scheduled event was linked to the channel at start time.

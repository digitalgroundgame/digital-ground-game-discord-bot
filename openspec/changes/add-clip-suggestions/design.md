# Design

## Context

See proposal.md for motivation and specs/clip-suggestions/spec.md for required behavior.

Relevant existing pieces:

- Chat commands implement `Command` (`src/commands/command.ts`) and are registered in `src/start-bot.ts`. Registration metadata lives in `src/commands/metadata.ts`, and options are defined in `src/commands/args.ts` with lang-driven names and descriptions in `lang/lang.en-US.json`.
- `CommandUtils.runChecks` (`src/utils/command-utils.ts`) already handles per-command `cooldown` (replies with `validationEmbeds.cooldownHit`) and `requireRoles` (replies with `validationEmbeds.missingRole`). An empty `requireRoles` skips the role check.
- Its client-permission check only covers the channel where the command was run, not a different destination channel.
- Config-driven role gates read `config.json` through a constants module and validate keys with `validateAllowedRoleKeys` (see `src/constants/kudos.ts`, `src/constants/skill-roles.ts`). `config/config.json` is tracked in git.
- Posting to a configured channel id has a precedent in `PragmaticPapersIntegration` (`integrations.pragmaticPapers.publishChannelId`).
- `ClientUtils.getChannel` (`src/utils/client-utils.ts`) fetches any channel by id, threads included, and returns `null` for unknown or inaccessible ids.
- The media team has no place for clip suggestions today. They're choosing between a dedicated forum or channel and a megathread post in the existing request board forum. The destination has to be swappable through config alone, between any of those, and the bot must run before it is set.

## Goals / Non-Goals

**Goals:**

- Keep timestamp parsing, URL classification and deep-link building as pure functions with no Discord dependency, so the spec's parsing scenarios are covered by unit tests.
- Make phase 2 (buttons, status tags, persistence) additive: nothing in phase 1 should need rework to add it.

**Non-Goals:**

- No network calls beyond posting to Discord: no title lookups and no checks that the video exists.
- No persistence: a suggestion exists only as the Discord post or message.
- No cross-shard delivery. The bot serves a single guild, so the destination channel is resolved from the guild where `/clip` was run.

## Decisions

### 1. Slash command options, not a modal

`/clip url start end note` as options. Defer the reply as `HIDDEN`, so every response is private.

- _Why:_ there are four short fields and a pasted link is often enough on its own, so one step is the lowest-friction path. Options also keep `deferType` simple: the modal path requires `CommandDeferType.NONE` plus manual deferral, as in `ContentCommand`.
- _Alternative:_ a modal via `ModalUtils.collect`. It gives a bigger note field but adds a second screen. It can be revisited if notes turn out to be long.

### 2. Pure helpers in a new `src/utils/clip-utils.ts`

`ClipUtils` (static class, matching the other utils) exposes:

- `parseTimestamp(input): number | null`: seconds, or null if unrecognized.
- `formatTimestamp(seconds): string`: `H:MM:SS` when there are hours, `M:SS` otherwise.
- `parseClipUrl(input): { url: URL, platform: 'youtube' | 'twitch' | 'other', videoId?: string, linkSeconds?: number } | null`: null for anything other than absolute `http:`/`https:`.
- `buildDeepLink(parsed, startSeconds): string`.

These are exported through `src/utils/index.ts`.

Parsing rules (see the spec's timestamp requirements):

- Colon form, three parts: minutes and seconds each `< 60`.
- Colon form, two parts: seconds `< 60`, minutes unbounded.
- Unit form: regex `^(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?$`, case-insensitive, at least one group present.
- Plain digits are seconds.
- `t` on a URL is parsed with the same function, unchanged. YouTube's `t=3723s` already matches the unit form as 3723 seconds. Stripping the trailing `s` first would break unit-form values such as `t=1h2m3s`.

Deep links are canonical rather than edits of the submitted URL, so tracking parameters, playlists and old timestamps are dropped:

- YouTube: `https://www.youtube.com/watch?v=<id>&t=<seconds>s`. This also normalizes `youtu.be`, `/live/` and `/shorts/` forms.
- Twitch: `https://www.twitch.tv/videos/<id>?t=<h>h<m>m<s>s`. Twitch expects unit form.
- Other: the submitted URL as normalized by the WHATWG `URL` parser (`url.href`). For ordinary links this is identical to what was pasted. The parser only lowercases the host, adds a `/` to a bare domain and percent-encodes characters such as spaces. Discord requires a valid URL for an embed's link, so the normalized form is the safe one to post.

_Alternative:_ setting `t` on the submitted URL. Rejected because the behavior of `t` on `/live/` and `/shorts/` paths is inconsistent, and keeping other parameters adds noise.

### 3. Config section and constants module

Add `clipSuggestions` to `config/config.json`, with a `// NOTE` key like the neighboring sections:

```json
"clipSuggestions": {
  "// NOTE": "...",
  "channelId": "",
  "allowedRoleKeys": []
}
```

`src/constants/clip-suggestions.ts` exports:

- `ClipSuggestionsChannelId: string | undefined`: trimmed; empty means unset.
- `ClipSuggestionsAllowedRoleKeys`: through `validateAllowedRoleKeys(..., { allowEmpty: true })`, following `KudosGiveAllowedRoleKeys`.

A missing channel id is a runtime "not set up yet" reply, not a startup error, because the channel may not exist yet.

### 4. Destination resolved per submission, branched on channel type

At execute time, the command resolves `ClipSuggestionsChannelId` with `ClientUtils.getChannel`. It treats `null`, or a channel whose `guildId` isn't the guild `/clip` was run in, as "could not be delivered". It then branches:

- `ChannelType.GuildForum`: `channel.threads.create({ name, message: { embeds: [embed], allowedMentions: { parse: [] } } })`. The post title is the note (truncated) followed by `@ <start>`, or `Clip @ <start>[ - <end>]` without a note. It is capped at 100 characters with `StringUtils.truncate`.
- `GuildText` / `GuildAnnouncement`: `channel.send({ embeds: [embed], allowedMentions: { parse: [] } })`.
- A thread (`channel.isThread()`), which covers a megathread post in a forum and a thread under a text channel:
  - If `channel.locked`, it is reported as could not be delivered.
  - Otherwise `channel.send(...)` with the same payload. Discord unarchives an archived, unlocked thread when a message is sent to it, so auto-archived megathreads need no special handling.
- Anything else: logged as misconfiguration, and the submitter is told it could not be delivered.

Before sending, the command checks `channel.permissionsFor(guild.members.me)` for `ViewChannel` and `EmbedLinks`, plus `SendMessagesInThreads` for a thread or `SendMessages` otherwise, so a missing permission is reported clearly. A send rejected anyway is caught, logged and reported the same way. Examples: a forum with "require tags" enabled, or a private thread the bot isn't a member of.

_Why threads are supported:_ a megathread in the request board is one of the options the media team is weighing. Supporting it costs one branch, and keeps their choice a config edit.

- _Why per submission:_ the bot keeps running and picks up config changes on restart, and a deleted channel doesn't break startup.
- _Alternative:_ resolving once at startup. Rejected for that reason.

### 5. One embed, built in code

The embed carries:

- Title: platform name or "Clip suggestion", with `url` set to the deep link.
- Fields: Start, plus End and Length when given, and Link (the deep link as text, for copying).
- Note: as the description.
- Submitter: shown as an author line or field, using a mention (`<@id>`). Mentions in embeds don't ping, and `allowedMentions: { parse: [] }` is set anyway as a guard on the note.

Static strings (field names, "Clip suggestion", error and confirmation embeds) go in `lang/lang.en-US.json` under `displayEmbeds.clip*` and `refs.clip*`. Dynamic fields are added with `embed.addFields`, as `ContentCommand.show` does.

The note option has `max_length` 500, like `PING_SKILL_ROLE_NOTE`, so it fits an embed description with no truncation logic.

### 6. Cooldown via the existing `RateLimiter`

`cooldown = new RateLimiter(3, 60_000)`, so `CommandUtils.runChecks` enforces it and replies. This stops a single member flooding the media channel; it doesn't try to catch duplicate suggestions (phase 2).

### 7. Phase-2 seams

The forum post or message the bot creates is owned by the bot, so phase 2 can:

- attach Claim/Done/Pass buttons (`src/buttons/`) to that message,
- let the bot retag the post, which clippers can't do on bot-owned posts without Manage Threads,
- add a table keyed on platform + video id + start for duplicate detection, using the same `ClipUtils.parseClipUrl` output.

Phase 1 adds no buttons and no forum tags.

## Risks / Trade-offs

- **[Risk] The media team wants a different destination or workflow.** → The destination is config-only and works with a forum, a text channel or a single thread. Switching needs a config edit and restart, not a code change.
- **[Risk] A megathread destination gets locked, or moderators archive it for good.** → A locked thread is reported to the submitter as could not be delivered and logged, so the problem is visible. An archived, unlocked thread reopens itself when the bot posts.
- **[Trade-off] A megathread has no per-clip discussion or status tags.** Replies about different clips mix together, and phase 2's forum tags won't apply there (Claim/Done buttons and duplicate "+1" replies still work, since they attach to messages). It's acceptable for a trial. Moving to a dedicated forum later is a `channelId` change.
- **[Risk] Spam or low-quality submissions, since the command is open to everyone by default.** → A per-member cooldown, plus `allowedRoleKeys` to restrict submitters through config alone.
- **[Risk] A forum with "Require tags when posting" rejects the bot's untagged posts.** → The failure is caught and logged, and the submitter is told. The README/config note says to leave that setting off (or grant the bot Manage Threads) until phase 2 adds tags.
- **[Risk] Platform URL formats change, or extra YouTube hosts (for example `music.youtube.com`) appear.** → Unknown forms fall back to "other" and are posted as given, so suggestions still arrive; the hosts list is easy to extend.
- **[Trade-off] No title lookup.** Forum post titles fall back to `Clip @ 1:02:03` when there's no note, which is less scannable. The note option gives submitters a way to label it, and an oEmbed lookup can come later.
- **[Trade-off] Canonical deep links drop playlist and other parameters** from the submitted URL. Clippers only need the video at the moment.

## Migration Plan

1. Merge with `clipSuggestions.channelId` empty; `/clip` replies "not set up yet".
2. Run `pnpm run commands:register` to publish `/clip`.
3. Once the media team picks a destination, set `channelId` to the forum, channel or megathread post id. Make sure the bot has View Channel and Embed Links there, plus Send Messages (forum or channel) or Send Messages in Threads (megathread). Then restart.

The recommended path, shared with the media team, is to start with a megathread post in the request board as a low-setup trial. If volume justifies it, move to a dedicated forum, which also unlocks phase 2's status tags. Each step is a `channelId` change.

Rollback: remove the command, or clear `channelId` and restart to disable delivery without new code.

## Open Questions

- Which destination to use: a megathread in the request board, or a dedicated forum or channel. The media team is discussing it. Any choice is a config value and doesn't change this design.
- Whether to restrict submitters to certain roles. The media team currently favors everyone in the server (the default), and possibly a wider audience later. The wider audience is deferred to a separate change (see proposal.md). A restriction would be a config value.

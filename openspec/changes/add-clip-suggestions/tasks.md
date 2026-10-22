# Tasks

## 1. Timestamp and link parsing

- [x] 1.1 Add `ClipUtils.parseTimestamp` and `ClipUtils.formatTimestamp` in `src/utils/clip-utils.ts`, exported from `src/utils/index.ts`, following design decision 2's rules (three-part colon with minutes/seconds < 60, two-part colon with seconds < 60, case-insensitive `h`/`m`/`s` unit form, plain seconds, surrounding whitespace trimmed). Verify with `tests/utils/clip-utils.test.ts`, covering every scenario under "Timestamps accept common formats" (including the `1:75:00` and free-text rejections), plus formatting `3723 -> 1:02:03` and `70 -> 1:10`.
- [x] 1.2 Add `ClipUtils.parseClipUrl`. It accepts only absolute `http:`/`https:` URLs; classifies YouTube (`watch?v=`, `youtu.be/<id>`, `/live/<id>`, `/shorts/<id>`, `www.`/`m.` hosts) and Twitch (`/videos/<id>`) links; and reads a `t` parameter through `parseTimestamp` unchanged (the unit form already covers `3723s`). Verify with unit tests for each host/path form, the "Only web links are accepted" rejections (`javascript:`, `ftp:`, free text), and `t=3723`, `t=3723s` and `t=1h2m3s`.
- [x] 1.3 Add `ClipUtils.buildDeepLink`, producing the canonical YouTube `watch?v=<id>&t=<n>s` link, the Twitch `videos/<id>?t=<h>h<m>m<s>s` link, and the unchanged URL for other platforms. Verify with unit tests matching the scenarios under "YouTube and Twitch links open at the start time" and "Other links are posted as given".

## 2. Configuration

- [x] 2.1 Add a `clipSuggestions` section to `config/config.json` with a `// NOTE`, `"channelId": ""` and `"allowedRoleKeys": []`. The NOTE should say:
  - `channelId` may be a forum, a text/announcement channel, or a single thread (for example a megathread post in the request board).
  - An empty channel disables delivery.
  - An empty role list means everyone can submit.
  - A forum destination should not require tags. Verify that `config.json` still parses and the bot config loads in `pnpm test`.
- [x] 2.2 Add `src/constants/clip-suggestions.ts`, exporting `ClipSuggestionsChannelId` (trimmed; `undefined` when empty or missing) and `ClipSuggestionsAllowedRoleKeys` (through `validateAllowedRoleKeys` with `allowEmpty: true`), re-exported from `src/constants/index.ts`. Verify with `pnpm run check-types` and a constants test confirming that an unknown role key throws and an empty channel id resolves to `undefined`.

## 3. `/clip` command

- [x] 3.1 Add lang entries in `lang/lang.en-US.json`: `chatCommands.clip`, `commandDescs.clip`, argument names and descriptions for url/start/end/note, embed labels, and `displayEmbeds` for the success reply, the not-set-up reply, the delivery failure, invalid URL, missing start, unrecognized time (naming the field and listing formats) and end-not-after-start. Verify the JSON parses and `Lang.getRef` resolves each new key in the command test.
- [x] 3.2 Add `CLIP_URL`, `CLIP_START`, `CLIP_END` and `CLIP_NOTE` options to `src/commands/args.ts` (strings; note `max_length` 500) and a `CLIP` entry to `ChatCommandMetadata` in `src/commands/metadata.ts` with `dm_permission: false`, `url` required and the rest optional. Verify with `pnpm run check-types` and `pnpm run build`.
- [x] 3.3 Implement `ClipCommand` in `src/commands/chat/clip-command.ts`: deferType `HIDDEN`, `cooldown = new RateLimiter(3, 60_000)`, `requireRoles` from `ClipSuggestionsAllowedRoleKeys`. It validates input in the order url, start (option overrides the link), end > start; builds the embed (design decision 5); resolves the destination with `ClientUtils.getChannel` and requires it to be in the same guild; checks the bot's `ViewChannel`/`EmbedLinks` plus `SendMessagesInThreads` (thread) or `SendMessages` (otherwise); and delivers per design decision 4: a new forum post for a forum, or a message for a text/announcement channel or an unlocked thread. Every outgoing message uses `allowedMentions: { parse: [] }`. It then replies privately with a link to the post or message, or with the matching error embed, and logs delivery failures. Verify with `tests/commands/clip-command.test.ts` using `tests/helpers/discord-mocks.ts`, covering:
  - a forum post is created (title holds the start time and the truncated note);
  - a text channel message is sent;
  - a thread destination (a megathread post) gets a message and no new post is created;
  - an archived, unlocked thread still gets the message;
  - a locked thread, a channel in another guild, an unknown channel, an unsupported channel type, missing permissions (including missing `SendMessagesInThreads` on a thread) and a rejected send each reply with the delivery failure and log it;
  - a timestamped link alone is accepted;
  - an explicit start overrides the link's;
  - missing start, bad time, end <= start and an invalid URL each reply with an error and post nothing;
  - an unset channel id replies "not set up";
  - mentions are disabled on the outgoing message.
- [x] 3.4 Export `ClipCommand` from `src/commands/chat/index.ts` and add `new ClipCommand()` to the command list in `src/start-bot.ts`. Verify with `pnpm run check-types`, and check that `/clip` appears in the sorted registration payload (`ChatCommandMetadata` includes `CLIP`).

## 4. Documentation

- [x] 4.1 Add `docs/ClipSuggestions.md` for server admins and the media team. It covers what `/clip` accepts (with format examples), how to set `clipSuggestions.channelId` and `allowedRoleKeys`, and the three destination options (dedicated forum, text channel, or a megathread post in the request board) with their trade-offs, since a megathread has no per-clip threads or status tags. It also covers how to copy a forum post's id for the megathread option, the bot permissions each destination type needs (Send Messages in Threads for a megathread), that a locked megathread stops delivery, the forum "require tags" caveat, and that `pnpm run commands:register` is needed once after deploy. Verify that each config key and command option named in the doc matches `config/config.json` and `src/commands/args.ts`.

## 5. Integration checks

- [x] 5.1 Run `pnpm run check-types`, `pnpm run lint`, `pnpm run format` and the full `pnpm test`, since this touches command routing, and verify all pass.
  - `check-types` and `lint` pass.
  - `format` fails repo-wide, but not because of this change. The failures are files checked out with CRLF line endings (`core.autocrlf`) and untracked OpenSpec tooling files under `.claude/`. Every file this change touches passes `prettier --check`.
  - `pnpm test` fails 2 of 447: both `stop-attendance-track-command` tests time out at 5s. The same two tests fail on the pre-change commit (2d27b0b) under the same conditions. All clip tests (105) pass.

## Workflow follow-up

- After merge, run `pnpm run commands:register` with production credentials to publish `/clip`.
- Once the media team picks a destination (megathread in the request board, or a dedicated forum or channel) and any role restriction, set `clipSuggestions` in `config/config.json`, confirm the bot's permissions there, and restart.
- Archive the change after review.

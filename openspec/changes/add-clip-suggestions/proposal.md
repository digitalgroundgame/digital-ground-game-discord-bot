# Proposal

## Why

The media team wants more clip suggestions from the community, and submitting "this video, at this time" is currently informal. A bot command gives members a low-friction way to send a timestamped suggestion and gives clippers a consistent, one-click link that jumps to the moment (issue #166).

## What Changes

- Add a `/clip` slash command any server member can run, with options:
  - `url` (required): link to an online video (VOD). A link that already carries a timestamp (for example YouTube `&t=1h2m3s`) is enough on its own.
  - `start` (required unless the URL already has a timestamp): accepts `1:02:03`, `62:03`, `1h2m3s`, or plain seconds.
  - `end` (optional): must be after `start`.
  - `note` (optional): short context for the clipper.
- Parse and validate the timestamps and, for YouTube and Twitch links, build a deep link that opens the video at the start time. Other `http(s)` links are accepted and posted as given, alongside the stated time range.
- Post each suggestion to one destination configured in `config.json`. A forum channel gets one post per suggestion. A text or announcement channel, or a single thread (for example a megathread post in the existing request board forum), gets one embed message per suggestion.
- Reply privately to the submitter with a link to the created post, or with a clear error if the input is invalid or the destination is not configured or not reachable.
- Add a `clipSuggestions` section to `config.json` (destination channel id, allowed role keys defaulting to "everyone") so the destination can be set or changed without code changes.

Out of scope for this change (candidates for a later phase): moments in live streams, claim/done/pass buttons and status tags, a database or duplicate detection, Democracy Points for clips, a right-click "Suggest clip" message command, and video title lookup.

Also deferred: submissions from people outside this Discord server. The media team would like regulars from Destiny's official (destiny.gg) chat to be able to submit, and possibly a wider audience after that. Those people can't use a Discord slash command, so reaching them needs a separate intake (for example a web form or a destiny.gg chat integration), planned as its own change.

## Capabilities

### New Capabilities

- `clip-suggestions`: How members submit timestamped clip suggestions for online videos, how the bot validates and normalizes timestamps and links, and how suggestions are delivered to the media team's configured channel or thread.

### Modified Capabilities

<!-- None: no existing specs. -->

## Impact

- New command: `src/commands/chat/clip-command.ts`, exported from `src/commands/chat/index.ts`, wired in `src/start-bot.ts`.
- Command registration: new entry in `src/commands/metadata.ts` and new options in `src/commands/args.ts`; strings in `lang/lang.en-US.json`. Requires `pnpm run commands:register` after merge.
- New pure parsing/link-building helpers (likely `src/utils/`) with focused Vitest coverage under `tests/`.
- New config section in `config/config.json` and a constants module in `src/constants/` that reads and validates it.
- Discord permissions: the bot needs View Channel and Embed Links in the destination, plus Send Messages for a forum or text channel (this covers creating forum posts) or Send Messages in Threads for a thread destination.
- No database, schema or dependency changes.

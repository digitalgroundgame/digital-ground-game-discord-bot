# Clip Suggestions

`/clip` lets server members suggest a moment from an online video for the media team to clip. The bot posts each suggestion to one configured destination with a link that opens the video at the suggested time.

## Using `/clip`

| Option | Required | What it takes |
| --- | --- | --- |
| `url` | Yes | A full `http(s)` link to the video. |
| `start` | Unless the link has a timestamp | Where the clip starts. |
| `end` | No | Where the clip ends. Must be after `start`. |
| `note` | No | What happens in the clip (up to 500 characters). |

Times can be written as `1:02:03`, `62:03`, `1h2m3s`, `45m`, `90s`, or plain seconds (`3723`).

A link that already carries a timestamp (for example `https://www.youtube.com/watch?v=abc123&t=1h2m3s`) works on its own. If you also give `start`, `start` wins.

YouTube videos (`youtube.com/watch`, `youtu.be`, `/live/`, `/shorts/`) and Twitch VODs (`twitch.tv/videos/<id>`) are posted as a link that opens at the start time. Links to any other site are posted as given, with the time range alongside.

The submitter gets a private reply with a link to the posted suggestion, or a message explaining what to fix. Each member can submit up to 3 suggestions a minute.

## Config

`config/config.json` → `clipSuggestions`:

| Field | Purpose |
| --- | --- |
| `channelId` | Where suggestions go: a forum channel, a text or announcement channel, or a single thread (such as a forum post). Leave empty (`""`) to disable delivery; `/clip` then replies that suggestions aren't set up yet. Must be a quoted string. |
| `allowedRoleKeys` | Role keys (from `roles`) allowed to run `/clip`. An empty list lets every member submit. An unknown key stops the bot at startup. |

Restart the bot after changing either field.

## Choosing a destination

| Destination | What the bot posts | Trade-offs |
| --- | --- | --- |
| Dedicated forum channel | One new post per suggestion, titled with the note and time | Each clip gets its own discussion. Easy to browse. Needs a new channel. |
| Megathread (a single post in an existing forum, such as the request board) | One message per suggestion inside that post | No new channel needed. Suggestions and replies share one long scroll, and there are no per-clip threads or tags. |
| Text or announcement channel | One message per suggestion | Simplest. No per-clip discussion unless someone opens a thread. |

Switching later is a `channelId` change and a restart.

### Getting the ID

Turn on **Developer Mode** (User Settings → Advanced), then right-click the channel, or the forum post for a megathread, and choose **Copy Channel ID**. A forum post's ID is its thread ID, which is what `channelId` needs for the megathread option.

## Bot permissions

| Destination | The bot needs |
| --- | --- |
| Forum or text/announcement channel | View Channel, Send Messages, Embed Links |
| Megathread / any thread | View Channel, Send Messages in Threads, Embed Links |

If anything goes wrong, the submitter is told their suggestion couldn't be delivered and the cause is logged. This covers a missing permission, a deleted channel, or a channel of an unsupported type. It also covers these destination-specific cases:

- **Locked thread:** a locked megathread stops delivery until it's unlocked. Discord auto-archives an inactive thread; that's fine, because the bot's next post reopens it.
- **Forum that requires tags:** if the forum has **Require tags when posting** turned on, Discord rejects the bot's untagged posts. Leave that setting off for a dedicated clip forum, or give the bot Manage Threads.

## Deploying

After the change that adds `/clip` is deployed, run `pnpm run commands:register` once so Discord shows the command.

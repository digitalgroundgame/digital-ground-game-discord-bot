# DM History Integration

Reads the bot's DM conversation with one user, a page at a time. The in-house CRM uses it to show
the replies contacts send to DMs it delivered through the [DM proxy](./DmProxyIntegration.md).

The endpoint returns every message in the conversation. The bot DMs users for many reasons
(reminders, command responses, staff messages), so callers pick out the messages they care about,
for example by the `messageId`s the DM proxy returned for their own sends.

## Endpoint

```
POST /integrations/dm-history
```

Authenticated via `Authorization` header. The API key is read from the `INTEGRATION_DM_HISTORY`
environment variable — a different key from the DM proxy's, since reading DMs exposes more than
sending them. If the env var is unset, the route is skipped at startup and a warning is logged.

## Request shape

```json
{
  "userId": "123456789012345678",
  "limit": 50,
  "before": "223456789012345678"
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string | yes | Discord user ID (snowflake, 17–20 digits). Must be a string — JSON numbers lose snowflake precision. |
| `limit` | integer | no | 1–100 messages, default 50. Discord caps one page at 100. |
| `before` | string | no | A message ID: return the messages just before it, to page further back. |
| `after` | string | no | A message ID: return the messages just after it, to pick up what is new. |

Pass `before` or `after`, not both. With neither, the page is the most recent messages.

Like the DM proxy, the read runs on a single shard and is capped at 30 seconds. Opening the DM
channel to read it sends nothing to the user, and a user the bot has never DMed returns an empty
page.

## Responses

| Status | Body | Meaning |
| --- | --- | --- |
| `200` | `{ "error": false, "channelId": "...", "messages": [...] }` | One page of the conversation, oldest first. |
| `404` | `{ "error": true, "reason": "unknown_user" }` | No Discord user with that ID (Discord `10013`). |
| `400` | `{ "error": true, "message": "..." }` | Invalid `userId`, `limit`, `before` or `after`, or a body that is not parseable JSON. |
| `401` | (empty) | Missing or incorrect `Authorization` header. |
| `502` | `{ "error": true, "reason": "discord_error", "code": n, "message": "..." }` | Discord rejected the read for another reason. |
| `500` | `{ "error": true, "message": "..." }` | Unexpected error, no shard running, or the shard did not answer within 30 seconds. |

A read is safe to retry.

Each message:

| Field | Type | Notes |
| --- | --- | --- |
| `id` | string | Message ID. |
| `authorId` | string | Discord user ID of the author: the requested `userId` for the user's messages, the bot's ID for its own. |
| `content` | string | Message text. Empty for a message that is only attachments or embeds. |
| `createdAt` | string | ISO 8601 timestamp. |
| `editedAt` | string \| null | ISO 8601 timestamp of the last edit. |
| `referencedMessageId` | string \| null | The message this one replies to, when the user used Discord's Reply. |
| `attachments` | array | `{ id, name, url, contentType }` for each file. Discord's attachment URLs expire, so fetch a fresh page rather than storing them. |
| `reactions` | array | `{ emoji, count, me }` for each emoji on the message. `emoji` is the emoji itself, or `:name:` for a custom one. `count` includes the bot's own reaction when `me` is true, so in a DM the user has reacted when `count` is more than `me` accounts for. |

## Paging

The page is oldest first. To go further back, pass the first message's `id` as `before`. To pick
up new messages since a page, pass its last message's `id` as `after`. A page shorter than `limit`
means there is nothing more in that direction.

## Example

```bash
curl -X POST http://localhost:3000/integrations/dm-history \
  -H "Content-Type: application/json" \
  -H "Authorization: abc123" \
  -d '{ "userId": "123456789012345678", "limit": 20 }'
```

## DM forwarding to the CRM

So the CRM knows when to read a conversation, the bot also pushes to it. Both calls use the CRM
Service's DRF token (`CRM_API_URL` and `CRM_API_TOKEN`, the same pair `/attendance-track` uses).

- **Each DM.** When a person (not a bot, and not a system message) DMs the bot, the Message Handler
  POSTs `{ "message_id", "channel_id", "author_id", "created_at" }` to
  `/api/discord/inbound-dms/`, with `created_at` as an ISO 8601 string. The message text is never
  sent; the CRM reads it through `/integrations/dm-history` if it needs it. The bot forwards every DM and keeps no
  subscription state, so the CRM decides which ones matter. The call is not awaited, so trigger
  processing doesn't wait on it.
- **Each reaction to the bot's DMs.** When a person adds or removes a reaction on a message the
  bot sent them in a DM, the bot POSTs `{ "message_id", "user_id", "emoji", "added" }` to
  `/api/discord/inbound-reactions/`. `emoji` is formatted as in `reactions` above, and `added` is
  false for a removal. Reactions in servers, and to the person's own messages, are not forwarded.
- **Catch-up at startup.** Once per manager start, after the shards and the API are up, the manager
  POSTs to `/api/discord/inbound-dms/catch-up/`, and the CRM re-reads the DM history the bot missed
  while it was down.

Each request is retried once, about 2 seconds later, after a network error or a 5xx. After that
the bot logs a warning and moves on. While `crm.enabled` is true in `config/config.json` (the
default), the bot and the manager both refuse to start without `CRM_API_URL` and `CRM_API_TOKEN`.
With it false, no request is sent.

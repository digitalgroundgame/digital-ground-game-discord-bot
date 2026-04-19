# Pragmatic Papers Integration

Receives event webhooks from [Pragmatic Papers](https://pragmaticpapers.com) and relays them to Discord.

## Endpoint

```
POST /integrations/pp-event
```

Authenticated via `Authorization` header. The API key is read from the `INTEGRATION_PRAGMATIC_PAPERS` environment variable. If the env var is unset, the route is skipped at startup and a warning is logged — the integration is effectively disabled.

## Config

`config/config.json` → `integrations.pragmaticPapers`:

| Field | Purpose |
| --- | --- |
| `name` | Human-readable name. Drives the env var lookup (`INTEGRATION_<UPPER_SNAKE>`). |
| `publishChannelId` | Discord channel ID where `publish` events are posted. |

## Request shape

All events share a common envelope:

```json
{
  "event": "<event-name>",
  "payload": { ... }
}
```

Unknown events return `400` with an `unhandled event` message. Invalid payloads for a known event return `400` with a type error.

### `publish`

Posts an embed announcing a new Volume to `publishChannelId`.

Payload:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `volumeNumber` | number | yes | |
| `title` | string | no | Appended to the embed title. |
| `articles` | `{ name: string, slug: string }[]` | yes | Rendered as a bulleted list of links. |

## Example

```bash
curl -X POST http://localhost:9010/integrations/pp-event \
  -H "Content-Type: application/json" \
  -H "Authorization: abc123" \
  -d '{
    "event": "publish",
    "payload": {
      "volumeNumber": 42,
      "title": "The Answer Issue",
      "articles": [
        { "name": "On Towels", "slug": "on-towels" },
        { "name": "Deep Thought", "slug": "deep-thought" }
      ]
    }
  }'
```

Responses:

- `200` — event handled.
- `400` — missing/invalid `event` field, invalid payload, or unhandled event name.
- `401` — missing/incorrect `Authorization` header.
- `500` — unexpected error while handling the event.

## Adding a new event type

1. Define a `PP<Name>Event` interface with a literal `event` discriminant and typed `payload`.
2. Add it to the `PPEvent` union in `src/integrations/pragmatic-papers-integration.ts`.
3. Add a `validate<Name>Event` assertion function and a `handle<Name>` method.
4. Branch on `event.event === '<name>'` inside `run()`.

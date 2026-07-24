# DM Proxy Integration

Centralized endpoint for sending Discord DMs on behalf of other services. The in-house CRM
uses it for volunteer notifications (event reminders); future callers should route their DMs
through it too, so all outbound DMs share one auth, delivery, and error-handling path.

## Endpoint

```
POST /integrations/send-dm
```

Authenticated via `Authorization` header. The API key is read from the `INTEGRATION_DM_PROXY`
environment variable. If the env var is unset, the route is skipped at startup and a warning is
logged — the integration is effectively disabled.

## Config

`config/config.json` → `integrations.dmProxy`:

| Field | Purpose |
| --- | --- |
| `name` | Human-readable name. Drives the env var lookup (`INTEGRATION_<UPPER_SNAKE>`). |

## Request shape

```json
{
  "userId": "123456789012345678",
  "message": "Reminder: you're signed up for ..."
}
```

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `userId` | string | yes | Discord user ID (snowflake, 17–20 digits). Must be a string — JSON numbers lose snowflake precision. |
| `message` | string | yes | 1–2000 characters, sent verbatim as the DM content. Discord timestamp markup (`<t:unixseconds:F>`) renders in the recipient's local timezone. |

The DM is dispatched through a `broadcastEval` pinned to shard 0 — `client.users.fetch()`
succeeds on every shard, so an unpinned broadcast would deliver one DM per shard.

## Responses

| Status | Body | Meaning |
| --- | --- | --- |
| `200` | `{ "error": false, "delivered": true }` | DM delivered. |
| `200` | `{ "error": false, "delivered": false, "reason": "dms_closed" }` | User has DMs disabled or blocked the bot (Discord `50007`). Terminal — do not retry. |
| `404` | `{ "error": true, "delivered": false, "reason": "unknown_user" }` | No Discord user with that ID (Discord `10013`). Terminal — do not retry. |
| `400` | `{ "error": true, "message": "..." }` | Invalid `userId` or `message`. |
| `401` | (empty) | Missing or incorrect `Authorization` header. |
| `502` | `{ "error": true, "delivered": false, "reason": "discord_error", "code": n, "message": "..." }` | Discord rejected the send for another reason. |
| `500` | `{ "error": true, "message": "..." }` | Unexpected error. |

## Retry guidance for callers

- **Never retry** a `200` (`delivered: false` means the user opted out at the Discord level) or a `404` — both are terminal.
- Retry only on `5xx`/network failures, and prefer retrying on your next scheduled run over
  immediate retries: a request that failed after Discord accepted the send would deliver a
  duplicate DM.

## Example

```bash
curl -X POST http://localhost:3001/integrations/send-dm \
  -H "Content-Type: application/json" \
  -H "Authorization: abc123" \
  -d '{
    "userId": "123456789012345678",
    "message": "Reminder: you are signed up for **Phone Bank** on <t:1753380000:F> (<t:1753380000:R>)."
  }'
```

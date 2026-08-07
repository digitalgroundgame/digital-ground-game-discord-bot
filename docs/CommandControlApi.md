# Bot control API

The manager exposes command administration and on-demand calendar sync through its HTTP API. These routes require `DISCORD_BOT_CONTROL_API_SECRET` in the `Authorization` header. Use a separate long random value for this secret; do not reuse `DISCORD_BOT_API_SECRET`.

The examples below use the local API URL. For a remote deployment, replace `http://localhost:3000` with its HTTPS URL. Do not send the control secret over unencrypted HTTP.

These requests are synchronous: the connection stays open until the bot finishes the operation, and the manager gives up after 5 minutes. A reverse proxy with a shorter timeout may return `504` while the operation is still running. In that case, retries receive HTTP 409 until it completes; check the bot logs rather than retrying.

Each request is forwarded to a ready Discord shard, which uses the already-running bot build. Only one operation of each type runs at a time per process; a concurrent request receives HTTP 409. In a clustered deployment the command-operation guard does not span containers, so avoid issuing command mutations from more than one place at once.

## Response codes

| Status | Meaning |
| --- | --- |
| `200` | The requested operation completed successfully. |
| `400` | The request is missing a required argument or confirmation. |
| `401` | The control API secret is missing or incorrect. |
| `404` | A requested Discord command does not exist. |
| `409` | Another operation of the same type is already in progress. |
| `503` | The operation could not be routed or did not complete successfully. The response body contains the reason. |

## View command state

```sh
curl http://localhost:3000/commands \
  -H "Authorization: $DISCORD_BOT_CONTROL_API_SECRET"
```

The response groups command names into `localAndRemote`, `localOnly`, and `remoteOnly`.

## Register or update commands

```sh
curl -X POST http://localhost:3000/commands/register \
  -H "Authorization: $DISCORD_BOT_CONTROL_API_SECRET"
```

## Delete one command

```sh
curl -X DELETE http://localhost:3000/commands/example \
  -H "Authorization: $DISCORD_BOT_CONTROL_API_SECRET"
```

## Rename one command

```sh
curl -X PATCH http://localhost:3000/commands/old-name \
  -H "Authorization: $DISCORD_BOT_CONTROL_API_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"name":"new-name"}'
```

## Clear every command

This removes every registered Discord command. The confirmation body is required.

```sh
curl -X DELETE http://localhost:3000/commands \
  -H "Authorization: $DISCORD_BOT_CONTROL_API_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true}'
```

## Sync Google Calendar

```sh
curl -X POST http://localhost:3000/calendar/sync \
  -H "Authorization: $DISCORD_BOT_CONTROL_API_SECRET"
```

Set `DISCORD_GUILD_ID` to the server whose scheduled events should be synced, along with the Google Calendar variables described in [the README](../README.md#optional-google-calendar-sync). The manager routes this request to the shard that owns that guild, then the running bot reconciles its scheduled events with Google Calendar.

In a clustered deployment only the manager container that owns that shard can service this endpoint; the others respond `503`.

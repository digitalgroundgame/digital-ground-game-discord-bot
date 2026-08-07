# Bot control API

The manager exposes command administration and on-demand calendar sync through its HTTP API. These routes require `DISCORD_BOT_CONTROL_API_SECRET` in the `Authorization` header. Use a separate long random value for this secret; do not reuse `DISCORD_BOT_API_SECRET`.

The examples below use the local API URL. For a remote deployment, replace `http://localhost:3000` with its HTTPS URL. Do not send the control secret over unencrypted HTTP.

Each request is forwarded to a ready Discord shard, which uses the already-running bot build. Only one command operation runs at a time; a concurrent request receives HTTP 409.

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

The manager routes this request to the shard that owns `DISCORD_GUILD_ID`, then the running bot reconciles that guild's scheduled events with Google Calendar.

In a clustered deployment only the manager container that owns that shard can service this endpoint; the others respond `503`.

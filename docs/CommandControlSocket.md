# Local bot control API

The manager exposes command administration through `/tmp/dggac-bot/control.sock`. It never opens a TCP port and the socket is mode `0600`, so only the account running the Docker container (and root) can use it.

Run these commands from inside the manager container, or use your container runtime's exec facility. Each request is forwarded to one ready Discord shard, which uses the already-running bot build. Only one command operation runs at a time; a concurrent request receives HTTP 409.

## View command state

```sh
curl --unix-socket /tmp/dggac-bot/control.sock \
  http://localhost/commands
```

The response groups command names into `localAndRemote`, `localOnly`, and `remoteOnly`.

## Register or update commands

```sh
curl --unix-socket /tmp/dggac-bot/control.sock \
  -X POST http://localhost/commands/register
```

## Delete one command

```sh
curl --unix-socket /tmp/dggac-bot/control.sock \
  -X DELETE http://localhost/commands/example
```

## Rename one command

```sh
curl --unix-socket /tmp/dggac-bot/control.sock \
  -X PATCH http://localhost/commands/old-name \
  -H 'Content-Type: application/json' \
  -d '{"name":"new-name"}'
```

## Clear every command

This removes every registered Discord command. The confirmation body is required.

```sh
curl --unix-socket /tmp/dggac-bot/control.sock \
  -X DELETE http://localhost/commands \
  -H 'Content-Type: application/json' \
  -d '{"confirm":true}'
```

## Sync Google Calendar

```sh
curl --unix-socket /tmp/dggac-bot/control.sock \
  -X POST http://localhost/calendar/sync
```

The manager routes this request to the shard that owns `DISCORD_GUILD_ID`, then the running bot reconciles that guild's scheduled events with Google Calendar.

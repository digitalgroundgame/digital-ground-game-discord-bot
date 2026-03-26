# DGG Discord Bot

Uses the [discord.js](https://discord.js.org/) framework.

## Upstream Template

This template for a Discord bot was based upon this public template. https://github.com/KevinNovak/Discord-Bot-TypeScript-Template

## Setup

1. Copy example config files.

   Run this command to create your local config and .env files:

   ```
   npm copyconfig
   ```

2. Fill your .env - see below.

3. `npm install`

4. Register commands.
   - In order to use slash commands, they first [have to be registered](https://discordjs.guide/creating-your-bot/command-deployment.html).
   - Type `npm run commands:register` to register the bot's commands.
     - Run this script any time you change a command name, structure, or add/remove commands.
     - This is so Discord knows what your commands look like.
     - It may take up to an hour for command changes to appear.
5. `npm start`

## Environment Variables

The bot requires certain environment variables to be set. In development, these can be set in an `.env` file in the root of the discord-bot directory. In production, these should be set in your deployment environment.

### Required

Go here for the first two https://discord.com/developers/applications/

Find this under OAuth2

```
DISCORD_CLIENT_ID="your-discord-client-id"
```

Find this under Bot

```
DISCORD_BOT_TOKEN="your-discord-bot-token"
```

Get this from inside of the Discord app. Enable developer mode -> right click user name -> Copy ID. https://support.discord.com/hc/en-us/articles/206346498-Where-can-I-find-my-User-Server-Message-ID

```
DISCORD_BOT_DEVELOPER_IDS="123456789012345678,987654321098765432" # comma-separated list of Discord user IDs
```

### Optional: Google Calendar sync

To sync Discord scheduled events (from the **DGG Political Action** server) to the DGGP group Google Calendar:

1. Create a [Google Cloud project](https://console.cloud.google.com/) and enable the **Google Calendar API**.

2. Choose **one** auth method:

   **A — Service account (JSON key file)**  
   - Create a service account, download its JSON key.  
   - Share the target Google Calendar with the service account email and grant **Make changes to events**.  
   - In `.env`: `GOOGLE_CALENDAR_ID`, `GOOGLE_APPLICATION_CREDENTIALS` = path to that JSON.

   **B — OAuth 2.0 client (no service account; “Download JSON” from Google Cloud)**  
   - In **APIs & Services → Credentials**, create an **OAuth client ID** (Desktop or Web).  
   - Under the client, add **Authorized redirect URI**: `http://127.0.0.1:34567/oauth2callback` (or set `GOOGLE_OAUTH_REDIRECT_URI` to match what you add in Google Cloud).  
   - Download the client JSON.  
   - In `.env`: `GOOGLE_CALENDAR_ID`, `GOOGLE_CALENDAR_CREDENTIALS` = path to that JSON.  
   - Run **once** on a machine with a browser: `npm run calendar:oauth` — sign in with the Google account that should own calendar writes. This writes `config/google-calendar-oauth-tokens.json` (gitignored).  
   - Optional: `GOOGLE_CALENDAR_OAUTH_TOKEN_PATH` if you store tokens elsewhere.

When configured, the bot will create/update/delete Google Calendar events when Discord scheduled events change. Sync state is stored in `config/calendar-sync-state.json`.

### Not used

Clustering Configuration (only needed if clustering.enabled is true), we will likely never cluster because it's for bots that serve 2,500+ guilds.

```
DISCORD_BOT_MASTER_API_TOKEN="token"
```

```
DISCORD_BOT_API_SECRET="secret"
```

# Configuring `/link-account` and `/grant-access` for GitHub

These two commands work together to let team leads add Discord members to
GitHub org teams:

- **`/link-account`** — a member runs this with `service:github` to record
  their GitHub username against their Discord ID. Read by `/grant-access` to
  resolve which GitHub account to add to a team.
- **`/grant-access`** — a role-gated command that, with `service:github`,
  looks up the target user's linked GitHub username and calls the REST API
  to add them to a team's GitHub team.

## What needs to be configured

| Piece | Required by |
| --- | --- |
| SQLite database (`SQLITE_PATH`) | `/link-account`, `/grant-access` |
| `GITHUB_TEAMS_TOKEN` | `/grant-access service:github` |
| Team shortname → org/team mapping in `config.json` | `/grant-access service:github` |

`/link-account` only needs the database. Everything below is for
`/grant-access service:github`.

## 1. Create a token

The endpoint used
([`PUT /orgs/{org}/teams/{team_slug}/memberships/{username}`](https://docs.github.com/en/rest/teams/members#add-or-update-team-membership-for-a-user))
requires the caller to be an organization owner or a maintainer of the team
being modified. Two ways to get a token:

- **Classic PAT** — create one under a qualifying account (org owner, or a
  maintainer of every team `/grant-access` should manage) with the
  `read:org` scope.
- **Fine-grained PAT / GitHub App installation token** — grant the
  "Members" organization permission (read and write).

Either way, treat the token as a secret.

## 2. Map team shortnames to GitHub org + team

In `config.json`, under `grantAccess`, fill in `githubTeams` — the same
shortnames used for `groups` (Google) can be reused so `/grant-access` offers
one team list regardless of which service is picked:

```json
"grantAccess": {
  "allowedRoleKeys": ["DIRECTOR", "COORDINATOR"],
  "groups": { "Dev Team": "dev-team@digitalgroundgame.org" },
  "githubTeams": {
      "Pragmatic Papers Website": { "org": "digitalgroundgame", "team": "pragmatic-papers-website" },
  }
}
```

`team` is the team's **slug** (visible in its GitHub URL,
`github.com/orgs/<org>/teams/<slug>`), not its display name.

## 3. Environment variable

```bash
# Token from an org owner or team maintainer with the read:org scope
# (classic PAT) or the "Members" org permission (fine-grained PAT / GitHub
# App installation token).
GITHUB_TEAMS_TOKEN="ghp_..."
```

## 4. Verify

Start the bot and watch the logs:

- If `GITHUB_TEAMS_TOKEN` is unset, you'll see:
  > `/grant-access: disabled for service:github — set GITHUB_TEAMS_TOKEN …`
- If a team shortname has no entry under `githubTeams`, `/grant-access` tells
  the caller the team is unknown for that service — check the `config.json`
  mapping.
- If the API call fails, the error (HTTP status + body) is logged. Common
  causes:
  - **404** — the org or team slug is wrong, or the token's owner can't see
    the team.
  - **403** — team synchronization (SCIM/IdP-managed teams) is enabled for
    that team, which blocks direct membership changes via this endpoint.
  - **401 / 403 "Must have admin rights"** — the token's account isn't an
    org owner or maintainer of that team.

Once configured, a member runs `/link-account service:github
identifier:<username>`, and an authorized lead runs `/grant-access
service:github team:<shortname> user:@member` to add them to the team. If
the member isn't yet in the GitHub org, GitHub emails them an invite and
`/grant-access` reports the membership as pending until they accept it.

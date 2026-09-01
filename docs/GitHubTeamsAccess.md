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
being modified.

**Two conditions, both required.** The account the token belongs to must hold
the role, *and* the token must carry a scope that permits writing team
membership. Being an org owner is not sufficient on its own — GitHub checks
the role against the token's scope, so an owner's under-scoped token is
refused with a message that reads like a role problem. Note also that org
roles granting repository access across the org (`all-repository-admin`,
`all-repository-maintain`) do **not** grant team membership writes; teams are
org-level objects, not repositories.

- **Fine-grained PAT / GitHub App installation token** (preferred) — owned by
  the organization, with the "Members" organization permission set to read and
  write. This is the narrower of the two: it permits managing membership and
  nothing else.
- **Classic PAT** — create one under a qualifying account (org owner, or a
  maintainer of every team `/grant-access` should manage) with the
  `admin:org` scope. `write:org` is **not** enough, despite its description
  mentioning team membership. Note that `admin:org` is full control of the
  organization and all its teams, which is a large amount of authority to
  leave sitting in a `.env` on a bot host — prefer the fine-grained token
  unless you have a reason not to.

Either way, treat the token as a secret.

To confirm what a token actually carries before wiring it up:

```bash
curl -s -i -H "Authorization: Bearer $GITHUB_TEAMS_TOKEN" https://api.github.com/user
```

`X-OAuth-Scopes` in the response headers lists the token's real scopes (absent
for fine-grained tokens), and `login` in the body is the account GitHub
authenticates it as — check that it is the account you granted the role to.

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
# Token from an org owner or team maintainer, scoped to write team membership:
# the "Members" org permission (fine-grained PAT / GitHub App installation
# token, preferred) or the admin:org scope (classic PAT — write:org is not
# enough).
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
  - **403 "You must be an organization owner or team maintainer to add a
    team membership"** — ambiguous: GitHub returns this both when the
    token's account lacks the role *and* when the account has the role but
    the token lacks the scope. Check the scope first, since it's the easier
    of the two to get wrong. Re-run the failing call with `-i` and read
    `X-Accepted-OAuth-Scopes` (what the endpoint requires) against
    `X-OAuth-Scopes` (what the token has). If the scope is right, confirm
    the role at `github.com/orgs/<org>/people` — the Owner/Member column,
    not the separate "Organization roles" assignments.
  - **403** — team synchronization (SCIM/IdP-managed teams) is enabled for
    that team, which blocks direct membership changes via this endpoint.
    This one carries a message about synchronized teams rather than the one
    above.

Once configured, a member runs `/link-account service:github
identifier:<username>`, and an authorized lead runs `/grant-access
service:github team:<shortname> user:@member` to add them to the team. If
the member isn't yet in the GitHub org, GitHub emails them an invite and
`/grant-access` reports the membership as pending until they accept it.

## Who is actually authorized

Nothing about the Discord user reaches GitHub. The only gate on the GitHub
side is the token, so every call is made as the token's account regardless of
who ran the command. Authorization to run it at all is enforced entirely on
the Discord side, by `grantAccess.allowedRoleKeys` in `config.json`.

That makes the Discord role the real access control on your GitHub org
membership: anyone holding it is exercising the token account's authority,
bounded only by what the command exposes — the teams listed under
`githubTeams`, always at `role: member`, and only against usernames someone
has linked with `/link-account`. This is the main argument for the
fine-grained token above.

It also means GitHub's org audit log attributes every one of these additions
to the token's account, not to the person who ran the command. The Discord
actor is recorded only in the bot's own logs:

```
<discord-tag> granted <target-tag> access to team '<shortname>' — active
```

Answering "who added this person" needs both logs together.

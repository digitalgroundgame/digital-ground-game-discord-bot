# Configuring `/link-account`, `/grant-access` and `/backfill-grants`

These commands work together to let team leads add Discord members to
Google Workspace groups, and to keep a record of who has access:

- **`/link-account`** — a member runs this to record their Google email
  against their Discord ID in the bot's database. Read by `/grant-access` to
  resolve which Google email to add to a group. Also materializes any grants
  `/backfill-grants` discovered for that address (see below).
- **`/grant-access`** — a role-gated command that looks up the target user's
  linked Google email and calls the Admin SDK Directory API to add them to a
  team's Google Group.
- **`/backfill-grants`** — a role-gated command that reads the *real* membership
  of the configured team Google Groups and records it, so the bot's grant
  records aren't limited to the adds it happened to make itself.

## What needs to be configured

| Piece | Required by |
| --- | --- |
| SQLite database (`SQLITE_PATH`) | `/link-account`, `/grant-access`, `/backfill-grants` |
| Service account JSON key with Domain-Wide Delegation | `/grant-access`, `/backfill-grants` |
| A Workspace admin to impersonate | `/grant-access`, `/backfill-grants` |
| Admin SDK API + Groups Settings API enabled on the project | `/grant-access`, `/backfill-grants` |

`/link-account` only needs the database. Everything below is for
`/grant-access` and `/backfill-grants`, which share the same credentials and
the same `admin.directory.group.member` scope — reading a group's membership
needs no extra scope beyond writing it, so nothing extra to set up.

## 1. Create (or reuse) a Google Cloud service account

You can reuse the same service account as the calendar sync — the credentials
env vars are shared.

1. In Google Cloud Console, pick (or create) the project that owns the
   service account.
2. **APIs & Services → Library**, enable both:
   - **Admin SDK API** (`admin.googleapis.com`) — the Directory API used to
     insert group members lives here.
   - **Groups Settings API** (`groupssettings.googleapis.com`).
3. **IAM & Admin → Service Accounts**, create one (or open the existing one
   used for calendar sync). Create a JSON key and download it. Treat the
   downloaded file as a secret — its path is what you point
   `GOOGLE_APPLICATION_CREDENTIALS` at.

## 2. Grant Domain-Wide Delegation

The Directory API rejects raw service-account identities for group
membership operations, so the service account must impersonate a Workspace
admin. This needs a one-time setup by a Workspace super admin:

1. On the service account in Cloud Console, note its **Client ID** (a
   numeric value visible on the service account's details page).
2. In the **Google Workspace Admin console** →
   **Security → Access and data control → API controls → Domain-wide
   delegation → Manage Domain Wide Delegation → Add new**.
3. Paste the service account's Client ID and add the OAuth scope:

   ```
   https://www.googleapis.com/auth/admin.directory.group.member
   ```

   (If you also use the same service account for calendar sync, add the
   calendar scope you already configured alongside it — scopes are
   comma-separated.)
4. Save. Propagation can take a few minutes.

## 3. Pick an admin to impersonate

Domain-Wide Delegation lets the service account act *as* a Workspace user.
For the Directory API, that user must have admin privileges sufficient to
manage group membership (the built-in **Groups Admin** role is enough — full
Super Admin is not required).

Use a real admin account (or a dedicated automation admin). The email of
that user goes into `GOOGLE_WORKSPACE_ADMIN_SUBJECT`.

## 4. Environment variables

Set these where the bot runs (e.g. `.env`, your process supervisor, the
container env):

```bash
# Path to the downloaded service account JSON key. Shared with calendar
# sync — GOOGLE_CALENDAR_CREDENTIALS is checked first, then this.
GOOGLE_APPLICATION_CREDENTIALS=/secrets/dggp-service-account.json

# Workspace admin email the service account impersonates when calling the
# Directory API for /grant-access.
# Falls back to GOOGLE_CALENDAR_IMPERSONATION_SUBJECT if unset, so if your
# calendar impersonation user is already an admin with the Groups Admin
# role, you can leave this unset.
GOOGLE_WORKSPACE_ADMIN_SUBJECT=admin@your-domain.org

# SQLite database file — required for /link-account to store linked accounts,
# for /grant-access to read them back, and for /backfill-grants to record what
# it finds in the groups.
SQLITE_PATH=./data/dggac.sqlite
```

### Calendar sync env vars (referenced above for fallback)

These are documented here because `/grant-access` reuses them when its own
vars are unset:

```bash
# Alternative credentials path. Used by calendar sync; /grant-access prefers
# this over GOOGLE_APPLICATION_CREDENTIALS when both are set.
GOOGLE_CALENDAR_CREDENTIALS=/secrets/dggp-service-account.json

# Workspace user the calendar service account impersonates. If that same
# user is a Workspace admin with group-member permissions, /grant-access
# will fall back to it when GOOGLE_WORKSPACE_ADMIN_SUBJECT is unset.
GOOGLE_CALENDAR_IMPERSONATION_SUBJECT=calendar-admin@your-domain.org
```

## 5. Verify

Start the bot and watch the logs:

- If credentials or the impersonation subject are missing, you'll see:
  > `/grant-access: disabled — set GOOGLE_APPLICATION_CREDENTIALS (or GOOGLE_CALENDAR_CREDENTIALS) and GOOGLE_WORKSPACE_ADMIN_SUBJECT (or GOOGLE_CALENDAR_IMPERSONATION_SUBJECT) …`
- If the call to `members.insert` (or `members.list`, for `/backfill-grants`)
  fails at runtime, the error is logged with the HTTP status. The most common
  causes:
  - **403 / `unauthorized_client`** — Domain-Wide Delegation isn't set up,
    or the `admin.directory.group.member` scope wasn't added to the client
    ID in the Admin console.
  - **403 / `Not Authorized to access this resource/api`** — the
    impersonated user isn't a Workspace admin (or lacks the Groups Admin
    role).
  - **404 / `Resource Not Found: groupKey`** — the address in
    `config.grantAccess.groups` doesn't name a group in this domain (a typo, or
    a group that was renamed or deleted). `/backfill-grants` reports the team as
    failed and keeps going.

Once configured, a member runs `/link-account service:google email:…`,
and an authorized lead runs `/grant-access service:google team:<shortname>
user:@member` to add them to the team's Google Group.

## 6. Backfilling membership that predates the bot

`/grant-access` records each add it makes, but most team membership was created
by hand in the Workspace admin console — or before the bot existed. Those
memberships are real but invisible to `/users/:id`.

`/backfill-grants` closes that gap. It reads each configured team group with the
Directory API and records what it finds:

```
/backfill-grants service:google                       # every configured team
/backfill-grants service:google team:Event Team       # just one
/backfill-grants service:google dry-run:True          # read and report, write nothing
```

Same coordinator role gate as `/grant-access`. The reply is ephemeral and is
edited as each team finishes, so you can watch a full sweep progress.

For each member of a group:

- If their address is **already linked** to a Discord user, a normal access
  grant is recorded — exactly as if `/grant-access` had done it.
- If **nobody has linked** that address, the grant is recorded as *pending*,
  keyed on the address itself. When someone eventually runs `/link-account`
  with it, the pending grants become real grants in the same transaction, so
  their existing access shows up immediately rather than looking absent.

The distinction is internal bookkeeping. The users API reports both the same
way — nothing downstream can tell a backfilled grant from a granted one.

Re-running is safe: every write is an upsert, so a second run over the same
groups refreshes timestamps rather than duplicating rows.

### Known limitations

- **A full sweep must finish inside Discord's 15-minute interaction window.**
  Progress edits keep the reply alive but don't extend that ceiling. If the
  sweep ever gets too slow, run it a team at a time with `team:`.
- **Alias addresses don't match.** The Directory API reports the address a
  member was added with. Someone added as `alias@your-domain.org` who links
  `primary@your-domain.org` gets a pending grant that never matches, so their
  access still won't appear. Add people to groups by their primary address.
- **Pending grants don't expire.** They're kept and refreshed on each run, so
  someone removed from a group months ago can still have a stale pending grant
  materialized when they finally link. Re-run the backfill periodically so
  recorded state tracks the groups.
- **Re-linking a different address carries grants over.** `/link-account`
  keeps the same linked-account row when you swap the address on it, so grants
  recorded for the old address remain attached. Pre-existing behavior, tracked
  separately from the backfill.

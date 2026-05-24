# Configuring `/link-account` and `/grant-access`

These two commands work together to let team leads add Discord members to
Google Workspace groups:

- **`/link-account`** — a member runs this to record their Google email
  against their Discord ID in the bot's database. Read by `/grant-access` to
  resolve which Google email to add to a group.
- **`/grant-access`** — a role-gated command that looks up the target user's
  linked Google email and calls the Admin SDK Directory API to add them to a
  team's Google Group.

## What needs to be configured

| Piece | Required by |
| --- | --- |
| Postgres database (`DATABASE_URL`) | `/link-account`, `/grant-access` |
| Service account JSON key with Domain-Wide Delegation | `/grant-access` |
| A Workspace admin to impersonate | `/grant-access` |
| Admin SDK API + Groups Settings API enabled on the project | `/grant-access` |

`/link-account` only needs the database. Everything below is for
`/grant-access`.

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

# Postgres URL — required for /link-account to store linked accounts and
# for /grant-access to read them back.
DATABASE_URL=postgres://user:pass@host:5432/dbname
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
- If the call to `members.insert` fails at runtime, the error is logged with
  the HTTP status. The two most common causes:
  - **403 / `unauthorized_client`** — Domain-Wide Delegation isn't set up,
    or the `admin.directory.group.member` scope wasn't added to the client
    ID in the Admin console.
  - **403 / `Not Authorized to access this resource/api`** — the
    impersonated user isn't a Workspace admin (or lacks the Groups Admin
    role).

Once configured, a member runs `/link-account service:google email:…`,
and an authorized lead runs `/grant-access service:google team:<shortname>
user:@member` to add them to the team's Google Group.

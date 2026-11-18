# Proposal

## Why

Coordinators sometimes need to see which Google email a member linked, for example when `/grant-access` can't find them or added them to a Google Group under the wrong address. Today the only ways to see it are to run `/link-account` again or to query the database. Linked emails are private, so the lookup has to be limited to the roles that already manage links on members' behalf.

## What Changes

- Add the `/linked-accounts [user]` slash command, which replies ephemerally with every account linked to a member: the Google email and the GitHub username, each with when it was linked, or a notice that nothing is linked.
- Looking up another member requires one of the coordinator roles (`grantAccess.allowedRoleKeys`), the same roles that can link an account on someone's behalf. Any member may look up their own links. The command is hidden in the picker from members without Manage Roles (`default_member_permissions`), and is unavailable in DMs.
- Log each lookup with who looked up whom, without the identifiers.
- Move the coordinator role IDs into one shared constant, `CoordinatorRoleIds`, used by `/grant-access`, `/link-account` and `/linked-accounts`.
- Add `UserService.listLinkedAccounts(discordUserId)`.

## Capabilities

### New Capabilities

- `linked-accounts`: showing a member's linked external accounts to coordinators.

### Modified Capabilities

None.

## Out of scope

- A right-click "View linked accounts" user context menu command. It can reuse this command's lookup and formatting later.
- Converting `/link-account` to subcommands (`/link-account lookup`), which would change its registered shape.

## Impact

- New code: `src/commands/chat/linked-accounts-command.ts` and `tests/commands/linked-accounts-command.test.ts`.
- Changed: `src/constants/google-groups.ts` (`CoordinatorRoleIds`), `src/services/user-service.ts`, `/grant-access` and `/link-account` now read the shared constant (no behavior change).
- Discord: a new slash command, so `pnpm run commands:register` is needed on deploy; new strings in `lang/lang.en-US.json`.
- Database: none. It reads the existing `linked_account` table.

# Tasks

## 1. Lookup

- [x] 1.1 Add `UserService.listLinkedAccounts(discordUserId)`, and verify `pnpm run check-types` passes
- [x] 1.2 Move the coordinator role IDs into the shared `CoordinatorRoleIds` constant and use it in `/grant-access` and `/link-account`, and verify `tests/commands/grant-access-command.test.ts` still passes

## 2. The `/linked-accounts` command

- [x] 2.1 Add the command, its registration metadata (`dm_permission: false`, no `default_member_permissions`) and its `lang/lang.en-US.json` strings, and register it in `src/commands/chat/index.ts` and `src/start-bot.ts`
- [x] 2.2 Refuse members without a coordinator role looking up someone else, allow self-lookup, list Google then GitHub with linked times, say when nothing is linked, and log who looked up whom without the identifiers; verify with `tests/commands/linked-accounts-command.test.ts`
- [x] 2.3 Mention the command in `docs/GoogleGroupsAccess.md` and `README.md`

## 3. Rollout

- [ ] 3.1 Merge into `dev` and verify the full `pnpm test` suite passes in CI
- [ ] 3.2 Run `pnpm run commands:register` against the deployed bot, and verify `/linked-accounts` appears in the guild
- [ ] 3.3 In a test guild, look up a member with a linked Google email as a coordinator, then as a member without the role, and verify the email shows only for the coordinator

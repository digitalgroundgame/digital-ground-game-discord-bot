# Tasks

The implementation already exists on the `give-issue-pr-review` branch, with review fixes in #190. Boxes are ticked where the code and its tests are in place.

## 1. Configuration and storage

- [x] 1.1 Add `config.findWork` (marker label, excluded repos, point amounts) with startup validation that rejects point amounts outside 0–10, a `points` value that isn't an object, and unknown keys, and verify with `tests/constants/find-work.test.ts`
- [x] 1.2 Add the `issue_claim` and `review_request` tables with one live claim per issue and one live review request per GitHub account per pull request, and verify `pnpm run check-types` passes
- [x] 1.3 Add `payFindWork`, `refreshGitHubIssues` and `refreshGitHubPullRequests` schedules under `config.jobs`, and verify they appear in `config/config.json`

## 2. Work pools

- [x] 2.1 Cache open, unassigned, marker-labelled issues from the org's public repositories, skipping excluded repos and pull requests, and verify with `tests/services/github-issues-service.test.ts` and `tests/services/github-api.test.ts`
- [x] 2.2 Cache open pull requests and per-file commit authors from the org's public repositories, and verify with `tests/services/github-pull-requests-service.test.ts`
- [x] 2.3 Load both caches at startup and register hourly refresh jobs for them in `src/start-bot.ts`, and verify `pnpm run check-types` passes

## 3. Selection

- [x] 3.1 Slug role names and labels, and draw two skill-matched issues plus a staleness-weighted wildcard with backfill, flagging only the wildcard slot, and verify with `tests/constants/find-work.test.ts`
- [x] 3.2 Rank review suggestions by matched files, commits and wait time, excluding drafts, own PRs, existing reviewers and lockfiles or build output, and verify with `tests/constants/review-suggestions.test.ts`

## 4. The `/find-work` command

- [x] 4.1 Add the command, its registration metadata and its `lang/lang.en-US.json` strings, and verify it builds with `pnpm run check-types`
- [x] 4.2 Gate on configuration and a linked GitHub account, and reply with the draw, review suggestions and claim buttons, and verify with `tests/commands/find-work-command.test.ts`
- [x] 4.3 On a claim, defer the press, record the claim (refusing when another live claim exists), re-read the issue on GitHub, then check assignability and assign, withdrawing the claim if any step fails; report a failed access check as a failure rather than missing access, and re-read the issue after a failed assignment before withdrawing; verify with `tests/commands/find-work-command.test.ts` and `tests/services/github-issues-service-http.test.ts`
- [x] 4.4 On a review, defer the press, request the review on GitHub and record it, and verify with `tests/commands/find-work-command.test.ts`

## 5. Payouts

- [x] 5.1 Record and settle claims and review requests in one transaction that only matches live records, and verify with `tests/services/work-claim-service.test.ts`; settle by the login the claim was made with even after the member relinks, and verify with `tests/services/find-work-payout-service.test.ts`
- [x] 5.2 Decide pay, expire or wait for issue claims and review requests: pay issues only when the claimer's own merged pull request or commit closed them, give fresh claims a 10-minute grace period, expire issue claims after 30 days and review requests after 14, leave unreadable records live, and settle each record on its own so one failure can't stop the run; verify with `tests/services/find-work-payout-service.test.ts`
- [x] 5.3 Register the hourly `PayFindWorkJob` with the bot as giver, and verify `pnpm run check-types` passes

## 6. Rollout

- [ ] 6.1 Merge the implementation into `dev` and verify the full `pnpm test` suite passes in CI
- [ ] 6.2 Run `pnpm run db:push` and `pnpm run commands:register` against the deployed bot, and verify `/find-work` appears in the guild
- [ ] 6.3 In a test guild, run `/find-work` without and with a linked GitHub account, and verify the not-linked notice, then the draw and review suggestions, appear
- [ ] 6.4 Label at least one issue `available` in a public repo, claim it, close it with a merged pull request you authored, and verify Democracy Points arrive after the next payout run

## Workflow follow-up

- Archive the change with `openspec archive add-find-work` once it is deployed, and verify the specs land under `openspec/specs/`.

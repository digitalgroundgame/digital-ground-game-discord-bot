# Tasks

The implementation already exists on the `give-issue-pr-review` branch. Boxes are ticked where the code and its tests are in place.

## 1. Configuration and storage

- [x] 1.1 Add `config.findWork` (marker label, excluded repos, approver role keys, point amounts) with startup validation that rejects point amounts outside 0–10, and verify with `tests/constants/find-work.test.ts`
- [x] 1.2 Add the `issue_claim` and `review_request` tables with one live claim per issue and one live review request per member per pull request, and verify `pnpm run check-types` passes
- [x] 1.3 Add `payFindWork`, `refreshGitHubIssues` and `refreshGitHubPullRequests` schedules under `config.jobs`, and verify they appear in `config/config.json`

## 2. Work pools

- [x] 2.1 Cache open, unassigned, marker-labelled issues from the org's public repositories, skipping excluded repos and pull requests, and verify with `tests/services/github-issues-service.test.ts`
- [x] 2.2 Cache open pull requests and per-file commit authors from the org's public repositories, and verify with `tests/services/github-pull-requests-service.test.ts`
- [x] 2.3 Register hourly refresh jobs for both caches in `src/start-bot.ts`, and verify `pnpm run check-types` passes

## 3. Selection

- [x] 3.1 Slug role names and labels, and draw two skill-matched issues plus a staleness-weighted wildcard with backfill, and verify with `tests/constants/find-work.test.ts`
- [x] 3.2 Rank review suggestions by matched files, commits and wait time, excluding own PRs, existing reviewers and lockfiles or build output, and verify with `tests/constants/review-suggestions.test.ts`

## 4. The `/find-work` command

- [x] 4.1 Add the command, its registration metadata and its `lang/lang.en-US.json` strings, and verify it builds with `pnpm run check-types`
- [x] 4.2 Gate on configuration and a linked GitHub account, and reply with the draw, review suggestions and claim buttons, and verify `pnpm run check-types` passes
- [x] 4.3 On a claim, refuse a duplicate live claim, check assignability, assign on GitHub and record the claim, and verify `pnpm run check-types` passes
- [x] 4.4 On a review, request the review on GitHub and record it, and verify `pnpm run check-types` passes

## 5. Payouts

- [x] 5.1 Record and settle claims and review requests in one transaction that only matches live records, and verify with `tests/services/work-claim-service.test.ts`
- [x] 5.2 Decide pay, expire or wait for issue claims and review requests, leaving unreadable records live, and verify with `tests/services/find-work-payout-service.test.ts`
- [x] 5.3 Register the hourly `PayFindWorkJob` with the bot as giver, and verify `pnpm run check-types` passes

## 6. Rollout

- [ ] 6.1 Merge the implementation into `dev` and verify the full `pnpm test` suite passes in CI
- [ ] 6.2 Run `pnpm run db:push` and `pnpm run commands:register` against the deployed bot, and verify `/find-work` appears in the guild
- [ ] 6.3 In a test guild, run `/find-work` without and with a linked GitHub account, and verify the not-linked notice, then the draw and review suggestions, appear
- [ ] 6.4 Label at least one issue `available` in a public repo, claim it, close it as completed, and verify Democracy Points arrive after the next payout run

## Workflow follow-up

- Archive the change with `openspec archive add-find-work` once it is deployed, and verify the specs land under `openspec/specs/`.

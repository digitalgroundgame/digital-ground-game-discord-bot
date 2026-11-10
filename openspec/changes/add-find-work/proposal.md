# Proposal

## Why

Members who want to contribute code to the organization have no easy way to find work that fits them, and maintainers have no lever to steer people toward issues that need an owner or pull requests that need a reviewer. Contribution also goes unrecognized unless someone remembers to hand out Democracy Points by hand. `/find-work` closes that loop: it offers a member work matched to their Discord skill roles, assigns it on GitHub when they take it, and pays Democracy Points automatically once the work is finished.

## What Changes

- Add the `/find-work` slash command, open to every member, which shows an ephemeral draw of up to three open issues to claim and up to two open pull requests to review.
- Issues come from a cached pool of open, unassigned issues carrying an opt-in marker label (`available` by default) in the organization's public repositories. Private repositories are never enumerated, and repositories listed in `config.findWork.excludeRepos` are left out.
- Two issue slots are matched to the member's Discord role names against issue labels; the third is a wildcard from unmatched work, weighted toward the stalest issues.
- Review suggestions are open pull requests that touch files the member has committed to, excluding their own pull requests and ones they already review.
- Claiming an issue assigns the member's linked GitHub account; taking a review requests a review from them. Both are recorded in new `issue_claim` and `review_request` tables.
- Add an hourly payout job that settles live claims: an issue closed as completed with the claimer still assigned pays `issue` points (or `wildcardIssue` for a wildcard draw), a submitted review pays `review` points, and everything that can no longer finish expires.
- Add hourly refresh jobs for the issue pool and the pull request and file-history cache.
- Add `config.findWork` (marker label, excluded repos, approver role keys, point amounts) and job schedules under `config.jobs`.

## Capabilities

### New Capabilities

- `find-work`: offering members open issues to claim and pull requests to review, and assigning that work on GitHub.
- `find-work-payouts`: recording claimed work and paying Democracy Points once it is finished.

### Modified Capabilities

None.

## Impact

- New code: `src/commands/chat/find-work-command.ts`, `src/constants/find-work.ts`, `src/constants/review-suggestions.ts`, `src/services/github-api.ts`, `src/services/github-issues-service.ts`, `src/services/github-pull-requests-service.ts`, `src/services/work-claim-service.ts`, `src/services/find-work-payout-service.ts`, and the `refresh-github-issues`, `refresh-github-pull-requests` and `pay-find-work` jobs.
- Database: two new tables, `issue_claim` and `review_request`, applied with `pnpm run db:push`.
- Discord: a new slash command, so `pnpm run commands:register` is needed on deploy; new strings in `lang/lang.en-US.json`.
- GitHub: the bot's token needs to read public repos, issues, pull requests and commits in the org, and to assign issues and request reviews. Each live claim costs one or two GitHub reads per payout run.
- Points are written to the existing Democracy Points ledger through `kudos-service`, with the bot as the giver.

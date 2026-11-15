# /find-work live testing

Manual checks against a real Discord server and the **Bigital-Bround-Bame** test org. Covers tasks 6.2–6.4 in [tasks.md](tasks.md) plus the GitHub team matching and button-label changes.

## Setup

- [ ] `.env` has `GITHUB_ISSUES_TOKEN` and `GITHUB_TEAMS_TOKEN` (the same fine-grained token is fine locally), plus `GITHUB_TEAMS_ORG=Bigital-Bround-Bame`
  - Repository permissions: Issues (read and write), Pull requests (read and write), Metadata (read)
  - Organization permissions: Members (read and write)
  - Repository access: All repositories
- [ ] `config/config.json` has `"excludeTeams": ["admin"]` (**local only, don't commit**)
- [ ] `pnpm run db:push` creates the `issue_claim` and `review_request` tables
- [ ] `/find-work` shows in Discord's command menu. If it doesn't, run `pnpm run commands:register` once.
- [ ] `config/debug.json` has `dummyMode.enabled: false`. Scheduled jobs, including payouts, don't run in dummy mode.
- [ ] Labelled test issues `available` in at least two **public** repos:
  - [ ] one in a repo a team you're on can access (e.g. add yourself to `test-team` and give it a repo)
  - [ ] one in a repo none of your teams can access
  - [ ] two issues with the **same number** in different repos, for the button-label check
- [ ] Started the bot with `pnpm start` **after** the last `.env` or config change. `.env` is read once, at startup.
- [ ] The startup log shows `GitHub Issues: cached N claimable issue(s)…` and no `GitHub Teams: failed…` or `/grant-access: disabled for service:github` lines

> **Tips**
>
> - `/find-work` allows 2 runs per hour per person, and developers aren't exempt. Restarting the bot resets the limit.
> - The issue pool reloads at startup and at the top of each hour. Restart after labelling or unlabelling issues.

## 1. Gates

- [ ] Without `GITHUB_ISSUES_TOKEN` (then restart): private reply saying `/find-work` isn't configured
- [ ] From a Discord account with no linked GitHub account: asks you to `/link-account`, and no draw is shown
- [ ] With no `available` issues and no review suggestions: "Nothing is up for grabs"

## 2. Team matching

- [ ] On a team that can access repo A, which has labelled issues: two cards from repo A, a ⭐ wildcard from another repo, and the normal claim hint
- [ ] On no team that can access any repo in the pool: one wildcard plus backfill, with the "None of your GitHub teams' repositories…" notice
- [ ] Join a team with `/grant-access`, then run `/find-work` again **right away**: the new team's repos match immediately
- [ ] On only `admin` (excluded): it's ignored, so you get the no-team-match notice
- [ ] A team that can access a **private** repo with labelled issues: those issues never appear
- [ ] With `excludeTeams` emptied (then restart): the draw still works, with the "Couldn't read your GitHub teams" notice. Restore `["admin"]` afterwards.

## 3. Buttons

- [ ] Each button names the repo: `Claim website #2`, `Review discord-bot #17`
- [ ] Two issues with the same number in different repos get **different** labels, and each claims the right issue
- [ ] Buttons appear in the same order as the numbered list
- [ ] Known behavior: when no team matches, the ⭐ wildcard is card **1**, not card 3

## 4. Claiming

- [ ] Claim the ⭐ wildcard: you're assigned on GitHub, and the reply promises **2** points
- [ ] Claim an ordinary card: the reply promises **1** point
- [ ] Wait 5 minutes without pressing anything: the reply turns into "That draw expired"
- [ ] Someone else presses your buttons: nothing happens for them
- [ ] Draw, assign the issue to someone else on GitHub, then press Claim: "Someone claimed it just before you", and you are **not** added as a second assignee
- [ ] Same, but close the issue on GitHub first: the same "already claimed" reply
- [ ] Account that hasn't accepted the org invite: the "won't let … be assigned" reply, and nothing is left claimed
- [ ] Two accounts press Claim on the same issue: one is assigned, and the other is told it's already claimed

## 5. Reviews

- [ ] An open PR (not yours, not a draft) touching files you've committed to shows under "Pull requests you know your way around"
- [ ] Press Review: you're requested as a reviewer on GitHub, and the reply promises 1 point
- [ ] Your own PR, or a draft PR: never suggested

## 6. `/grant-access service:github`

- [ ] Offers `test-team`, `test-team-2` and `test-team-3-electric-boogaloo`, but **not** `admin`
- [ ] Granting a team adds the member on GitHub, or sends an invite if they aren't in the org yet

## 7. Payouts

The payout job runs at :45 past each hour (`config.jobs.payFindWork.schedule`, `"0 45 * * * *"`). To test faster, set it to `"0 */5 * * * *"` (every 5 minutes), then restart. **Don't commit that either.**

- [ ] Claim, then merge **your own** PR containing `Fixes #N`: points arrive (check `/democracy-points`)
- [ ] Claim, then close the issue by hand: no points, and the claim expires
- [ ] Claim, then get unassigned on GitHub and wait at least 10 minutes: the claim expires, and the issue can be claimed again
- [ ] Request a review, then submit a review on GitHub: review points arrive
- [ ] Restart the bot and let the job run again: nothing is paid twice

## Cleanup

- [ ] Reverted local-only config: `excludeTeams`, the `payFindWork` schedule, and `dummyMode`
- [ ] Unassigned yourself and removed the `available` label from test issues you don't want left open
- [ ] Ticked tasks 6.2–6.4 in [tasks.md](tasks.md), then ran `/opsx:archive`

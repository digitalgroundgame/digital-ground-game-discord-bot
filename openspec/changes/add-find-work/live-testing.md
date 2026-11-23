# /find-work live testing

Manual checks against a real Discord server and the **Bigital-Bround-Bame** test org. Covers rollout tasks 9.2–9.4 in [tasks.md](tasks.md), the GitHub team matching and button-label changes, and the live checks for the follow-ups in sections 6, 7 and 8 (team-tier reviews, bot pull requests, release on age expiry, several opt-in labels). Checks marked **(after 6.x)**, **(after 7.x)** or **(after 8.x)** need that task implemented first.

## Setup

- [ ] `.env` has `GITHUB_ISSUES_TOKEN` and `GITHUB_TEAMS_TOKEN` (the same fine-grained token is fine locally), plus `GITHUB_TEAMS_ORG=Bigital-Bround-Bame`
  - Repository permissions: Issues (read and write), Pull requests (read and write), Metadata (read)
  - Organization permissions: Members (read and write)
  - Repository access: All repositories
- [ ] `config/config.json` has `"excludeTeams": ["admin"]` (**local only, don't commit**)
- [ ] `pnpm run db:push` creates the `issue_claim` and `review_request` tables
- [ ] `/find-work` shows in Discord's command menu. If it doesn't, run `pnpm run commands:register` once.
- [ ] `config/debug.json` has `dummyMode.enabled: false`. Scheduled jobs, including payouts, don't run in dummy mode.
- [ ] Test issues labelled `available` (or, **(after 8.1–8.2)**, `good first issue` or `help wanted`) in at least two **public** repos:
  - [ ] one in a repo a team you're on can access (e.g. add yourself to `test-team` and give it a repo)
  - [ ] one in a repo none of your teams can access
  - [ ] two issues with the **same number** in different repos, for the button-label check
- [ ] Started the bot with `pnpm start` **after** the last `.env` or config change. `.env` is read once, at startup.
- [ ] The startup log shows `GitHub Issues: cached N claimable issue(s)…` and no `GitHub Teams: failed…` or `/grant-access: disabled for service:github` lines

> **Tips**
>
> - `/find-work` allows 2 runs per hour per person, and developers aren't exempt. Restarting the bot resets the limit.
> - The issue pool reloads at startup and at the top of each hour. Restart after labelling or unlabelling issues.
> - The open pull request cache reloads at startup and at :30 past each hour. A pull request opened after the last refresh isn't suggested until the next one, so restart after opening a test pull request.
> - Run only one bot at a time. Two bots on the same token both receive every interaction, so buttons fail and every job runs twice.

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

## Opt-in labels (after 8.1–8.2)

- [ ] An issue labelled only `help wanted` can be drawn, and so can one labelled only `good first issue`
- [ ] An issue labelled both `available` and `good first issue` appears once, and the startup log's count includes it once
- [ ] An issue labelled `Help Wanted` (different case) counts
- [ ] Removing every opt-in label from an issue drops it from the pool after the next refresh
- [ ] A leftover `"markerLabel"` in `config/config.json`, or `"markerLabels": []`, stops the bot at startup with an error naming `markerLabels`

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

Suggestions match on files you've **modified** before. A pull request that only adds new files has no history, so it can't match by history; it can only appear from the team tier (after 6.2–6.3).

- [ ] An open PR (not yours, not a draft) that edits a file you've committed to on the default branch shows in the review section, with "you've worked on `<file>`"
- [ ] Press Review: you're requested as a reviewer on GitHub, and the reply promises 1 point
- [ ] Your own PR, or a draft PR: never suggested
- [ ] **(after 6.2–6.3)** An open PR that only adds a file, in a repo one of your teams reaches, shows as a team-tier suggestion ("open in a repository your team works on"). The review section's title and hint fit both kinds.
- [ ] **(after 6.2–6.3)** An account with no commits in the org, on a team that reaches a repo with open PRs, gets up to two of them, unreviewed ones first
- [ ] **(after 6.2–6.3)** With one history match and other PRs in your team's repos: the history match is R1, a team-tier PR is R2
- [ ] **(after 6.1)** A PR opened by a bot (e.g. Dependabot) is never suggested

## 6. `/grant-access service:github`

- [ ] Offers `test-team`, `test-team-2` and `test-team-3-electric-boogaloo`, but **not** `admin`
- [ ] Granting a team adds the member on GitHub, or sends an invite if they aren't in the org yet

## 7. Payouts

The payout job runs at :45 past each hour (`config.jobs.payFindWork.schedule`, `"0 45 * * * *"`). To test faster, set it to `"0 * * * * *"` (every minute) and `log` to `true`, then restart. **Don't commit that either.**

The issue has to be closed by GitHub, which only happens when the PR merges into the repo's **default branch** (`main` in the test repos) and says `Fixes #N` or `Closes #N`.

- [ ] Claim, then merge **your own** PR containing `Fixes #N` into the default branch: points arrive (check `/democracy-points`)
- [ ] Claim, then close the issue by hand: no points, and the claim expires
- [ ] Claim, then get unassigned on GitHub and wait at least 10 minutes: the claim expires, and the issue can be claimed again
- [ ] Request a review, then submit a review on GitHub: review points arrive
- [ ] Restart the bot and let the job run again: nothing is paid twice
- [ ] **(after 7.1)** Release on age expiry. Claim an issue, then back its claim date up 31 days so the next run treats it as 30 days old. Claim dates are stored in seconds, and the claim's `id` is in the `issue_claim` table:

  ```sh
  node -e "require('better-sqlite3')('data/dggac.sqlite').prepare('UPDATE issue_claim SET claimed_at = claimed_at - 31*86400 WHERE id = ?').run(Number(process.argv[1]))" <id>
  ```

  After the next payout run, the claim is `expired`, you're **unassigned** on GitHub, and no points are paid. After the next pool refresh (or a restart), the issue appears in `/find-work` again and you can claim it again.

## Cleanup

- [ ] Reverted local-only config: `excludeTeams`, `dummyMode`, and any test schedule for `payFindWork` (back to the committed value)
- [ ] Unassigned yourself and removed the `available` label from test issues you don't want left open
- [ ] Ticked tasks 6.4, 8.3 and 9.2–9.4 in [tasks.md](tasks.md) once their checks pass, then ran `/opsx:archive` after deploy

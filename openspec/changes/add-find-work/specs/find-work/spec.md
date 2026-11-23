## ADDED Requirements

### Requirement: Open command with a linked GitHub account

The `/find-work` command SHALL be available to every guild member. It MUST reply ephemerally. It MUST require the member to have a linked GitHub account before showing any work, and MUST say when the feature is not configured.

#### Scenario: Member without a linked GitHub account

- **WHEN** a member with no linked GitHub account runs `/find-work`
- **THEN** the bot replies privately asking them to link one, and shows no draw

#### Scenario: GitHub integration not configured

- **WHEN** a member runs `/find-work` and the GitHub issues integration is not configured
- **THEN** the bot replies privately that `/find-work` is not available

#### Scenario: Nothing to offer

- **WHEN** the issue pool and the review suggestions are both empty
- **THEN** the bot replies privately that no work is available right now

### Requirement: Claimable issue pool

The bot SHALL offer only open, unassigned issues, not pull requests, that carry at least one of the configured opt-in labels (default `available`, `good first issue` and `help wanted`) in the organization's public repositories. It MUST NOT enumerate private repositories, and MUST leave out repositories listed in `config.findWork.excludeRepos`. The pool SHALL be loaded when the bot starts and refreshed on a schedule (hourly by default).

#### Scenario: Any one opt-in label is enough

- **WHEN** an open, unassigned issue in a public repository carries only `help wanted`, under the default labels
- **THEN** it can be offered, the same as one labelled `available`

#### Scenario: Several opt-in labels

- **WHEN** an issue carries more than one opt-in label
- **THEN** it appears in the pool once

#### Scenario: Label case

- **WHEN** an issue's label differs from a configured opt-in label only in case, such as `Help Wanted`
- **THEN** it counts as that opt-in label

#### Scenario: Unlabelled issue

- **WHEN** an open, unassigned issue in a public repository carries none of the opt-in labels
- **THEN** it is never offered

#### Scenario: Excluded repository

- **WHEN** a repository is listed in `config.findWork.excludeRepos`
- **THEN** none of its issues are offered, even ones carrying an opt-in label

### Requirement: Opt-in label configuration

The opt-in labels SHALL come from `config.findWork.markerLabels`, a list of label names matched without regard to case, defaulting to `available`, `good first issue` and `help wanted` when the key is absent. The bot MUST refuse to start when the list is not an array, is empty, or holds a name that is blank or contains a comma, or when the retired `markerLabel` key is present.

#### Scenario: Default labels

- **WHEN** `config.findWork.markerLabels` is absent
- **THEN** issues labelled `available`, `good first issue` or `help wanted` are offered

#### Scenario: Retired key left in config

- **WHEN** `config.findWork` still has `markerLabel`
- **THEN** the bot refuses to start and names `markerLabels` as its replacement, rather than quietly ignoring the old setting

#### Scenario: Empty list

- **WHEN** `config.findWork.markerLabels` is `[]`
- **THEN** the bot refuses to start, rather than running with a pool that can never fill

### Requirement: Team-matched draw with a wildcard

A draw SHALL offer up to three issues: two from repositories the member's GitHub teams reach, and one wildcard drawn at random from the stalest third, by last update, of issues in every other repository. When either side is short, the draw SHALL backfill from the rest of the pool so it offers three issues whenever three exist. Only an issue drawn into the wildcard slot SHALL be marked as a wildcard; a backfilled issue SHALL NOT be, so it pays the ordinary rate.

#### Scenario: Member on a team

- **WHEN** a member whose linked GitHub account is on a team with access to `org/website` runs `/find-work` and `org/website` has issues in the pool
- **THEN** two of the offered issues are in `org/website` and the third is a wildcard from another repository

#### Scenario: Teams match nothing

- **WHEN** none of the member's teams reach a repository with issues in the pool, or the member is on no team
- **THEN** one issue is the wildcard, the rest are backfilled from the pool at the ordinary rate, and the reply says that their teams matched no issues

#### Scenario: Teams can't be read

- **WHEN** GitHub can't answer which teams the member is on
- **THEN** the draw still goes ahead from the whole pool as if the teams matched nothing, and the reply says their teams couldn't be read

#### Scenario: Team matching not configured

- **WHEN** the bot has no GitHub teams token or organization configured
- **THEN** the draw still goes ahead from the whole pool as if the teams matched nothing, and the reply says team matching isn't set up rather than that the read failed

#### Scenario: Thin pool

- **WHEN** the pool holds fewer than three issues
- **THEN** the draw offers every issue in the pool

### Requirement: Matching from GitHub team membership

A member's matched repositories SHALL be every repository reached by an org team their linked GitHub account is on, read live on each `/find-work` so access granted moments earlier counts. Teams in `config.grantAccess.excludeTeams`, and teams nested beneath them at any depth, MUST be ignored. Matched repositories decide which issues match and fill the team tier of review suggestions. Discord roles and labels other than the opt-in labels MUST NOT affect matching.

#### Scenario: Team granted through /grant-access

- **WHEN** a lead grants a member's GitHub account the `discord-bot` team, which has access to `org/digital-ground-game-discord-bot`, and the member runs `/find-work`
- **THEN** issues in `org/digital-ground-game-discord-bot` are matched

#### Scenario: Excluded team

- **WHEN** a member is on an excluded admin team that reaches every repository
- **THEN** that team matches nothing, so the member's draw is not all matched issues

#### Scenario: Team nested under an excluded team

- **WHEN** a member is on a team two or more levels beneath an excluded team, including before the bot has cached the org's team list
- **THEN** that team matches nothing either

#### Scenario: Only pull requests to offer

- **WHEN** the issue pool is empty but there are open pull requests
- **THEN** the member's teams are still read, once, so the team tier of review suggestions can be filled

### Requirement: Review suggestions

Alongside the draw, the bot SHALL suggest up to two open pull requests in the organization's public repositories: history matches first, then team-repository pull requests for any slot left over. A pull request MUST NOT be suggested twice. Each suggestion SHALL say why it was offered, and a suggestion from either source pays the same `review` points.

#### Scenario: History match outranks the team tier

- **WHEN** one open pull request changes files the member has committed to and others are only in their team's repositories
- **THEN** the history match is suggested first, and one team-tier pull request fills the second slot

### Requirement: Suggestions from commit history

The bot SHALL suggest open pull requests that change files the member has committed to on the default branch, ordered by most matched files, then most commits across them, then longest waiting. Lockfiles, build output and snapshots MUST be ignored when matching.

#### Scenario: Only lockfiles in common

- **WHEN** the only file a pull request shares with the member's history is a lockfile, and the pull request is not in one of the member's matched repositories
- **THEN** that pull request is not suggested

### Requirement: Suggestions from team repositories

When fewer than two pull requests match by history, the bot SHALL fill the remaining slots with open pull requests in the member's matched repositories (see "Matching from GitHub team membership"), those with no requested or past reviewer first, then longest waiting. When the member's teams can't be read, or team matching isn't configured, this tier MUST offer nothing.

#### Scenario: Pull request that only adds files

- **WHEN** an open pull request in a repository the member's team reaches only adds new files, so no one has history on them
- **THEN** it can still be suggested to the member from the team tier

#### Scenario: Member with no commit history

- **WHEN** a member who has never committed to the organization's repositories is on a team that reaches a repository with open pull requests
- **THEN** up to two of those pull requests are suggested, unreviewed ones first

#### Scenario: Teams can't be read for reviews

- **WHEN** the member's teams can't be read, or team matching isn't configured
- **THEN** only history matches are suggested

### Requirement: Pull requests never suggested

Review suggestions MUST leave out draft pull requests, pull requests authored by a bot account, the member's own pull requests, and pull requests on which the member is already a requested or past reviewer.

#### Scenario: Member's own pull request

- **WHEN** the member authored an open pull request that touches files they committed to
- **THEN** that pull request is not suggested

#### Scenario: Pull request opened by a bot

- **WHEN** an open pull request was opened by a bot account, such as a dependency update or an automated release
- **THEN** it is never suggested, from either tier

### Requirement: Claiming an issue

Pressing an issue's claim button within five minutes SHALL assign the member's linked GitHub account to that issue and record the claim, noting whether it came from the wildcard slot. Only the member who ran the command can press the buttons. The claim MUST be recorded before the assignment, so that when another live claim exists on the issue the bot refuses without assigning. When the account can't be assigned, or the assignment fails, the bot MUST withdraw the claim.

#### Scenario: Successful claim

- **WHEN** the member presses "Claim website #42" and the issue has no live claim
- **THEN** the bot records the claim, assigns their GitHub account to the issue, and confirms with the points it will pay when that payout is enabled

#### Scenario: Someone claimed it first

- **WHEN** the member presses a claim button for an issue that already has a live claim
- **THEN** the bot says the issue is already claimed and does not assign it

#### Scenario: Account not assignable

- **WHEN** the member's GitHub account can't be assigned on the issue's repository, for example because of an unaccepted organization invitation
- **THEN** the bot explains that access is needed and does not assign

#### Scenario: Two members claim at once

- **WHEN** two members press claim on the same issue at about the same time
- **THEN** only one claim is recorded and only that member is assigned; the other is told the issue is already claimed

#### Scenario: Assignment fails

- **WHEN** the claim is recorded but GitHub refuses the assignment
- **THEN** the claim is withdrawn, the issue can be claimed again, and the member is told the claim failed

#### Scenario: Buttons time out

- **WHEN** five minutes pass with no button pressed
- **THEN** the reply is replaced with a notice that the draw has expired

### Requirement: Re-reading the issue before assigning

After recording a claim, the bot MUST re-read the issue on GitHub before assigning, since the pool can be up to an hour old. When the issue is no longer open and unassigned, the bot MUST withdraw the claim and say the issue was taken. When the issue can't be read, it MUST withdraw the claim and say the claim failed.

#### Scenario: Taken on GitHub since the draw

- **WHEN** the member presses a claim button for an issue that was assigned or closed on GitHub after the pool was last refreshed
- **THEN** the bot withdraws the claim, says the issue is already claimed, and does not assign it

#### Scenario: Issue can't be re-read

- **WHEN** the member presses a claim button and GitHub returns an error when the issue is re-read
- **THEN** the bot withdraws the claim, says the claim failed, and does not assign it

### Requirement: Telling a GitHub failure from a refusal

When GitHub fails to answer whether the member can be assigned, the bot MUST withdraw the claim and say the claim failed, not that access is needed. When the assignment request fails, the bot MUST re-read the issue: if the member is assigned, the claim stands and is confirmed; if not, the claim is withdrawn; if the issue can't be read, the claim is kept and the member is told the assignment couldn't be confirmed.

#### Scenario: GitHub down during the access check

- **WHEN** the member presses a claim button and GitHub returns a server error when asked whether their account can be assigned
- **THEN** the bot withdraws the claim and says the claim failed, without saying access is needed

#### Scenario: Assignment landed but its answer was lost

- **WHEN** the assignment request times out after GitHub applied it
- **THEN** the bot sees the member assigned on re-reading the issue, keeps the claim, and confirms it

#### Scenario: Assignment can't be confirmed

- **WHEN** the assignment request fails and the issue then can't be read
- **THEN** the claim is kept, the member is told the assignment couldn't be confirmed, and the payout job expires the claim if the member never ends up assigned

### Requirement: Answering button presses in time

The bot MUST acknowledge a claim or review press before calling GitHub, then edit the reply once the outcome is known, so a slow GitHub can't make the interaction fail.

#### Scenario: Slow GitHub

- **WHEN** GitHub takes longer than Discord's three-second window to answer after a claim button is pressed
- **THEN** the press is still acknowledged in time, and the reply shows the outcome once GitHub answers

### Requirement: Taking a review

Pressing a review button SHALL request a review from the member's linked GitHub account on that pull request and record the request. Each GitHub account holds at most one live review request per pull request. The confirmation SHALL state the points the review will pay when that payout is enabled.

#### Scenario: Successful review request

- **WHEN** the member presses "Review website #17"
- **THEN** the bot requests their review on GitHub, records the request, and confirms with the points it will pay

#### Scenario: Reviewer not assignable

- **WHEN** GitHub refuses the review request because the account lacks access
- **THEN** the bot explains that access is needed and records nothing

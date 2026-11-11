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

The bot SHALL offer only open, unassigned issues, not pull requests, that carry the configured marker label (default `available`) in the organization's public repositories. It MUST NOT enumerate private repositories, and MUST leave out repositories listed in `config.findWork.excludeRepos`. The pool SHALL be loaded when the bot starts and refreshed on a schedule (hourly by default).

#### Scenario: Unlabelled issue

- **WHEN** an open, unassigned issue in a public repository lacks the marker label
- **THEN** it is never offered

#### Scenario: Excluded repository

- **WHEN** a repository is listed in `config.findWork.excludeRepos`
- **THEN** none of its issues are offered, even ones carrying the marker label

### Requirement: Skill-matched draw with a wildcard

A draw SHALL offer up to three issues: two matched to the member's skills and one wildcard drawn at random from the stalest third, by last update, of issues that match none of them. When either side is short, the draw SHALL backfill from the rest of the pool so it offers three issues whenever three exist. Only an issue drawn into the wildcard slot SHALL be marked as a wildcard; a backfilled issue SHALL NOT be, so it pays the ordinary rate.

#### Scenario: Member with matching roles

- **WHEN** a member holding the role "Front End Development" runs `/find-work` and issues labelled `front-end-development` exist
- **THEN** two of the offered issues carry that label and the third is a wildcard

#### Scenario: Roles match nothing

- **WHEN** none of the member's roles match any issue in the pool
- **THEN** one issue is the wildcard, the rest are backfilled from the pool at the ordinary rate, and the reply says that their roles matched no issues

#### Scenario: Thin pool

- **WHEN** the pool holds fewer than three issues
- **THEN** the draw offers every issue in the pool

### Requirement: Skills from Discord roles

A member's skills SHALL be the slugs of their Discord role names: lowercased, with runs of non-alphanumeric characters collapsed to a hyphen and leading or trailing hyphens removed. A role whose slug equals the marker label MUST be ignored. An issue matches a member when any of its label slugs equals one of their skills.

#### Scenario: Role name and label spelled differently

- **WHEN** a member holds the role "Front End Development" and an issue carries the label `front-end-development`
- **THEN** the issue matches the member

#### Scenario: Role named like the marker label

- **WHEN** a member holds a role named "Available" and the marker label is `available`
- **THEN** that role matches no issues

### Requirement: Review suggestions

Alongside the draw, the bot SHALL suggest up to two open pull requests in the organization's public repositories that change files the member has committed to on the default branch. It MUST leave out draft pull requests, the member's own pull requests and pull requests on which they are already a requested or past reviewer, and MUST ignore lockfiles, build output and snapshots when matching. Suggestions SHALL be ordered by most matched files, then most commits across them, then longest waiting.

#### Scenario: Member's own pull request

- **WHEN** the member authored an open pull request that touches files they committed to
- **THEN** that pull request is not suggested

#### Scenario: Only lockfiles in common

- **WHEN** the only file a pull request shares with the member's history is a lockfile
- **THEN** that pull request is not suggested

### Requirement: Claiming an issue

Pressing an issue's claim button within five minutes SHALL assign the member's linked GitHub account to that issue and record the claim, noting whether it came from the wildcard slot. Only the member who ran the command can press the buttons. The claim MUST be recorded before the assignment, so that when another live claim exists on the issue the bot refuses without assigning. When the account can't be assigned, or the assignment fails, the bot MUST withdraw the claim.

#### Scenario: Successful claim

- **WHEN** the member presses "Claim #42" and the issue has no live claim
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

- **WHEN** the member presses "Review #17"
- **THEN** the bot requests their review on GitHub, records the request, and confirms with the points it will pay

#### Scenario: Reviewer not assignable

- **WHEN** GitHub refuses the review request because the account lacks access
- **THEN** the bot explains that access is needed and records nothing

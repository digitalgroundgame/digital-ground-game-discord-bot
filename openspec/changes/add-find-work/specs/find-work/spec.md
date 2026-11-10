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

The bot SHALL offer only open, unassigned issues, not pull requests, that carry the configured marker label (default `available`) in the organization's public repositories. It MUST NOT enumerate private repositories, and MUST leave out repositories listed in `config.findWork.excludeRepos`. The pool SHALL be refreshed on a schedule (hourly by default).

#### Scenario: Unlabelled issue

- **WHEN** an open, unassigned issue in a public repository lacks the marker label
- **THEN** it is never offered

#### Scenario: Excluded repository

- **WHEN** a repository is listed in `config.findWork.excludeRepos`
- **THEN** none of its issues are offered, even ones carrying the marker label

### Requirement: Skill-matched draw with a wildcard

A draw SHALL offer up to three issues: two matched to the member's skills and one wildcard drawn at random from the stalest third, by last update, of issues that match none of them. When either side is short, the draw SHALL backfill from the rest of the pool so it offers three issues whenever three exist. An issue SHALL be marked as a wildcard exactly when it matches none of the member's skills.

#### Scenario: Member with matching roles

- **WHEN** a member holding the role "Front End Development" runs `/find-work` and issues labelled `front-end-development` exist
- **THEN** two of the offered issues carry that label and the third is a wildcard

#### Scenario: Roles match nothing

- **WHEN** none of the member's roles match any issue in the pool
- **THEN** the draw is all wildcards and the reply says that their roles matched no issues

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

Alongside the draw, the bot SHALL suggest up to two open pull requests in the organization's public repositories that change files the member has committed to on the default branch. It MUST leave out the member's own pull requests and pull requests on which they are already a requested or past reviewer, and MUST ignore lockfiles, build output and snapshots when matching. Suggestions SHALL be ordered by most matched files, then most commits across them, then longest waiting.

#### Scenario: Member's own pull request

- **WHEN** the member authored an open pull request that touches files they committed to
- **THEN** that pull request is not suggested

#### Scenario: Only lockfiles in common

- **WHEN** the only file a pull request shares with the member's history is a lockfile
- **THEN** that pull request is not suggested

### Requirement: Claiming an issue

Pressing an issue's claim button within five minutes SHALL assign the member's linked GitHub account to that issue and record the claim, noting whether it came from the wildcard slot. Only the member who ran the command can press the buttons. The bot MUST refuse a claim when another live claim exists on the issue, and MUST NOT assign when the GitHub account can't be assigned on that repository. The confirmation SHALL state the points the claim will pay when that payout is enabled.

#### Scenario: Successful claim

- **WHEN** the member presses "Claim #42" and the issue has no live claim
- **THEN** the bot assigns their GitHub account to the issue, records the claim, and confirms with the points it will pay

#### Scenario: Someone claimed it first

- **WHEN** the member presses a claim button for an issue that already has a live claim
- **THEN** the bot says the issue is already claimed and does not assign it

#### Scenario: Account not assignable

- **WHEN** the member's GitHub account can't be assigned on the issue's repository, for example because of an unaccepted organization invitation
- **THEN** the bot explains that access is needed and does not assign

#### Scenario: Assigned but not recorded

- **WHEN** the GitHub assignment succeeds but recording the claim fails
- **THEN** the bot tells the member the assignment landed but the claim was not recorded, so no payout will follow

#### Scenario: Buttons time out

- **WHEN** five minutes pass with no button pressed
- **THEN** the reply is replaced with a notice that the draw has expired

### Requirement: Taking a review

Pressing a review button SHALL request a review from the member's linked GitHub account on that pull request and record the request. Each member holds at most one live review request per pull request. The confirmation SHALL state the points the review will pay when that payout is enabled.

#### Scenario: Successful review request

- **WHEN** the member presses "Review #17"
- **THEN** the bot requests their review on GitHub, records the request, and confirms with the points it will pay

#### Scenario: Reviewer not assignable

- **WHEN** GitHub refuses the review request because the account lacks access
- **THEN** the bot explains that access is needed and records nothing

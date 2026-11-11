## ADDED Requirements

### Requirement: Attributable claim records

Every accepted issue claim and review request SHALL be recorded with the guild, the Discord member, the GitHub login that was assigned, the repository and number, and the time. Issue claims MUST also record whether they came from the wildcard slot. The recorded GitHub login MUST NOT change if the member later links a different account.

#### Scenario: Member relinks GitHub

- **WHEN** a member with a live claim links a different GitHub account
- **THEN** the claim still names the account that was assigned

### Requirement: Claim lifecycle

Records SHALL start live (`claimed` or `requested`) and end as `completed` or `expired`. An issue SHALL have at most one live claim at a time, and a new claim after an expiry SHALL be a new record that keeps the expired one.

#### Scenario: Re-claim after expiry

- **WHEN** a claim on an issue expires and another member claims the same issue
- **THEN** a new live claim is recorded and the expired one is kept

### Requirement: Scheduled settlement

A job SHALL settle live claims and review requests on a schedule (hourly by default, configurable under `config.jobs.payFindWork`). When the bot can't read an issue or pull request from GitHub, it MUST leave that record live for the next run rather than expire it. A failure settling one record MUST NOT stop the job from settling the rest.

#### Scenario: GitHub unavailable

- **WHEN** the payout job runs and GitHub returns an error for a claimed issue
- **THEN** the claim stays live and is checked again on the next run

#### Scenario: One record fails

- **WHEN** settling one claim throws an error during a payout run
- **THEN** the error is logged and the job goes on to settle the remaining claims and review requests

### Requirement: Issue claim payout

A live issue claim SHALL pay when the issue was closed as completed, or with no reason, by a merged pull request the claimer authored or a commit the claimer wrote, and the claimer's GitHub login is still among its assignees. It SHALL expire when the claimer is no longer assigned, when the issue was closed by hand or by someone else's code, or when it was closed as not planned or as a duplicate. Otherwise it SHALL stay live, subject to the claim age limits.

#### Scenario: Claimer finishes the issue

- **WHEN** a merged pull request the claimer authored closes the issue as completed with the claimer still assigned
- **THEN** the claim is marked completed and the claimer receives the issue points

#### Scenario: Closed by someone else's code

- **WHEN** a merged pull request authored by someone other than the claimer closes the issue, with the claimer still assigned
- **THEN** the claim expires without payment

#### Scenario: Closed by hand

- **WHEN** the claimer, or anyone else, closes the issue as completed without a merged pull request or commit
- **THEN** the claim expires without payment, so nobody can be paid for closing their own claim

#### Scenario: Work taken over

- **WHEN** the claimer is unassigned and someone else closes the issue
- **THEN** the claim expires and nobody is paid for it

#### Scenario: Closed as not planned

- **WHEN** the issue is closed as not planned with the claimer still assigned
- **THEN** the claim expires without payment

#### Scenario: Still in progress

- **WHEN** the issue is open, the claimer is still assigned, and the claim is less than 30 days old
- **THEN** the claim stays live

### Requirement: Claim age limits

A claim less than 10 minutes old whose claimer is not yet assigned SHALL stay live, since its GitHub assignment may still be landing. An issue claim still open 30 days after it was made SHALL expire without payment, and so SHALL a review request still unreviewed 14 days after it was made, so abandoned work stops costing the payout job GitHub reads.

#### Scenario: Assignment still landing

- **WHEN** the payout job runs a minute after a claim was recorded and the claimer is not yet among the issue's assignees
- **THEN** the claim stays live

#### Scenario: Claim left open too long

- **WHEN** the issue is still open 30 days after the claim, with the claimer still assigned
- **THEN** the claim expires without payment

#### Scenario: Review never submitted

- **WHEN** the pull request is still open 14 days after the request and the member has not submitted a counted review
- **THEN** the request expires without payment

### Requirement: Issue payout amount

A completed claim MUST pay `config.findWork.points.wildcardIssue` (default 2) when it came from the wildcard slot, and `config.findWork.points.issue` (default 1) otherwise. Points MUST be paid into the guild where the claim was made, with the bot as the giver.

#### Scenario: Wildcard bonus

- **WHEN** a claim drawn from the wildcard slot completes
- **THEN** the claimer receives the wildcard points instead of the regular issue points

### Requirement: Review payout

A live review request SHALL pay `config.findWork.points.review` (default 1) once the member has submitted an approving, changes-requested or comment review on the pull request at or after the time of the request, allowing one minute for clock skew. Dismissed and pending reviews MUST NOT count. A request on a pull request that is closed or merged without such a review SHALL expire.

#### Scenario: Review submitted

- **WHEN** the member leaves a "changes requested" review after taking the review
- **THEN** the request is marked completed and the member receives the review points

#### Scenario: Merged without the member's review

- **WHEN** the pull request is merged and the member never submitted a counted review
- **THEN** the request expires without payment

### Requirement: Pay at most once

Settling a record MUST change its state and write its points award in one transaction, and MUST only apply to a record that is still live, so that a record is paid at most once however many times settlement runs.

#### Scenario: Settlement runs twice

- **WHEN** two settlement runs process the same completed claim
- **THEN** the claimer is paid once, not twice

### Requirement: Configurable point amounts

Each payout amount SHALL be a whole number from 0 to 10, read from `config.findWork.points`. Zero MUST turn that kind of payout off, and the bot MUST NOT promise a reward for it in `/find-work` replies. Any other value MUST stop the bot at startup with an error naming the bad key, and so MUST a `points` value that isn't an object or a key other than `issue`, `wildcardIssue` and `review`.

#### Scenario: Payout turned off

- **WHEN** `config.findWork.points.review` is 0
- **THEN** review confirmations show no reward line and completed reviews award nothing

#### Scenario: Typo in config

- **WHEN** `config.findWork.points.issue` is 50
- **THEN** the bot fails to start with an error naming `config.findWork.points.issue`

#### Scenario: Misspelled key

- **WHEN** `config.findWork.points` sets `wildcard` instead of `wildcardIssue`
- **THEN** the bot fails to start with an error naming the unknown key `wildcard`, instead of paying the default wildcard rate

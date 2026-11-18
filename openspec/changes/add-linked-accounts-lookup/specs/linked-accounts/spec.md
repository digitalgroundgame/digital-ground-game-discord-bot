## ADDED Requirements

### Requirement: Private, coordinator-gated lookup

The `/linked-accounts` command SHALL reply ephemerally and MUST NOT be available in DMs. Looking up another member MUST require one of the coordinator roles configured in `grantAccess.allowedRoleKeys`, checked when the command runs. A member MAY look up their own links without the role. The command's registration MUST NOT set `default_member_permissions`, so every member can reach the self-lookup and no coordinator is hidden from it by a Discord permission they lack.

#### Scenario: Coordinator looks up a member

- **WHEN** a member with a coordinator role runs `/linked-accounts user:@member`
- **THEN** the bot replies privately with that member's linked accounts

#### Scenario: Member without the role looks up someone else

- **WHEN** a member without a coordinator role runs `/linked-accounts` naming another member
- **THEN** the bot replies privately that they don't have permission, and reveals no account

#### Scenario: Member looks up their own links

- **WHEN** a member runs `/linked-accounts` without a `user`, or naming themselves
- **THEN** the bot replies privately with their own linked accounts, whatever their roles

#### Scenario: No database configured

- **WHEN** the bot has no database
- **THEN** the bot replies privately that account linking isn't configured

### Requirement: Every linked account is shown

The reply SHALL list every account linked to the member, one line per service, in the order `/link-account` offers the services (Google, then GitHub). Each line SHALL show the service, the identifier (the email for Google, the username for GitHub) and when it was linked as a relative Discord timestamp. When nothing is linked, the reply SHALL say so and point to `/link-account`.

#### Scenario: Google and GitHub linked

- **WHEN** a member has linked both a Google email and a GitHub username
- **THEN** the reply shows the Google email first, then the GitHub username

#### Scenario: GitHub only

- **WHEN** a member has linked only a GitHub username
- **THEN** the reply shows only the GitHub line

#### Scenario: Nothing linked

- **WHEN** a member has no linked accounts
- **THEN** the reply says they haven't linked any accounts yet

### Requirement: Lookups are audited without exposing identifiers

Each lookup SHALL be logged with the Discord tags of who looked up whom. The log MUST NOT include the linked email or username.

#### Scenario: Lookup is logged

- **WHEN** a coordinator looks up a member with a linked Google email
- **THEN** the log names both members and does not contain the email

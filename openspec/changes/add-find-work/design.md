# Design

## Context

The work already exists on the `give-issue-pr-review` branch. This change records it in OpenSpec rather than proposing something new, so the design describes the choices the code made and why.

## Goals / Non-Goals

**Goals:**

- Point members at work they are likely able to do, plus one nudge toward neglected work.
- Make every payout attributable to the Discord member who took the work.
- Never pay twice for the same claim, and never lose a payout to a GitHub outage.

**Non-Goals:**

- Role aliases for Discord roles whose names don't slug to any label in use.
- Weighting the wildcard by how few members hold a matching role (staleness stands in for now).
- Raising GitHub access requests automatically when a member can't be assigned.
- Enumerating private repositories.

## Decisions

- **Curation by label on GitHub.** An issue is offered only while it carries the marker label, so maintainers advertise or withdraw work on GitHub without touching bot config. The alternative, a list in config, would drift.
- **Cached pools refreshed by jobs.** The command reads from in-memory caches filled hourly, so a draw costs no GitHub calls and stays fast. Claim time re-checks that nobody else holds a live claim before assigning.
- **Role names matched to labels by slug.** "Front End Development" and `front-end-development` both slug to the same value, so no mapping file is needed for the common case. A role that slugs to the marker label is ignored so it can't match everything.
- **Claims recorded locally, not inferred from GitHub.** GitHub knows who is assigned but not which Discord member asked or whether it came from the wildcard slot. The GitHub login is denormalized onto the claim so a later relink doesn't reattribute it.
- **Settlement is one transaction guarded on the live state.** The state change and the points award commit together, and the update only matches a row still `claimed` or `requested`, so reruns can't double-pay.
- **Pay only a claimer still assigned at close.** This stops paying someone who dropped the issue and stops paying the original claimer when someone else took it over.
- **Pay only for a close that came from code.** The payout reads the issue's latest close event and pays only when its closer is a merged pull request or a commit. Without this, anyone able to close issues could claim one, close it and be paid. It costs one GraphQL read per closed claim, and an issue closed by hand after an unlinked merge expires instead of paying.
- **Claim before assigning.** The claim row is inserted first and the one-live-claim index decides a race between two members; the claim is withdrawn if the GitHub assignment doesn't land.
- **Unreadable status means wait.** If GitHub can't be read, the claim is left for the next run instead of expired.
- **Ephemeral reply with a five-minute button window.** A draw is personal, and an ephemeral reply keeps channels clean. The cost is that buttons stop working when the interaction expires.

## Risks / Trade-offs

- A null `state_reason` on a closed issue is treated as completed, since that is what GitHub records when no reason is given. Because a close must also come from a merged pull request or commit, this no longer lets a careless or self-made close pay out.
- A pull request that fixes an issue without a closing keyword (`Fixes #n`) leaves the claim to expire when someone closes the issue by hand. The `/find-work` reward line tells members a merged pull request has to close the issue.
- Review timestamps from GitHub are compared with a one-minute allowance for clock skew → a review submitted just before the request could count. Accepted as negligible.
- Point amounts are capped at 10 per payout in config validation to catch typos that would swamp the leaderboard.

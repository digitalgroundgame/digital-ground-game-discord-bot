# Spec Delta

## Purpose

Lets server members submit timestamped clip suggestions for online videos so the media team receives them in one place, with links that open the video at the suggested moment.

## ADDED Requirements

### Requirement: Members can submit a clip suggestion

The bot SHALL provide a `/clip` slash command, usable in the server (not in DMs), that takes a required video URL, an optional start time, an optional end time and an optional note. When no role keys are configured, every server member SHALL be allowed to run it.

#### Scenario: Member submits a suggestion with a start time

- **WHEN** a member runs `/clip` with `url` set to a video link and `start` set to `1:02:03`
- **THEN** the bot accepts the submission and delivers a suggestion starting at 1 hour, 2 minutes, 3 seconds

#### Scenario: Command is used in a DM

- **WHEN** a user tries to run `/clip` in a direct message with the bot
- **THEN** the command is not available there

#### Scenario: Role restriction is configured

- **WHEN** role keys are configured for clip suggestions and a member holding none of those roles runs `/clip`
- **THEN** the bot refuses the command without delivering a suggestion

### Requirement: Timestamps accept common formats

The bot SHALL accept a time as colon-separated `H:MM:SS` or `M:SS` (minutes may exceed 59 in the two-part form), as unit form combining `h`, `m` and `s` (for example `1h2m3s`, `45m`, `90s`), or as a plain whole number of seconds. Surrounding whitespace SHALL be ignored and unit letters SHALL be case-insensitive.

#### Scenario: Colon form

- **WHEN** a member enters `start` as `1:02:03`
- **THEN** the start time is 3723 seconds

#### Scenario: Two-part colon form over an hour

- **WHEN** a member enters `start` as `62:03`
- **THEN** the start time is 3723 seconds

#### Scenario: Unit form

- **WHEN** a member enters `start` as `1h2m3s`
- **THEN** the start time is 3723 seconds

#### Scenario: Plain seconds

- **WHEN** a member enters `start` as `3723`
- **THEN** the start time is 3723 seconds

#### Scenario: Unrecognized time

- **WHEN** a member enters `start` or `end` as text that matches none of the accepted formats (for example `about an hour in`, or `1:75:00`)
- **THEN** the bot rejects the submission with a private message that names the field and shows the accepted formats, and delivers nothing

### Requirement: Start time can come from the link

The bot SHALL read a start time from a `t` query parameter on the submitted URL when `start` is not given. When both are present, `start` SHALL take precedence. When neither provides a start time, the bot SHALL reject the submission.

#### Scenario: Timestamped link only

- **WHEN** a member runs `/clip` with `url` set to `https://www.youtube.com/watch?v=abc123&t=1h2m3s` and no `start`
- **THEN** the suggestion's start time is 3723 seconds

#### Scenario: Explicit start overrides the link

- **WHEN** a member runs `/clip` with `url` containing `t=600` and `start` set to `12:00`
- **THEN** the suggestion's start time is 720 seconds

#### Scenario: No start time anywhere

- **WHEN** a member runs `/clip` with a URL that has no timestamp and no `start`
- **THEN** the bot rejects the submission with a private message asking for a start time, and delivers nothing

### Requirement: End time is optional and must follow the start

When `end` is given, the bot SHALL require it to be strictly later than the start time and SHALL include the end time and the clip length in the suggestion. When `end` is omitted, the suggestion SHALL show only the start time.

#### Scenario: Valid range

- **WHEN** a member submits start `1:02:03` and end `1:03:13`
- **THEN** the suggestion shows the range 1:02:03 to 1:03:13 and a length of 1:10

#### Scenario: End not after start

- **WHEN** a member submits an `end` equal to or earlier than the start time
- **THEN** the bot rejects the submission with a private message explaining that the end must be after the start, and delivers nothing

#### Scenario: Start only

- **WHEN** a member submits a start time and no `end`
- **THEN** the suggestion shows the start time and no end time or length

### Requirement: Only web links are accepted

The bot SHALL accept a URL only if it is an absolute `http` or `https` link. Any other value SHALL be rejected.

#### Scenario: Not a link

- **WHEN** a member enters `url` as `watch the destiny stream`
- **THEN** the bot rejects the submission with a private message asking for a video link, and delivers nothing

#### Scenario: Non-web scheme

- **WHEN** a member enters `url` as `javascript:alert(1)` or `ftp://example.com/video`
- **THEN** the bot rejects the submission and delivers nothing

### Requirement: YouTube and Twitch links open at the start time

For YouTube video links (`youtube.com/watch`, `youtu.be`, `youtube.com/live`, `youtube.com/shorts`, including `www.` and `m.` hosts) and Twitch VOD links (`twitch.tv/videos/<id>`), the bot SHALL post a link to the same video that opens at the suggestion's start time, regardless of any timestamp on the submitted link.

#### Scenario: YouTube short link

- **WHEN** a member submits `https://youtu.be/abc123` with start `1:02:03`
- **THEN** the posted link opens video `abc123` on YouTube at 3723 seconds

#### Scenario: YouTube link with a different timestamp

- **WHEN** a member submits `https://www.youtube.com/watch?v=abc123&t=10` with start `5:00`
- **THEN** the posted link opens video `abc123` at 300 seconds

#### Scenario: Twitch VOD

- **WHEN** a member submits `https://www.twitch.tv/videos/987654` with start `1:02:03`
- **THEN** the posted link opens Twitch VOD `987654` at 1 hour, 2 minutes, 3 seconds

### Requirement: Other links are posted as given

For any accepted link that is not a recognized YouTube video or Twitch VOD link, the bot SHALL post the submitted link unchanged, together with the time range, so the clipper can seek manually.

#### Scenario: Unrecognized platform

- **WHEN** a member submits `https://rumble.com/v123-some-stream.html` with start `45:00`
- **THEN** the suggestion includes that exact link and shows a start time of 45:00

### Requirement: Suggestions are delivered to the configured destination

The bot SHALL deliver each accepted suggestion to the single destination set in configuration, which may be a forum channel, a text or announcement channel, or a thread (including a post in a forum). A forum channel SHALL get a new post per suggestion; a text, announcement or thread destination SHALL get a new message per suggestion.

#### Scenario: Forum destination

- **WHEN** the configured destination is a forum channel and a member submits a valid suggestion
- **THEN** a new forum post is created for that suggestion

#### Scenario: Text destination

- **WHEN** the configured destination is a text or announcement channel and a member submits a valid suggestion
- **THEN** a new message for that suggestion is sent in that channel

#### Scenario: Megathread destination

- **WHEN** the configured destination is a single post in a forum (for example a clip-suggestions megathread in the request board) and a member submits a valid suggestion
- **THEN** a new message for that suggestion is sent in that post, and no new forum post is created

#### Scenario: Archived thread destination

- **WHEN** the configured destination thread has been auto-archived for inactivity but is not locked, and a member submits a valid suggestion
- **THEN** the suggestion is delivered in that thread

### Requirement: Suggestions show what a clipper needs

Each delivered suggestion SHALL show the clickable video link, the start time, the end time and clip length when given, the note when given, and the submitting member. Delivering a suggestion SHALL NOT notify any user or role.

#### Scenario: Full suggestion

- **WHEN** a member submits a YouTube link, start `1:02:03`, end `1:03:13` and note `Destiny reacts to the debate`
- **THEN** the delivered suggestion shows the deep link, 1:02:03, 1:03:13, a length of 1:10, the note and the submitter

#### Scenario: Note containing mentions

- **WHEN** a member submits a note containing `@everyone` or a user mention
- **THEN** the delivered suggestion does not notify anyone

#### Scenario: Forum post title

- **WHEN** a suggestion is delivered to a forum channel
- **THEN** the post title includes the start time, and includes the note (shortened to fit Discord's title limit) when one is given

### Requirement: Submitter gets private confirmation or a clear error

The bot SHALL reply only to the submitter. On success the reply SHALL link to the delivered post or message. When the destination is not configured, cannot be found, is not a supported channel type, or the bot cannot post there, the reply SHALL say the suggestion could not be delivered, and the bot SHALL log the cause.

#### Scenario: Successful submission

- **WHEN** a member's suggestion is delivered
- **THEN** the member gets a private reply with a link to the new post or message

#### Scenario: Destination not configured

- **WHEN** no destination channel is configured and a member runs `/clip` with valid input
- **THEN** the member gets a private reply saying clip suggestions are not set up yet, and nothing is posted

#### Scenario: Bot cannot post in the destination

- **WHEN** the configured destination does not exist, is not a forum, text, announcement or thread channel, is a locked thread, or the bot lacks permission to post there
- **THEN** the member gets a private reply saying the suggestion could not be delivered, and the cause is logged

### Requirement: Missing destination does not stop the bot

The bot SHALL start normally when no clip-suggestion destination is configured. A configured role key that does not match a known role SHALL stop startup with an error naming the bad key, consistent with other role-gated features.

#### Scenario: No destination at startup

- **WHEN** the bot starts with the clip-suggestion destination channel unset or empty
- **THEN** the bot starts and `/clip` is registered

#### Scenario: Typo in a role key

- **WHEN** the clip-suggestion role keys include a key that is not defined in the role configuration
- **THEN** the bot refuses to start and reports the unknown key

### Requirement: Submissions are rate limited per member

The bot SHALL limit how often a single member can submit clip suggestions in a short window and SHALL tell a member who exceeds the limit to wait, without delivering the extra suggestion.

#### Scenario: Rapid repeat submissions

- **WHEN** a member submits more suggestions than the per-member limit allows within the window
- **THEN** the extra submission is not delivered and the member is told to try again shortly

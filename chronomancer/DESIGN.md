# Chronomancer: Design

A themed group scheduler. A Dungeon Master (organizer) creates a campaign, players mark availability on a grid, the app ranks the best slots, the Discord bot runs a vote on the top slots, then reminds everyone before the confirmed session. D&D is the default theme, but the model is generic and works for any group.

## Stack
- **Backend:** Python 3.11+, FastAPI, SQLAlchemy 2.x, SQLite (Postgres-ready via `DATABASE_URL`).
- **Bot:** discord.py, running in the same process as FastAPI (started in the app lifespan).
- **Frontend:** plain HTML/CSS/JS served by FastAPI as static files. No build step.
- **Tests:** pytest. Scheduling logic is pure Python and is tested without Discord or HTTP.
- **Config:** environment variables via `.env` (never committed). `.env.example` documents them.

## Layout
```
chronomancer/
  DESIGN.md
  requirements.txt
  .env.example
  app/
    main.py            # FastAPI app, lifespan starts bot
    config.py          # settings from env
    db.py              # engine, session
    models.py          # SQLAlchemy models
    schemas.py         # pydantic request/response models
    auth.py            # Discord OAuth, signed session cookie
    scheduling.py      # ranking logic (pure, no I/O)
    reminders.py       # reminder scheduler loop
    routes/            # campaigns, polls, availability, votes
    bot/               # client, slash commands, vote view, notifier
  web/
    index.html, poll.html, campaign.html
    css/base.css, css/themes/{dnd,plain}.css
    js/api.js, grid.js, theme.js
    themes/{dnd,plain}.json   # wording per theme
  tests/
```

## Data model (neutral names; every row is scoped to a guild)
- **User**: id, discord_id (unique), display_name, avatar_url, timezone.
- **Campaign** (UI: "Campaign" / "Group"): id, guild_id, channel_id, name, owner_user_id, cadence (none / weekly / biweekly / monthly), default_duration_min, default_window (start/end time of day), min_quorum, vote_top_n, reminder_offsets_min (JSON, default [1440, 60]).
- **Member**: campaign_id, user_id, role (organizer / player), required (bool).
- **Poll** (one session): id, campaign_id, date_start, date_end, window_start, window_end, slot_minutes (default 30), duration_min, status (collecting / voting / confirmed / cancelled), vote_deadline, vote_message_id, confirmed_start_utc.
- **Availability**: poll_id, user_id, slot_start_utc, level (free / maybe). Absence means unavailable.
- **Candidate**: poll_id, start_utc, score, free_count, maybe_count, rank.
- **Vote**: candidate_id, user_id (one vote per user per poll, changeable until deadline).
- **Reminder**: poll_id, user_id (nullable for channel), send_at_utc, kind (channel / dm), sent_at.

All times are stored in UTC. The browser converts to and from the viewer's timezone.

## Scheduling logic (`scheduling.py`)
Input: availability for a poll, members, duration, quorum. Output: ranked candidate start times.
1. Build the contiguous run of slots covering `duration_min` for each possible start.
2. A player is **free** for a candidate only if every slot in it is marked; **maybe** if all are free or maybe with at least one maybe.
3. Discard candidates missing any required player or below `min_quorum` free players.
4. Score = `free_count * 2 + maybe_count`. Sort by score descending, then earliest start. Keep top `vote_top_n` (default 3, max 5).
5. If fewer than 1 candidate qualifies, report why (not enough players, required player missing) so the organizer can extend the range.

## Discord flows
- **Login:** OAuth2 authorization code flow, scopes `identify` only. State parameter checked; session in a signed, HttpOnly, SameSite cookie.
- **Install:** bot invite with minimal permissions (send messages, embed links, use slash commands). Campaign creation requires the bot to be in the target guild.
- **Slash commands** (six, after consolidation): `/schedule` (anyone: joins the caller, then always answers what is happening, what to do, and one link, in every state); `/chronomancer setup` (Manage Channels: creates this channel's campaign, or changes its settings if it exists; name, `code` to adopt a web campaign, frequency, quorum, length, reminders, timezone, theme in one command); `/chronomancer poll` (organizer: one week; length, quorum and timezone come from the campaign settings); `/chronomancer advance` (organizer: closes a collecting poll into a vote, or decrees the winner of a vote); `/chronomancer cancel` (organizer: the open poll, else the next session); `/chronomancer unlink` (organizer or admin: frees the channel).
- **Vote:** when the organizer closes collection (or the deadline passes), the bot posts an embed with the top N slots as buttons. A click records or changes the player's vote and updates the embed tallies.
- **Confirm:** at the vote deadline, or on the organizer's confirm button, the highest-voted slot wins (ties go to the higher availability score, then earliest). The bot posts the result and creates the Reminder rows.
- **Reminders:** a background loop sends channel pings and DMs at each offset. DMs that fail (closed DMs) fall back to a channel mention. Each reminder is sent once (`sent_at`).
- **Recurrence:** see "Automatic recurrence" below: when a decided session ends, the next one is scheduled automatically at the same local time.

## Themes
- `web/themes/<name>.json` holds wording (organizer, party, session, poll, etc.), `web/css/themes/<name>.css` holds styling via CSS variables.
- `theme.js` loads the chosen theme (stored per user, default `dnd`), swaps the stylesheet, and fills text from the JSON.
- Bot messages use the same wording file, selected by the campaign's theme setting.
- v1 ships `dnd` and `plain`. Adding a theme is two files.

## Security and public-app concerns
- Secrets only from env. `.env` is gitignored.
- Every query is filtered by guild/campaign membership. The API checks the logged-in user's membership on each request.
- CSRF protection on state-changing routes (SameSite cookie plus origin check).
- Rate limit the OAuth and availability endpoints.
- Store the minimum user data (Discord ID, display name, avatar URL, timezone).
- Deleting a campaign removes its polls, availability and votes.

## Phases
1. **Core (no Discord):** models, scheduling logic with tests, REST routes, availability grid UI with the D&D theme, fake user login for dev.
2. **Discord:** OAuth login, bot client, slash commands, vote buttons, confirmation.
3. **Reminders and recurrence:** reminder loop, DM fallback, cadence proposals.
4. **Themes and polish:** plain theme, theme switcher, bot wording, empty and error states.
5. **Portfolio link:** link the Chronomancer card and add an artifact write-up (requires approval to edit `index.html`).

## Phase 2 as built (Discord)
- **Shared service layer** (`app/services.py`): the web API and the bot call the same functions, so a rule exists once. Status changes (`close`, `confirm`, `cancel`) are atomic compare-and-set updates, so two simultaneous actions cannot both win or queue duplicate messages.
- **Outbox** (`notifications` table, `app/bot/outbox.py`): actions queue `vote_open`, `vote_update`, `confirmed` and `cancelled`; a background loop delivers them. Delivery is at-least-once, in order per poll, with exponential backoff (15s up to 10 min, 12 attempts, about an hour). Rows wait while the bot is offline. `/chronomancer repost` re-sends a vote message that was given up on.
- **Buttons** are persistent (`DynamicItem`, custom id `cm:vote:<poll>:<candidate>` / `cm:confirm:<poll>`), so they keep working after a restart, and are honoured only in the channel their campaign is bound to.
- **Binding** a campaign to a channel happens only through the bot (never the web API), is unique per `(guild_id, channel_id)`, and needs Manage permissions. A campaign made on the web shows a notice with its invite code until linked via `/chronomancer link`.
- **OAuth**: `identify` scope only; random per-attempt `state` checked in constant time and single-use; session reset on login; `next` limited to same-site paths (server and client side); the Discord access token is used once and never stored. Bad or expired attempts return to the login page with a message.
- **Supervision**: the bot runs under a supervisor that retries failed starts with backoff; a rejected token stops cleanly with a message while the website keeps running. A failed command sync does not stop the bot.
- **Background loop** also auto-confirms polls whose vote deadline has passed, independent of the bot.
- **One week per poll:** a poll takes a single start date and always covers that day plus the next six (the service derives the end date; clients cannot ask for a range). `/chronomancer poll` takes `week_start` (blank means the week suggested by the campaign's frequency) and an optional `quorum`, because the campaign default of 2 players blocks a one-person test.
- **Meeting frequency** (`one-off, weekly, biweekly, monthly, quarterly, annually`) is set on `/chronomancer setup` or the campaign page's Settings panel and drives automatic recurrence (next section). Monthly, quarterly and annual steps keep the original day of the month (Jan 31 then Feb 28 then Mar 31), not "the first Saturday".
- **Phase 3 as built (reminders and recurrence):**
  - Confirming a session creates one `reminders` row per offset in the campaign's `reminder_offsets_min` (default 1 day and 1 hour before; set with `/chronomancer setup reminders:1d, 1h` or the Settings panel; both go through `PATCH /api/campaigns/{id}`; up to five, 1 minute to 30 days). Offsets already in the past are skipped rather than sent late.
  - The background loop sends due reminders (`app/bot/reminders.py`): a channel post mentioning the whole group (mentions limited to exactly the members: never `@everyone`, never a role), then a DM to each member. The channel post goes first, so a failure there retries with backoff and nobody is DMed twice. Closed DMs are counted and skipped, since the channel mention already reached them. Each reminder is sent once, survives restarts, is skipped if the session has already started, and unlinked campaigns are reminded by DM only. Groups over 50 members are capped.
  - A confirmed future session can be cancelled (`/chronomancer cancel`, `POST /api/polls/{id}/cancel`): unsent reminders are dropped and a "called off" notice is posted.
- **Automatic recurrence:** when a decided session ends (its start plus its length), `services.roll_recurrences` (run by the background loop every few seconds) creates the next session: already confirmed, at the same *local* wall-clock time one interval later (so 11:00 AM stays 11:00 AM through daylight saving), with its reminders and a "The Wheel Turns" announcement. Each session is handled exactly once (an atomic flag), and after downtime the series catches up to the next session still ahead. Cancelling a session skips it and schedules the next one immediately (to stop repeating, set the frequency to one-off). Deciding a session through a poll replaces automatic upcoming ones; changing the frequency re-plans the upcoming automatic one; one-off groups never repeat. Polls that existed before migration `0003` are marked handled, so history never spawns sessions. Columns: `polls.recurrence_handled`, `recurred_from`, `anchor_day`.
- **Discord scheduled events:** while a session is decided, still ahead, and `campaigns.events_enabled` is on (default), one external Discord event exists for it: named after the session, starting at the confirmed time, ending after its length, with the campaign page as its location. The outbox's `event_sync` notification is idempotent: it creates the event if one should exist and none does, and deletes it if one exists and should not (session cancelled, replaced, or events switched off), so retries and repeats never duplicate it. It is queued when a session is confirmed, scheduled automatically, or cancelled, and when the switch changes (applied to already-decided sessions). The bot needs the **Create Events** permission (bit 44, narrower than Manage Events: it can only manage its own events), now part of the invite link; if it is missing the sync is recorded as undeliverable (not retried forever) and `/schedule` (organizer) and `/chronomancer setup` say exactly what to fix. `polls.discord_event_id` remembers the event. Toggle with `/chronomancer setup events:false` or the Settings panel.
- **Threads:** a command or button used inside a thread of the campaign's channel resolves to the parent channel's campaign (`home_channel_id`); replies stay in the thread.
- **Membership follows Discord:** `members.left_at` marks people who are no longer in the server. About every 6 hours (`app/bot/membership.py`) the bot asks Discord, one member at a time (no privileged intent), whether each person in a linked campaign is still there. Those who are not stop counting: not a poll player or required player, not pinged or DMed, no web access, not in the member lists. Safety rules: organizers are never marked; a Discord error or an unreachable server marks nobody; at most 500 lookups per run. They return automatically (role and "required" flag intact) when they use `/schedule` or a vote button. A campaign linked to Discord can only be joined through Discord, never with an invite code, because only Discord proves they are in the server.
- **Not yet done / known limits:** the session cookie is stateless (logout does not revoke a copied cookie); the rate limiter is per process and keys on the client IP (run uvicorn with `--proxy-headers` behind a proxy).

## Database migrations
Schema changes are versioned with Alembic (`migrations/versions/`). The app runs `alembic upgrade head` at startup (`app/migrate.py`), so deploying new code upgrades the database. A database created before migrations existed is stamped as the baseline (`0001`) and upgraded, keeping its data. To change the schema: edit `app/models.py`, then run `python -m alembic revision --autogenerate -m "what changed"`, review the file, and commit it. A test fails if the models and migrations disagree. Set `CHRONOMANCER_AUTO_MIGRATE=0` to skip migrations (only tests do).

## Open items
- Public hosting target (determines OAuth redirect URL and whether SQLite stays).
- Discord application credentials (user creates; supplied via `.env`, never committed).
- Timezone source: browser-detected by default, editable in profile.

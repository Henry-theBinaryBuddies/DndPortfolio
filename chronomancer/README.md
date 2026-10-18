# Chronomancer

A group scheduler with a Discord bot. Someone (the *Dungeon Master* in the D&D look, the *group manager* in the plain look) creates a group. Everyone marks when they are free on a one-week grid. Chronomancer ranks the best times, the bot runs a vote, then confirms the session, creates a Discord event, and reminds everyone. When a session ends, the next one of a repeating group is scheduled on its own.

It was built for tabletop game nights and works for any group that needs a regular time: book clubs, study groups, teams.

**Live:** the instance this project runs is at <https://35-225-68-147.sslip.io> (see [`DEPLOY.md`](DEPLOY.md)).

## What it does

- **Weekly availability grid.** Click a box once for *available* (green), twice for *maybe* (yellow), three times for *not available* (red), a fourth time to clear it. Drag with a mouse to paint, tap a day or a time to fill a whole column or row. Everyone sees times in their own timezone.
- **Ranking and voting.** The best times always go to a vote (the ones where the most people are free, and everyone marked Required is). On the availability grid each box shows how many people are free and hovering lists who, so the group can see the overlap while they mark times. Times that have already begun are greyed out and never offered. The grid refreshes every 30 seconds in the Discord channel. The organizer confirms, or the vote ends at its deadline.
- **Reminders.** A channel post and a direct message before each session (by default 1 day and 1 hour). The direct message has **I'm in / Can't make it** buttons; if more than half of the group can't make it, the session is called off and a new poll opens.
- **Repeating groups.** Weekly, every two weeks, monthly (the same Nth weekday), or yearly. When a session ends, the next one is scheduled at the same local time, and the group has **one repeating Discord event** that always points at the next session.
- **Two looks.** A rich Dungeons & Dragons theme and a clean plain theme, switchable in the page header. Works on phones.
- **Your data.** Organizers can delete a group (its Discord events go with it). Anyone can delete their own data. There is a privacy policy and terms page.

## Discord commands

| Command | Who | What it does |
|---|---|---|
| `/schedule` | anyone | Joins you to this channel's group, then says what is happening and what to do, with a link |
| `/chronomancer setup` | Manage Channels | Creates this channel's group, or changes its settings (`name`, `code`, `frequency`, `length`, `reminders`, `theme`, `events`) |
| `/chronomancer poll` | organizer | Opens a one-week poll (`week_start`, `start`, `end`, `title`; the hours default to the whole day) |
| `/chronomancer advance` | organizer | Closes availability into a vote, or decrees the winning time (`vote_hours`) |
| `/chronomancer cancel` | organizer | Cancels the open poll, or the next session |
| `/chronomancer unlink` | organizer or admin | Frees the channel and removes the group's Discord events |

## Run it on your computer

You need Python 3.15 (it is developed and tested on that version) and a Discord application (below) if you want the bot.

```bash
cd chronomancer
python -m venv .venv
.venv/Scripts/activate            # Windows. On macOS or Linux: source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env              # then edit it (see below)
python -m uvicorn app.main:app --port 8000
```

Open <http://localhost:8000>. With `CHRONOMANCER_DEV=1` in `.env` the login page has a **development login** (any Discord ID and name), so you can try the whole website without Discord. The database (`chronomancer.db`) is created and upgraded automatically on start.

### Set up the Discord bot (optional locally, needed to run it for real)

1. Create an application at <https://discord.com/developers/applications>.
2. **Bot:** copy the token into `DISCORD_BOT_TOKEN`. Leave all privileged intents off.
3. **General Information:** copy the Application ID into `DISCORD_CLIENT_ID`. **OAuth2:** copy the client secret into `DISCORD_CLIENT_SECRET` and add a redirect URL: `http://localhost:8000/auth/callback`.
4. Invite the bot to a server you manage, using (with your Application ID):
   `https://discord.com/oauth2/authorize?client_id=<ID>&permissions=17592186063872&integration_type=0&scope=bot+applications.commands`
   (View Channels, Send Messages, Embed Links, Create Events). The app also prints this link in its log when the bot is in no server yet.
5. For quick testing, set `DISCORD_DEV_GUILD_ID` to your test server's ID so slash commands appear there at once instead of after Discord's global rollout.
6. In a channel, run `/chronomancer setup`.

Never commit `.env`. It holds secrets, and `.gitignore` already excludes it.

### Settings

All settings are environment variables (or lines in `.env`). The full list with comments is in [`.env.example`](.env.example) (local) and [`.env.production.example`](.env.production.example) (server).

| Variable | Meaning |
|---|---|
| `CHRONOMANCER_DEV` | `1` only for local development: fake login, plain-HTTP cookies |
| `SECRET_KEY` | Signs login cookies (required unless in dev mode) |
| `DATABASE_URL` | Defaults to a SQLite file next to the app |
| `PUBLIC_BASE_URL` | Where people reach the site, for the links the bot posts |
| `DISCORD_BOT_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET` | From the Developer Portal |
| `DISCORD_REDIRECT_URI` | Defaults to `PUBLIC_BASE_URL/auth/callback` |
| `CHRONOMANCER_BOT=0` | Run the website without the bot |
| `CHRONOMANCER_COMPACT=0` | Turn off the sweep that drops old availability |

## Tests

```bash
python -m pytest -q
```

Over 600 tests. Discord is replaced by strict fakes, so they need no network or credentials.

## Project layout

```
app/         the server: services (all the rules), scheduling, bot, routes, background loop
web/         the pages, scripts, styles and the two themes
migrations/  database upgrades (Alembic), applied automatically at start
deploy/      Caddy config and the VM scripts
tests/       the test suite
```

[`DESIGN.md`](DESIGN.md) explains how it works and why. Putting it on a server: [`DEPLOY.md`](DEPLOY.md). Looking after it: [`OPERATIONS.md`](OPERATIONS.md).

## Privacy

Logging in asks Discord for your identity only (`identify`). It stores your Discord ID, display name, avatar link and timezone, plus what you mark and vote. See [`web/privacy.html`](web/privacy.html) and [`web/terms.html`](web/terms.html).

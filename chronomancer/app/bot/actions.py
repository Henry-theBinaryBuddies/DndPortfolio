"""Bot behaviour as plain synchronous functions over a database session. The Discord layer
(commands.py, client.py) is a thin wrapper, so everything here is testable without Discord.

Commands (what the group sees):
  /schedule            anyone: join, see what is happening, get your link
  /chronomancer setup  create or reconfigure the campaign in this channel
  /chronomancer poll   open a poll for one week
  /chronomancer advance  close the poll into a vote, or decree the winner
  /chronomancer cancel   cancel the open poll or an upcoming session
  /chronomancer unlink   free this channel
"""
import re
from dataclasses import dataclass
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

import discord
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config, db as dbmod, services
from ..models import Availability, Poll, User
from ..services import ServiceError
from . import wording
from .snapshots import PollSnapshot, load_poll_snapshot


@dataclass(frozen=True)
class DUser:
    id: str
    name: str
    avatar_url: str | None = None
    # True if Discord says this person may manage the channel/server where they ran the
    # command. Decided by Discord, passed in by the command layer; gates channel claiming.
    can_manage: bool = False


@dataclass(frozen=True)
class Reply:
    text: str
    ephemeral: bool = False


@dataclass(frozen=True)
class Outcome:
    text: str
    ok: bool
    snapshot: PollSnapshot | None = None


def with_db(fn, *args):
    """Run fn(db, *args) in its own session. Called from worker threads."""
    with dbmod.SessionLocal() as db:
        return fn(db, *args)


def esc(text: str) -> str:
    """Organizer-controlled text must not inject markdown or mentions into bot messages."""
    return discord.utils.escape_markdown(discord.utils.escape_mentions(text))


def error_text(exc: ServiceError) -> str:
    d = exc.detail
    if not isinstance(d, dict):
        return str(d)
    extra = ""
    if "considered" in d:
        extra = (f" ({d['considered']} start times considered; {d.get('dropped_required', 0)} "
                 f"lost a required person, {d.get('dropped_quorum', 0)} had too few free people)")
    return str(d.get("message", "request failed")) + extra


# ---------------------------------------------------------------- helpers


def _user(db: Session, du: DUser):
    return services.upsert_user(db, du.id, du.name, du.avatar_url)


def _in_channel(guild_id, channel_id) -> None:
    if not guild_id or not channel_id:
        raise ServiceError(400, "Use this command in a server channel.")


def _here(db: Session, guild_id, channel_id):
    _in_channel(guild_id, channel_id)
    campaign = services.campaign_for_channel(db, str(guild_id), str(channel_id))
    if campaign is None:
        raise ServiceError(404, "No campaign lives in this channel yet. "
                                "Use /chronomancer setup here to create one.")
    return campaign


def _require_organizer(db: Session, campaign, user):
    member = services.get_member(db, campaign.id, user.id)
    if member is None or member.role != "organizer":
        w = wording.words(campaign.theme)
        raise ServiceError(403, wording.t(campaign.theme, "botOrganizerOnly", organizer=w["organizerInline"]))
    return member


def _is_organizer(db: Session, campaign, user) -> bool:
    member = services.get_member(db, campaign.id, user.id)
    return member is not None and member.role == "organizer"


def poll_url(poll: Poll) -> str:
    return f"{config.PUBLIC_BASE_URL}/poll.html?id={poll.id}"


def campaign_url(campaign_id: int) -> str:
    return f"{config.PUBLIC_BASE_URL}/campaign.html?id={campaign_id}"


def describe_minutes(total: int) -> str:
    days, rest = divmod(total, 1440)
    hours, mins = divmod(rest, 60)
    return " ".join(f"{n} {word}{'' if n == 1 else 's'}"
                    for n, word in ((days, "day"), (hours, "hour"), (mins, "minute")) if n)


def parse_offsets(text: str) -> list:
    """'1d, 2h 15m' -> [1440, 120, 15]. 'off' or 'none' -> []. Raises ServiceError on junk."""
    text = text.strip().lower()
    if text in ("", "off", "none", "no"):
        return []
    minutes = []
    for token in re.split(r"[,;\s]+", text):
        m = re.fullmatch(r"(\d+)([dhm])", token)
        if not m:
            raise ServiceError(422, f"I could not read {token!r}. Use values like 1d, 2h or 30m, or off.")
        minutes.append(int(m.group(1)) * {"d": 1440, "h": 60, "m": 1}[m.group(2)])
    return minutes


def _ts(moment: datetime, style: str = "F") -> str:
    return f"<t:{int(moment.timestamp())}:{style}>"


def _parse_day(value: str) -> date:
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise ServiceError(422, "Week start must look like 2026-10-24.")


def _parse_time(value: str, label: str) -> time:
    if label == "End" and value.strip() in ("24:00", "24"):
        return time(0)  # the end of the day is stored as 00:00
    try:
        return datetime.strptime(value.strip(), "%H:%M").time()
    except ValueError:
        raise ServiceError(422, f"{label} must look like 18:00 (24-hour)"
                                + (", or 24:00 for the end of the day." if label == "End" else "."))


def settings_summary(campaign) -> str:
    w = wording.words(campaign.theme)
    return (f"{w.get('freq_' + campaign.cadence, campaign.cadence)} · "
            f"{describe_minutes(campaign.default_duration_min)} · "
            f"at least {campaign.min_quorum} free · reminders: "
            + (", ".join(describe_minutes(m) for m in campaign.reminder_offsets_min) + " before"
               if campaign.reminder_offsets_min else "off")
            + f" · Discord events: {'on' if campaign.events_enabled else 'off'}")


# ---------------------------------------------------------------- /schedule


def cmd_schedule(db: Session, du: DUser, guild_id, channel_id, events_ok: bool = True) -> Reply:
    """The one command for players. It always answers the same three things, whatever the
    state: what is happening, what you should do, and where to click."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    services.ensure_member(db, campaign.id, user.id)
    w = wording.words(campaign.theme)
    lines = [f"**{esc(campaign.name)}** · {w.get('freq_' + campaign.cadence, campaign.cadence)}"]

    session = services.next_session(db, campaign.id)
    if session is not None:
        lines.append(f"{w['session']} confirmed: {_ts(session.confirmed_start_utc)} "
                     f"({_ts(session.confirmed_start_utc, 'R')})")
        times = services.pending_reminder_times(db, session.id)
        if times:
            lines.append("Reminders: " + ", ".join(_ts(t, "f") for t in times))
        elif campaign.reminder_offsets_min:
            lines.append(wording.t(campaign.theme, "botRemindersNoFit"))

    poll = services.open_poll(db, campaign.id)
    if poll is None:
        if session is None:
            lines.append(f"Nothing is scheduled. The {w['organizerInline']} can open a poll with /chronomancer poll.")
        link = campaign_url(campaign.id)
    elif poll.status == "collecting":
        responded = set(db.scalars(select(Availability.user_id).where(
            Availability.poll_id == poll.id).distinct()))
        members = services.active_members(db, campaign.id)
        waiting = [m.user.display_name for m in members if m.user_id not in responded]
        lines.append(f"Availability is open for {esc(poll.title or campaign.name)}: "
                     f"{len(members) - len(waiting)}/{len(members)} have responded.")
        if waiting:
            more = f" and {len(waiting) - 15} more" if len(waiting) > 15 else ""
            lines.append("Still waiting on: " + ", ".join(esc(n) for n in waiting[:15]) + more)
        lines.append("**Your turn:** mark the times you can play.")
        link = poll_url(poll)
    else:
        lines.append("A vote is open in this channel for the best times.")
        if poll.vote_deadline:
            lines.append(f"Voting ends {_ts(poll.vote_deadline)}.")
        lines.append("**Your turn:** vote for a time, here or on the page.")
        link = poll_url(poll)
    lines.append(link)
    if _is_organizer(db, campaign, user):
        lines.append(_events_warning(campaign, events_ok).strip())
    return Reply("\n".join(l for l in lines if l)[:1900], True)


# ---------------------------------------------------------------- /chronomancer setup


def cmd_setup(db: Session, du: DUser, guild_id, channel_id, *, name=None, code=None,
              frequency=None, quorum=None, length=None, reminders=None,
              theme=None, events=None, events_ok=True) -> Reply:
    """Create the campaign for this channel, or change its settings if it already exists.
    With `code`, bind a campaign made on the website instead of creating a new one."""
    _in_channel(guild_id, channel_id)
    changes = {"cadence": frequency, "min_quorum": quorum, "default_duration_min": length,
               "theme": theme, "events_enabled": events,
               "reminder_offsets_min": parse_offsets(reminders) if reminders is not None else None}
    changes = {k: v for k, v in changes.items() if v is not None}
    themes = wording.available_themes()
    # Validate everything first, so a bad option never leaves a half-made campaign behind.
    services.check_campaign_settings(name=name, available_themes=themes, **changes)
    campaign = services.campaign_for_channel(db, str(guild_id), str(channel_id))
    user = _user(db, du)

    if campaign is None:  # first time in this channel: claim it
        if not du.can_manage:
            raise ServiceError(403, wording.t(wording.DEFAULT_THEME, "botNeedManage"))
        if code:
            campaign = services.link_campaign(db, user, code.strip(), str(guild_id), str(channel_id))
            verb = "linked to this channel"
        elif name:
            campaign, _ = services.create_campaign(
                db, user, name=name, guild_id=str(guild_id), channel_id=str(channel_id),
                available_themes=themes, **{k: v for k, v in changes.items() if k != "events_enabled"})
            changes = {k: v for k, v in changes.items() if k == "events_enabled"}  # the rest applied
            verb = "created"
        else:
            raise ServiceError(422, "Give the campaign a name, like: /chronomancer setup name:Curse of Strahd")
    else:
        if not du.can_manage and not _is_organizer(db, campaign, user):
            raise ServiceError(403, wording.t(campaign.theme, "botNeedManage"))
        verb = "updated"
        if name:
            changes["name"] = name

    if changes:
        services.update_campaign(db, campaign, available_themes=themes, **changes)
    w = wording.words(campaign.theme)
    text = f"**{esc(campaign.name)}** {verb}.\n{settings_summary(campaign)}"
    text += _events_warning(campaign, events_ok)
    if verb != "updated":
        text += (f"\nEveryone: run `/schedule` in this channel to join. "
                 f"The {w['organizerInline']} opens a poll with `/chronomancer poll`.")
    elif reminders is not None:
        text += _reminders_effect(db, campaign)  # what the new timings mean for a decided session
    return Reply(text)


def _events_warning(campaign, events_ok: bool) -> str:
    """Events are on but the bot cannot create them: say so, with the fix, instead of failing quietly."""
    if campaign.events_enabled and not events_ok:
        return ("\n**Discord events won't be created:** I need the *Create Events* permission. "
                "Give me that role permission, or re-invite me with the link in the bot's description.")
    return ""


def _reminders_effect(db: Session, campaign) -> str:
    """After changing reminder timings: say what will actually be sent for the next session,
    so a timing that cannot fit is never a silent surprise."""
    session = services.next_session(db, campaign.id)
    if session is None or not campaign.reminder_offsets_min:
        return ""
    times = services.pending_reminder_times(db, session.id)
    if times:
        return "\nFor the next session: " + ", ".join(_ts(t, "f") for t in times)
    return "\n" + wording.t(campaign.theme, "botRemindersNoFit")


def cmd_unlink(db: Session, du: DUser, guild_id, channel_id) -> Reply:
    """Free this channel. The organizer may, and so may anyone who manages the channel, so a
    server admin can always reclaim a channel."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    if not du.can_manage and not _is_organizer(db, campaign, user):
        raise ServiceError(403, wording.t(campaign.theme, "botNeedManage"))
    services.unlink_campaign(db, campaign)
    return Reply(f"**{esc(campaign.name)}** no longer speaks in this channel. "
                 "Its polls remain on the website.")


# ---------------------------------------------------------------- poll lifecycle


def cmd_poll(db: Session, du: DUser, guild_id, channel_id, week_start: str | None,
             start: str, end: str, title: str) -> Reply:
    """Open a poll for one week: the seven days from week_start (default: today). Length and
    minimum players come from the campaign's settings. The daily hours are read in the
    organizer's own timezone (learned from their browser; UTC until they have visited the
    website); every player sees every time in their own timezone."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    _require_organizer(db, campaign, user)
    tz = user.timezone or "UTC"
    if week_start and week_start.strip():
        first_day = _parse_day(week_start)
    else:
        first_day = datetime.now(ZoneInfo(tz)).date()
    poll = services.create_poll(
        db, campaign, title=title.strip()[:120], date_start=first_day, tz=tz,
        window_start=_parse_time(start, "Start"), window_end=_parse_time(end, "End"),
    )
    text = wording.t(campaign.theme, "botPollCreated", title=esc(poll.title or campaign.name),
                     url=poll_url(poll))
    text += (f"\nHours: {services.hours_label(poll.window_start, poll.window_end)} {tz} "
             "(everyone sees them in their own timezone).")
    if tz == "UTC":
        text += " Open the website once and I will use your own timezone next time."
    return Reply(text)


def cmd_advance(db: Session, du: DUser, guild_id, channel_id, vote_hours: int | None) -> Reply:
    """Move the open poll to its next step: collecting becomes a vote; a vote becomes a decree."""
    campaign = _here(db, guild_id, channel_id)
    _require_organizer(db, campaign, _user(db, du))
    poll = services.open_poll(db, campaign.id)
    if poll is None:
        raise ServiceError(409, "There is no open poll to move forward. Start one with /chronomancer poll.")
    if poll.status == "collecting":
        services.close_poll(db, poll, vote_hours=vote_hours)
        return Reply(wording.t(campaign.theme, "botPollClosed"))
    services.confirm_poll(db, poll)
    return Reply(wording.t(campaign.theme, "botPollDecreed"))


def cmd_cancel(db: Session, du: DUser, guild_id, channel_id) -> Reply:
    """Cancel the open poll, or else the next decided session that has not happened yet."""
    campaign = _here(db, guild_id, channel_id)
    _require_organizer(db, campaign, _user(db, du))
    poll = services.open_poll(db, campaign.id) or services.next_session(db, campaign.id)
    if poll is None:
        raise ServiceError(409, "There is no open poll or upcoming session to cancel.")
    was_session = poll.status == "confirmed"
    services.cancel_poll(db, poll)
    text = wording.t(campaign.theme, "botPollCancelledReply")
    if was_session:  # cancelling one occurrence skips it; say where the series goes next
        following = services.next_session(db, campaign.id)
        if following is not None:
            text += f" The next session is {_ts(following.confirmed_start_utc)}."
        text += " To stop repeating altogether, set the frequency to one-off with `/chronomancer setup`."
    return Reply(text)


# ---------------------------------------------------------------- button clicks


def _poll_in_place(db: Session, poll_id: int, guild_id, channel_id) -> Poll:
    poll = db.get(Poll, poll_id)
    if poll is None:
        raise ServiceError(404, "That poll no longer exists.")
    c = poll.campaign
    # Defence in depth: a button is only honoured in the channel its campaign is bound to.
    if c.guild_id != (str(guild_id) if guild_id else None) or \
            c.channel_id != (str(channel_id) if channel_id else None):
        raise ServiceError(403, "This poll belongs to a different channel.")
    return poll


def _click(db, du, poll_id, guild_id, channel_id, act, success_key, *, organizer_only=False,
           snapshot=False) -> Outcome:
    """Shared body of the button handlers: locate the poll, check who may press, act."""
    theme = None
    try:
        poll = _poll_in_place(db, poll_id, guild_id, channel_id)
        theme = poll.campaign.theme
        user = _user(db, du)
        if organizer_only:
            _require_organizer(db, poll.campaign, user)
        else:
            services.ensure_member(db, poll.campaign_id, user.id)
        act(poll, user)
    except ServiceError as exc:
        if exc.status == 409:  # the poll moved on while the button was still on screen
            return Outcome(wording.t(theme, "botVoteClosed"), False)
        return Outcome(error_text(exc), False)
    return Outcome(wording.t(theme, success_key), True, load_poll_snapshot(db, poll.id) if snapshot else None)


def vote_click(db: Session, du: DUser, poll_id: int, candidate_id: int, guild_id, channel_id) -> Outcome:
    return _click(db, du, poll_id, guild_id, channel_id,
                  lambda poll, user: services.cast_vote(db, poll, user, candidate_id),
                  "botVoteRecorded", snapshot=True)


def rsvp_click(db: Session, du: DUser, poll_id: int, answer: str) -> Outcome:
    """'I'm in' / 'Can't make it' on a reminder DM. When this answer tips the group past half
    saying no, the session is called off and a new poll is opened (the snapshot of that poll
    comes back so the caller can flush the outbox)."""
    poll = db.get(Poll, poll_id)
    if poll is None:
        return Outcome(wording.t(None, "botRsvpClosed"), False)
    theme = poll.campaign.theme
    user = db.scalar(select(User).where(User.discord_id == du.id))
    if user is None:
        return Outcome(wording.t(theme, "botRsvpStranger"), False)
    try:
        result = services.record_attendance(db, poll, user, answer)
    except ServiceError as exc:
        if exc.status == 409:
            return Outcome(wording.t(theme, "botRsvpClosed"), False)
        if exc.status == 403:
            return Outcome(wording.t(theme, "botRsvpStranger"), False)
        return Outcome(error_text(exc), False)
    if result.rescheduled is not None:
        return Outcome(wording.t(theme, "botRsvpCalledOff"), True, load_poll_snapshot(db, result.rescheduled.id))
    if answer == "in":
        return Outcome(wording.t(theme, "botRsvpInAck"), True)
    return Outcome(wording.t(theme, "botRsvpOutAck", out=result.out, active=result.active), True)


def confirm_click(db: Session, du: DUser, poll_id: int, guild_id, channel_id) -> Outcome:
    return _click(db, du, poll_id, guild_id, channel_id,
                  lambda poll, user: services.confirm_poll(db, poll),
                  "botPollDecreed", organizer_only=True)

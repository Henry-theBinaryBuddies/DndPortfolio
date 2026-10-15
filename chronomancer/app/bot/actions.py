"""Bot behaviour as plain synchronous functions over a database session. The Discord layer
(commands.py, client.py) is a thin wrapper, so everything here is testable without Discord."""
from dataclasses import dataclass
from datetime import date, datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import re

import discord
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config, db as dbmod, services
from ..models import Availability, Member, Poll
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


def _esc(text: str) -> str:
    """Organizer-controlled text must not inject markdown into bot messages."""
    return discord.utils.escape_markdown(discord.utils.escape_mentions(text))


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


def error_text(exc: ServiceError) -> str:
    d = exc.detail
    if isinstance(d, dict):
        extra = ""
        if "considered" in d:
            extra = (f" ({d['considered']} start times considered; {d.get('dropped_required', 0)} "
                     f"lost a required player, {d.get('dropped_quorum', 0)} had too few free players)")
        return str(d.get("message", "request failed")) + extra
    return str(d)


def _user(db: Session, du: DUser):
    return services.upsert_user(db, du.id, du.name, du.avatar_url)


def _here(db: Session, guild_id, channel_id):
    if not guild_id or not channel_id:
        raise ServiceError(400, "Use this command in a server channel.")
    campaign = services.campaign_for_channel(db, str(guild_id), str(channel_id))
    if campaign is None:
        raise ServiceError(404, "No campaign lives in this channel yet. Use /chronomancer create here first.")
    return campaign


def _require_organizer(db: Session, campaign, user):
    member = services.get_member(db, campaign.id, user.id)
    if member is None or member.role != "organizer":
        w = wording.words(campaign.theme)
        raise ServiceError(403, wording.t(campaign.theme, "botOrganizerOnly", organizer=w["organizer"]))
    return member


def _poll_url(poll: Poll) -> str:
    return f"{config.PUBLIC_BASE_URL}/poll.html?id={poll.id}"


# ---------------------------------------------------------------- slash commands


def cmd_create(db: Session, du: DUser, guild_id, channel_id, name: str, duration: int,
               quorum: int, theme: str, frequency: str = "none") -> Reply:
    if not guild_id or not channel_id:
        raise ServiceError(400, "Use this command in a server channel.")
    if not du.can_manage:
        raise ServiceError(403, wording.t(theme, "botNeedManage"))
    name = name.strip()
    if not 1 <= len(name) <= 120:
        raise ServiceError(422, "The name must be 1 to 120 characters.")
    if theme not in wording.available_themes():
        raise ServiceError(422, "Unknown theme.")
    user = _user(db, du)
    campaign, _ = services.create_campaign(
        db, user, name=name, guild_id=str(guild_id), channel_id=str(channel_id),
        default_duration_min=duration, min_quorum=quorum, theme=theme, cadence=frequency,
    )
    return Reply(wording.t(campaign.theme, "botCampaignCreated", name=_esc(campaign.name)))


def cmd_frequency(db: Session, du: DUser, guild_id, channel_id, frequency: str) -> Reply:
    """Set how often the group meets (weekly, biweekly, monthly, quarterly, annually, none)."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    _require_organizer(db, campaign, user)
    services.set_cadence(db, campaign, frequency)
    label = wording.words(campaign.theme).get("freq_" + campaign.cadence, campaign.cadence)
    text = wording.t(campaign.theme, "botFrequencySet", frequency=label)
    nxt = services.suggest_next_week(db, campaign)
    if nxt:
        text += " " + wording.t(campaign.theme, "botNextWeek", date=nxt.strftime("%A %B %d, %Y"))
    return Reply(text)


def cmd_link(db: Session, du: DUser, guild_id, channel_id, code: str) -> Reply:
    if not guild_id or not channel_id:
        raise ServiceError(400, "Use this command in a server channel.")
    if not du.can_manage:
        raise ServiceError(403, wording.t(wording.DEFAULT_THEME, "botNeedManage"))
    user = _user(db, du)
    campaign = services.link_campaign(db, user, code.strip(), str(guild_id), str(channel_id))
    return Reply(wording.t(campaign.theme, "botCampaignLinked", name=_esc(campaign.name)))


def cmd_unlink(db: Session, du: DUser, guild_id, channel_id) -> Reply:
    """Free this channel. The campaign's organizer may, and so may anyone who manages the
    channel (so a server admin can always reclaim a channel)."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    member = services.get_member(db, campaign.id, user.id)
    if not du.can_manage and (member is None or member.role != "organizer"):
        raise ServiceError(403, wording.t(campaign.theme, "botNeedManage"))
    services.unlink_campaign(db, campaign)
    return Reply(wording.t(campaign.theme, "botCampaignUnlinked", name=_esc(campaign.name)))


def _parse_day(value: str, label: str) -> date:
    try:
        return date.fromisoformat(value.strip())
    except ValueError:
        raise ServiceError(422, f"{label} must look like 2026-10-24.")


def _parse_time(value: str, label: str) -> time:
    try:
        return datetime.strptime(value.strip(), "%H:%M").time()
    except ValueError:
        raise ServiceError(422, f"{label} must look like 18:00 (24-hour).")


def cmd_poll(db: Session, du: DUser, guild_id, channel_id, week_start: str | None,
             start: str, end: str, length: int | None, tz: str, title: str,
             quorum: int | None = None) -> Reply:
    """Open a poll for one week: the seven days from week_start. Without week_start, use the
    week the campaign's meeting frequency suggests after the last confirmed session."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    _require_organizer(db, campaign, user)
    if week_start and week_start.strip():
        first_day = _parse_day(week_start, "Week start")
    else:
        first_day = services.suggest_next_week(db, campaign)
        if first_day is None:
            raise ServiceError(422, "Which week? Give week_start, the first of the seven days, like 2026-10-26.")
    tz = tz.strip() or "UTC"
    if len(tz) > 64:
        raise ServiceError(422, "Unknown timezone. Use a name like America/Los_Angeles or UTC.")
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
        raise ServiceError(422, "Unknown timezone. Use a name like America/Los_Angeles or UTC.")
    poll = services.create_poll(
        db, campaign, title=title.strip()[:120], tz=tz,
        date_start=first_day,
        window_start=_parse_time(start, "Start"), window_end=_parse_time(end, "End"),
        duration_min=length, min_quorum=quorum,
    )
    return Reply(wording.t(campaign.theme, "botPollCreated",
                           title=_esc(poll.title or campaign.name), url=_poll_url(poll)))


def cmd_availability(db: Session, du: DUser, guild_id, channel_id) -> Reply:
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    services.ensure_member(db, campaign.id, user.id)
    poll = services.current_poll(db, campaign.id)
    if poll is None or poll.status not in ("collecting", "voting"):
        w = wording.words(campaign.theme)
        return Reply(wording.t(campaign.theme, "botNoOpenPoll", organizer=w["organizer"]), True)
    if poll.status == "voting":
        return Reply(wording.t(campaign.theme, "botVotingNow"), True)
    return Reply(wording.t(campaign.theme, "botAvailabilityLink", url=_poll_url(poll)), True)


def cmd_status(db: Session, du: DUser, guild_id, channel_id) -> Reply:
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    services.ensure_member(db, campaign.id, user.id)
    poll = services.current_poll(db, campaign.id)
    if poll is None:
        return Reply("No polls yet for this campaign.", True)
    responded = set(db.scalars(
        select(Availability.user_id).where(Availability.poll_id == poll.id).distinct()
    ))
    members = db.scalars(select(Member).where(Member.campaign_id == campaign.id)).all()
    waiting = [m.user.display_name for m in members if m.user_id not in responded]
    lines = [f"**{_esc(poll.title or campaign.name)}**: {poll.status}",
             f"{len(members) - len(waiting)}/{len(members)} have marked availability."]
    if waiting and poll.status == "collecting":
        shown = [_esc(n) for n in waiting[:20]]
        more = f" and {len(waiting) - 20} more" if len(waiting) > 20 else ""
        lines.append("Still waiting on: " + ", ".join(shown) + more)
    if poll.confirmed_start_utc:
        lines.append(f"Confirmed for <t:{int(poll.confirmed_start_utc.timestamp())}:F>.")
        times = services.pending_reminder_times(db, poll.id) if poll.status == "confirmed" else []
        if times:
            lines.append("Reminders: " + ", ".join(f"<t:{int(t.timestamp())}:f>" for t in times))
        elif poll.status == "confirmed" and campaign.reminder_offsets_min:
            lines.append(wording.t(campaign.theme, "botRemindersNoFit"))
    return Reply("\n".join(lines)[:1900], True)


def cmd_close(db: Session, du: DUser, guild_id, channel_id, vote_hours: int | None) -> Reply:
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    _require_organizer(db, campaign, user)
    poll = services.current_poll(db, campaign.id)
    if poll is None or poll.status != "collecting":
        raise ServiceError(409, "No poll is collecting availability in this campaign.")
    services.close_poll(db, poll, vote_hours=vote_hours)
    return Reply(wording.t(campaign.theme, "botPollClosed"))


def cmd_confirm(db: Session, du: DUser, guild_id, channel_id) -> Reply:
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    _require_organizer(db, campaign, user)
    poll = services.current_poll(db, campaign.id)
    if poll is None or poll.status != "voting":
        raise ServiceError(409, "No poll is open for voting in this campaign.")
    services.confirm_poll(db, poll)
    return Reply(wording.t(campaign.theme, "botPollDecreed"))


def cmd_cancel(db: Session, du: DUser, guild_id, channel_id) -> Reply:
    """Cancel the open poll, or a decided session that has not happened yet."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    _require_organizer(db, campaign, user)
    poll = services.current_poll(db, campaign.id)
    if poll is None:
        raise ServiceError(409, "There is no poll or session to cancel.")
    services.cancel_poll(db, poll)
    return Reply(wording.t(campaign.theme, "botPollCancelledReply"))


_OFFSET_TOKEN = re.compile(r"^(\d+)\s*([dhm])$", re.IGNORECASE)


def parse_offsets(text: str) -> list:
    """'1d, 2h 15m' -> [1440, 120, 15]. 'off' or 'none' -> []. Raises ServiceError on junk."""
    text = text.strip().lower()
    if text in ("", "off", "none", "no"):
        return []
    minutes = []
    for token in re.split(r"[,;\s]+", text):
        m = _OFFSET_TOKEN.match(token)
        if not m:
            raise ServiceError(422, f"I could not read {token!r}. Use values like 1d, 2h or 30m, or off.")
        n, unit = int(m.group(1)), m.group(2)
        minutes.append(n * {"d": 1440, "h": 60, "m": 1}[unit])
    return minutes


def describe_minutes(total: int) -> str:
    days, rest = divmod(total, 1440)
    hours, mins = divmod(rest, 60)
    parts = [f"{n} {word}{'' if n == 1 else 's'}"
             for n, word in ((days, "day"), (hours, "hour"), (mins, "minute")) if n]
    return " ".join(parts)


def cmd_reminders(db: Session, du: DUser, guild_id, channel_id, offsets_text: str) -> Reply:
    """Set how long before a session the group is reminded (organizer only)."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    _require_organizer(db, campaign, user)
    services.set_reminder_offsets(db, campaign, parse_offsets(offsets_text))
    if not campaign.reminder_offsets_min:
        return Reply(wording.t(campaign.theme, "botRemindersOff"))
    listed = ", ".join(describe_minutes(m) for m in campaign.reminder_offsets_min)
    text = wording.t(campaign.theme, "botRemindersSet", offsets=listed)
    # Tell them what this means for a session that is already decided.
    upcoming = db.scalar(select(Poll).where(
        Poll.campaign_id == campaign.id, Poll.status == "confirmed",
        Poll.confirmed_start_utc > services.now_utc()).order_by(Poll.confirmed_start_utc))
    if upcoming is not None:
        times = services.pending_reminder_times(db, upcoming.id)
        if times:
            text += "\n" + wording.t(campaign.theme, "botRemindersAt",
                                      times=", ".join(f"<t:{int(t.timestamp())}:f>" for t in times))
        else:
            text += "\n" + wording.t(campaign.theme, "botRemindersNoFit")
    return Reply(text)


def cmd_repost(db: Session, du: DUser, guild_id, channel_id) -> Reply:
    """Resend the vote message, for example after the bot was offline or lost permissions."""
    campaign = _here(db, guild_id, channel_id)
    user = _user(db, du)
    _require_organizer(db, campaign, user)
    poll = services.current_poll(db, campaign.id)
    if poll is None:
        raise ServiceError(409, "There is no poll to repost.")
    services.requeue_vote_post(db, poll)
    return Reply(wording.t(campaign.theme, "botReposted"), True)


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


def vote_click(db: Session, du: DUser, poll_id: int, candidate_id: int, guild_id, channel_id) -> Outcome:
    theme = None
    try:
        poll = _poll_in_place(db, poll_id, guild_id, channel_id)
        theme = poll.campaign.theme
        user = _user(db, du)
        services.ensure_member(db, poll.campaign_id, user.id)
        services.cast_vote(db, poll, user, candidate_id)
    except ServiceError as exc:
        if exc.status == 409:
            return Outcome(wording.t(theme, "botVoteClosed"), False)
        return Outcome(error_text(exc), False)
    return Outcome(wording.t(theme, "botVoteRecorded"), True, load_poll_snapshot(db, poll.id))


def next_click(db: Session, du: DUser, poll_id: int, guild_id, channel_id) -> Outcome:
    """The organizer pressed 'open next poll' under a confirmed session."""
    try:
        poll = _poll_in_place(db, poll_id, guild_id, channel_id)
        theme = poll.campaign.theme
        user = _user(db, du)
        _require_organizer(db, poll.campaign, user)
        fresh = services.open_next_poll(db, poll)
    except ServiceError as exc:
        return Outcome(error_text(exc), False)
    return Outcome(wording.t(theme, "botNextOpened", date=fresh.date_start.strftime("%A %B %d, %Y"),
                             url=_poll_url(fresh)), True)


def confirm_click(db: Session, du: DUser, poll_id: int, guild_id, channel_id) -> Outcome:
    theme = None
    try:
        poll = _poll_in_place(db, poll_id, guild_id, channel_id)
        theme = poll.campaign.theme
        user = _user(db, du)
        _require_organizer(db, poll.campaign, user)
        services.confirm_poll(db, poll)
    except ServiceError as exc:
        if exc.status == 409:
            return Outcome(wording.t(theme, "botVoteClosed"), False)
        return Outcome(error_text(exc), False)
    return Outcome(wording.t(theme, "botPollDecreed"), True)

"""Operations shared by the web API and the Discord bot. Each commits its own work."""
from collections import Counter
import secrets
from calendar import monthrange
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, aliased

from . import config
from .models import (
    Attendance, Availability, Campaign, Candidate, DiscordCleanup, Member, Notification, Poll, PollMessage, Reminder, User,
    Vote, WebSession,
)
from .scheduling import best_overlap, candidate_starts, generate_slots, rank_candidates


# The frequencies Discord can repeat an event at: every week, every two weeks, every month on
# the same Nth weekday (for example the 4th Saturday), and every year on the same date.
CADENCES = ("none", "weekly", "biweekly", "monthly", "annually")


def nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    """The nth (1-4) given weekday (Monday=0) of a month."""
    first = date(year, month, 1)
    return first + timedelta(days=(weekday - first.weekday()) % 7 + 7 * (n - 1))


def week_of_month(day: date) -> int:
    """Which weekday of its month `day` is (1st, 2nd, ...), counting a 5th as the 4th, which is
    how Discord's own monthly repeat is offered."""
    return min(4, (day.day - 1) // 7 + 1)


def add_cadence(day: date, cadence: str, anchor_day: int | None = None) -> date | None:
    """The date one meeting interval after `day`, or None for a one-off campaign. Monthly
    meets on the same Nth weekday (the 4th Saturday stays the 4th Saturday); annual steps aim
    for `anchor_day` (default: day's own), clamped to the end of short months."""
    if cadence == "weekly":
        return day + timedelta(days=7)
    if cadence == "biweekly":
        return day + timedelta(days=14)
    if cadence == "monthly":
        year_carry, month0 = divmod(day.month, 12)
        return nth_weekday(day.year + year_carry, month0 + 1, day.weekday(), week_of_month(day))
    if cadence != "annually":
        return None
    year = day.year + 1
    return date(year, day.month, min(anchor_day or day.day, monthrange(year, day.month)[1]))


class ServiceError(Exception):
    """A user-facing failure. `status` mirrors an HTTP status; `detail` is a string or dict."""

    def __init__(self, status: int, detail):
        super().__init__(str(detail))
        self.status = status
        self.detail = detail


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


# ---------------------------------------------------------------- web sessions

SESSION_LIFETIME = timedelta(days=14)


def create_web_session(db: Session, user: User) -> str:
    token = secrets.token_urlsafe(32)
    db.add(WebSession(id=token, user_id=user.id, expires_at=now_utc() + SESSION_LIFETIME))
    db.commit()
    return token


def valid_web_session(db: Session, token: str | None) -> WebSession | None:
    row = db.get(WebSession, token) if token else None
    if row is None or row.expires_at <= now_utc():
        return None
    return row


def delete_user_data(db: Session, user: User) -> dict:
    """Remove a person's data: their profile, group memberships, availability, votes, attendance
    answers and logins. Refused while they run a group, because a group needs its organizer and
    deleting it takes everyone else's sessions with it: they delete those groups first (which
    also clears the groups' Discord events). What other members already saw (tallies, a past
    session) is not personal data and stays. Returns how many rows of each kind were removed."""
    running = list(db.scalars(select(Campaign).where(or_(
        Campaign.owner_id == user.id,
        Campaign.id.in_(select(Member.campaign_id).where(Member.user_id == user.id,
                                                          Member.role == "organizer"))))))
    if running:
        names = ", ".join(f'"{c.name}"' for c in running)
        raise ServiceError(409, f"You run {names}. Delete {'it' if len(running) == 1 else 'them'} first "
                                "(the Delete button on the home page), then delete your data.")
    removed = {}
    for model in (Availability, Vote, Attendance, Member, WebSession):
        removed[model.__tablename__] = db.execute(delete(model).where(model.user_id == user.id)).rowcount
    db.execute(delete(User).where(User.id == user.id))
    db.commit()
    return removed


def end_web_sessions(db: Session, *, token: str | None = None, user_id: int | None = None) -> int:
    """Revoke one session (log out) or every session of a user (log out everywhere)."""
    q = delete(WebSession)
    q = q.where(WebSession.id == token) if token is not None else q.where(WebSession.user_id == user_id)
    result = db.execute(q)
    db.commit()
    return result.rowcount


def purge_expired_web_sessions(db: Session) -> int:
    result = db.execute(delete(WebSession).where(WebSession.expires_at <= now_utc()))
    db.commit()
    return result.rowcount


# ---------------------------------------------------------------- users and membership


def upsert_user(db: Session, discord_id: str, display_name: str,
                avatar_url: str | None = None, tz: str | None = None) -> User:
    display_name = (display_name or "Adventurer")[:100]
    for _ in range(2):  # second pass handles losing a first-login race
        user = db.scalar(select(User).where(User.discord_id == discord_id))
        try:
            if user is None:
                user = User(discord_id=discord_id, display_name=display_name,
                            avatar_url=avatar_url, timezone=tz or "UTC")
                db.add(user)
            else:
                user.display_name = display_name
                if avatar_url is not None:
                    user.avatar_url = avatar_url
                if tz:
                    user.timezone = tz
            db.commit()
            return user
        except IntegrityError:
            db.rollback()
    raise ServiceError(500, "could not create user")


def set_user_timezone(db: Session, user: User, tz: str) -> User:
    """Remember the timezone of the person's browser. Poll hours are read in the organizer's
    timezone; everyone else sees every time converted to their own."""
    if not valid_timezone(tz):
        raise ServiceError(422, "Unknown timezone.")
    if user.timezone != tz:
        user.timezone = tz
        db.commit()
    return user


def get_member(db: Session, campaign_id: int, user_id: int) -> Member | None:
    """The person's membership, if they are still in the group (people who left Discord are not)."""
    return db.scalar(select(Member).where(
        Member.campaign_id == campaign_id, Member.user_id == user_id, Member.left_at.is_(None)))


def active_members(db: Session, campaign_id: int) -> list:
    return list(db.scalars(select(Member).where(
        Member.campaign_id == campaign_id, Member.left_at.is_(None)).order_by(Member.id)))


def ensure_member(db: Session, campaign_id: int, user_id: int) -> Member:
    """Join the group, or come back to it: someone who left and shows up again through Discord
    is restored (their old role and 'required' flag come back with them)."""
    for _ in range(2):
        member = db.scalar(select(Member).where(
            Member.campaign_id == campaign_id, Member.user_id == user_id))
        if member is not None:
            if member.left_at is not None:
                member.left_at = None
                db.commit()
            return member
        try:
            member = Member(campaign_id=campaign_id, user_id=user_id, role="player")
            db.add(member)
            db.commit()
            return member
        except IntegrityError:
            db.rollback()
    raise ServiceError(500, "could not join campaign")


# ---------------------------------------------------------------- campaigns


def mark_members_left(db: Session, member_ids: list) -> int:
    """Record that these people are no longer in the Discord server. Organizers are never
    removed this way, so a campaign cannot end up without anyone able to run it."""
    if not member_ids:
        return 0
    result = db.execute(update(Member).where(
        Member.id.in_(member_ids), Member.role != "organizer", Member.left_at.is_(None)
    ).values(left_at=now_utc()))
    db.commit()
    return result.rowcount


def campaign_for_channel(db: Session, guild_id: str, channel_id: str) -> Campaign | None:
    return db.scalar(
        select(Campaign).where(Campaign.guild_id == guild_id, Campaign.channel_id == channel_id)
    )


def create_campaign(db: Session, owner: User, *, name: str, guild_id: str | None = None,
                    channel_id: str | None = None, cadence: str = "none",
                    default_duration_min: int = 180, vote_top_n: int = 3,
                    reminder_offsets_min: list | None = None, theme: str = "dnd",
                    available_themes: list | None = None) -> tuple:
    name = check_campaign_settings(
        name=name, cadence=cadence, default_duration_min=default_duration_min,
        theme=theme, reminder_offsets_min=reminder_offsets_min, available_themes=available_themes)
    if guild_id and channel_id and campaign_for_channel(db, guild_id, channel_id):
        raise ServiceError(409, "this channel already hosts a campaign")
    campaign = Campaign(
        owner_id=owner.id, name=name, guild_id=guild_id, channel_id=channel_id,
        cadence=cadence, default_duration_min=default_duration_min,
        vote_top_n=vote_top_n, theme=theme,
        reminder_offsets_min=reminder_offsets_min if reminder_offsets_min is not None else [1440, 60],
    )
    # Nobody is required by default: a required person who has not answered blocks every time.
    member = Member(user=owner, role="organizer", required=False)
    campaign.members.append(member)
    db.add(campaign)
    try:
        db.commit()
    except IntegrityError:  # lost a race for the channel (unique guild_id + channel_id)
        db.rollback()
        raise ServiceError(409, "this channel already hosts a campaign")
    return campaign, member


def link_campaign(db: Session, user: User, invite_code: str, guild_id: str, channel_id: str):
    """Bind a campaign created on the web to a Discord channel. Organizer only."""
    campaign = db.scalar(select(Campaign).where(Campaign.invite_code == invite_code))
    member = get_member(db, campaign.id, user.id) if campaign else None
    if campaign is None or member is None or member.role != "organizer":
        # Same answer either way: do not reveal which invite codes exist.
        raise ServiceError(404, "no campaign with that code that you organize")
    if campaign_for_channel(db, guild_id, channel_id):
        raise ServiceError(409, "this channel already hosts a campaign")
    campaign.guild_id = guild_id
    campaign.channel_id = channel_id
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise ServiceError(409, "this channel already hosts a campaign")
    return campaign


def unlink_campaign(db: Session, campaign: Campaign) -> Campaign:
    """Free the Discord channel so it can be claimed again. The campaign itself is kept; its
    Discord events are removed (queued here, delivered using the server remembered on the
    campaign, since the channel link is gone)."""
    if campaign.events_guild_id:
        targets = {s.id for s in upcoming_sessions(db, campaign.id)}
        targets |= set(db.scalars(select(Poll.id).where(
            Poll.campaign_id == campaign.id, Poll.discord_event_id.is_not(None))))
        if not targets and campaign.series_event_id:
            latest = db.scalar(select(Poll.id).where(Poll.campaign_id == campaign.id)
                               .order_by(Poll.id.desc()).limit(1))
            targets = {latest} if latest is not None else set()
        for poll_id in sorted(targets):
            enqueue_once(db, "event_sync", poll_id)
    campaign.guild_id = None
    campaign.channel_id = None
    db.commit()
    return campaign


def queue_discord_cleanup(db: Session, campaign: Campaign) -> None:
    """Record everything the group left in Discord, so it can still be removed once the rows
    that knew about it are gone: its one repeating event, the event of every session that still
    has one, and the live buttons of a vote in progress."""
    guild = campaign.events_guild_id or campaign.guild_id
    event_ids = {campaign.series_event_id}
    event_ids |= set(db.scalars(select(Poll.discord_event_id).where(
        Poll.campaign_id == campaign.id, Poll.discord_event_id.is_not(None))))
    for event_id in sorted(e for e in event_ids if e):
        db.add(DiscordCleanup(kind="event", guild_id=guild, target_id=event_id))
    for message in db.scalars(select(PollMessage).join(Poll, Poll.id == PollMessage.poll_id).where(
            Poll.campaign_id == campaign.id, Poll.status == "voting")):
        db.add(DiscordCleanup(kind="message", channel_id=message.channel_id, target_id=message.message_id))


def delete_campaign(db: Session, campaign_id: int) -> None:
    """Remove a campaign and everything hanging off it, including outbox rows and the
    remembered Discord message (otherwise they dangle, and on SQLite a recycled poll id
    would inherit them)."""
    poll_ids = list(db.scalars(select(Poll.id).where(Poll.campaign_id == campaign_id)))
    campaign = db.get(Campaign, campaign_id)
    if campaign is not None:
        queue_discord_cleanup(db, campaign)  # same transaction as the delete below
    if poll_ids:
        for model in (Availability, Notification, PollMessage, Reminder, Attendance):
            db.execute(delete(model).where(model.poll_id.in_(poll_ids)))
    # Polls, candidates, votes and members go with the campaign via the ORM cascade.
    if campaign is not None:
        db.delete(campaign)
    db.commit()


def open_poll(db: Session, campaign_id: int) -> Poll | None:
    """The poll that is collecting availability or voting, if any."""
    return db.scalar(select(Poll).where(
        Poll.campaign_id == campaign_id, Poll.status.in_(("collecting", "voting")))
        .order_by(Poll.id.desc()))


def upcoming_sessions(db: Session, campaign_id: int) -> list:
    return list(db.scalars(select(Poll).where(
        Poll.campaign_id == campaign_id, Poll.status == "confirmed",
        Poll.confirmed_start_utc > now_utc()).order_by(Poll.confirmed_start_utc)))


def next_session(db: Session, campaign_id: int) -> Poll | None:
    """The soonest decided session that has not started yet."""
    return db.scalar(select(Poll).where(
        Poll.campaign_id == campaign_id, Poll.status == "confirmed",
        Poll.confirmed_start_utc > now_utc()).order_by(Poll.confirmed_start_utc))


def session_phase(poll: Poll, now: datetime | None = None) -> str:
    """Where a session is in its life: open (collecting or voting), upcoming (decided, not over),
    held (decided and over) or called_off (cancelled)."""
    now = now or now_utc()
    if poll.status in ("collecting", "voting"):
        return "open"
    if poll.status == "cancelled":
        return "called_off"
    start = poll.confirmed_start_utc
    if start is not None and start + timedelta(minutes=poll.duration_min) > now:
        return "upcoming"
    return "held"


def recent_sessions(campaign: Campaign, now: datetime | None = None, shown: int | None = None) -> dict:
    """What the campaign page lists: everything still live (open polls and upcoming sessions) and
    the latest few sessions that were really held. Called-off polls are only counted, so a run
    of reschedules cannot push real sessions out of the list. Nothing is deleted by this."""
    now = now or now_utc()
    shown = config.SESSIONS_SHOWN if shown is None else shown
    phases = [(p, session_phase(p, now)) for p in campaign.polls]
    start = lambda p: p.confirmed_start_utc or now  # noqa: E731
    opened = sorted((p for p, ph in phases if ph == "open"), key=lambda p: -p.id)
    upcoming = sorted((p for p, ph in phases if ph == "upcoming"), key=start)
    held = sorted((p for p, ph in phases if ph == "held"), key=lambda p: (start(p), p.id), reverse=True)
    return {
        "sessions": [(p, "open") for p in opened] + [(p, "upcoming") for p in upcoming]
                    + [(p, "held") for p in held[:shown]],
        "hidden": max(0, len(held) - shown),
        "called_off": sum(1 for _, ph in phases if ph == "called_off"),
    }


def _droppable_marks():
    """(alias, condition) for availability rows that nothing will read again: the person has
    answered a newer poll in the same group (so their latest answers are elsewhere), or has left
    the group. A person's most recent answers are kept, because they pre-fill their next poll."""
    mark = aliased(Availability)
    later = aliased(Availability)
    later_poll = aliased(Poll)
    superseded = select(later.id).join(later_poll, later_poll.id == later.poll_id).where(
        later_poll.campaign_id == Poll.campaign_id, later_poll.id > Poll.id,
        later.user_id == mark.user_id).correlate(Poll, mark).exists()
    still_in = select(Member.id).where(
        Member.campaign_id == Poll.campaign_id, Member.user_id == mark.user_id,
        Member.left_at.is_(None)).correlate(Poll, mark).exists()
    return mark, or_(superseded, ~still_in)


def compact_finished_polls(db: Session, now: datetime | None = None, keep_days: int | None = None,
                           max_polls: int = 200) -> int:
    """Drop the per-person availability of sessions that are decided or called off and older than
    `keep_days`. That grid is about 95-99% of what a session stores and nothing reads it once the
    poll is closed; votes, candidates and the session itself stay. Each person's latest answers
    in a group are the exception (see _droppable_marks). Each poll is its own small transaction,
    and the delete re-checks the poll's status, so it cannot race a state change.
    Returns how many availability rows were removed."""
    now = now or now_utc()
    cutoff = now - timedelta(days=config.AVAILABILITY_KEEP_DAYS if keep_days is None else keep_days)
    terminal = ("confirmed", "cancelled")
    mark, droppable = _droppable_marks()
    poll_ids = db.scalars(select(Poll.id).where(
        Poll.status.in_(terminal), Poll.date_end < cutoff.date(),
        or_(Poll.confirmed_start_utc.is_(None), Poll.confirmed_start_utc < cutoff),
        select(mark.id).where(mark.poll_id == Poll.id, droppable).exists(),
    ).order_by(Poll.id).limit(max_polls)).all()
    removed = 0
    for poll_id in poll_ids:
        mark, droppable = _droppable_marks()
        result = db.execute(delete(Availability).where(
            Availability.id.in_(select(mark.id).join(Poll, Poll.id == mark.poll_id).where(
                mark.poll_id == poll_id, droppable)),
            select(Poll.id).where(Poll.id == poll_id, Poll.status.in_(terminal)).exists()))
        db.commit()
        removed += result.rowcount
    return removed


_LEVEL_ORDER = {"no": 0, "maybe": 1, "free": 2}
_WEEK_MINUTES = 7 * 24 * 60


def _week_minute(slot: datetime, tz: ZoneInfo) -> int:
    """Where a moment falls in the week on the local clock: minutes since Monday 00:00."""
    local = slot.astimezone(tz)
    return local.weekday() * 1440 + local.hour * 60 + local.minute


def suggest_availability(db: Session, poll: Poll, user: User, now: datetime | None = None) -> dict | None:
    """A draft for a new poll, copied from the person's most recent earlier poll in the same group
    that has any of their answers. Boxes are matched by weekday and time of day on the poll's own
    clock, so the week may start on another day and daylight saving does not shift anything. A box
    that has already begun is skipped. Nothing is saved: the person must look it over and press
    Save. Returns None when there is nothing to copy."""
    now = now or now_utc()
    source = db.scalar(select(Poll).where(
        Poll.campaign_id == poll.campaign_id, Poll.id < poll.id,
        select(Availability.id).where(Availability.poll_id == Poll.id,
                                      Availability.user_id == user.id).exists(),
    ).order_by(Poll.id.desc()).limit(1))
    if source is None:
        return None
    old_tz, new_tz = ZoneInfo(source.timezone), ZoneInfo(poll.timezone)
    old_len, new_len = source.slot_minutes, poll.slot_minutes
    old_boxes = {_week_minute(s, old_tz) for s in poll_slots(source)}
    old_marks = {_week_minute(r.slot_start_utc, old_tz): r.level for r in db.scalars(
        select(Availability).where(Availability.poll_id == source.id, Availability.user_id == user.id))}
    marks, outside = {}, 0
    for slot in poll_slots(poll):
        if slot <= now:
            continue
        start = _week_minute(slot, new_tz)
        if new_len >= old_len:    # the same size or coarser: the old boxes that make up this one
            covered = [(start + k) % _WEEK_MINUTES for k in range(0, new_len, old_len)]
        else:                     # finer: the one old box that contains this one
            covered = [(start - k) % _WEEK_MINUTES for k in range(old_len)
                       if (start - k) % _WEEK_MINUTES in old_boxes][:1]
        if not covered or any(m not in old_boxes for m in covered):
            outside += 1          # that poll did not cover this time of day: nothing to copy
            continue
        levels = [old_marks.get(m) for m in covered]
        if any(level is None for level in levels):
            continue              # the person left it unmarked (or part of it): leave it blank
        marks[slot] = min(levels, key=_LEVEL_ORDER.__getitem__)  # the most cautious answer
    if not marks:
        return None
    return {"marks": marks, "from_title": source.title, "from_start": source.date_start,
            "outside": outside}


def current_poll(db: Session, campaign_id: int) -> Poll | None:
    """The open poll if there is one, otherwise the most recent."""
    polls = db.scalars(
        select(Poll).where(Poll.campaign_id == campaign_id).order_by(Poll.id.desc())
    ).all()
    for poll in polls:
        if poll.status in ("collecting", "voting"):
            return poll
    return polls[0] if polls else None


# ---------------------------------------------------------------- polls


def hours_label(window_start: time, window_end: time) -> str:
    """'00:00 to 24:00': an end of 00:00 is the end of the day."""
    end = "24:00" if window_end == time(0) else f"{window_end:%H:%M}"
    return f"{window_start:%H:%M} to {end}"


def poll_slots(poll: Poll) -> list:
    return generate_slots(
        poll.date_start, poll.date_end, poll.window_start, poll.window_end,
        poll.timezone, poll.slot_minutes,
    )


def enqueue(db: Session, kind: str, poll_id: int) -> None:
    db.add(Notification(kind=kind, poll_id=poll_id))


def enqueue_once(db: Session, kind: str, poll_id: int) -> None:
    """Like enqueue, but skipped while an identical notification is still waiting."""
    pending = db.scalar(select(Notification.id).where(
        Notification.kind == kind, Notification.poll_id == poll_id,
        Notification.processed_at.is_(None)).limit(1))
    if pending is None:
        enqueue(db, kind, poll_id)


def create_poll(db: Session, campaign: Campaign, *, title: str, date_start: date,
                window_start: time, window_end: time, tz: str | None = None, slot_minutes: int = 30,
                duration_min: int | None = None,
                vote_top_n: int | None = None, vote_deadline: datetime | None = None) -> Poll:
    if tz is not None and not valid_timezone(tz):
        raise ServiceError(422, "Unknown timezone. Use a name like America/Los_Angeles or UTC.")
    if open_poll(db, campaign.id) is not None:
        raise ServiceError(409, "A poll is already open in this campaign. Close or confirm it first.")
    # A poll is always exactly one week: the grid players paint is seven days starting here.
    date_end = date_start + timedelta(days=config.WEEK_DAYS - 1)
    if vote_deadline is not None:
        if vote_deadline.tzinfo is None:
            raise ServiceError(422, "vote deadline must include a timezone")
        if vote_deadline <= now_utc():
            raise ServiceError(422, "vote deadline must be in the future")
    poll = Poll(
        campaign_id=campaign.id, title=title, timezone=tz or "UTC",
        date_start=date_start, date_end=date_end,
        window_start=window_start, window_end=window_end, slot_minutes=slot_minutes,
        duration_min=duration_min or campaign.default_duration_min,
        vote_top_n=vote_top_n or campaign.vote_top_n,
        vote_deadline=vote_deadline,
    )
    try:
        slots = poll_slots(poll)
    except ValueError as exc:
        raise ServiceError(422, str(exc))
    if not slots:
        raise ServiceError(422, "no slots fit the chosen window")
    if not candidate_starts(slots, poll.slot_minutes, poll.duration_min):
        raise ServiceError(422, "session length does not fit inside the daily window")
    db.add(poll)
    db.commit()
    return poll


def update_poll_hours(db: Session, poll: Poll, window_start: time, window_end: time) -> Poll:
    """Change the daily hours of a poll that is still collecting. Marks outside the new hours are
    kept (widening again brings them back) but are ignored until then."""
    if poll.status != "collecting":
        raise ServiceError(409, "the hours can only change while availability is being collected")
    old = (poll.window_start, poll.window_end)
    poll.window_start, poll.window_end = window_start, window_end
    try:
        slots = poll_slots(poll)
    except ValueError as exc:
        poll.window_start, poll.window_end = old
        raise ServiceError(422, str(exc))
    if not slots or not candidate_starts(slots, poll.slot_minutes, poll.duration_min):
        poll.window_start, poll.window_end = old
        raise ServiceError(422, "session length does not fit inside the daily window")
    db.commit()
    return poll


def close_poll(db: Session, poll: Poll, vote_hours: int | None = None) -> Poll:
    """Stop collecting availability, rank times, open voting and queue the Discord post."""
    if poll.status != "collecting":
        raise ServiceError(409, "poll is not collecting availability")
    if vote_hours is not None and not 1 <= vote_hours <= config.MAX_VOTE_HOURS:
        raise ServiceError(422, f"voting may last 1 to {config.MAX_VOTE_HOURS} hours")
    # Claim the transition atomically: of two simultaneous closes only one UPDATE matches,
    # so candidates and the Discord post are created exactly once. Rolled back on failure.
    claimed = db.execute(update(Poll).where(Poll.id == poll.id, Poll.status == "collecting")
                         .values(status="voting"))
    if claimed.rowcount != 1:
        db.rollback()
        raise ServiceError(409, "poll is not collecting availability")
    db.refresh(poll)
    availability = {}
    for row in db.scalars(select(Availability).where(Availability.poll_id == poll.id)):
        availability.setdefault(row.user_id, {})[row.slot_start_utc] = row.level
    # Queried explicitly: a relationship cached earlier in this session could be stale.
    members = active_members(db, poll.campaign_id)
    result = rank_candidates(
        slots=poll_slots(poll),
        availability=availability,
        players=[m.user_id for m in members],
        required=[m.user_id for m in members if m.required],
        slot_minutes=poll.slot_minutes,
        duration_min=poll.duration_min,
        top_n=poll.vote_top_n,
    )
    if not result.candidates:
        message = no_time_message(poll, members, availability, result)
        db.rollback()  # release the claim: the poll stays open for more availability
        raise ServiceError(409, {"message": message, "considered": result.total_considered})
    for rank, cand in enumerate(result.candidates, start=1):
        db.add(Candidate(poll_id=poll.id, start_utc=cand.start, score=cand.score,
                         free_count=cand.free_count, maybe_count=cand.maybe_count, rank=rank))
    now = now_utc()
    if vote_hours is not None:
        poll.vote_deadline = now + timedelta(hours=vote_hours)
    elif poll.vote_deadline is not None and poll.vote_deadline <= now:
        # A deadline set when the poll was created may be stale by the time it closes.
        # Keeping it would auto-confirm instantly with zero votes.
        poll.vote_deadline = None
    db.flush()
    enqueue(db, "vote_open", poll.id)
    db.commit()
    return poll


def _length_text(minutes: int) -> str:
    if minutes % 60 == 0:
        hours = minutes // 60
        return f"{hours} hour" + ("" if hours == 1 else "s")
    return f"{minutes} minutes"


def no_time_message(poll: Poll, members: list, availability: dict, result) -> str:
    """Say why a poll cannot be closed, and what to do about it. Only used when no start time can
    be offered at all, which is rare: any time at which at least one person can attend is offered."""
    if result.total_considered and result.skipped_past == result.total_considered:
        return ("Every time in this poll has already passed. Start a new poll for the days ahead.")
    if not any(availability.get(m.user_id) for m in members):
        return "Nobody has marked any availability yet."
    if result.dropped_required:
        # Which required people are not free for a whole session at any of the future starts?
        needed = [m for m in members if m.required]
        names = ", ".join(m.user.display_name for m in needed)
        return (f"Everyone who is marked Required has to be free for the whole session, and at no "
                f"time are all of them ({names}) free together. Untick Required for anyone who "
                f"does not have to be there, or ask them to mark more times.")
    tz = ZoneInfo(poll.timezone)
    overlap = best_overlap(poll_slots(poll), availability, [m.user_id for m in members],
                           poll.slot_minutes)
    length = _length_text(poll.duration_min)
    if overlap is None:
        return f"Nobody is free for a whole {length} session. Ask people to mark more times."
    start, end = overlap.start.astimezone(tz), overlap.end.astimezone(tz)
    return (f"Nobody is free for a whole {length} session. The closest is {start:%a %b %d}, "
            f"{start:%H:%M}-{end:%H:%M}, when {overlap.people} of {len(members)} people are free "
            f"together ({_length_text(overlap.minutes)}). Shorten the session length, or ask "
            f"people to mark longer blocks.")


def cast_vote(db: Session, poll: Poll, user: User, candidate_id: int) -> Candidate:
    if poll.status != "voting":
        raise ServiceError(409, "poll is not open for voting")
    if poll.vote_deadline and now_utc() > poll.vote_deadline:
        raise ServiceError(409, "voting deadline has passed")
    candidate = db.get(Candidate, candidate_id)
    if candidate is None or candidate.poll_id != poll.id:
        raise ServiceError(404, "candidate not found")
    for _ in range(2):
        vote = db.scalar(select(Vote).where(Vote.poll_id == poll.id, Vote.user_id == user.id))
        try:
            if vote is None:
                db.add(Vote(poll_id=poll.id, user_id=user.id, candidate_id=candidate.id))
            else:
                vote.candidate_id = candidate.id
            db.commit()
            return candidate
        except IntegrityError:
            db.rollback()
    raise ServiceError(500, "could not record vote")


def confirm_poll(db: Session, poll: Poll, candidate_id: int | None = None) -> Poll:
    """Decree a time. Default: most votes, then best availability score, then earliest."""
    if poll.status != "voting":
        raise ServiceError(409, "poll is not open for voting")
    if candidate_id is not None:
        chosen = db.get(Candidate, candidate_id)
        if chosen is None or chosen.poll_id != poll.id:
            raise ServiceError(404, "candidate not found")
    else:
        votes = Counter(
            v.candidate_id for v in db.scalars(select(Vote).where(Vote.poll_id == poll.id))
        )
        candidates = db.scalars(select(Candidate).where(Candidate.poll_id == poll.id)).all()
        if not candidates:
            raise ServiceError(409, "poll has no candidate times")
        chosen = min(candidates, key=lambda c: (-votes.get(c.id, 0), -c.score, c.start_utc))
    # Atomic: a deadline timer and the organizer's click cannot both decree a time.
    claimed = db.execute(update(Poll).where(Poll.id == poll.id, Poll.status == "voting")
                         .values(status="confirmed", confirmed_start_utc=chosen.start_utc))
    if claimed.rowcount != 1:
        db.rollback()
        raise ServiceError(409, "poll is not open for voting")
    enqueue(db, "confirmed", poll.id)
    enqueue(db, "event_sync", poll.id)
    schedule_reminders(db, poll.id, chosen.start_utc, poll.campaign.reminder_offsets_min or [])
    supersede_auto_sessions(db, poll.campaign_id, keep_id=poll.id)
    db.commit()
    db.refresh(poll)
    return poll


def schedule_reminders(db: Session, poll_id: int, session_start: datetime, offsets: list,
                       now: datetime | None = None) -> list:
    """One reminder per offset (minutes before the session). Offsets that are already in the
    past (the session is sooner than that) are skipped rather than sent late and wrong."""
    now = now or now_utc()
    created = []
    for minutes in sorted(set(offsets), reverse=True):
        send_at = session_start - timedelta(minutes=minutes)
        if send_at <= now:
            continue
        reminder = Reminder(poll_id=poll_id, offset_min=minutes, send_at=send_at)
        db.add(reminder)
        created.append(reminder)
    return created


def cancel_poll(db: Session, poll: Poll) -> Poll:
    """Abandon a poll: an open one, or a confirmed session that has not happened yet. Unsent
    reminders are dropped so nobody is told about a session that is off."""
    was_confirmed = poll.status == "confirmed"
    claimed = db.execute(update(Poll).where(
        Poll.id == poll.id,
        or_(Poll.status.in_(("collecting", "voting")),
            and_(Poll.status == "confirmed", Poll.confirmed_start_utc > now_utc())),
    ).values(status="cancelled"))
    if claimed.rowcount != 1:
        db.rollback()
        raise ServiceError(409, "poll is already finished")
    db.execute(delete(Reminder).where(Reminder.poll_id == poll.id, Reminder.sent_at.is_(None)))
    if was_confirmed or db.get(PollMessage, poll.id) is not None:
        enqueue(db, "cancelled", poll.id)  # lets the bot retire buttons / announce the change
    if was_confirmed:
        enqueue(db, "event_sync", poll.id)  # remove the Discord event
    if was_confirmed:
        # Skipping one occurrence must not end the series: line up the next one now.
        db.execute(update(Poll).where(Poll.id == poll.id).values(recurrence_handled=True))
        db.refresh(poll)
        if poll.campaign.cadence != "none":
            schedule_next_occurrence(db, poll)
    db.commit()
    db.refresh(poll)
    return poll


@dataclass
class RsvpResult:
    out: int                       # active members who said they cannot make it
    active: int                    # active members of the group
    rescheduled: Poll | None = None  # the new poll, when this answer tipped the balance


def declined_count(db: Session, poll: Poll) -> tuple:
    """(people who said they cannot make it, active members). People who never answered count
    as coming, and people who have left the server do not count at all."""
    active = active_members(db, poll.campaign_id)
    ids = {m.user_id for m in active}
    out = db.scalars(select(Attendance.user_id).where(
        Attendance.poll_id == poll.id, Attendance.answer == "out")).all()
    return sum(1 for uid in out if uid in ids), len(ids)


def record_attendance(db: Session, poll: Poll, user: User, answer: str) -> RsvpResult:
    """A member answers the reminder: 'in' or 'out'. They may change their mind until the
    session starts. When more than half of the active members cannot make it, the session is
    called off and a new poll is opened to find another time."""
    if answer not in ("in", "out"):
        raise ServiceError(422, "answer must be 'in' or 'out'")
    if poll.status != "confirmed" or poll.confirmed_start_utc is None \
            or poll.confirmed_start_utc <= now_utc():
        raise ServiceError(409, "this session is no longer upcoming")
    member = get_member(db, poll.campaign_id, user.id)
    if member is None or member.left_at is not None:
        raise ServiceError(403, "you are not part of this group")
    row = db.scalar(select(Attendance).where(Attendance.poll_id == poll.id, Attendance.user_id == user.id))
    if row is None:
        db.add(Attendance(poll_id=poll.id, user_id=user.id, answer=answer))
    else:
        row.answer, row.answered_at = answer, now_utc()
    db.commit()
    out, active = declined_count(db, poll)
    new_poll = reschedule_after_declines(db, poll) if out * 2 > active else None
    return RsvpResult(out, active, new_poll)


def reschedule_after_declines(db: Session, poll: Poll) -> Poll | None:
    """Call off a decided session and open a fresh one-week poll (same hours, length and
    title, starting today) so the group can pick another time. The next session is not lined
    up automatically: the new poll replaces it. Does nothing (None) if the session already
    moved on, so repeated answers open at most one poll."""
    claimed = db.execute(update(Poll).where(
        Poll.id == poll.id, Poll.status == "confirmed", Poll.confirmed_start_utc > now_utc(),
    ).values(status="cancelled", recurrence_handled=True))
    if claimed.rowcount != 1:
        db.rollback()
        return None
    db.execute(delete(Reminder).where(Reminder.poll_id == poll.id, Reminder.sent_at.is_(None)))
    enqueue(db, "event_sync", poll.id)
    db.refresh(poll)
    if open_poll(db, poll.campaign_id) is not None:  # someone already opened one
        db.commit()
        return None
    today = datetime.now(ZoneInfo(poll.timezone)).date()
    following = Poll(
        campaign_id=poll.campaign_id, title=poll.title, timezone=poll.timezone,
        date_start=today, date_end=today + timedelta(days=config.WEEK_DAYS - 1),
        window_start=poll.window_start, window_end=poll.window_end,
        slot_minutes=poll.slot_minutes, duration_min=poll.duration_min,
        vote_top_n=poll.vote_top_n,
        anchor_day=poll.anchor_day, rescheduled_from=poll.id,
    )
    db.add(following)
    db.flush()
    enqueue(db, "reschedule", following.id)
    db.commit()
    db.refresh(following)
    return following


def valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
        return len(name) <= 64
    except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
        return False


def check_campaign_settings(*, name=None, cadence=None, default_duration_min=None,
                            theme=None, reminder_offsets_min=None, events_enabled=None,
                            available_themes=None) -> str | None:
    """Validate any subset of a campaign's settings. Raises ServiceError for the first bad
    value, so callers can check everything *before* writing anything. Returns the stripped name."""
    if name is not None:
        name = name.strip()
        if not 1 <= len(name) <= 120:
            raise ServiceError(422, "The name must be 1 to 120 characters.")
    if cadence is not None and cadence not in CADENCES:
        raise ServiceError(422, "frequency must be one of: " + ", ".join(CADENCES))
    if default_duration_min is not None and not 15 <= default_duration_min <= 1440:
        raise ServiceError(422, "session length must be between 15 and 1440 minutes")
    if theme is not None and available_themes is not None and theme not in available_themes:
        raise ServiceError(422, "Unknown theme.")
    if reminder_offsets_min is not None and (
            len(reminder_offsets_min) > 5 or any(
                not isinstance(m, int) or not 1 <= m <= 60 * 24 * 30 for m in reminder_offsets_min)):
        raise ServiceError(422, "use up to 5 reminders, each between 1 minute and 30 days before")
    return name


def update_campaign(db: Session, campaign: Campaign, *, name: str | None = None,
                    cadence: str | None = None,
                    default_duration_min: int | None = None,
                    theme: str | None = None, reminder_offsets_min: list | None = None,
                    events_enabled: bool | None = None,
                    available_themes: tuple | list | None = None) -> Campaign:
    """Change any of a campaign's settings in one step. Only the arguments given change, and
    nothing changes at all if any value is invalid. Reminder timings also reschedule the
    reminders of sessions that are already decided."""
    name = check_campaign_settings(
        name=name, cadence=cadence,
        default_duration_min=default_duration_min, theme=theme,
        reminder_offsets_min=reminder_offsets_min, available_themes=available_themes)
    cadence_changed = cadence is not None and cadence != campaign.cadence
    events_changed = events_enabled is not None and events_enabled != campaign.events_enabled
    if events_enabled is not None:
        campaign.events_enabled = events_enabled
    for field, value in (("name", name), ("cadence", cadence),
                         ("default_duration_min", default_duration_min), ("theme", theme)):
        if value is not None:
            setattr(campaign, field, value)
    if cadence_changed:
        replan_auto_sessions(db, campaign)
    if events_changed or cadence_changed:  # applies to the sessions already decided
        for session in upcoming_sessions(db, campaign.id):
            enqueue_once(db, "event_sync", session.id)
    if reminder_offsets_min is not None:
        campaign.reminder_offsets_min = sorted(set(reminder_offsets_min), reverse=True)
        reschedule_reminders(db, campaign)
    db.commit()
    return campaign


def reschedule_reminders(db: Session, campaign: Campaign, now: datetime | None = None) -> list:
    """Re-plan reminders for the campaign's upcoming decided sessions after the timings
    changed. Reminders already sent are left alone and not repeated; unsent ones are replaced."""
    now = now or now_utc()
    upcoming = db.scalars(select(Poll).where(
        Poll.campaign_id == campaign.id, Poll.status == "confirmed",
        Poll.confirmed_start_utc > now).order_by(Poll.confirmed_start_utc)).all()
    planned = []
    for poll in upcoming:
        db.execute(delete(Reminder).where(Reminder.poll_id == poll.id, Reminder.sent_at.is_(None)))
        already_sent = set(db.scalars(select(Reminder.offset_min).where(
            Reminder.poll_id == poll.id, Reminder.sent_at.is_not(None))))
        offsets = [m for m in (campaign.reminder_offsets_min or []) if m not in already_sent]
        planned += schedule_reminders(db, poll.id, poll.confirmed_start_utc, offsets, now)
    return planned


def pending_reminder_times(db: Session, poll_id: int) -> list:
    """When the group will next be reminded about this session, soonest first."""
    return list(db.scalars(select(Reminder.send_at).where(
        Reminder.poll_id == poll_id, Reminder.sent_at.is_(None)).order_by(Reminder.send_at)))


def due_reminders(db: Session, now: datetime | None = None) -> list:
    """Ids of reminders that should go out now, oldest first (retry backoff respected)."""
    now = now or now_utc()
    return list(db.scalars(
        select(Reminder.id).where(
            Reminder.sent_at.is_(None), Reminder.send_at <= now,
            or_(Reminder.retry_after.is_(None), Reminder.retry_after <= now))
        .order_by(Reminder.send_at, Reminder.id).limit(50)
    ))


def auto_confirm_due(db: Session, now: datetime | None = None) -> list:
    """Confirm every voting poll whose deadline has passed. Returns the poll ids."""
    now = now or now_utc()
    due = db.scalars(
        select(Poll).where(Poll.status == "voting", Poll.vote_deadline.is_not(None),
                           Poll.vote_deadline <= now)
    ).all()
    confirmed = []
    for poll in due:
        try:
            confirm_poll(db, poll)
            confirmed.append(poll.id)
        except ServiceError:
            db.rollback()
    return confirmed


# ---------------------------------------------------------------- recurrence


def next_occurrence(poll: Poll, cadence: str, now: datetime | None = None) -> tuple | None:
    """(start_utc, local_date) of the next session after `poll`, at the same local clock time,
    or None for a one-off campaign. Occurrences that would already be over are skipped, so
    after downtime the series catches up to the next one still ahead."""
    now = now or now_utc()
    tz = ZoneInfo(poll.timezone)
    local = poll.confirmed_start_utc.astimezone(tz)
    anchor = poll.anchor_day or local.day
    day = local.date()
    for _ in range(400):  # bounded: a long outage must not loop forever
        day = add_cadence(day, cadence, anchor)
        if day is None:
            return None
        start = datetime.combine(day, local.time(), tzinfo=tz).astimezone(timezone.utc)
        if start + timedelta(minutes=poll.duration_min) > now:
            return start, day
    return None


def schedule_next_occurrence(db: Session, poll: Poll, now: datetime | None = None) -> Poll | None:
    """Create the next session of a recurring campaign: already confirmed, with its reminders
    and an announcement queued. Does nothing for a one-off campaign."""
    campaign = poll.campaign
    found = next_occurrence(poll, campaign.cadence, now)
    if found is None:
        return None
    start, day = found
    local_start = poll.confirmed_start_utc.astimezone(ZoneInfo(poll.timezone))
    following = Poll(
        campaign_id=campaign.id, title=poll.title, timezone=poll.timezone,
        date_start=day, date_end=day + timedelta(days=config.WEEK_DAYS - 1),
        window_start=poll.window_start, window_end=poll.window_end,
        slot_minutes=poll.slot_minutes, duration_min=poll.duration_min,
        vote_top_n=poll.vote_top_n,
        status="confirmed", confirmed_start_utc=start,
        recurred_from=poll.id, anchor_day=poll.anchor_day or local_start.day,
    )
    db.add(following)
    db.flush()
    schedule_reminders(db, following.id, start, campaign.reminder_offsets_min or [], now)
    enqueue(db, "recurred", following.id)
    enqueue(db, "event_sync", following.id)
    return following


def roll_recurrences(db: Session, now: datetime | None = None) -> list:
    """For every decided session that has now ended, schedule the next one (recurring
    campaigns only). Each session is handled exactly once. Returns the new poll ids."""
    now = now or now_utc()
    started = db.scalars(select(Poll).where(
        Poll.status == "confirmed", Poll.recurrence_handled.is_(False),
        Poll.confirmed_start_utc <= now)).all()
    created = []
    for poll in started:
        if poll.confirmed_start_utc + timedelta(minutes=poll.duration_min) > now:
            continue  # still in progress
        claimed = db.execute(update(Poll).where(Poll.id == poll.id, Poll.recurrence_handled.is_(False))
                             .values(recurrence_handled=True))
        if claimed.rowcount != 1:
            db.rollback()
            continue
        following = schedule_next_occurrence(db, poll, now) if poll.campaign.cadence != "none" else None
        db.commit()
        if following is not None:
            created.append(following.id)
    return created


def _future_auto_sessions(db: Session, campaign_id: int, exclude_id: int | None = None) -> list:
    """Upcoming sessions that were scheduled automatically (not decided by a poll)."""
    q = select(Poll).where(
        Poll.campaign_id == campaign_id, Poll.status == "confirmed", Poll.recurred_from.is_not(None),
        Poll.recurrence_handled.is_(False), Poll.confirmed_start_utc > now_utc())
    if exclude_id is not None:
        q = q.where(Poll.id != exclude_id)
    return list(db.scalars(q))


def _drop_session(db: Session, poll: Poll) -> bool:
    """Cancel a decided session (status, reminders, notification). False if it moved on."""
    claimed = db.execute(update(Poll).where(Poll.id == poll.id, Poll.status == "confirmed")
                         .values(status="cancelled", recurrence_handled=True))
    if claimed.rowcount != 1:
        return False
    db.execute(delete(Reminder).where(Reminder.poll_id == poll.id, Reminder.sent_at.is_(None)))
    enqueue(db, "cancelled", poll.id)
    enqueue(db, "event_sync", poll.id)
    return True


def supersede_auto_sessions(db: Session, campaign_id: int, keep_id: int) -> None:
    """A newly decided session replaces automatically scheduled ones, which would otherwise
    double up with it. The group is told (the old ones were announced)."""
    for stale in _future_auto_sessions(db, campaign_id, exclude_id=keep_id):
        _drop_session(db, stale)


def replan_auto_sessions(db: Session, campaign: Campaign) -> None:
    """The meeting frequency changed: redo the upcoming automatic session from the session it
    followed, using the new interval (or drop it if the group no longer repeats)."""
    for session in _future_auto_sessions(db, campaign.id):
        source = db.get(Poll, session.recurred_from)
        if not _drop_session(db, session):
            continue
        if source is not None and campaign.cadence != "none":
            schedule_next_occurrence(db, source)

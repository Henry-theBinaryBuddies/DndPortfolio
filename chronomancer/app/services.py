"""Operations shared by the web API and the Discord bot. Each commits its own work."""
from collections import Counter
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from sqlalchemy import and_, delete, or_, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import config
from .models import (
    Availability, Campaign, Candidate, Member, Notification, Poll, PollMessage, Reminder, User,
    Vote,
)
from .scheduling import candidate_starts, generate_slots, rank_candidates


CADENCES = ("none", "weekly", "biweekly", "monthly", "quarterly", "annually")


def add_cadence(day: date, cadence: str, anchor_day: int | None = None) -> date | None:
    """The date one meeting interval after `day`, or None for a one-off campaign. Monthly,
    quarterly and annual steps aim for `anchor_day` (default: day's own), clamped to the end
    of short months, so Jan 31 -> Feb 28 -> Mar 31 rather than drifting to the 28th."""
    if cadence == "weekly":
        return day + timedelta(days=7)
    if cadence == "biweekly":
        return day + timedelta(days=14)
    months = {"monthly": 1, "quarterly": 3, "annually": 12}.get(cadence)
    if months is None:
        return None
    year_carry, month0 = divmod(day.month - 1 + months, 12)
    year, month = day.year + year_carry, month0 + 1
    return date(year, month, min(anchor_day or day.day, monthrange(year, month)[1]))


class ServiceError(Exception):
    """A user-facing failure. `status` mirrors an HTTP status; `detail` is a string or dict."""

    def __init__(self, status: int, detail):
        super().__init__(str(detail))
        self.status = status
        self.detail = detail


def now_utc() -> datetime:
    return datetime.now(timezone.utc)


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


def get_member(db: Session, campaign_id: int, user_id: int) -> Member | None:
    return db.scalar(
        select(Member).where(Member.campaign_id == campaign_id, Member.user_id == user_id)
    )


def ensure_member(db: Session, campaign_id: int, user_id: int) -> Member:
    for _ in range(2):
        member = get_member(db, campaign_id, user_id)
        if member is not None:
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


def campaign_for_channel(db: Session, guild_id: str, channel_id: str) -> Campaign | None:
    return db.scalar(
        select(Campaign).where(Campaign.guild_id == guild_id, Campaign.channel_id == channel_id)
    )


def create_campaign(db: Session, owner: User, *, name: str, guild_id: str | None = None,
                    channel_id: str | None = None, cadence: str = "none",
                    default_duration_min: int = 180, min_quorum: int = 2, vote_top_n: int = 3,
                    reminder_offsets_min: list | None = None, theme: str = "dnd",
                    timezone: str = "UTC", available_themes: list | None = None) -> tuple:
    name = check_campaign_settings(
        name=name, cadence=cadence, min_quorum=min_quorum, default_duration_min=default_duration_min,
        timezone=timezone, theme=theme, reminder_offsets_min=reminder_offsets_min,
        available_themes=available_themes)
    if guild_id and channel_id and campaign_for_channel(db, guild_id, channel_id):
        raise ServiceError(409, "this channel already hosts a campaign")
    campaign = Campaign(
        owner_id=owner.id, name=name, guild_id=guild_id, channel_id=channel_id,
        cadence=cadence, default_duration_min=default_duration_min, min_quorum=min_quorum,
        vote_top_n=vote_top_n, theme=theme, timezone=timezone,
        reminder_offsets_min=reminder_offsets_min if reminder_offsets_min is not None else [1440, 60],
    )
    member = Member(user=owner, role="organizer", required=True)
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
    """Free the Discord channel so it can be claimed again. The campaign itself is kept."""
    campaign.guild_id = None
    campaign.channel_id = None
    db.commit()
    return campaign


def delete_campaign(db: Session, campaign_id: int) -> None:
    """Remove a campaign and everything hanging off it, including outbox rows and the
    remembered Discord message (otherwise they dangle, and on SQLite a recycled poll id
    would inherit them)."""
    poll_ids = list(db.scalars(select(Poll.id).where(Poll.campaign_id == campaign_id)))
    if poll_ids:
        for model in (Availability, Notification, PollMessage, Reminder):
            db.execute(delete(model).where(model.poll_id.in_(poll_ids)))
    # Polls, candidates, votes and members go with the campaign via the ORM cascade.
    campaign = db.get(Campaign, campaign_id)
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
                duration_min: int | None = None, min_quorum: int | None = None,
                vote_top_n: int | None = None, vote_deadline: datetime | None = None) -> Poll:
    existing = current_poll(db, campaign.id)
    if existing is not None and existing.status in ("collecting", "voting"):
        raise ServiceError(409, "A poll is already open in this campaign. Close or confirm it first.")
    # A poll is always exactly one week: the grid players paint is seven days starting here.
    date_end = date_start + timedelta(days=config.WEEK_DAYS - 1)
    if vote_deadline is not None:
        if vote_deadline.tzinfo is None:
            raise ServiceError(422, "vote deadline must include a timezone")
        if vote_deadline <= now_utc():
            raise ServiceError(422, "vote deadline must be in the future")
    poll = Poll(
        campaign_id=campaign.id, title=title, timezone=tz or campaign.timezone,
        date_start=date_start, date_end=date_end,
        window_start=window_start, window_end=window_end, slot_minutes=slot_minutes,
        duration_min=duration_min or campaign.default_duration_min,
        min_quorum=min_quorum or campaign.min_quorum,
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
    members = db.scalars(select(Member).where(Member.campaign_id == poll.campaign_id)).all()
    result = rank_candidates(
        slots=poll_slots(poll),
        availability=availability,
        players=[m.user_id for m in members],
        required=[m.user_id for m in members if m.required],
        slot_minutes=poll.slot_minutes,
        duration_min=poll.duration_min,
        min_quorum=poll.min_quorum,
        top_n=poll.vote_top_n,
    )
    if not result.candidates:
        db.rollback()  # release the claim: the poll stays open for more availability
        raise ServiceError(409, {
            "message": "no start time satisfies the required players and quorum",
            "considered": result.total_considered,
            "dropped_required": result.dropped_required,
            "dropped_quorum": result.dropped_quorum,
        })
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


def valid_timezone(name: str) -> bool:
    try:
        ZoneInfo(name)
        return len(name) <= 64
    except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
        return False


def check_campaign_settings(*, name=None, cadence=None, min_quorum=None, default_duration_min=None,
                            timezone=None, theme=None, reminder_offsets_min=None,
                            events_enabled=None, available_themes=None) -> str | None:
    """Validate any subset of a campaign's settings. Raises ServiceError for the first bad
    value, so callers can check everything *before* writing anything. Returns the stripped name."""
    if name is not None:
        name = name.strip()
        if not 1 <= len(name) <= 120:
            raise ServiceError(422, "The name must be 1 to 120 characters.")
    if cadence is not None and cadence not in CADENCES:
        raise ServiceError(422, "frequency must be one of: " + ", ".join(CADENCES))
    if min_quorum is not None and not 1 <= min_quorum <= 50:
        raise ServiceError(422, "minimum players must be between 1 and 50")
    if default_duration_min is not None and not 15 <= default_duration_min <= 1440:
        raise ServiceError(422, "session length must be between 15 and 1440 minutes")
    if timezone is not None and not valid_timezone(timezone):
        raise ServiceError(422, "Unknown timezone. Use a name like America/Los_Angeles or UTC.")
    if theme is not None and available_themes is not None and theme not in available_themes:
        raise ServiceError(422, "Unknown theme.")
    if reminder_offsets_min is not None and (
            len(reminder_offsets_min) > 5 or any(
                not isinstance(m, int) or not 1 <= m <= 60 * 24 * 30 for m in reminder_offsets_min)):
        raise ServiceError(422, "use up to 5 reminders, each between 1 minute and 30 days before")
    return name


def update_campaign(db: Session, campaign: Campaign, *, name: str | None = None,
                    cadence: str | None = None, min_quorum: int | None = None,
                    default_duration_min: int | None = None, timezone: str | None = None,
                    theme: str | None = None, reminder_offsets_min: list | None = None,
                    events_enabled: bool | None = None,
                    available_themes: tuple | list | None = None) -> Campaign:
    """Change any of a campaign's settings in one step. Only the arguments given change, and
    nothing changes at all if any value is invalid. Reminder timings also reschedule the
    reminders of sessions that are already decided."""
    name = check_campaign_settings(
        name=name, cadence=cadence, min_quorum=min_quorum,
        default_duration_min=default_duration_min, timezone=timezone, theme=theme,
        reminder_offsets_min=reminder_offsets_min, available_themes=available_themes)
    cadence_changed = cadence is not None and cadence != campaign.cadence
    events_changed = events_enabled is not None and events_enabled != campaign.events_enabled
    if events_enabled is not None:
        campaign.events_enabled = events_enabled
    for field, value in (("name", name), ("cadence", cadence), ("min_quorum", min_quorum),
                         ("default_duration_min", default_duration_min), ("timezone", timezone),
                         ("theme", theme)):
        if value is not None:
            setattr(campaign, field, value)
    if cadence_changed:
        replan_auto_sessions(db, campaign)
    if events_changed:  # turning events on or off applies to the sessions already decided
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
        min_quorum=poll.min_quorum, vote_top_n=poll.vote_top_n,
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

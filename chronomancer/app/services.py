"""Operations shared by the web API and the Discord bot. Each commits its own work."""
from collections import Counter
from calendar import monthrange
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

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


def add_cadence(day: date, cadence: str) -> date | None:
    """The date one meeting interval after `day`, or None for a one-off campaign."""
    if cadence == "weekly":
        return day + timedelta(days=7)
    if cadence == "biweekly":
        return day + timedelta(days=14)
    months = {"monthly": 1, "quarterly": 3, "annually": 12}.get(cadence)
    if months is None:
        return None
    year_carry, month0 = divmod(day.month - 1 + months, 12)
    year, month = day.year + year_carry, month0 + 1
    return date(year, month, min(day.day, monthrange(year, month)[1]))  # Jan 31 + 1 month = Feb 28


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
                    reminder_offsets_min: list | None = None, theme: str = "dnd") -> tuple:
    if guild_id and channel_id and campaign_for_channel(db, guild_id, channel_id):
        raise ServiceError(409, "this channel already hosts a campaign")
    if cadence not in CADENCES:
        raise ServiceError(422, "frequency must be one of: " + ", ".join(CADENCES))
    campaign = Campaign(
        owner_id=owner.id, name=name, guild_id=guild_id, channel_id=channel_id,
        cadence=cadence, default_duration_min=default_duration_min, min_quorum=min_quorum,
        vote_top_n=vote_top_n, theme=theme,
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


def set_cadence(db: Session, campaign: Campaign, cadence: str) -> Campaign:
    if cadence not in CADENCES:
        raise ServiceError(422, "frequency must be one of: " + ", ".join(CADENCES))
    campaign.cadence = cadence
    db.commit()
    return campaign


def suggest_next_week(db: Session, campaign: Campaign) -> date | None:
    """Where the next poll's week should start, from the last confirmed session plus the
    campaign's meeting frequency. None for one-off campaigns or before any session."""
    if campaign.cadence == "none":
        return None
    last = db.scalar(select(Poll).where(Poll.campaign_id == campaign.id,
                                        Poll.status == "confirmed").order_by(Poll.id.desc()))
    if last is None or last.confirmed_start_utc is None:
        return None
    held_on = last.confirmed_start_utc.astimezone(ZoneInfo(last.timezone)).date()
    return add_cadence(held_on, campaign.cadence)


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


def create_poll(db: Session, campaign: Campaign, *, title: str, tz: str, date_start: date,
                window_start: time, window_end: time, slot_minutes: int = 30,
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
        campaign_id=campaign.id, title=title, timezone=tz,
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
    schedule_reminders(db, poll.id, chosen.start_utc, poll.campaign.reminder_offsets_min or [])
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
    db.commit()
    db.refresh(poll)
    return poll


def set_reminder_offsets(db: Session, campaign: Campaign, offsets: list) -> Campaign:
    """Minutes before a session at which to remind the group (up to five, 1 minute to 30 days)."""
    if len(offsets) > 5 or any(not isinstance(m, int) or not 1 <= m <= 60 * 24 * 30 for m in offsets):
        raise ServiceError(422, "use up to 5 reminders, each between 1 minute and 30 days before")
    campaign.reminder_offsets_min = sorted(set(offsets), reverse=True)
    reschedule_reminders(db, campaign)  # sessions already decided pick up the new timings
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


def open_next_poll(db: Session, poll: Poll) -> Poll:
    """Open the next poll of a recurring campaign: the suggested week, same window, length,
    timezone and quorum as the session just decided."""
    campaign = poll.campaign
    latest = db.scalar(select(Poll.id).where(Poll.campaign_id == campaign.id,
                                             Poll.status == "confirmed").order_by(Poll.id.desc()))
    if poll.status != "confirmed" or latest != poll.id:
        raise ServiceError(409, "that is not the campaign's latest confirmed session")
    week = suggest_next_week(db, campaign)
    if week is None:
        raise ServiceError(409, "this campaign does not repeat: set a meeting frequency first")
    return create_poll(
        db, campaign, title=poll.title, tz=poll.timezone, date_start=week,
        window_start=poll.window_start, window_end=poll.window_end,
        slot_minutes=poll.slot_minutes, duration_min=poll.duration_min,
        min_quorum=poll.min_quorum, vote_top_n=poll.vote_top_n,
    )


def requeue_vote_post(db: Session, poll: Poll) -> None:
    """Organizer-triggered resend of the vote message (for example after a long outage)."""
    if poll.status != "voting":
        raise ServiceError(409, "there is no open vote to repost")
    enqueue(db, "vote_open", poll.id)
    db.commit()


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

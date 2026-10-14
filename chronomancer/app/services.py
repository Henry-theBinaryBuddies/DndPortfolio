"""Operations shared by the web API and the Discord bot. Each commits its own work."""
from collections import Counter
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import config
from .models import (
    Availability, Campaign, Candidate, Member, Notification, Poll, PollMessage, User, Vote,
)
from .scheduling import candidate_starts, generate_slots, rank_candidates


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
        for model in (Availability, Notification, PollMessage):
            db.execute(delete(model).where(model.poll_id.in_(poll_ids)))
    # Polls, candidates, votes and members go with the campaign via the ORM cascade.
    campaign = db.get(Campaign, campaign_id)
    if campaign is not None:
        db.delete(campaign)
    db.commit()


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
                date_end: date, window_start: time, window_end: time, slot_minutes: int = 30,
                duration_min: int | None = None, min_quorum: int | None = None,
                vote_top_n: int | None = None, vote_deadline: datetime | None = None) -> Poll:
    existing = current_poll(db, campaign.id)
    if existing is not None and existing.status in ("collecting", "voting"):
        raise ServiceError(409, "A poll is already open in this campaign. Close or confirm it first.")
    if date_end < date_start:
        raise ServiceError(422, "last day must not be before first day")
    if (date_end - date_start).days + 1 > config.MAX_POLL_DAYS:
        raise ServiceError(422, f"poll may cover at most {config.MAX_POLL_DAYS} days")
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
    db.commit()
    db.refresh(poll)
    return poll


def cancel_poll(db: Session, poll: Poll) -> Poll:
    """Abandon an open poll so a new one can be created."""
    claimed = db.execute(update(Poll).where(Poll.id == poll.id,
                                            Poll.status.in_(("collecting", "voting")))
                         .values(status="cancelled"))
    if claimed.rowcount != 1:
        db.rollback()
        raise ServiceError(409, "poll is already finished")
    if db.get(PollMessage, poll.id) is not None:
        enqueue(db, "cancelled", poll.id)  # lets the bot retire the vote buttons
    db.commit()
    db.refresh(poll)
    return poll


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

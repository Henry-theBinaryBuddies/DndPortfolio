"""Plain-data views of a poll, loaded in a worker thread and then used on the event loop
(so no ORM objects, and no database access, ever happen inside async Discord code)."""
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config, services
from ..models import Campaign, Member, Poll, PollMessage, Vote


@dataclass
class CandidateSnap:
    id: int
    start: datetime
    free: int
    maybe: int
    votes: int


@dataclass
class PollSnapshot:
    poll_id: int
    campaign_id: int
    campaign_name: str
    theme: str
    title: str
    status: str
    guild_id: int | None
    channel_id: int | None
    duration_min: int
    vote_deadline: datetime | None
    confirmed_start: datetime | None
    candidates: list = field(default_factory=list)
    message_channel_id: int | None = None
    message_id: int | None = None
    organizer_discord_id: str | None = None
    # Recurrence: when the next session will be scheduled for (a decided session of a repeating
    # group), the session that follows a cancelled one, and whether this one was automatic.
    recurrence_next: datetime | None = None
    following: datetime | None = None
    auto: bool = False
    events_enabled: bool = True
    discord_event_id: str | None = None
    # Events: the group's repeat frequency, its one repeating event (if any), the server the
    # events live in (still known after the channel is unlinked), and the session that event
    # should currently point at.
    cadence: str = "none"
    series_event_id: str | None = None
    series_event_sig: str | None = None
    events_guild_id: int | None = None
    linked: bool = True
    next_start: datetime | None = None
    next_duration: int = 0
    next_title: str = ""
    # Everyone currently in the group (for mentions), and when the session that a
    # reschedule poll replaces was due.
    member_ids: list = field(default_factory=list)
    rescheduled_from_start: datetime | None = None
    campaign_url: str = ""
    reminder_times: list = field(default_factory=list)  # pending reminder send times
    reminder_offsets: list = field(default_factory=list)  # the campaign's configured timings

    @property
    def url(self) -> str:
        return f"{config.PUBLIC_BASE_URL}/poll.html?id={self.poll_id}"

    @property
    def session_end(self) -> datetime | None:
        if self.confirmed_start is None:
            return None
        return self.confirmed_start + timedelta(minutes=self.duration_min)

    @property
    def total_votes(self) -> int:
        return sum(c.votes for c in self.candidates)

    @property
    def display_title(self) -> str:
        return self.title or self.campaign_name


def _int_or_none(value) -> int | None:
    try:
        return int(value) if value else None
    except (TypeError, ValueError):
        return None


def _recurrence_next(poll: Poll, campaign: Campaign) -> datetime | None:
    if poll.status != "confirmed" or poll.recurrence_handled or campaign.cadence == "none":
        return None
    found = services.next_occurrence(poll, campaign.cadence)
    return found[0] if found else None


def _following(db: Session, poll: Poll, campaign: Campaign) -> datetime | None:
    """For a cancelled session of a repeating group: when the next one is."""
    if poll.status != "cancelled" or poll.confirmed_start_utc is None or campaign.cadence == "none":
        return None
    upcoming = services.next_session(db, campaign.id)
    return upcoming.confirmed_start_utc if upcoming else None


def load_poll_snapshot(db: Session, poll_id: int) -> PollSnapshot | None:
    poll = db.get(Poll, poll_id)
    if poll is None:
        return None
    campaign: Campaign = poll.campaign
    counts = Counter(v.candidate_id for v in db.scalars(select(Vote).where(Vote.poll_id == poll.id)))
    message = db.get(PollMessage, poll.id)
    upcoming = services.next_session(db, campaign.id)
    earlier = db.get(Poll, poll.rescheduled_from) if poll.rescheduled_from else None
    organizer = db.scalar(
        select(Member).where(Member.campaign_id == campaign.id, Member.role == "organizer")
    )
    return PollSnapshot(
        poll_id=poll.id,
        campaign_id=campaign.id,
        campaign_name=campaign.name,
        theme=campaign.theme,
        title=poll.title,
        status=poll.status,
        guild_id=_int_or_none(campaign.guild_id),
        channel_id=_int_or_none(campaign.channel_id),
        duration_min=poll.duration_min,
        vote_deadline=poll.vote_deadline,
        confirmed_start=poll.confirmed_start_utc,
        candidates=[
            CandidateSnap(c.id, c.start_utc, c.free_count, c.maybe_count, counts.get(c.id, 0))
            for c in poll.candidates
        ],
        message_channel_id=_int_or_none(message.channel_id) if message else None,
        message_id=_int_or_none(message.message_id) if message else None,
        organizer_discord_id=organizer.user.discord_id if organizer else None,
        recurrence_next=_recurrence_next(poll, campaign),
        following=_following(db, poll, campaign),
        auto=poll.recurred_from is not None,
        events_enabled=campaign.events_enabled,
        discord_event_id=poll.discord_event_id,
        cadence=campaign.cadence,
        series_event_id=campaign.series_event_id,
        series_event_sig=campaign.series_event_sig,
        events_guild_id=_int_or_none(campaign.events_guild_id),
        linked=campaign.channel_id is not None,
        next_start=upcoming.confirmed_start_utc if upcoming else None,
        next_duration=upcoming.duration_min if upcoming else 0,
        next_title=(upcoming.title or campaign.name) if upcoming else "",
        member_ids=[int(m.user.discord_id) for m in services.active_members(db, campaign.id)
                    if m.user.discord_id.isdigit()],
        rescheduled_from_start=earlier.confirmed_start_utc if earlier else None,
        campaign_url=f"{config.PUBLIC_BASE_URL}/campaign.html?id={campaign.id}",
        reminder_times=services.pending_reminder_times(db, poll.id) if poll.status == "confirmed" else [],
        reminder_offsets=list(campaign.reminder_offsets_min or []),
    )

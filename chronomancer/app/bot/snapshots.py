"""Plain-data views of a poll, loaded in a worker thread and then used on the event loop
(so no ORM objects, and no database access, ever happen inside async Discord code)."""
from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import config
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

    @property
    def url(self) -> str:
        return f"{config.PUBLIC_BASE_URL}/poll.html?id={self.poll_id}"

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


def load_poll_snapshot(db: Session, poll_id: int) -> PollSnapshot | None:
    poll = db.get(Poll, poll_id)
    if poll is None:
        return None
    campaign: Campaign = poll.campaign
    counts = Counter(v.candidate_id for v in db.scalars(select(Vote).where(Vote.poll_id == poll.id)))
    message = db.get(PollMessage, poll.id)
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
    )

import secrets
from datetime import datetime, timezone

from sqlalchemy import (
    JSON, Boolean, Date, DateTime, ForeignKey, Integer, String, Time, UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy.types import TypeDecorator

from .db import Base


class UTCDateTime(TypeDecorator):
    """Stores naive UTC, always returns timezone-aware UTC."""

    impl = DateTime
    cache_ok = True

    def process_bind_param(self, value, dialect):
        if value is None:
            return None
        if value.tzinfo is None:
            raise ValueError("naive datetime not allowed")
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def process_result_value(self, value, dialect):
        return None if value is None else value.replace(tzinfo=timezone.utc)


def _invite_code() -> str:
    return secrets.token_urlsafe(8)


class User(Base):
    __tablename__ = "users"
    id: Mapped[int] = mapped_column(primary_key=True)
    discord_id: Mapped[str] = mapped_column(String(32), unique=True)
    display_name: Mapped[str] = mapped_column(String(100))
    avatar_url: Mapped[str | None] = mapped_column(String(300), default=None)
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")


class Campaign(Base):
    __tablename__ = "campaigns"
    # One campaign per Discord channel. (NULL, NULL) for web-only campaigns never collides.
    __table_args__ = (UniqueConstraint("guild_id", "channel_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120))
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    guild_id: Mapped[str | None] = mapped_column(String(32), default=None)
    channel_id: Mapped[str | None] = mapped_column(String(32), default=None)
    invite_code: Mapped[str] = mapped_column(String(32), unique=True, default=_invite_code)
    cadence: Mapped[str] = mapped_column(String(16), default="none")
    default_duration_min: Mapped[int] = mapped_column(Integer, default=180)
    min_quorum: Mapped[int] = mapped_column(Integer, default=2)
    vote_top_n: Mapped[int] = mapped_column(Integer, default=3)
    reminder_offsets_min: Mapped[list] = mapped_column(JSON, default=lambda: [1440, 60])
    theme: Mapped[str] = mapped_column(String(32), default="dnd")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")  # default for new polls
    events_enabled: Mapped[bool] = mapped_column(Boolean, default=True)  # Discord scheduled events
    members: Mapped[list["Member"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )
    polls: Mapped[list["Poll"]] = relationship(
        back_populates="campaign", cascade="all, delete-orphan"
    )


class Member(Base):
    __tablename__ = "members"
    __table_args__ = (UniqueConstraint("campaign_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(16), default="player")  # organizer | player
    required: Mapped[bool] = mapped_column(Boolean, default=False)
    campaign: Mapped[Campaign] = relationship(back_populates="members")
    user: Mapped[User] = relationship()


class Poll(Base):
    __tablename__ = "polls"
    id: Mapped[int] = mapped_column(primary_key=True)
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id"))
    title: Mapped[str] = mapped_column(String(120), default="")
    timezone: Mapped[str] = mapped_column(String(64), default="UTC")
    date_start = mapped_column(Date)
    date_end = mapped_column(Date)
    window_start = mapped_column(Time)
    window_end = mapped_column(Time)
    slot_minutes: Mapped[int] = mapped_column(Integer, default=30)
    duration_min: Mapped[int] = mapped_column(Integer, default=180)
    min_quorum: Mapped[int] = mapped_column(Integer, default=2)
    vote_top_n: Mapped[int] = mapped_column(Integer, default=3)
    status: Mapped[str] = mapped_column(String(16), default="collecting")
    vote_deadline = mapped_column(UTCDateTime, nullable=True)
    confirmed_start_utc = mapped_column(UTCDateTime, nullable=True)
    # Recurrence: once a decided session has ended and its follow-up was handled, never again.
    recurrence_handled: Mapped[bool] = mapped_column(Boolean, default=False)
    recurred_from: Mapped[int | None] = mapped_column(Integer, nullable=True)  # the session this repeats
    anchor_day: Mapped[int | None] = mapped_column(Integer, nullable=True)    # day of month to keep
    discord_event_id: Mapped[str | None] = mapped_column(String(32), nullable=True)
    campaign: Mapped[Campaign] = relationship(back_populates="polls")
    candidates: Mapped[list["Candidate"]] = relationship(
        back_populates="poll", cascade="all, delete-orphan", order_by="Candidate.rank"
    )


class Availability(Base):
    __tablename__ = "availability"
    __table_args__ = (UniqueConstraint("poll_id", "user_id", "slot_start_utc"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    slot_start_utc = mapped_column(UTCDateTime)
    level: Mapped[str] = mapped_column(String(8))  # free | maybe


class Candidate(Base):
    __tablename__ = "candidates"
    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id"))
    start_utc = mapped_column(UTCDateTime)
    score: Mapped[int] = mapped_column(Integer)
    free_count: Mapped[int] = mapped_column(Integer)
    maybe_count: Mapped[int] = mapped_column(Integer)
    rank: Mapped[int] = mapped_column(Integer)
    poll: Mapped[Poll] = relationship(back_populates="candidates")
    votes: Mapped[list["Vote"]] = relationship(cascade="all, delete-orphan")


class Vote(Base):
    __tablename__ = "votes"
    __table_args__ = (UniqueConstraint("poll_id", "user_id"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    candidate_id: Mapped[int] = mapped_column(ForeignKey("candidates.id"))
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id"))
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))


class PollMessage(Base):
    """The Discord message that carries a poll's vote buttons."""

    __tablename__ = "poll_messages"
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id"), primary_key=True)
    channel_id: Mapped[str] = mapped_column(String(32))
    message_id: Mapped[str] = mapped_column(String(32))


class Notification(Base):
    """Outbox: web/bot actions queue these, the background worker delivers them to Discord."""

    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(32))  # vote_open | confirmed
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id"), index=True)
    created_at = mapped_column(UTCDateTime, default=lambda: datetime.now(timezone.utc))
    processed_at = mapped_column(UTCDateTime, nullable=True)
    retry_after = mapped_column(UTCDateTime, nullable=True)  # backoff: not before this time
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(300), default=None)


class Reminder(Base):
    """A scheduled 'your session starts soon' message for a confirmed poll."""

    __tablename__ = "reminders"
    __table_args__ = (UniqueConstraint("poll_id", "offset_min"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id"), index=True)
    offset_min: Mapped[int] = mapped_column(Integer)      # minutes before the session
    send_at = mapped_column(UTCDateTime, index=True)
    sent_at = mapped_column(UTCDateTime, nullable=True)   # set once delivered or given up
    retry_after = mapped_column(UTCDateTime, nullable=True)
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    dm_ok: Mapped[int] = mapped_column(Integer, default=0)
    dm_failed: Mapped[int] = mapped_column(Integer, default=0)
    error: Mapped[str | None] = mapped_column(String(300), default=None)

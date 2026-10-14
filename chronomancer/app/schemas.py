from datetime import date, datetime, time
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, Field, field_validator

from . import config


def _check_tz(v: str) -> str:
    if len(v) > 64:
        raise ValueError("unknown timezone")
    try:
        ZoneInfo(v)
    except (ZoneInfoNotFoundError, ValueError, KeyError, OSError):
        raise ValueError("unknown timezone")
    return v


class DevLogin(BaseModel):
    discord_id: str = Field(min_length=1, max_length=32)
    display_name: str = Field(min_length=1, max_length=100)
    timezone: str = "UTC"

    _tz = field_validator("timezone")(_check_tz)


class CampaignCreate(BaseModel):
    # guild_id / channel_id are deliberately absent: a campaign is bound to a Discord channel
    # only through the bot (/chronomancer create or link), which verifies the caller is in it.
    name: str = Field(min_length=1, max_length=120)
    cadence: str = Field(default="none", pattern="^(none|weekly|biweekly|monthly)$")
    default_duration_min: int = Field(default=180, ge=30, le=1440)
    min_quorum: int = Field(default=2, ge=1, le=50)
    vote_top_n: int = Field(default=3, ge=1, le=config.MAX_VOTE_TOP_N)
    reminder_offsets_min: list[int] = Field(default_factory=lambda: [1440, 60])
    theme: str = Field(default="dnd", pattern="^[a-z0-9_-]{1,32}$")

    @field_validator("reminder_offsets_min")
    @classmethod
    def _offsets(cls, v: list[int]) -> list[int]:
        if len(v) > 5 or any(not 1 <= m <= 60 * 24 * 30 for m in v):
            raise ValueError("up to 5 reminders, each 1 minute to 30 days before")
        return sorted(set(v), reverse=True)


class JoinRequest(BaseModel):
    invite_code: str


class PollCreate(BaseModel):
    title: str = Field(default="", max_length=120)
    timezone: str = "UTC"
    date_start: date
    date_end: date
    window_start: time
    window_end: time
    slot_minutes: int = Field(default=30, ge=15, le=120)
    duration_min: int | None = Field(default=None, ge=15, le=1440)
    min_quorum: int | None = Field(default=None, ge=1, le=50)
    vote_top_n: int | None = Field(default=None, ge=1, le=config.MAX_VOTE_TOP_N)
    vote_deadline: datetime | None = None

    _tz = field_validator("timezone")(_check_tz)


class SlotMark(BaseModel):
    start: datetime
    level: str = Field(pattern="^(free|maybe)$")


class AvailabilityPut(BaseModel):
    slots: list[SlotMark]


class VoteCast(BaseModel):
    candidate_id: int


class ConfirmRequest(BaseModel):
    candidate_id: int | None = None


class CloseRequest(BaseModel):
    vote_hours: int | None = Field(default=None, ge=1, le=config.MAX_VOTE_HOURS)

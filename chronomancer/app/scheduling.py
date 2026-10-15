"""Pure scheduling logic: slot generation and candidate ranking. No I/O."""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Collection, Mapping
from zoneinfo import ZoneInfo

FREE = "free"
MAYBE = "maybe"
NO = "no"          # marked red: explicitly not available (as opposed to not having answered)
LEVELS = (FREE, MAYBE, NO)


@dataclass(frozen=True)
class Ranked:
    start: datetime
    free_ids: tuple
    maybe_ids: tuple
    score: int

    @property
    def free_count(self) -> int:
        return len(self.free_ids)

    @property
    def maybe_count(self) -> int:
        return len(self.maybe_ids)


@dataclass(frozen=True)
class RankResult:
    candidates: list
    total_considered: int
    dropped_required: int
    dropped_quorum: int


def generate_slots(
    date_start: date,
    date_end: date,
    window_start: time,
    window_end: time,
    tz_name: str,
    slot_minutes: int,
) -> list:
    """UTC-aware slot starts for every day in range, inside the daily window (local to tz_name).
    A window_end of 00:00 means midnight at the end of the day, so 00:00 to 00:00 is the whole day."""
    if window_end != time(0) and window_start >= window_end:
        raise ValueError("window_start must be before window_end")
    if date_start > date_end:
        raise ValueError("date_start must not be after date_end")
    if slot_minutes <= 0:
        raise ValueError("slot_minutes must be positive")
    tz = ZoneInfo(tz_name)
    step = timedelta(minutes=slot_minutes)
    slots = []
    day = date_start
    while day <= date_end:
        # Walk elapsed time between the window's local start and end, so a DST change
        # inside the window neither duplicates (spring) nor drops (autumn) slots.
        cursor = datetime.combine(day, window_start, tzinfo=tz).astimezone(timezone.utc)
        end_day = day + timedelta(days=1) if window_end == time(0) else day
        end = datetime.combine(end_day, window_end, tzinfo=tz).astimezone(timezone.utc)
        while cursor + step <= end:
            slots.append(cursor)
            cursor += step
        day += timedelta(days=1)
    return slots


def candidate_starts(slots: Collection, slot_minutes: int, duration_min: int) -> list:
    """Slots from which a session of duration_min fits entirely inside the offered slots."""
    needed = -(-duration_min // slot_minutes)
    step = timedelta(minutes=slot_minutes)
    slot_set = set(slots)
    return sorted(
        s for s in slot_set if all(s + step * k in slot_set for k in range(needed))
    )


def rank_candidates(
    slots: Collection,
    availability: Mapping,
    players: Collection,
    required: Collection,
    slot_minutes: int,
    duration_min: int,
    min_quorum: int,
    top_n: int,
) -> RankResult:
    """Rank start times. availability: user_id -> {slot_start_utc: 'free'|'maybe'}.

    A player is free for a candidate only if every slot of the session is free, maybe if
    every slot is free-or-maybe with at least one maybe, otherwise unavailable. Candidates
    where a required player is unavailable, or with fewer than min_quorum free players,
    are dropped. Order: score (free*2 + maybe) descending, then earliest start.
    """
    needed = -(-duration_min // slot_minutes)
    step = timedelta(minutes=slot_minutes)
    starts = candidate_starts(slots, slot_minutes, duration_min)
    kept, dropped_required, dropped_quorum = [], 0, 0
    for start in starts:
        run = [start + step * k for k in range(needed)]
        free_ids, maybe_ids = [], []
        for uid in players:
            levels = [availability.get(uid, {}).get(s) for s in run]
            if any(lv not in (FREE, MAYBE) for lv in levels):  # unmarked, or marked "no"
                continue
            (free_ids if all(lv == FREE for lv in levels) else maybe_ids).append(uid)
        attending = set(free_ids) | set(maybe_ids)
        if any(r not in attending for r in required):
            dropped_required += 1
            continue
        if len(free_ids) < min_quorum:
            dropped_quorum += 1
            continue
        kept.append(
            Ranked(start, tuple(free_ids), tuple(maybe_ids), len(free_ids) * 2 + len(maybe_ids))
        )
    kept.sort(key=lambda c: (-c.score, c.start))
    return RankResult(kept[:top_n], len(starts), dropped_required, dropped_quorum)

"""Pure scheduling logic: slot generation and candidate ranking. No I/O."""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from typing import Collection, Mapping
from zoneinfo import ZoneInfo

FREE = "free"
MAYBE = "maybe"
NO = "no"          # marked red: explicitly not available (as opposed to not having answered)


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
    total_considered: int     # possible starts that fit inside the offered slots
    skipped_past: int         # of those, starts that have already begun
    dropped_required: int     # starts where a required person is not free for the whole session
    dropped_nobody: int       # starts where nobody is free for the whole session


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
    top_n: int,
    now: datetime | None = None,
) -> RankResult:
    """Rank start times. availability: user_id -> {slot_start_utc: 'free'|'maybe'}.

    A player is free for a candidate only if every slot of the session is free, maybe if
    every slot is free-or-maybe with at least one maybe, otherwise unavailable. There is no
    minimum: the best times are always offered, as long as at least one person can attend.
    A start is dropped if nobody can attend, or if a person marked *required* cannot, and a
    start that has already begun (before `now`, default the current time) is never offered.
    Order: score (free*2 + maybe) descending, then earliest start.
    """
    now = now or datetime.now(timezone.utc)
    needed = -(-duration_min // slot_minutes)
    step = timedelta(minutes=slot_minutes)
    starts = candidate_starts(slots, slot_minutes, duration_min)
    kept, skipped_past, dropped_required, dropped_nobody = [], 0, 0, 0
    for start in starts:
        if start < now:
            skipped_past += 1
            continue
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
        if not attending:
            dropped_nobody += 1
            continue
        kept.append(
            Ranked(start, tuple(free_ids), tuple(maybe_ids), len(free_ids) * 2 + len(maybe_ids))
        )
    kept.sort(key=lambda c: (-c.score, c.start))
    return RankResult(kept[:top_n], len(starts), skipped_past, dropped_required, dropped_nobody)


@dataclass(frozen=True)
class Overlap:
    people: int       # how many people are available together
    start: datetime
    end: datetime

    @property
    def minutes(self) -> int:
        return int((self.end - self.start).total_seconds() // 60)


def best_overlap(
    slots: Collection,
    availability: Mapping,
    players: Collection,
    slot_minutes: int,
    now: datetime | None = None,
) -> Overlap | None:
    """The best stretch of time that is too short for the session: the run of consecutive slots
    during which the most people (free or maybe) are available together; the longer stretch wins a
    tie. Used to tell the organizer how close the group came when
    nobody is free for a whole session. Slots that have already begun are ignored."""
    now = now or datetime.now(timezone.utc)
    step = timedelta(minutes=slot_minutes)
    future = sorted(s for s in set(slots) if s >= now)
    if not future or not players:
        return None
    present = {s: sum(1 for uid in players if availability.get(uid, {}).get(s) in (FREE, MAYBE)) for s in future}
    best = None  # (people, minutes, start, end)

    def consider(best, people, run):
        if not run:
            return best
        minutes = len(run) * slot_minutes
        candidate = (people, minutes, run[0], run[-1] + step)
        return candidate if best is None or candidate[:2] > best[:2] else best

    for people in range(len(players), 0, -1):
        run = []   # consecutive slots in which at least `people` people are available
        for s in future:
            if present[s] >= people and (not run or s == run[-1] + step):
                run.append(s)
            else:
                best = consider(best, people, run)
                run = [s] if present[s] >= people else []
        best = consider(best, people, run)
    return Overlap(best[0], best[2], best[3]) if best else None

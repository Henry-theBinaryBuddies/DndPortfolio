from datetime import date, datetime, time, timedelta, timezone

import pytest

from app.scheduling import best_overlap, candidate_starts, generate_slots, rank_candidates

UTC = timezone.utc
LONG_AGO = datetime(2026, 1, 1, tzinfo=UTC)   # 'now' for tests whose slots are in March 2026


def slots_for(day, start_h, end_h, minutes=30, tz="UTC"):
    return generate_slots(day, day, time(start_h), time(end_h), tz, minutes)


def mark(slots, level="free"):
    return {s: level for s in slots}


def test_generate_slots_count_and_utc_conversion():
    day = date(2026, 3, 2)
    slots = slots_for(day, 18, 22, 30, tz="America/Los_Angeles")
    assert len(slots) == 8
    # 18:00 PST on 2026-03-02 is 02:00 UTC the next day
    assert slots[0] == datetime(2026, 3, 3, 2, 0, tzinfo=UTC)
    assert all(s.tzinfo is not None for s in slots)


def test_generate_slots_rejects_bad_input():
    d = date(2026, 3, 2)
    with pytest.raises(ValueError):
        generate_slots(d, d, time(22), time(18), "UTC", 30)
    with pytest.raises(ValueError):
        generate_slots(d, d - timedelta(days=1), time(18), time(22), "UTC", 30)


def test_candidate_starts_require_full_duration_inside_window():
    slots = slots_for(date(2026, 3, 2), 18, 21)  # 6 slots
    starts = candidate_starts(slots, 30, 120)  # needs 4 slots
    assert starts == slots[:3]


def test_candidate_starts_do_not_span_days():
    d = date(2026, 3, 2)
    two_days = generate_slots(d, d + timedelta(days=1), time(20), time(22), "UTC", 60)
    starts = candidate_starts(two_days, 60, 180)  # 3h cannot fit a 2h window
    assert starts == []


def test_ranking_prefers_more_free_players():
    slots = slots_for(date(2026, 3, 2), 18, 20)  # 4 slots; 1h session -> 3 starts
    a = mark(slots)
    b = mark(slots[2:])  # only free from 19:00
    result = rank_candidates(slots, {1: a, 2: b}, [1, 2], [], 30, 60, 5, LONG_AGO)
    assert result.candidates[0].start == slots[2]
    assert result.candidates[0].free_ids == (1, 2)
    assert result.candidates[0].score == 4


def test_maybe_counts_less_than_free():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    avail = {1: mark(slots), 2: mark(slots, "maybe"), 3: mark(slots)}
    r = rank_candidates(slots, avail, [1, 2, 3], [], 30, 60, 5, LONG_AGO)
    best = r.candidates[0]
    assert best.free_count == 2 and best.maybe_count == 1 and best.score == 5


def test_one_maybe_slot_downgrades_the_whole_session():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    mixed = {s: "free" for s in slots}
    mixed[slots[1]] = "maybe"
    r = rank_candidates(slots, {1: mixed}, [1], [], 30, 60, 5, LONG_AGO)
    first = next(c for c in r.candidates if c.start == slots[0])
    assert first.maybe_ids == (1,) and first.free_ids == ()


def test_required_player_unavailable_drops_candidate():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    avail = {1: mark(slots), 2: mark(slots[:1])}
    r = rank_candidates(slots, avail, [1, 2], [2], 30, 60, 5, LONG_AGO)
    assert r.candidates == []
    assert r.dropped_required == r.total_considered == 3


def test_best_times_are_offered_even_when_few_people_fit():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    avail = {1: mark(slots), 2: mark(slots, "maybe")}
    r = rank_candidates(slots, avail, [1, 2, 3, 4, 5], [], 30, 60, 5, LONG_AGO)
    assert r.candidates and r.candidates[0].free_count == 1 and r.candidates[0].maybe_count == 1


def test_a_start_where_nobody_can_attend_is_dropped():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    r = rank_candidates(slots, {1: mark(slots[:1])}, [1, 2], [], 30, 60, 5, LONG_AGO)
    assert r.candidates == [] and r.dropped_nobody == r.total_considered == 3


def test_starts_that_have_already_begun_are_never_offered():
    slots = slots_for(date(2026, 3, 2), 18, 22)   # 8 slots, 1h session -> 7 starts
    now = slots[2]                                 # 19:00 has begun
    r = rank_candidates(slots, {1: mark(slots)}, [1], [], 30, 60, 10, now)
    assert r.skipped_past == 2 and all(c.start >= now for c in r.candidates)
    assert len(r.candidates) == 5


def test_everything_in_the_past_leaves_nothing():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    r = rank_candidates(slots, {1: mark(slots)}, [1], [], 30, 60, 5, slots[-1] + timedelta(days=1))
    assert r.candidates == [] and r.skipped_past == r.total_considered


def test_best_overlap_finds_the_biggest_group_even_if_too_short():
    slots = slots_for(date(2026, 3, 2), 18, 22)   # 18:00-22:00
    avail = {1: mark(slots[:4]), 2: mark(slots[2:6]), 3: mark(slots[2:3])}
    o = best_overlap(slots, avail, [1, 2, 3], 30, LONG_AGO)
    assert (o.people, o.start, o.end) == (3, slots[2], slots[3])   # all three, 19:00-19:30
    assert o.minutes == 30


def test_best_overlap_breaks_a_tie_on_group_size_with_the_longer_stretch():
    slots = slots_for(date(2026, 3, 2), 18, 22)
    avail = {1: mark(slots[:2] + slots[3:7]), 2: mark(slots[:2] + slots[3:7])}
    o = best_overlap(slots, avail, [1, 2, 3], 30, LONG_AGO)
    assert (o.people, o.start, o.minutes) == (2, slots[3], 120)


def test_best_overlap_ignores_the_past_and_empty_input():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    assert best_overlap(slots, {1: mark(slots)}, [1], 30, slots[-1] + timedelta(days=1)) is None
    assert best_overlap(slots, {}, [1], 30, LONG_AGO) is None


def test_ties_break_to_earliest_and_top_n_limits():
    slots = slots_for(date(2026, 3, 2), 18, 22)
    avail = {1: mark(slots)}
    r = rank_candidates(slots, avail, [1], [], 30, 60, 2, LONG_AGO)
    assert [c.start for c in r.candidates] == slots[:2]


def test_player_with_no_availability_counts_as_unavailable():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    r = rank_candidates(slots, {1: mark(slots)}, [1, 2], [], 30, 60, 5, LONG_AGO)
    assert r.candidates[0].free_ids == (1,)


# ---- marking a box red ("not available") is different from not answering, but ranks the same


def test_a_red_box_counts_as_unavailable_not_as_maybe():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    red = mark(slots, "no")
    r = rank_candidates(slots, {1: mark(slots), 2: red}, [1, 2], [], 30, 60, 5, LONG_AGO)
    best = r.candidates[0]
    assert best.free_ids == (1,) and best.maybe_ids == ()  # player 2 is in neither list


def test_one_red_box_inside_a_session_rules_the_player_out_of_it():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    mixed = mark(slots)
    mixed[slots[1]] = "no"
    r = rank_candidates(slots, {1: mixed}, [1], [], 30, 60, 5, LONG_AGO)
    starts = {c.start: c for c in r.candidates}
    assert slots[0] not in [c.start for c in r.candidates if 1 in c.free_ids + c.maybe_ids]   # 18:00-19:00 hits the red box
    assert 1 in starts[slots[2]].free_ids                                                    # 19:00-20:00 is clear


def test_a_required_player_who_marked_every_box_red_blocks_the_poll():
    slots = slots_for(date(2026, 3, 2), 18, 20)
    r = rank_candidates(slots, {1: mark(slots), 2: mark(slots, "no")}, [1, 2], [2], 30, 60, 5, LONG_AGO)
    assert r.candidates == [] and r.dropped_required == r.total_considered

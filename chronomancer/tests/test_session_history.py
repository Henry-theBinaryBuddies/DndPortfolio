"""Keeping history small without losing anything the app needs: the campaign page lists the latest
three held sessions (called-off polls are only counted), and the per-person availability of old finished
sessions is dropped. Sessions, votes and candidates are never deleted."""
import asyncio
import logging
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path

import pytest
from sqlalchemy import func, select

from app import background, config, services
from app.models import Availability, Candidate, Notification, Poll, Reminder, Vote

from conftest import login, make_client
from helpers import fresh, make_campaign, make_player, mark_all_free, open_poll, voting_poll
from test_recurrence import decided

WEB = Path(__file__).resolve().parent.parent / "web"
UTC = timezone.utc
NOW = datetime(2030, 6, 1, 12, tzinfo=UTC)


def held(db, campaign, days_ago):
    return decided(db, campaign, NOW - timedelta(days=days_ago), duration=60)


def called_off(db, campaign, n):
    for i in range(n):
        poll = open_poll_row(db, campaign)
        poll.status = "cancelled"
    db.commit()


def open_poll_row(db, campaign):
    poll = Poll(campaign_id=campaign.id, title="x", timezone="UTC", date_start=date(2030, 1, 1),
                date_end=date(2030, 1, 7), window_start=time(10), window_end=time(15), slot_minutes=30,
                duration_min=60, vote_top_n=3, status="collecting")
    db.add(poll)
    db.commit()
    return poll


def listed(db, campaign, **kw):
    db.expire_all()
    return services.recent_sessions(db.get(type(campaign), campaign.id), now=NOW, **kw)


# ------------------------------------------------ what the campaign page lists


def test_only_the_latest_three_held_sessions_are_listed_newest_first(db):
    campaign, _ = make_campaign(db)
    polls = [held(db, campaign, d) for d in (50, 40, 30, 20, 10)]
    result = listed(db, campaign)
    assert [p.id for p, _ in result["sessions"]] == [polls[4].id, polls[3].id, polls[2].id]
    assert {phase for _, phase in result["sessions"]} == {"held"} and result["hidden"] == 2


def test_open_polls_and_upcoming_sessions_are_always_listed_on_top(db):
    campaign, _ = make_campaign(db)
    for d in (50, 40, 30, 20, 10):
        held(db, campaign, d)
    upcoming = decided(db, campaign, NOW + timedelta(days=3))
    opened = open_poll_row(db, campaign)
    result = listed(db, campaign)
    assert [(p.id, ph) for p, ph in result["sessions"][:2]] == [(opened.id, "open"), (upcoming.id, "upcoming")]
    assert len(result["sessions"]) == 5 and result["hidden"] == 2


def test_called_off_polls_are_counted_not_listed(db):
    campaign, _ = make_campaign(db)
    a, b = held(db, campaign, 30), held(db, campaign, 20)
    called_off(db, campaign, 10)
    result = listed(db, campaign)
    assert [p.id for p, _ in result["sessions"]] == [b.id, a.id]
    assert result["called_off"] == 10 and result["hidden"] == 0


def test_a_run_of_reschedules_cannot_push_real_sessions_out(db):
    campaign, _ = make_campaign(db)
    real = [held(db, campaign, d) for d in (30, 20, 10)]
    called_off(db, campaign, 8)                          # newer than every real session
    result = listed(db, campaign)
    assert {p.id for p, _ in result["sessions"]} == {p.id for p in real}


def test_a_decided_session_is_upcoming_until_it_ends_then_held(db):
    campaign, _ = make_campaign(db)
    poll = decided(db, campaign, NOW - timedelta(minutes=30), duration=60)     # in progress
    assert services.session_phase(poll, NOW) == "upcoming"
    assert services.session_phase(poll, NOW + timedelta(minutes=31)) == "held"
    soon = decided(db, campaign, NOW + timedelta(hours=1))
    assert services.session_phase(soon, NOW) == "upcoming"


def test_the_number_shown_is_a_setting(db, monkeypatch):
    monkeypatch.setattr(config, "SESSIONS_SHOWN", 2)
    campaign, _ = make_campaign(db)
    for d in (30, 20, 10):
        held(db, campaign, d)
    result = listed(db, campaign)
    assert len(result["sessions"]) == 2 and result["hidden"] == 1


def test_listing_never_deletes_anything(db):
    campaign, _ = make_campaign(db)
    for d in (50, 40, 30, 20, 10):
        held(db, campaign, d)
    called_off(db, campaign, 4)
    listed(db, campaign)
    assert db.scalar(select(func.count()).select_from(Poll)) == 9


def test_the_api_reports_phases_and_the_counts(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    with fresh() as db:
        campaign = db.get(services.Campaign, cid)
        for d in (400, 300, 200, 100):
            decided(db, campaign, datetime.now(UTC) - timedelta(days=d), duration=60)
        for _ in range(3):
            open_poll_row(db, campaign).status = "cancelled"
        db.commit()
    body = client.get(f"/api/campaigns/{cid}").json()
    assert [p["phase"] for p in body["polls"]] == ["held"] * 3
    assert body["polls_hidden"] == 1 and body["polls_called_off"] == 3


# ------------------------------------------------ dropping old availability


def finished_poll(db, status="confirmed", superseded=True):
    """A finished session. By default everyone has since answered a newer poll, because a
    person's most recent answers are kept (they pre-fill their next poll) and only older ones go."""
    campaign, poll, users = voting_poll(db)
    if status == "confirmed":
        services.confirm_poll(db, poll)
    else:
        services.cancel_poll(db, poll)
    if superseded:
        newer = open_poll(db, campaign, date_start=date(2030, 6, 1))
        for user in users:
            mark_all_free(db, newer, user)
    return campaign, poll, users


def availability_rows(poll_id):
    with fresh() as db:
        return db.scalar(select(func.count()).select_from(Availability).where(Availability.poll_id == poll_id))


LONG_AFTER = datetime(2027, 6, 1, tzinfo=UTC)


def test_old_availability_of_a_decided_session_is_dropped_but_the_session_stays(db):
    campaign, poll, _ = finished_poll(db)
    assert availability_rows(poll.id) > 0
    with fresh() as other:
        candidates = other.scalar(select(func.count()).select_from(Candidate).where(Candidate.poll_id == poll.id))
        votes_before = other.scalar(select(func.count()).select_from(Vote))
        reminders_before = other.scalar(select(func.count()).select_from(Reminder))
        notifications_before = other.scalar(select(func.count()).select_from(Notification))
    removed = services.compact_finished_polls(db, now=LONG_AFTER)
    assert removed > 0 and availability_rows(poll.id) == 0
    with fresh() as other:
        assert other.get(Poll, poll.id).status == "confirmed"
        assert other.scalar(select(func.count()).select_from(Candidate).where(Candidate.poll_id == poll.id)) == candidates
        assert other.scalar(select(func.count()).select_from(Vote)) == votes_before
        assert other.scalar(select(func.count()).select_from(Reminder)) == reminders_before
        assert other.scalar(select(func.count()).select_from(Notification)) == notifications_before


def test_a_called_off_polls_availability_goes_too(db):
    _, poll, _ = finished_poll(db, status="cancelled")
    assert services.compact_finished_polls(db, now=LONG_AFTER) > 0 and availability_rows(poll.id) == 0


def test_recent_sessions_keep_their_availability_for_two_weeks(db):
    _, poll, _ = finished_poll(db)
    just_after = datetime.combine(poll.date_end, time(0), tzinfo=UTC) + timedelta(days=13)
    assert services.compact_finished_polls(db, now=just_after) == 0 and availability_rows(poll.id) > 0
    assert services.compact_finished_polls(db, now=just_after + timedelta(days=3)) > 0


def test_open_polls_are_never_compacted_however_old(db):
    campaign, poll, users = voting_poll(db)                          # voting: the grid is still on show
    campaign2, _ = make_campaign(db, guild="7000", channel="7001")
    collecting = open_poll(db, campaign2)
    mark_all_free(db, collecting, users[0])
    assert services.compact_finished_polls(db, now=LONG_AFTER) == 0
    assert availability_rows(poll.id) > 0 and availability_rows(collecting.id) > 0


def test_an_upcoming_session_is_not_compacted_even_if_its_poll_week_is_old(db):
    _, poll, _ = finished_poll(db)
    with fresh() as other:
        row = other.get(Poll, poll.id)
        row.confirmed_start_utc = datetime(2031, 1, 1, tzinfo=UTC)
        other.commit()
    assert services.compact_finished_polls(db, now=LONG_AFTER) == 0


def test_compacting_twice_does_nothing_the_second_time(db):
    _, poll, _ = finished_poll(db)
    first = services.compact_finished_polls(db, now=LONG_AFTER)
    assert first > 0 and services.compact_finished_polls(db, now=LONG_AFTER) == 0


def test_each_sweep_is_bounded_and_the_rest_waits_for_the_next(db):
    ids = []
    _, first, _ = finished_poll(db)
    ids.append(first.id)
    campaign, _ = make_campaign(db, guild="7000", channel="7001")
    users = [make_player(db, campaign, f"9{i}", f"P{i}") for i in range(2)]
    for i in range(3):
        poll = open_poll(db, campaign, date_start=date(2026, 12, 1 + i * 8))
        for u in users:
            mark_all_free(db, poll, u)
        poll.status = "cancelled"
        db.commit()
        ids.append(poll.id)
    first = services.compact_finished_polls(db, now=LONG_AFTER, max_polls=2)
    left = [i for i in ids if availability_rows(i)]
    assert first > 0 and len(left) == len(ids) - 2
    assert services.compact_finished_polls(db, now=LONG_AFTER, max_polls=10) > 0
    assert [i for i in ids if availability_rows(i)] == [ids[-1]]   # the newest answers are kept


def test_a_persons_latest_answers_are_kept_however_old(db):
    """They pre-fill the next poll, so a biweekly or monthly group still has something to copy."""
    _, poll, _ = finished_poll(db, superseded=False)
    assert services.compact_finished_polls(db, now=LONG_AFTER) == 0 and availability_rows(poll.id) > 0


def test_only_the_people_who_answered_a_newer_poll_lose_the_old_one(db):
    campaign, poll, users = finished_poll(db, superseded=False)
    newer = open_poll(db, campaign, date_start=date(2030, 6, 1))
    mark_all_free(db, newer, users[0])                       # only one person answered again
    before = availability_rows(poll.id)
    removed = services.compact_finished_polls(db, now=LONG_AFTER)
    assert 0 < removed < before and availability_rows(poll.id) == before - removed
    with fresh() as other:
        left = {u for (u,) in other.execute(select(Availability.user_id).where(Availability.poll_id == poll.id))}
    assert users[0].id not in left and left == {u.id for u in users[1:]}


def test_the_answers_of_someone_who_left_the_group_are_dropped_with_the_old_session(db):
    campaign, poll, users = finished_poll(db, superseded=False)
    with fresh() as other:
        member = other.scalar(select(services.Member).where(
            services.Member.campaign_id == campaign.id, services.Member.user_id == users[1].id))
        member.left_at = LONG_AFTER
        other.commit()
    services.compact_finished_polls(db, now=LONG_AFTER)
    with fresh() as other:
        left = {u for (u,) in other.execute(select(Availability.user_id).where(Availability.poll_id == poll.id))}
    assert users[1].id not in left and users[0].id in left


def test_the_delete_only_touches_polls_that_are_still_finished(db):
    """A poll that went back to collecting (it cannot normally) is never touched, even if selected."""
    _, poll, _ = finished_poll(db)
    real_execute = db.execute

    def flip_then_delete(stmt, *a, **kw):
        if getattr(stmt, "is_delete", False):
            with fresh() as other:
                other.get(Poll, poll.id).status = "collecting"
                other.commit()
        return real_execute(stmt, *a, **kw)

    db.execute = flip_then_delete
    try:
        assert services.compact_finished_polls(db, now=LONG_AFTER) == 0
    finally:
        db.execute = real_execute
    assert availability_rows(poll.id) > 0


# ------------------------------------------------ the page no longer says everyone is waiting


def test_a_closed_poll_does_not_report_who_answered(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json={
        "date_start": "2030-03-01", "window_start": "10:00:00", "window_end": "14:00:00", "duration_min": 60}).json()
    marks = [{"start": s, "level": "free"} for s in poll["slots"][:4]]
    client.put(f"/api/polls/{poll['id']}/availability", json={"slots": marks})
    open_view = client.get(f"/api/polls/{poll['id']}").json()
    assert [m["responded"] for m in open_view["members"]] == [True]
    client.post(f"/api/polls/{poll['id']}/close", json={})
    voting = client.get(f"/api/polls/{poll['id']}").json()
    assert [m["responded"] for m in voting["members"]] == [True]           # still shown while voting
    client.post(f"/api/polls/{poll['id']}/confirm", json={})
    done = client.get(f"/api/polls/{poll['id']}").json()
    assert [m["responded"] for m in done["members"]] == [None]


def test_the_poll_page_hides_the_answered_badge_when_the_server_says_nothing():
    page = (WEB / "poll.html").read_text(encoding="utf-8")
    assert "m.responded === null ? null" in page


def test_the_campaign_page_labels_sessions_and_explains_what_is_not_listed():
    page = (WEB / "campaign.html").read_text(encoding="utf-8")
    assert 'id="polls-note"' in page and "campaign.polls_hidden" in page and "campaign.polls_called_off" in page
    assert 'upcoming: "scheduled"' in page and 'held: "held"' in page


# ------------------------------------------------ the background sweep


def sweep_rig(monkeypatch):
    calls = []
    monkeypatch.setattr(background, "_compact", lambda: calls.append(1) or 5)
    return background.Background(), calls


def test_the_sweep_waits_a_minute_before_its_first_run_then_follows_its_interval(monkeypatch):
    bg, calls = sweep_rig(monkeypatch)
    clock = {"t": 1000.0}
    monkeypatch.setattr(background.time, "monotonic", lambda: clock["t"])
    asyncio.run(bg._compact_if_due())
    assert calls == []                                   # first tick only schedules
    clock["t"] += 30
    asyncio.run(bg._compact_if_due())
    assert calls == []
    clock["t"] += 31
    asyncio.run(bg._compact_if_due())
    assert calls == [1]
    clock["t"] += config.COMPACT_EVERY_SECONDS - 1
    asyncio.run(bg._compact_if_due())
    assert calls == [1]
    clock["t"] += 2
    asyncio.run(bg._compact_if_due())
    assert calls == [1, 1]


def test_the_sweep_can_be_switched_off(monkeypatch):
    bg, calls = sweep_rig(monkeypatch)
    monkeypatch.setattr(config, "COMPACT_ENABLED", False)
    monkeypatch.setattr(background.time, "monotonic", lambda: 10**9)
    for _ in range(3):
        asyncio.run(bg._compact_if_due())
    assert calls == [] and bg._next_compaction is None


def test_a_failing_sweep_is_logged_and_retried_later_not_every_tick(monkeypatch, caplog):
    clock = {"t": 0.0}
    monkeypatch.setattr(background.time, "monotonic", lambda: clock["t"])
    attempts = []

    def boom():
        attempts.append(1)
        raise RuntimeError("database is locked")

    monkeypatch.setattr(background, "_compact", boom)
    bg = background.Background()
    asyncio.run(bg._compact_if_due())
    clock["t"] += 61
    with caplog.at_level(logging.ERROR, logger="chronomancer.background"):
        asyncio.run(bg._compact_if_due())                # raises nothing
    assert attempts == [1] and "compaction failed" in caplog.text
    clock["t"] += 5                                      # the next ticks do not hammer it
    asyncio.run(bg._compact_if_due())
    assert attempts == [1]


def test_the_sweep_is_not_part_of_the_time_driven_tick():
    """It must not slow down confirming votes or scheduling sessions."""
    import inspect
    assert "compact" not in inspect.getsource(background._db_tick)

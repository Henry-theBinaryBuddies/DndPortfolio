"""A repeating group has one session lined up at a time. Cancelling a session, or two sessions
ending in a row, used to line up another one each time, so extras stacked up (two automatic
sessions beside an open poll) and cancelling them made more."""
from datetime import timedelta, timezone

from sqlalchemy import select

from app import services
from app.models import Poll

from helpers import open_poll
from test_recurrence import all_polls, decided, local, repeating
from test_series_and_attendance import SAT_11AM

UTC = timezone.utc


def scheduled(db, campaign, ignore=()):
    """Sessions still lined up (decided, not started), leaving out the 'earlier' ones a test made."""
    db.expire_all()
    return [p for p in all_polls(db) if p.status == "confirmed" and p.confirmed_start_utc > services.now_utc()
            and p.id not in ignore]


def test_cancelling_a_session_while_another_is_lined_up_adds_nothing(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    second = decided(db, campaign, SAT_11AM + timedelta(days=7), recurred_from=first.id)
    services.cancel_poll(db, first)
    assert [p.id for p in scheduled(db, campaign)] == [second.id]


def test_cancelling_the_only_session_still_lines_up_the_next_one(db):
    campaign, _ = repeating(db, "weekly")
    only = decided(db, campaign, SAT_11AM)
    services.cancel_poll(db, only)
    rest = scheduled(db, campaign)
    assert len(rest) == 1 and rest[0].recurred_from == only.id
    assert rest[0].confirmed_start_utc == (SAT_11AM + timedelta(days=7)).astimezone(UTC)


def test_cancelling_the_last_session_while_a_poll_is_open_adds_nothing(db):
    campaign, _ = repeating(db, "weekly")
    only = decided(db, campaign, SAT_11AM)
    open_poll(db, campaign)                                             # the open poll will decide the next one
    services.cancel_poll(db, only)
    assert scheduled(db, campaign) == []


def test_the_stray_pair_can_be_cleared_without_making_more(db):
    """Two automatic sessions beside an open poll, as seen on the group page."""
    campaign, _ = repeating(db, "weekly")
    seed = decided(db, campaign, SAT_11AM - timedelta(days=7))
    friday = decided(db, campaign, SAT_11AM + timedelta(days=6, hours=3), recurred_from=seed.id)
    saturday = decided(db, campaign, SAT_11AM + timedelta(days=7), recurred_from=seed.id)
    open_poll(db, campaign)
    services.cancel_poll(db, friday)
    services.cancel_poll(db, saturday)
    assert scheduled(db, campaign, ignore={seed.id}) == []
    assert services.clear_called_off(db, campaign) == 2


def test_two_sessions_that_end_in_a_row_line_up_only_one(db):
    campaign, _ = repeating(db, "weekly")
    a = decided(db, campaign, local(2030, 3, 2, 11))
    b = decided(db, campaign, local(2030, 3, 3, 11))                    # both are over by the time the sweep runs
    created = services.roll_recurrences(db, now=local(2030, 3, 4, 9).astimezone(UTC))
    assert len(created) == 1
    nxt = db.get(Poll, created[0])
    assert nxt.confirmed_start_utc > local(2030, 3, 4, 9).astimezone(UTC)


def test_changing_the_frequency_still_replans_one_session(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT_11AM)
    nxt = decided(db, campaign, SAT_11AM + timedelta(days=7), recurred_from=first.id)
    services.update_campaign(db, campaign, cadence="biweekly")
    rest = scheduled(db, campaign, ignore={first.id})
    assert len(rest) == 1 and rest[0].confirmed_start_utc == (SAT_11AM + timedelta(days=14)).astimezone(UTC)
    assert db.get(Poll, nxt.id).status == "cancelled"


def test_deciding_a_poll_still_replaces_the_automatic_sessions(db):
    campaign, _ = repeating(db, "weekly")
    seed = decided(db, campaign, SAT_11AM - timedelta(days=7))
    auto = decided(db, campaign, SAT_11AM + timedelta(days=7), recurred_from=seed.id)
    services.supersede_auto_sessions(db, campaign.id, keep_id=0)
    assert db.get(Poll, auto.id).status == "cancelled"

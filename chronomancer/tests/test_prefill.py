"""A new poll starts with a draft copied from the person's last answers in the group. The draft is
never stored: nothing counts until they look it over and press Save."""
from datetime import date, datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

from sqlalchemy import select

from app import services
from app.models import Availability
from conftest import login, make_client
from helpers import make_campaign, make_player, open_poll

ROOT = Path(__file__).resolve().parent.parent
UTC = timezone.utc
LONG_AGO = datetime(2026, 1, 1, tzinfo=UTC)
MON = date(2031, 3, 3)          # a Monday


def answer(db, poll, user, picks):
    """picks: {(day_offset, hour, minute): level} on the poll's own clock."""
    tz = ZoneInfo(poll.timezone)
    for (offset, hour, minute), level in picks.items():
        local = datetime.combine(poll.date_start + timedelta(days=offset), time(hour, minute), tzinfo=tz)
        db.add(Availability(poll_id=poll.id, user_id=user.id, slot_start_utc=local.astimezone(UTC), level=level))
    db.commit()


def next_poll(db, campaign, previous, **overrides):
    services.cancel_poll(db, previous)
    return open_poll(db, campaign, **overrides)


def local(slot, tz="UTC"):
    return slot.astimezone(ZoneInfo(tz))


def base(db, **first):
    campaign, owner = make_campaign(db)
    args = dict(date_start=MON, window_start=time(12), window_end=time(18), duration_min=60)
    args.update(first)
    poll = open_poll(db, campaign, **args)
    return campaign, owner, poll


def test_the_draft_lands_on_the_same_weekdays_and_times_of_the_next_week(db):
    campaign, owner, first = base(db)
    answer(db, first, owner, {(0, 12, 0): "free", (1, 13, 30): "maybe", (2, 12, 0): "no"})
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7),
                       window_start=time(12), window_end=time(18), duration_min=60)
    found = services.suggest_availability(db, second, owner, now=LONG_AGO)
    got = {(local(s).date(), local(s).hour, local(s).minute): level for s, level in found["marks"].items()}
    assert got == {(MON + timedelta(days=7), 12, 0): "free",
                   (MON + timedelta(days=8), 13, 30): "maybe",
                   (MON + timedelta(days=9), 12, 0): "no"}
    assert found["from_title"] == first.title and found["from_start"] == MON
    assert db.scalars(select(Availability).where(Availability.poll_id == second.id)).first() is None   # not stored


def test_a_week_that_starts_on_another_weekday_still_matches_by_weekday(db):
    campaign, owner, first = base(db)
    answer(db, first, owner, {(0, 12, 0): "free"})                       # a Monday
    wed = MON + timedelta(days=9)                                        # the new week starts on a Wednesday
    second = next_poll(db, campaign, first, date_start=wed, window_start=time(12), window_end=time(18),
                       duration_min=60)
    found = services.suggest_availability(db, second, owner, now=LONG_AGO)
    assert [(local(s).date(), local(s).weekday()) for s in found["marks"]] == [(MON + timedelta(days=14), 0)]


def test_daylight_saving_does_not_shift_the_clock_time(db):
    campaign, owner, first = base(db, tz="America/Los_Angeles")          # US clocks change on 9 March 2031
    answer(db, first, owner, {(0, 12, 0): "free", (6, 12, 0): "free"})
    second = next_poll(db, campaign, first, tz="America/Los_Angeles", date_start=MON + timedelta(days=7),
                       window_start=time(12), window_end=time(18), duration_min=60)
    found = services.suggest_availability(db, second, owner, now=LONG_AGO)
    clocks = sorted((local(s, "America/Los_Angeles").date(), local(s, "America/Los_Angeles").time()) for s in found["marks"])
    assert clocks == [(MON + timedelta(days=7), time(12)), (MON + timedelta(days=13), time(12))]
    # the UTC instant moved by an hour: 12:00 before the change was 20:00 UTC, after it 19:00 UTC
    source = db.scalar(select(Availability.slot_start_utc).where(
        Availability.poll_id == first.id).order_by(Availability.slot_start_utc))
    assert source.hour == 20 and sorted(s.hour for s in found["marks"]) == [19, 19]


def test_the_most_recent_poll_with_answers_is_the_one_copied(db):
    campaign, owner, first = base(db)
    answer(db, first, owner, {(0, 12, 0): "free"})
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7),
                       window_start=time(12), window_end=time(18), duration_min=60)
    answer(db, second, owner, {(1, 14, 0): "maybe"})
    third = next_poll(db, campaign, second, date_start=MON + timedelta(days=14),
                      window_start=time(12), window_end=time(18), duration_min=60)
    found = services.suggest_availability(db, third, owner, now=LONG_AGO)
    assert found["from_start"] == MON + timedelta(days=7)
    assert [(local(s).weekday(), local(s).hour, level) for s, level in found["marks"].items()] == [(1, 14, "maybe")]


def test_a_poll_the_person_never_answered_is_skipped(db):
    campaign, owner, first = base(db)
    answer(db, first, owner, {(0, 12, 0): "free"})
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7),
                       window_start=time(12), window_end=time(18), duration_min=60)       # they never answered it
    third = next_poll(db, campaign, second, date_start=MON + timedelta(days=14),
                      window_start=time(12), window_end=time(18), duration_min=60)
    assert services.suggest_availability(db, third, owner, now=LONG_AGO)["from_start"] == MON


def test_nothing_to_copy_for_a_new_member_or_a_first_poll(db):
    campaign, owner, first = base(db)
    assert services.suggest_availability(db, first, owner, now=LONG_AGO) is None
    answer(db, first, owner, {(0, 12, 0): "free"})
    newcomer = make_player(db, campaign, "9", "Newcomer")
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7),
                       window_start=time(12), window_end=time(18), duration_min=60)
    assert services.suggest_availability(db, second, newcomer, now=LONG_AGO) is None


def test_boxes_that_have_already_begun_are_not_copied(db):
    campaign, owner, first = base(db)
    answer(db, first, owner, {(0, 12, 0): "free", (2, 12, 0): "free"})
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7),
                       window_start=time(12), window_end=time(18), duration_min=60)
    now = datetime.combine(MON + timedelta(days=8), time(0), tzinfo=UTC)               # the Monday has passed
    found = services.suggest_availability(db, second, owner, now=now)
    assert [local(s).weekday() for s in found["marks"]] == [2]


def test_wider_hours_leave_the_new_boxes_blank_and_are_counted(db):
    campaign, owner, first = base(db)                                                  # 12:00-18:00
    answer(db, first, owner, {(0, 12, 0): "free"})
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7),
                       window_start=time(10), window_end=time(18), duration_min=60)    # 10:00-18:00
    found = services.suggest_availability(db, second, owner, now=LONG_AGO)
    assert found["outside"] == 4 * 7                                                   # 10:00-12:00, seven days
    assert all(local(s).hour >= 12 for s in found["marks"])


def test_an_unmarked_box_stays_unmarked(db):
    campaign, owner, first = base(db)
    answer(db, first, owner, {(0, 12, 0): "free"})
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7),
                       window_start=time(12), window_end=time(18), duration_min=60)
    found = services.suggest_availability(db, second, owner, now=LONG_AGO)
    assert len(found["marks"]) == 1 and found["outside"] == 0


def test_a_coarser_box_takes_the_most_cautious_of_the_boxes_it_covers(db):
    campaign, owner, first = base(db, slot_minutes=30)
    answer(db, first, owner, {(0, 12, 0): "free", (0, 12, 30): "maybe", (0, 13, 0): "free"})   # 13:30 unmarked
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7), slot_minutes=60,
                       window_start=time(12), window_end=time(18), duration_min=60)
    found = services.suggest_availability(db, second, owner, now=LONG_AGO)
    assert {(local(s).hour, level) for s, level in found["marks"].items()} == {(12, "maybe")}   # 13:00 needs 13:30 too


def test_a_finer_box_takes_the_answer_of_the_box_that_contains_it(db):
    campaign, owner, first = base(db, slot_minutes=60)
    answer(db, first, owner, {(0, 12, 0): "free"})
    second = next_poll(db, campaign, first, date_start=MON + timedelta(days=7), slot_minutes=30,
                       window_start=time(12), window_end=time(18), duration_min=60)
    found = services.suggest_availability(db, second, owner, now=LONG_AGO)
    assert {(local(s).hour, local(s).minute) for s in found["marks"]} == {(12, 0), (12, 30)}


# ---- through the API


def test_the_api_offers_a_draft_until_the_person_saves(client):
    login(client, "1", "Dana")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    body = {"title": "Week one", "timezone": "UTC", "date_start": "2031-03-03", "window_start": "12:00:00",
            "window_end": "18:00:00", "duration_min": 60}
    first = client.post(f"/api/campaigns/{cid}/polls", json=body).json()
    assert first["suggestion"] is None
    picks = [s for s in first["slots"] if s.startswith("2031-03-03T12")]
    client.put(f"/api/polls/{first['id']}/availability", json={"slots": [{"start": s, "level": "free"} for s in picks]})
    assert client.post(f"/api/polls/{first['id']}/cancel").status_code == 200
    second = client.post(f"/api/campaigns/{cid}/polls", json={**body, "title": "Week two", "date_start": "2031-03-10"}).json()
    draft = second["suggestion"]
    assert draft["from_title"] == "Week one" and draft["from_start"] == "2031-03-03"
    assert sorted(draft["marks"]) == ["2031-03-10T12:00:00Z", "2031-03-10T12:30:00Z"]
    assert second["my_availability"] == {} and second["slot_counts"] == {} and second["slot_people"] == {}
    # nothing is stored, so the draft is still offered, and the person still counts as waiting
    again = client.get(f"/api/polls/{second['id']}").json()
    assert again["suggestion"] == draft and again["members"][0]["responded"] is False
    # once they save, the draft goes away and their saved marks are what count
    client.put(f"/api/polls/{second['id']}/availability", json={"slots": [{"start": "2031-03-10T13:00:00Z", "level": "maybe"}]})
    saved = client.get(f"/api/polls/{second['id']}").json()
    assert saved["suggestion"] is None and saved["my_availability"] == {"2031-03-10T13:00:00Z": "maybe"}
    assert saved["members"][0]["responded"] is True


def test_other_members_never_see_someones_draft(client):
    login(client, "1", "Dana")
    campaign = client.post("/api/campaigns", json={"name": "x"}).json()
    body = {"timezone": "UTC", "date_start": "2031-03-03", "window_start": "12:00:00",
            "window_end": "18:00:00", "duration_min": 60}
    first = client.post(f"/api/campaigns/{campaign['id']}/polls", json=body).json()
    client.put(f"/api/polls/{first['id']}/availability",
               json={"slots": [{"start": first["slots"][0], "level": "free"}]})
    client.post(f"/api/polls/{first['id']}/cancel")
    second = client.post(f"/api/campaigns/{campaign['id']}/polls", json={**body, "date_start": "2031-03-10"}).json()
    aria = make_client()
    login(aria, "2", "Aria")
    aria.post("/api/join", json={"invite_code": campaign["invite_code"]})
    view = aria.get(f"/api/polls/{second['id']}").json()
    assert view["suggestion"] is None and view["slot_people"] == {} and view["slot_counts"] == {}


def test_a_poll_that_is_no_longer_collecting_offers_no_draft(client):
    login(client, "1", "Dana")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    body = {"timezone": "UTC", "date_start": "2031-03-03", "window_start": "12:00:00",
            "window_end": "18:00:00", "duration_min": 60}
    first = client.post(f"/api/campaigns/{cid}/polls", json=body).json()
    client.put(f"/api/polls/{first['id']}/availability", json={"slots": [{"start": first["slots"][0], "level": "free"}]})
    client.post(f"/api/polls/{first['id']}/cancel")
    second = client.post(f"/api/campaigns/{cid}/polls", json={**body, "date_start": "2031-03-10"}).json()
    client.post(f"/api/polls/{second['id']}/cancel")
    assert client.get(f"/api/polls/{second['id']}").json()["suggestion"] is None


# ---- the page and the policy


def test_the_poll_page_marks_a_draft_unsaved_and_warns_before_leaving():
    page = (ROOT / "web" / "poll.html").read_text(encoding="utf-8")
    for needle in ("draft-banner", "Not saved yet", "beforeunload", "grid.loadMarks(poll.suggestion.marks)",
                   "Nothing counts until you do", 'id="draft-blank"'):
        assert needle in page, needle
    assert "loadMarks" in (ROOT / "web" / "js" / "grid.js").read_text(encoding="utf-8")


def test_the_privacy_page_explains_that_the_latest_answers_are_kept():
    text = (ROOT / "web" / "privacy.html").read_text(encoding="utf-8").lower()
    assert "most recent answers" in text and "fill in" in text

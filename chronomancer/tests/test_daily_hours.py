"""Polls default to the whole day, an end of 00:00 means the end of the day, and the organizer can
change a collecting poll's hours without losing anyone's marks."""
from datetime import date, datetime, time, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from app import services
from app.bot import actions
from app.bot.actions import DUser
from app.scheduling import generate_slots
from app.services import ServiceError

from conftest import login, make_client
from helpers import CHANNEL, GUILD, make_campaign, make_player, open_poll

ROOT = Path(__file__).resolve().parent.parent
DM = DUser("1", "Dungeon Master", can_manage=True)
POLL = {"date_start": "2026-12-01", "window_start": "18:00:00", "window_end": "22:00:00",
        "duration_min": 60}


# ------------------------------------------------ the end of the day


def test_zero_to_zero_is_the_whole_day():
    slots = generate_slots(date(2026, 12, 1), date(2026, 12, 1), time(0), time(0), "UTC", 30)
    assert len(slots) == 48 and slots[0].hour == 0 and slots[-1] == datetime(2026, 12, 1, 23, 30, tzinfo=timezone.utc)


def test_an_end_of_midnight_covers_the_last_slot_of_the_evening():
    slots = generate_slots(date(2026, 12, 1), date(2026, 12, 1), time(22), time(0), "UTC", 30)
    assert [s.strftime("%H:%M") for s in slots] == ["22:00", "22:30", "23:00", "23:30"]


def test_an_end_before_the_start_is_still_rejected():
    with pytest.raises(ValueError):
        generate_slots(date(2026, 12, 1), date(2026, 12, 1), time(22), time(18), "UTC", 30)


def test_the_whole_day_follows_the_zone_through_a_daylight_saving_change():
    slots = generate_slots(date(2026, 3, 8), date(2026, 3, 8), time(0), time(0), "America/Los_Angeles", 60)
    assert len(slots) == 23  # the day the clocks spring forward is 23 hours long


# ------------------------------------------------ the slash command


def test_the_slash_command_defaults_to_the_whole_day(db):
    make_campaign(db)
    reply = actions.cmd_poll(db, DM, GUILD, CHANNEL, None, "00:00", "24:00", "")
    poll = services.current_poll(db, services.campaign_for_channel(db, GUILD, CHANNEL).id)
    assert (poll.window_start, poll.window_end) == (time(0), time(0))
    assert "00:00 to 24:00" in reply.text and len(services.poll_slots(poll)) == 7 * 48


def test_the_command_registers_whole_day_defaults():
    source = (ROOT / "app" / "bot" / "commands.py").read_text(encoding="utf-8")
    assert 'start: str = "00:00", end: str = "24:00"' in source


def test_the_end_of_day_can_be_typed_as_24(db):
    make_campaign(db)
    actions.cmd_poll(db, DM, GUILD, CHANNEL, None, "08:00", "24:00", "")
    poll = services.current_poll(db, services.campaign_for_channel(db, GUILD, CHANNEL).id)
    assert (poll.window_start, poll.window_end) == (time(8), time(0))


def test_a_bad_end_names_the_24_option(db):
    make_campaign(db)
    with pytest.raises(ServiceError) as err:
        actions.cmd_poll(db, DM, GUILD, CHANNEL, None, "08:00", "25:00", "")
    assert "24:00" in str(err.value.detail)


# ------------------------------------------------ changing hours after creating the poll


def two_players(db):
    campaign = make_campaign(db)
    organizer = services.upsert_user(db, "1", "Dungeon Master")
    return campaign, organizer


def test_the_organizer_can_move_the_hours_of_a_collecting_poll(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json=POLL).json()
    assert (poll["window_start"], poll["window_end"]) == ("18:00", "22:00") and len(poll["slots"]) == 56
    changed = client.patch(f"/api/polls/{poll['id']}", json={"window_start": "09:00:00", "window_end": "00:00:00"})
    assert changed.status_code == 200
    body = changed.json()
    assert (body["window_start"], body["window_end"]) == ("09:00", "00:00") and len(body["slots"]) == 7 * 30


def test_only_the_organizer_may_change_hours(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    poll = client.post(f"/api/campaigns/{camp['id']}/polls", json=POLL).json()
    player = make_client()
    login(player, "2", "Aria")
    player.post("/api/join", json={"invite_code": camp["invite_code"]})
    r = player.patch(f"/api/polls/{poll['id']}", json={"window_start": "00:00:00", "window_end": "00:00:00"})
    assert r.status_code == 403
    outsider = make_client()
    login(outsider, "3", "Nobody")
    assert outsider.patch(f"/api/polls/{poll['id']}",
                          json={"window_start": "00:00:00", "window_end": "00:00:00"}).status_code == 404


def test_hours_cannot_change_once_voting_has_begun(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json=POLL).json()
    marks = [{"start": s, "level": "free"} for s in poll["slots"][:2]]  # a full hour
    client.put(f"/api/polls/{poll['id']}/availability", json={"slots": marks})
    assert client.post(f"/api/polls/{poll['id']}/close", json={}).status_code == 200
    r = client.patch(f"/api/polls/{poll['id']}", json={"window_start": "00:00:00", "window_end": "00:00:00"})
    assert r.status_code == 409


def test_hours_that_cannot_hold_a_session_are_refused_and_nothing_changes(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json={**POLL, "duration_min": 120}).json()
    for hours in ({"window_start": "10:00:00", "window_end": "11:00:00"},     # shorter than a session
                  {"window_start": "22:00:00", "window_end": "18:00:00"}):    # backwards
        assert client.patch(f"/api/polls/{poll['id']}", json=hours).status_code == 422
    again = client.get(f"/api/polls/{poll['id']}").json()
    assert (again["window_start"], again["window_end"]) == ("18:00", "22:00")


def test_marks_outside_new_hours_are_hidden_not_lost(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json=POLL).json()
    evening, late = poll["slots"][0], poll["slots"][5]  # 18:00 and 20:30 on the first day
    marks = [{"start": s, "level": "free"} for s in (evening, late)]
    client.put(f"/api/polls/{poll['id']}/availability", json={"slots": marks})
    narrowed = client.patch(f"/api/polls/{poll['id']}", json={"window_start": "18:00:00", "window_end": "19:00:00"}).json()
    assert set(narrowed["my_availability"]) == {evening}          # the late mark is not shown...
    assert late not in narrowed["slot_counts"]                    # ...or counted
    client.put(f"/api/polls/{poll['id']}/availability", json={"slots": [{"start": evening, "level": "maybe"}]})
    widened = client.patch(f"/api/polls/{poll['id']}", json={"window_start": "18:00:00", "window_end": "22:00:00"}).json()
    assert widened["my_availability"] == {evening: "maybe", late: "free"}   # saving left it alone


def test_the_poll_page_has_an_hours_editor_for_the_organizer():
    page = (ROOT / "web" / "poll.html").read_text(encoding="utf-8")
    assert 'id="hours-form"' in page and "Api.patch(`/api/polls/${id}`" in page
    assert '!(organizerHere && collecting)' in page


def test_the_new_poll_form_starts_with_the_whole_day():
    page = (ROOT / "web" / "campaign.html").read_text(encoding="utf-8")
    assert 'name="window_start" type="time" value="00:00"' in page
    assert 'name="window_end" type="time" value="00:00"' in page

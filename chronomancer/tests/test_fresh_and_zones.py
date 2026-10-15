"""Browsers must never run stale pages, and a poll's hours mean the organizer's own clock while
every player sees the same instants in their own timezone."""
from datetime import datetime, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import pytest

from conftest import login, make_client

ROOT = Path(__file__).resolve().parent.parent
LA = ZoneInfo("America/Los_Angeles")


# ------------------------------------------------ no stale pages


@pytest.mark.parametrize("path", ["/", "/poll.html", "/campaign.html", "/js/grid.js", "/js/api.js",
                                  "/css/base.css", "/css/themes/dnd.css", "/themes/dnd.json"])
def test_every_page_script_and_style_must_be_revalidated(client, path):
    r = client.get(path)
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-cache"
    assert "etag" in r.headers  # so the check costs a 304, not a download


def test_an_unchanged_file_is_answered_with_a_cheap_304(client):
    first = client.get("/js/grid.js")
    again = client.get("/js/grid.js", headers={"If-None-Match": first.headers["etag"]})
    assert again.status_code == 304 and again.headers["cache-control"] == "no-cache"


def test_a_changed_file_is_not_answered_from_an_old_copy(client):
    r = client.get("/js/grid.js", headers={"If-None-Match": '"some-old-version"'})
    assert r.status_code == 200 and "AvailabilityGrid" in r.text


# ------------------------------------------------ the organizer's clock


POLL = {"date_start": "2026-10-15", "window_start": "08:00:00", "window_end": "23:00:00",
        "duration_min": 30}


def local_hours(slots, zone):
    parsed = [datetime.fromisoformat(s.replace("Z", "+00:00")).astimezone(zone) for s in slots]
    return parsed[0].strftime("%H:%M"), parsed[-1].strftime("%H:%M")


def test_a_pacific_organizer_who_picks_8am_to_11pm_gets_exactly_those_hours(client):
    login(client, "1", "DM", tz="America/Los_Angeles")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json=POLL).json()      # no zone sent: profile's
    assert poll["timezone"] == "America/Los_Angeles"
    assert local_hours(poll["slots"][:30], LA) == ("08:00", "22:30")           # last 30-min slot ends at 23:00


def test_the_browsers_zone_sent_with_the_poll_wins_over_a_stale_profile(client):
    """What the poll form now does: the profile may still say UTC, but the hours are theirs."""
    login(client, "1", "DM", tz="UTC")                                         # profile never updated
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    client.put("/api/me", json={"timezone": "America/Los_Angeles"})            # the form reports it first
    poll = client.post(f"/api/campaigns/{cid}/polls",
                       json={**POLL, "timezone": "America/Los_Angeles"}).json()
    assert poll["timezone"] == "America/Los_Angeles"
    assert local_hours(poll["slots"][:30], LA) == ("08:00", "22:30")
    assert client.get("/api/me").json()["timezone"] == "America/Los_Angeles"


def test_the_bug_report_a_utc_poll_looks_shifted_to_a_pacific_viewer(client):
    """Why 08:00-23:00 showed up as 01:00-15:00: the poll was saved with the UTC default."""
    login(client, "1", "DM", tz="UTC")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json=POLL).json()
    assert poll["timezone"] == "UTC"
    assert local_hours(poll["slots"][:30], LA) == ("01:00", "15:30")


def test_every_player_gets_the_same_instants_to_show_in_their_own_zone(client):
    login(client, "1", "DM", tz="America/Los_Angeles")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    poll = client.post(f"/api/campaigns/{camp['id']}/polls", json=POLL).json()
    tokyo, london = make_client(), make_client()
    login(tokyo, "2", "Aria", tz="Asia/Tokyo")
    login(london, "3", "Borin", tz="Europe/London")
    for c in (tokyo, london):
        c.post("/api/join", json={"invite_code": camp["invite_code"]})
    seen = [c.get(f"/api/polls/{poll['id']}").json()["slots"] for c in (client, tokyo, london)]
    assert seen[0] == seen[1] == seen[2]                  # one set of UTC instants for everyone...
    tz = ZoneInfo("Asia/Tokyo")
    assert local_hours(seen[1][:30], tz) == ("00:00", "14:30")   # ...which Tokyo reads in its own time
    assert local_hours(seen[2][:30], ZoneInfo("Europe/London")) == ("16:00", "06:30")   # BST until Oct 25


# ------------------------------------------------ the pages do what the server expects


def test_the_poll_form_reports_the_browsers_timezone_before_creating_the_poll():
    page = (ROOT / "web" / "campaign.html").read_text(encoding="utf-8")
    put = page.index('Api.put("/api/me", { timezone: zone })')
    post = page.index("Api.post(`/api/campaigns/${id}/polls`")
    assert put < post and "timezone: zone" in page[post:post + 300]


def test_the_poll_page_explains_when_the_hours_were_set_in_another_zone():
    page = (ROOT / "web" / "poll.html").read_text(encoding="utf-8")
    assert 'id="tz-note"' in page and "poll.timezone === here" in page

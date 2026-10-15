"""One-week polls, meeting-frequency arithmetic, campaign settings and the command surface."""
import asyncio
from datetime import date

import pytest

from app import services
from app.services import ServiceError, add_cadence

from conftest import login, make_client
from helpers import make_campaign, open_poll


# ------------------------------------------------ a poll is exactly one week


def test_every_poll_covers_seven_days_from_the_start_date(db):
    campaign, _ = make_campaign(db)
    poll = open_poll(db, campaign, date_start=date(2026, 12, 1))
    assert poll.date_start == date(2026, 12, 1) and poll.date_end == date(2026, 12, 7)
    days = {s.date() for s in services.poll_slots(poll)}
    assert len(days) == 7 and min(days) == date(2026, 12, 1) and max(days) == date(2026, 12, 7)


def test_the_api_ignores_a_client_supplied_end_date(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    body = {"timezone": "UTC", "date_start": "2026-12-01", "date_end": "2027-03-01",
            "window_start": "18:00:00", "window_end": "22:00:00", "duration_min": 120}
    poll = client.post(f"/api/campaigns/{cid}/polls", json=body).json()
    days = sorted({s[:10] for s in poll["slots"]})
    assert days == [f"2026-12-0{d}" for d in range(1, 8)]  # a week, not the three months asked for


def test_a_poll_without_a_timezone_uses_the_organizers_own(client):
    login(client, "1", "DM", tz="Asia/Tokyo")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json={
        "date_start": "2026-12-01", "window_start": "18:00:00", "window_end": "22:00:00",
        "duration_min": 120}).json()
    assert poll["timezone"] == "Asia/Tokyo"


# ------------------------------------------------ meeting frequency arithmetic


@pytest.mark.parametrize("cadence,start,expected", [
    ("weekly", date(2026, 10, 24), date(2026, 10, 31)),
    ("biweekly", date(2026, 10, 24), date(2026, 11, 7)),
    ("monthly", date(2026, 10, 24), date(2026, 11, 24)),
    ("monthly", date(2026, 1, 31), date(2026, 2, 28)),       # short month: clamp, never overflow
    ("monthly", date(2028, 1, 31), date(2028, 2, 29)),       # leap year
    ("monthly", date(2026, 12, 15), date(2027, 1, 15)),      # year rollover
    ("quarterly", date(2026, 11, 30), date(2027, 2, 28)),
    ("annually", date(2026, 10, 24), date(2027, 10, 24)),
    ("annually", date(2028, 2, 29), date(2029, 2, 28)),      # leap day
    ("none", date(2026, 10, 24), None),
])
def test_add_cadence(cadence, start, expected):
    assert add_cadence(start, cadence) == expected


# ------------------------------------------------ campaign settings


def test_update_campaign_changes_only_what_is_given(db):
    campaign, _ = make_campaign(db)
    services.update_campaign(db, campaign, cadence="monthly")
    assert (campaign.cadence, campaign.min_quorum, campaign.default_duration_min) == ("monthly", 2, 180)
    services.update_campaign(db, campaign, min_quorum=1, name="  Renamed  ")
    assert (campaign.cadence, campaign.min_quorum, campaign.name) == ("monthly", 1, "Renamed")


@pytest.mark.parametrize("bad", [
    dict(cadence="hourly"), dict(min_quorum=0), dict(min_quorum=51), dict(default_duration_min=14),
    dict(name=" "), dict(name="x" * 121),
    dict(reminder_offsets_min=[0]), dict(reminder_offsets_min=[1] * 6),
    dict(reminder_offsets_min=[60 * 24 * 31]),
])
def test_one_bad_setting_rejects_the_whole_update(db, bad):
    campaign, _ = make_campaign(db)
    before = (campaign.name, campaign.cadence, campaign.min_quorum)
    valid_change = {"cadence": "weekly"} if "cadence" not in bad else {"min_quorum": 1}
    with pytest.raises(ServiceError) as exc:
        services.update_campaign(db, campaign, **valid_change, **bad)  # a good value plus a bad one
    assert exc.value.status == 422
    assert (campaign.name, campaign.cadence, campaign.min_quorum) == before


def test_create_campaign_validates_before_writing(db):
    owner = services.upsert_user(db, "1", "DM")
    with pytest.raises(ServiceError):
        services.create_campaign(db, owner, name="x", cadence="hourly")
    with pytest.raises(ServiceError):
        services.create_campaign(db, owner, name=" ")
    assert services.campaign_for_channel(db, "g", "c") is None


def test_patch_endpoint_changes_any_subset(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    r = client.patch(f"/api/campaigns/{camp['id']}", json={"cadence": "weekly", "reminder_offsets_min": [30, 2880]})
    body = r.json()
    assert r.status_code == 200 and body["cadence"] == "weekly"
    assert body["reminder_offsets_min"] == [2880, 30] and body["min_quorum"] == 2  # untouched
    r = client.patch(f"/api/campaigns/{camp['id']}", json={"min_quorum": 1, "default_duration_min": 90})
    assert (r.json()["min_quorum"], r.json()["default_duration_min"], r.json()["cadence"]) == (1, 90, "weekly")


def test_patch_endpoint_validation_and_permissions(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    url = f"/api/campaigns/{camp['id']}"
    for bad in ({"cadence": "daily"}, {"min_quorum": 0},
                {"reminder_offsets_min": [0]}, {"reminder_offsets_min": [1] * 6}, {"theme": "klingon"},
                {"default_duration_min": 5}):
        assert client.patch(url, json=bad).status_code == 422, bad
    assert client.get(url).json()["cadence"] == "none"  # nothing leaked through
    player = make_client()
    login(player, "2", "Aria")
    player.post("/api/join", json={"invite_code": camp["invite_code"]})
    assert player.patch(url, json={"cadence": "weekly"}).status_code == 403
    outsider = make_client()
    login(outsider, "3", "Stranger")
    assert outsider.patch(url, json={"cadence": "weekly"}).status_code == 404


def test_the_old_per_field_endpoints_are_gone(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    assert client.put(f"/api/campaigns/{cid}/cadence", json={"cadence": "weekly"}).status_code in (404, 405)
    assert client.put(f"/api/campaigns/{cid}/reminders", json={"offsets_min": [5]}).status_code in (404, 405)


# ------------------------------------------------ the command surface


def test_exactly_the_six_documented_commands_are_registered():
    import discord
    from discord import app_commands
    from app.bot import commands

    class Dummy(discord.Client):
        pass

    async def build():
        tree = app_commands.CommandTree(Dummy(intents=discord.Intents.none()))
        commands.register(tree)
        top = {c.name: c for c in tree.get_commands()}
        group = top["chronomancer"]
        return top, {c.name: c for c in group.commands}

    top, sub = asyncio.run(build())
    assert set(top) == {"chronomancer", "schedule"}
    assert set(sub) == {"setup", "poll", "advance", "cancel", "unlink"}

    setup = {p.name: p for p in sub["setup"].parameters}
    assert set(setup) == {"name", "code", "frequency", "quorum", "length", "reminders", "theme", "events"}
    assert not any(p.required for p in setup.values())  # every option is optional
    assert {c.value for c in setup["frequency"].choices} == {
        "none", "weekly", "biweekly", "monthly", "quarterly", "annually"}

    poll = {p.name: p for p in sub["poll"].parameters}
    assert set(poll) == {"week_start", "start", "end", "title"}  # length/quorum/timezone live in setup
    assert not poll["week_start"].required

# ------------------------------------------------ timezones: stored in UTC, shown in the viewer's zone


def test_the_browser_reports_its_timezone_and_it_is_remembered(client):
    login(client, "1", "DM")                              # logged in with the default UTC
    assert client.get("/api/me").json()["timezone"] == "UTC"
    r = client.put("/api/me", json={"timezone": "America/Los_Angeles"})
    assert r.status_code == 200 and r.json()["timezone"] == "America/Los_Angeles"
    assert client.get("/api/me").json()["timezone"] == "America/Los_Angeles"


@pytest.mark.parametrize("bad", ["Mars/Base", "x" * 100, "", "../../etc/passwd"])
def test_a_bogus_browser_timezone_is_refused(client, bad):
    login(client, "1", "DM")
    assert client.put("/api/me", json={"timezone": bad}).status_code == 422
    assert client.get("/api/me").json()["timezone"] == "UTC"


def test_reporting_a_timezone_needs_a_login(client):
    assert client.put("/api/me", json={"timezone": "UTC"}).status_code == 401


def test_campaigns_have_no_timezone_setting_any_more(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x", "timezone": "Asia/Tokyo"}).json()
    assert "timezone" not in camp                          # ignored if sent, never stored or returned
    r = client.patch(f"/api/campaigns/{camp['id']}", json={"timezone": "Asia/Tokyo"})
    assert r.status_code == 200 and "timezone" not in r.json()


def test_a_polls_hours_follow_the_organizers_zone_but_slots_are_stored_in_utc(client):
    login(client, "1", "DM", tz="Asia/Tokyo")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    poll = client.post(f"/api/campaigns/{cid}/polls", json={
        "date_start": "2026-12-01", "window_start": "18:00:00", "window_end": "19:00:00",
        "duration_min": 30}).json()
    assert poll["timezone"] == "Asia/Tokyo"
    assert poll["slots"][0] == "2026-12-01T09:00:00Z"      # 18:00 in Tokyo is 09:00 UTC: stored as UTC

"""One-week polls, meeting frequency and the minimum-players option on /chronomancer poll."""
import asyncio
from datetime import date, datetime, time, timezone

import pytest

from app import services
from app.bot import actions
from app.bot.actions import DUser
from app.bot.snapshots import load_poll_snapshot
from app.bot.views import confirmed_embed
from app.services import ServiceError, add_cadence

from conftest import login, make_client
from helpers import (
    CHANNEL, GUILD, fresh, make_campaign, make_player, mark_all_free, open_poll,
)

DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")


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


def test_bot_poll_command_takes_one_week_start(db):
    make_campaign(db)
    reply = actions.cmd_poll(db, DM, GUILD, CHANNEL, "2026-12-01", "18:00", "22:00", 120, "UTC", "Week 1")
    assert "/poll.html" in reply.text
    poll = services.current_poll(db, services.campaign_for_channel(db, GUILD, CHANNEL).id)
    assert (poll.date_start, poll.date_end) == (date(2026, 12, 1), date(2026, 12, 7))


def test_bot_poll_command_without_a_week_and_no_history_asks_which(db):
    make_campaign(db)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_poll(db, DM, GUILD, CHANNEL, None, "18:00", "22:00", 120, "UTC", "")
    assert exc.value.status == 422 and "week_start" in exc.value.detail


# ------------------------------------------------ meeting frequency


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


def test_campaign_frequency_is_validated(db):
    owner = services.upsert_user(db, "1", "DM")
    campaign, _ = services.create_campaign(db, owner, name="x", cadence="biweekly")
    assert campaign.cadence == "biweekly"
    with pytest.raises(ServiceError) as exc:
        services.create_campaign(db, owner, name="y", cadence="hourly")
    assert exc.value.status == 422
    with pytest.raises(ServiceError):
        services.set_cadence(db, campaign, "daily")
    services.set_cadence(db, campaign, "monthly")
    assert campaign.cadence == "monthly"


def test_bot_create_accepts_a_frequency(db):
    actions.cmd_create(db, DM, GUILD, CHANNEL, "Strahd", 180, 2, "dnd", "biweekly")
    assert services.campaign_for_channel(db, GUILD, CHANNEL).cadence == "biweekly"


def test_frequency_command_is_organizer_only_and_reports_next_week(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    with pytest.raises(ServiceError) as exc:
        actions.cmd_frequency(db, ARIA, GUILD, CHANNEL, "weekly")
    assert exc.value.status == 403 and campaign.cadence == "none"
    reply = actions.cmd_frequency(db, DM, GUILD, CHANNEL, "weekly")
    assert "Every week" in reply.text and campaign.cadence == "weekly"
    with pytest.raises(ServiceError):
        actions.cmd_frequency(db, DM, GUILD, CHANNEL, "whenever")


def confirm_session(db, campaign, owner, tz="UTC", day=date(2026, 12, 3)):
    """Run a poll to confirmation, with the session landing on `day` 18:00 local."""
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign, tz=tz, date_start=day.replace(day=1))
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    services.close_poll(db, poll)
    wanted = [c for c in poll.candidates if c.start_utc.date() == day]
    services.confirm_poll(db, poll, (wanted or poll.candidates)[0].id)
    return poll


def test_next_week_is_suggested_from_the_last_confirmed_session(db):
    campaign, owner = make_campaign(db)
    assert services.suggest_next_week(db, campaign) is None  # no session yet
    services.set_cadence(db, campaign, "biweekly")
    assert services.suggest_next_week(db, campaign) is None
    poll = confirm_session(db, campaign, owner)
    held = poll.confirmed_start_utc.date()
    assert services.suggest_next_week(db, campaign) == add_cadence(held, "biweekly")
    services.set_cadence(db, campaign, "none")
    assert services.suggest_next_week(db, campaign) is None  # one-off groups get no suggestion


def test_next_week_uses_the_polls_timezone_for_the_session_date(db):
    campaign, owner = make_campaign(db)
    services.set_cadence(db, campaign, "weekly")
    # 22:00 Pacific is already the next day in UTC; the meeting happened on the Pacific date.
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign, tz="America/Los_Angeles", date_start=date(2026, 12, 1),
                     window_start=time(18), window_end=time(23), duration_min=60)
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    services.close_poll(db, poll)
    late = max(poll.candidates, key=lambda c: c.start_utc)
    services.confirm_poll(db, poll, late.id)
    local_day = late.start_utc.astimezone(__import__("zoneinfo").ZoneInfo("America/Los_Angeles")).date()
    assert services.suggest_next_week(db, campaign) == add_cadence(local_day, "weekly")


def test_poll_command_defaults_to_the_suggested_week(db):
    campaign, owner = make_campaign(db)
    services.set_cadence(db, campaign, "weekly")
    poll = confirm_session(db, campaign, owner)
    expected = services.suggest_next_week(db, campaign)
    actions.cmd_poll(db, DM, GUILD, CHANNEL, None, "18:00", "22:00", 120, "UTC", "Next")
    newest = services.current_poll(db, campaign.id)
    assert newest.id != poll.id and newest.date_start == expected


def test_confirmation_announcement_names_the_next_week_for_regular_groups(db):
    campaign, owner = make_campaign(db)
    services.set_cadence(db, campaign, "monthly")
    poll = confirm_session(db, campaign, owner)
    snap = load_poll_snapshot(db, poll.id)
    assert snap.next_week == services.suggest_next_week(db, campaign)
    text = confirmed_embed(snap).description
    assert "Next gathering" in text and snap.next_week.strftime("%Y") in text


def test_one_off_campaigns_get_no_next_week_line(db):
    campaign, owner = make_campaign(db)
    poll = confirm_session(db, campaign, owner)
    snap = load_poll_snapshot(db, poll.id)
    assert snap.next_week is None and "Next gathering" not in confirmed_embed(snap).description


def test_frequency_endpoint(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x", "cadence": "annually"}).json()
    assert camp["cadence"] == "annually" and camp["next_week_start"] is None
    r = client.put(f"/api/campaigns/{camp['id']}/cadence", json={"cadence": "weekly"})
    assert r.status_code == 200 and r.json()["cadence"] == "weekly"
    assert client.put(f"/api/campaigns/{camp['id']}/cadence", json={"cadence": "daily"}).status_code == 422
    player = make_client()
    login(player, "2", "Aria")
    player.post("/api/join", json={"invite_code": camp["invite_code"]})
    assert player.put(f"/api/campaigns/{camp['id']}/cadence", json={"cadence": "monthly"}).status_code == 403
    assert client.get(f"/api/campaigns/{camp['id']}").json()["cadence"] == "weekly"


# ------------------------------------------------ minimum players from Discord


def test_poll_command_sets_the_minimum_players(db):
    make_campaign(db, quorum=2)  # the campaign default would demand two
    actions.cmd_poll(db, DM, GUILD, CHANNEL, "2026-12-01", "18:00", "22:00", 120, "UTC", "Solo", 1)
    poll = services.current_poll(db, services.campaign_for_channel(db, GUILD, CHANNEL).id)
    assert poll.min_quorum == 1


def test_poll_command_without_quorum_uses_the_campaigns(db):
    make_campaign(db, quorum=3)
    actions.cmd_poll(db, DM, GUILD, CHANNEL, "2026-12-01", "18:00", "22:00", 120, "UTC", "x")
    poll = services.current_poll(db, services.campaign_for_channel(db, GUILD, CHANNEL).id)
    assert poll.min_quorum == 3


def test_a_lone_organizer_can_run_a_poll_end_to_end_with_quorum_one(db):
    """The reported problem: a one-person local test could not get a vote at the default of 2."""
    campaign, owner = make_campaign(db)
    actions.cmd_poll(db, DM, GUILD, CHANNEL, "2026-12-01", "18:00", "22:00", 120, "UTC", "Solo", 1)
    poll = services.current_poll(db, campaign.id)
    mark_all_free(db, poll, owner)
    actions.cmd_close(db, DM, GUILD, CHANNEL, None)
    assert poll.status == "voting" and poll.candidates


def test_default_quorum_of_two_still_blocks_a_lone_organizer(db):
    campaign, owner = make_campaign(db, quorum=2)
    actions.cmd_poll(db, DM, GUILD, CHANNEL, "2026-12-01", "18:00", "22:00", 120, "UTC", "Solo")
    poll = services.current_poll(db, campaign.id)
    mark_all_free(db, poll, owner)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_close(db, DM, GUILD, CHANNEL, None)
    assert exc.value.status == 409 and "too few free players" in actions.error_text(exc.value)


# ------------------------------------------------ the registered commands match


def test_registered_commands_expose_the_new_options():
    import discord
    from discord import app_commands
    from app.bot import commands

    class Dummy(discord.Client):
        pass

    async def build():
        bot = Dummy(intents=discord.Intents.none())
        tree = app_commands.CommandTree(bot)
        commands.register(tree)
        group = next(c for c in tree.get_commands() if c.name == "chronomancer")
        by_name = {c.name: c for c in group.commands}
        return by_name

    cmds = asyncio.run(build())
    poll = {p.name: p for p in cmds["poll"].parameters}
    assert "week_start" in poll and "quorum" in poll
    assert "first_day" not in poll and "last_day" not in poll  # no more date ranges
    assert poll["week_start"].required is False  # blank means "the suggested next week"
    create = {p.name: p for p in cmds["create"].parameters}
    assert {c.value for c in create["frequency"].choices} == {
        "none", "weekly", "biweekly", "monthly", "quarterly", "annually"}
    assert "frequency" in cmds

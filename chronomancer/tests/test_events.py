"""Discord scheduled events: one exists exactly while a session is decided, still ahead, and
events are enabled for the campaign."""
from datetime import datetime, timedelta, timezone

import discord
import pytest
from sqlalchemy import select

from app import services
from app.bot import actions
from app.bot.actions import DUser
from app.bot.client import INVITE_PERMISSIONS
from app.models import Campaign, Notification, Poll

from conftest import login, make_client
from helpers import CHANNEL, GUILD, fresh, make_campaign, make_player, voting_poll
from test_outbox import World, run, skip_backoff
from test_recurrence import all_polls, decided, local, repeating

DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")
UTC = timezone.utc


def stored_event_id(poll_id):
    with fresh() as db:
        return db.get(Poll, poll_id).discord_event_id


def sync_notifications(db):
    return [n for n in db.scalars(select(Notification).order_by(Notification.id)) if n.kind == "event_sync"]


# ------------------------------------------------ creating


def test_confirming_a_session_creates_a_discord_event(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    assert len(world.guild.created) == 1
    event = world.guild.created[0].kwargs
    assert event["name"] == "Session 5"
    assert event["start_time"] == poll.confirmed_start_utc
    assert event["end_time"] == poll.confirmed_start_utc + timedelta(minutes=poll.duration_min)
    assert event["location"].endswith(f"/campaign.html?id={campaign.id}")
    assert event["privacy_level"] == discord.PrivacyLevel.guild_only
    assert "Curse of Strahd" in event["description"]
    assert stored_event_id(poll.id) == str(world.guild.created[0].id)


def test_the_event_is_created_only_once(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    with fresh() as other:  # a second sync request, for whatever reason
        services.enqueue(other, "event_sync", poll.id)
        other.commit()
    run(world.processor.run_once())
    assert len(world.guild.created) == 1


def test_no_event_exists_before_the_session_is_decided(db):
    voting_poll(db)  # voting, not confirmed
    world = World()
    run(world.processor.run_once())
    assert world.guild.created == []


def test_a_session_already_in_the_past_gets_no_event(db):
    campaign, _ = repeating(db)
    past = decided(db, campaign, local(2020, 1, 4, 11))
    services.enqueue(db, "event_sync", past.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    assert world.guild.created == []


def test_long_text_is_cut_to_discords_limits(db):
    campaign, owner = make_campaign(db)
    from helpers import mark_all_free, open_poll
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign, title="T" * 120)
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    services.close_poll(db, poll)
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    event = world.guild.created[0].kwargs
    assert len(event["name"]) <= 100 and len(event["location"]) <= 100 and len(event["description"]) <= 1000


# ------------------------------------------------ removing


def test_cancelling_a_decided_session_removes_its_event(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    event = world.guild.created[0]
    services.cancel_poll(db, poll)
    run(world.processor.run_once())
    assert event.deleted and world.guild.events == {} and stored_event_id(poll.id) is None


def test_an_event_someone_already_deleted_is_not_an_error(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    world.guild.events.clear()          # an admin removed it by hand
    services.cancel_poll(db, poll)
    run(world.processor.run_once())
    assert stored_event_id(poll.id) is None
    with fresh() as other:
        assert all(n.processed_at and not n.error for n in other.scalars(select(Notification)))


# ------------------------------------------------ the per-campaign switch


def test_a_campaign_with_events_off_gets_none(db):
    campaign, poll, _ = voting_poll(db)
    services.update_campaign(db, campaign, events_enabled=False)
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    assert world.guild.created == [] and stored_event_id(poll.id) is None


def test_turning_events_on_creates_them_for_sessions_already_decided(db):
    campaign, poll, _ = voting_poll(db)
    services.update_campaign(db, campaign, events_enabled=False)
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    assert world.guild.created == []
    services.update_campaign(db, campaign, events_enabled=True)
    run(world.processor.run_once())
    assert len(world.guild.created) == 1 and stored_event_id(poll.id)


def test_turning_events_off_removes_the_existing_ones(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    services.update_campaign(db, campaign, events_enabled=False)
    run(world.processor.run_once())
    assert world.guild.events == {} and stored_event_id(poll.id) is None


def test_saving_other_settings_does_not_resync_events(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    before = len(sync_notifications(db))
    services.update_campaign(db, campaign, min_quorum=1, events_enabled=True)  # unchanged switch
    assert len(sync_notifications(db)) == before


def test_setup_can_turn_events_off_when_creating(db):
    actions.cmd_setup(db, DM, GUILD, CHANNEL, name="Quiet group", events=False)
    assert services.campaign_for_channel(db, GUILD, CHANNEL).events_enabled is False


def test_events_default_to_on(db):
    reply = actions.cmd_setup(db, DM, GUILD, CHANNEL, name="Loud group")
    assert services.campaign_for_channel(db, GUILD, CHANNEL).events_enabled is True
    assert "Discord events: on" in reply.text


# ------------------------------------------------ recurrence and replacement


def test_an_automatically_scheduled_session_points_the_repeating_event_at_it(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2030, 3, 2, 11))
    services.roll_recurrences(db, now=local(2030, 3, 2, 15).astimezone(UTC))
    world = World()
    run(world.processor.run_once())
    assert world.guild.created == []  # a repeating group has no per-session events
    (event,) = world.guild.series.values()
    # the event follows the soonest upcoming session (here still the first one, in 2030)
    assert event["scheduled_start_time"] == "2030-03-02T19:00:00Z"
    assert event["recurrence_rule"]["frequency"] == 2  # weekly


def test_skipping_a_session_moves_the_event_to_the_next_one(db):
    campaign, _ = repeating(db)
    first = decided(db, campaign, local(2030, 3, 2, 11))
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    (event_id,) = world.guild.series
    assert world.guild.series[event_id]["scheduled_start_time"] == "2030-03-02T19:00:00Z"
    services.cancel_poll(db, first)
    run(world.processor.run_once())
    assert list(world.guild.series) == [event_id]  # the same event, moved
    assert world.guild.series[event_id]["scheduled_start_time"] == "2030-03-09T19:00:00Z"


def test_becoming_a_one_off_group_removes_the_repeating_event(db):
    campaign, _ = repeating(db)
    decided(db, campaign, local(2030, 3, 2, 11))
    services.roll_recurrences(db, now=local(2030, 3, 2, 15).astimezone(UTC))
    world = World()
    run(world.processor.run_once())
    assert len(world.guild.series) == 1
    services.update_campaign(db, campaign, cadence="none")      # drops the automatic session
    run(world.processor.run_once())
    assert world.guild.series == {}
    with fresh() as other:
        assert other.get(Campaign, campaign.id).series_event_id is None


# ------------------------------------------------ permission and failures


def test_missing_permission_is_reported_not_retried_forever(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    world = World(can_create_events=False)
    run(world.processor.run_once())
    assert world.guild.created == [] and stored_event_id(poll.id) is None
    with fresh() as other:
        row = [n for n in other.scalars(select(Notification)) if n.kind == "event_sync"][0]
        assert row.processed_at and "Create Events" in row.error and row.attempts == 1  # not retried
        others = [n for n in other.scalars(select(Notification)) if n.kind != "event_sync"]
        assert all(n.processed_at and not n.error for n in others)  # the announcement still went out
    assert any(m.embed.title == "The Session Is Decreed" for m in world.channel.sent)


def test_a_temporary_discord_error_retries_and_makes_exactly_one_event(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    world = World()
    real = world.guild.create_scheduled_event
    attempts = {"n": 0}

    async def flaky(**kw):
        attempts["n"] += 1
        if attempts["n"] == 1:
            raise discord.HTTPException(type("R", (), {"status": 503, "reason": "down"})(), "unavailable")
        return await real(**kw)

    world.guild.create_scheduled_event = flaky
    run(world.processor.run_once())
    assert world.guild.created == []
    skip_backoff()
    run(world.processor.run_once())
    run(world.processor.run_once())
    assert len(world.guild.created) == 1


def test_an_unlinked_campaign_is_skipped_quietly(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    with fresh() as other:
        row = other.get(Campaign, campaign.id)
        row.guild_id = row.channel_id = None
        other.commit()
    world = World()
    run(world.processor.run_once())
    assert world.guild.created == []


# ------------------------------------------------ telling the organizer


def test_schedule_warns_the_organizer_when_events_cannot_be_created(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    warned = actions.cmd_schedule(db, DM, GUILD, CHANNEL, events_ok=False).text
    assert "Create Events" in warned
    assert "Create Events" not in actions.cmd_schedule(db, DM, GUILD, CHANNEL, events_ok=True).text
    assert "Create Events" not in actions.cmd_schedule(db, ARIA, GUILD, CHANNEL, events_ok=False).text  # not their concern


def test_no_warning_when_events_are_switched_off(db):
    campaign, _ = make_campaign(db)
    services.update_campaign(db, campaign, events_enabled=False)
    assert "Create Events" not in actions.cmd_schedule(db, DM, GUILD, CHANNEL, events_ok=False).text


def test_setup_warns_about_the_missing_permission(db):
    reply = actions.cmd_setup(db, DM, GUILD, CHANNEL, name="Strahd", events_ok=False)
    assert "Create Events" in reply.text
    assert "Create Events" not in actions.cmd_setup(db, DM, GUILD, CHANNEL, quorum=1, events_ok=True).text


def test_the_invite_link_requests_create_events():
    assert INVITE_PERMISSIONS & (1 << 44)           # Create Events
    assert not INVITE_PERMISSIONS & (1 << 33)       # but not the broader Manage Events


# ------------------------------------------------ web


def test_the_events_switch_is_part_of_the_settings_api(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    assert camp["events_enabled"] is True
    r = client.patch(f"/api/campaigns/{camp['id']}", json={"events_enabled": False})
    assert r.status_code == 200 and r.json()["events_enabled"] is False
    player = make_client()
    login(player, "2", "Aria")
    player.post("/api/join", json={"invite_code": camp["invite_code"]})
    assert player.patch(f"/api/campaigns/{camp['id']}", json={"events_enabled": True}).status_code == 403

"""Deleting a campaign also clears out Discord: its events (the repeating one and per-session ones)
and the buttons of a vote in progress. The ids live on rows that are deleted, so they are recorded in
a cleanup table in the same transaction and removed afterwards, with retries."""
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

import discord
import pytest
from sqlalchemy import select

from app import services
from app.bot.outbox import MAX_ATTEMPTS, OutboxProcessor
from app.models import Campaign, DiscordCleanup, Notification, Poll, PollMessage

from conftest import login, make_client
from helpers import CHANNEL, GUILD, fresh, make_campaign, voting_poll
from test_events import stored_event_id
from test_outbox import FakeResponse, World, run
from test_recurrence import decided, local, repeating

WEB = Path(__file__).resolve().parent.parent / "web"
UTC = timezone.utc
SAT = local(2030, 3, 2, 11)


def cleanup_rows():
    with fresh() as db:
        return db.scalars(select(DiscordCleanup).order_by(DiscordCleanup.id)).all()


def due_now():
    with fresh() as db:
        for row in db.scalars(select(DiscordCleanup)):
            if row.retry_after is not None:
                row.retry_after = datetime.now(UTC) - timedelta(seconds=1)
        db.commit()


def repeating_group_with_event(db):
    campaign, _ = repeating(db, "weekly")
    first = decided(db, campaign, SAT)
    services.enqueue(db, "event_sync", first.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    assert len(world.guild.series) == 1
    db.expire_all()
    return campaign, world


# ------------------------------------------------ recording what is in Discord


def test_deleting_a_repeating_group_records_its_event_before_the_rows_go(db):
    campaign, world = repeating_group_with_event(db)
    (event_id,) = world.guild.series
    services.delete_campaign(db, campaign.id)
    rows = cleanup_rows()
    assert [(r.kind, r.guild_id, r.target_id, r.processed_at) for r in rows] == [("event", GUILD, event_id, None)]
    with fresh() as other:
        assert other.get(Campaign, campaign.id) is None and other.scalars(select(Poll)).all() == []


def test_deleting_a_one_off_group_records_every_session_event(db):
    campaign, _ = repeating(db, "none")
    a, b = decided(db, campaign, SAT), decided(db, campaign, local(2030, 3, 9, 11))
    for poll in (a, b):
        services.enqueue(db, "event_sync", poll.id)
    db.commit()
    world = World()
    run(world.processor.run_once())
    assert len(world.guild.events) == 2
    db.expire_all()
    services.delete_campaign(db, campaign.id)
    assert sorted(r.target_id for r in cleanup_rows()) == sorted(str(i) for i in world.guild.events)
    run(world.processor.run_once())
    assert world.guild.events == {} and all(r.processed_at for r in cleanup_rows())


def test_a_vote_in_progress_has_its_buttons_retired(db):
    campaign, poll, _ = voting_poll(db)
    world = World()
    run(world.processor.run_once())                      # the vote message is posted
    message = world.channel.sent[0]
    db.expire_all()
    services.delete_campaign(db, campaign.id)
    (row,) = cleanup_rows()
    assert (row.kind, row.channel_id, row.target_id) == ("message", CHANNEL, str(message.id))
    run(world.processor.run_once())
    assert message.edits[-1]["view"] is None and "deleted" in message.edits[-1]["embed"].description
    assert cleanup_rows()[0].processed_at is not None


def test_finished_polls_have_no_live_buttons_to_retire(db):
    campaign, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)                      # the vote ended, its buttons were frozen
    run(World().processor.run_once())
    db.expire_all()
    services.delete_campaign(db, campaign.id)
    assert [r for r in cleanup_rows() if r.kind == "message"] == []


def test_a_group_with_nothing_in_discord_queues_nothing(db):
    campaign, _ = make_campaign(db, guild=None, channel=None)
    services.delete_campaign(db, campaign.id)
    assert cleanup_rows() == []


def test_the_pending_notifications_of_a_deleted_group_are_dropped(db):
    campaign, poll, _ = voting_poll(db)
    services.delete_campaign(db, campaign.id)
    with fresh() as other:
        assert other.scalars(select(Notification)).all() == []


# ------------------------------------------------ delivering the cleanup


def test_removal_is_done_once_and_only_once(db):
    campaign, world = repeating_group_with_event(db)
    services.delete_campaign(db, campaign.id)
    run(world.processor.run_once())
    assert world.guild.series == {}
    calls = len(world.guild._state.http.calls)
    assert run(world.processor.run_once()) == 0 and len(world.guild._state.http.calls) == calls


def test_an_event_someone_already_deleted_counts_as_done(db):
    campaign, world = repeating_group_with_event(db)
    services.delete_campaign(db, campaign.id)
    world.guild.series.clear()
    run(world.processor.run_once())
    (row,) = cleanup_rows()
    assert row.processed_at is not None and row.error is None


def test_discord_trouble_is_retried_with_backoff_until_it_works(db):
    campaign, world = repeating_group_with_event(db)
    services.delete_campaign(db, campaign.id)
    real = world.guild._state.http.request
    state = {"fail": True}

    async def flaky(route, **kw):
        if state["fail"]:
            raise discord.HTTPException(type("R", (), {"status": 503, "reason": "down"})(), "unavailable")
        return await real(route, **kw)

    world.guild._state.http.request = flaky
    run(world.processor.run_once())
    (row,) = cleanup_rows()
    assert row.processed_at is None and row.attempts == 1 and row.retry_after is not None
    run(world.processor.run_once())                      # still backing off: nothing happens
    assert cleanup_rows()[0].attempts == 1
    state["fail"] = False
    due_now()
    run(world.processor.run_once())
    assert cleanup_rows()[0].processed_at is not None and world.guild.series == {}


def test_it_gives_up_after_the_retry_budget(db):
    campaign, world = repeating_group_with_event(db)
    services.delete_campaign(db, campaign.id)

    async def down(route, **kw):
        raise discord.HTTPException(type("R", (), {"status": 503, "reason": "down"})(), "unavailable")

    world.guild._state.http.request = down
    for _ in range(MAX_ATTEMPTS):
        run(world.processor.run_once())
        due_now()
    row = cleanup_rows()[0]
    assert row.processed_at is not None and row.attempts == MAX_ATTEMPTS and "HTTPException" in row.error


def test_an_unknown_server_is_given_up_on_at_once(db):
    with fresh() as other:
        other.add(DiscordCleanup(kind="event", guild_id=None, target_id="123"))
        other.commit()
    world = World()
    run(world.processor.run_once())
    (row,) = cleanup_rows()
    assert row.processed_at is not None and "not known" in row.error and row.attempts == 1


def test_a_server_the_bot_has_left_is_given_up_on_not_retried_forever(db):
    with fresh() as other:
        other.add(DiscordCleanup(kind="event", guild_id=GUILD, target_id="123"))
        other.commit()
    world = World()

    async def gone(guild_id):
        raise discord.NotFound(FakeResponse(), "Unknown Guild")

    world.processor._get_guild = gone
    run(world.processor.run_once())
    assert cleanup_rows()[0].processed_at is not None and "NotFound" in cleanup_rows()[0].error


def test_a_message_that_is_already_gone_counts_as_done(db):
    campaign, poll, _ = voting_poll(db)
    world = World()
    run(world.processor.run_once())
    db.expire_all()
    services.delete_campaign(db, campaign.id)
    world.channel.missing_messages = True
    run(world.processor.run_once())
    assert cleanup_rows()[0].processed_at is not None and cleanup_rows()[0].error is None


# ------------------------------------------------ the race: deleted while Discord was being told


def test_an_event_made_while_the_group_was_deleted_is_still_removed(db):
    """The delivery had read the group, then the group was deleted, then the event was made."""
    world = World()
    world.guild.series["900"] = {"name": "x"}
    OutboxProcessor._store_series(4242, "900", "sig", GUILD)       # the campaign no longer exists
    OutboxProcessor._store_event(4242, "901", GUILD)               # nor does the poll
    assert sorted((r.kind, r.guild_id, r.target_id) for r in cleanup_rows()) == [
        ("event", GUILD, "900"), ("event", GUILD, "901")]
    run(world.processor.run_once())
    assert "900" not in world.guild.series and all(r.processed_at for r in cleanup_rows())


def test_a_vote_message_posted_for_a_deleted_poll_is_retired_not_remembered(db):
    OutboxProcessor._store_message(777, int(CHANNEL), 9000)
    with fresh() as other:
        assert other.get(PollMessage, 777) is None           # nothing dangling for a recycled poll id
    (row,) = cleanup_rows()
    assert (row.kind, row.channel_id, row.target_id) == ("message", CHANNEL, "9000")


def test_clearing_an_event_id_for_a_missing_poll_queues_nothing(db):
    OutboxProcessor._store_event(4242, None)
    OutboxProcessor._store_series(4242, None, None)
    assert cleanup_rows() == []


# ------------------------------------------------ the API and the page


def make_group(client):
    login(client, "1", "DM")
    return client.post("/api/campaigns", json={"name": "Doomed"}).json()


def test_the_organizer_deletes_through_the_api(client):
    camp = make_group(client)
    assert client.delete(f"/api/campaigns/{camp['id']}").status_code == 204
    assert client.get(f"/api/campaigns/{camp['id']}").status_code == 404
    assert client.get("/api/campaigns").json() == []


def test_a_member_cannot_delete_and_a_stranger_cannot_tell_it_exists(client):
    camp = make_group(client)
    member, stranger = make_client(), make_client()
    login(member, "2", "Aria")
    member.post("/api/join", json={"invite_code": camp["invite_code"]})
    login(stranger, "3", "Nobody")
    assert member.delete(f"/api/campaigns/{camp['id']}").status_code == 403
    assert stranger.delete(f"/api/campaigns/{camp['id']}").status_code == 404
    assert client.get(f"/api/campaigns/{camp['id']}").status_code == 200


def test_deleting_twice_is_a_clean_404(client):
    camp = make_group(client)
    assert client.delete(f"/api/campaigns/{camp['id']}").status_code == 204
    assert client.delete(f"/api/campaigns/{camp['id']}").status_code == 404


def test_deleting_requires_a_login(client):
    assert make_client().delete("/api/campaigns/1").status_code == 401


def test_the_home_page_offers_delete_only_to_organizers_with_a_confirmation():
    page = (WEB / "index.html").read_text(encoding="utf-8")
    assert 'c.my_role === "organizer"' in page and 'class: "danger"' in page
    assert "confirm(" in page and "c.name" in page
    assert 'Api.del("/api/campaigns/" + c.id)' in page
    assert "button.disabled = true" in page and "e.status !== 404" in page  # locked while running; 404 = done
    assert 'id="delete-error"' in page and 'role="alert"' in page


def test_the_confirmation_names_the_group_and_says_what_is_lost():
    for theme in ("dnd", "plain"):
        words = __import__("json").loads((WEB / "themes" / f"{theme}.json").read_text(encoding="utf-8"))
        assert {"deleteLabel", "deleteConfirmPre", "deleteConfirmPost"} <= set(words)
        assert "cannot be undone" in words["deleteConfirmPost"] and "Discord events" in words["deleteConfirmPost"]


def test_the_danger_button_has_a_style_in_both_themes():
    css = (WEB / "css" / "base.css").read_text(encoding="utf-8")
    assert "button.danger" in css and "var(--danger)" in css


def test_on_a_phone_the_delete_button_stays_small_instead_of_stretching_across_the_row():
    css = (WEB / "css" / "base.css").read_text(encoding="utf-8")
    phone = css[css.index("@media (max-width: 640px)"):]
    assert "ul.plain li > button.danger { width: auto;" in phone

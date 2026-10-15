"""Regression tests for the defects confirmed by the phase-2 review. Each group names the
finding it pins."""
import asyncio
import re
from datetime import date, datetime, time, timedelta, timezone

import discord
import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError

from app import background, config, services
from app.bot import actions, commands, outbox as outbox_mod
from app.bot.actions import DUser
from app.bot.outbox import OutboxProcessor
from app.bot.snapshots import load_poll_snapshot
from app.bot.views import cancelled_embed, confirmed_embed, vote_embed
from app.models import (
    Availability, Campaign, Candidate, Notification, Poll, PollMessage, Vote,
)
from app.scheduling import generate_slots
from app.services import ServiceError

from conftest import login, make_client
from helpers import (
    CHANNEL, GUILD, fresh, make_campaign, make_player, mark_all_free, open_poll, voting_poll,
)
from test_outbox import World, notification_rows, run, skip_backoff

DM = DUser("1", "Dungeon Master", can_manage=True)
ARIA = DUser("2", "Aria")                       # an ordinary member: no manage rights
ADMIN = DUser("50", "Server Admin", can_manage=True)


def count(db, model):
    return db.scalar(select(func.count()).select_from(model))


# ------------------------------------------------ squatting: who may claim a channel


def test_organizer_can_unlink_but_an_ordinary_member_cannot(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    with pytest.raises(ServiceError) as exc:
        actions.cmd_unlink(db, ARIA, GUILD, CHANNEL)
    assert exc.value.status == 403 and campaign.channel_id == CHANNEL
    organizer_without_manage = DUser("1", "Dungeon Master", can_manage=False)
    actions.cmd_unlink(db, organizer_without_manage, GUILD, CHANNEL)
    assert campaign.channel_id is None and campaign.name == "Curse of Strahd"  # kept


def test_channel_binding_is_unique_in_the_database_itself(db):
    make_campaign(db)
    owner = services.upsert_user(db, "9", "Other")
    db.add(Campaign(name="dup", owner_id=owner.id, guild_id=GUILD, channel_id=CHANNEL))
    with pytest.raises(IntegrityError):
        db.commit()
    db.rollback()


def test_unlinked_campaigns_do_not_collide_on_null_binding(db):
    owner = services.upsert_user(db, "1", "DM")
    for i in range(3):
        services.create_campaign(db, owner, name=f"web {i}")
    assert count(db, Campaign) == 3


class FakePerms:
    def __init__(self, **kw):
        self.administrator = kw.get("administrator", False)
        self.manage_guild = kw.get("manage_guild", False)
        self.manage_channels = kw.get("manage_channels", False)


class FakeAvatar:
    url = "https://cdn.example/global.png"


class FakeUser:
    id = 4242
    name = "aria_tag"
    global_name = "Aria Global"
    display_name = "Server Nickname"  # what the old code used: per-server, must NOT be stored
    avatar = FakeAvatar()


class FakeInteraction:
    def __init__(self, perms, user=None):
        self.user = user or FakeUser()
        self.permissions = perms


def test_make_duser_reads_discords_permissions_and_global_profile():
    plain = commands.make_duser(FakeInteraction(FakePerms()))
    assert (plain.id, plain.name, plain.avatar_url) == ("4242", "Aria Global", FakeAvatar.url)
    assert plain.can_manage is False
    for flag in ("administrator", "manage_guild", "manage_channels"):
        assert commands.make_duser(FakeInteraction(FakePerms(**{flag: True}))).can_manage is True


def test_make_duser_falls_back_to_username_and_no_avatar():
    class Bare(FakeUser):
        global_name = None
        avatar = None
    duser = commands.make_duser(FakeInteraction(FakePerms(), Bare()))
    assert duser.name == "aria_tag" and duser.avatar_url is None


# ------------------------------------------------ races: close / confirm are atomic


def test_two_stale_sessions_cannot_both_close_a_poll(db):
    campaign, owner = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign)
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    with fresh() as a, fresh() as b:
        pa, pb = a.get(Poll, poll.id), b.get(Poll, poll.id)  # both see "collecting"
        services.close_poll(a, pa)
        with pytest.raises(ServiceError) as exc:
            services.close_poll(b, pb)
        assert exc.value.status == 409
    with fresh() as check:
        n_candidates = count(check, Candidate)
        assert 1 <= n_candidates <= 3  # one set, not two
        assert count(check, Notification) == 1


def test_two_stale_sessions_cannot_both_confirm(db):
    _, poll, (_, aria, _) = voting_poll(db)
    with fresh() as a, fresh() as b:
        pa, pb = a.get(Poll, poll.id), b.get(Poll, poll.id)
        services.confirm_poll(a, pa, pa.candidates[0].id)
        with pytest.raises(ServiceError) as exc:
            services.confirm_poll(b, pb, pb.candidates[-1].id)  # a different time: must not win
        assert exc.value.status == 409
    with fresh() as check:
        decided = check.get(Poll, poll.id)
        assert decided.confirmed_start_utc == decided.candidates[0].start_utc
        kinds = [n.kind for n in check.scalars(select(Notification).order_by(Notification.id))]
        assert kinds.count("confirmed") == 1


def test_a_failed_close_leaves_the_poll_open_and_unclaimed(db):
    campaign, _ = make_campaign(db)
    poll = open_poll(db, campaign)
    with pytest.raises(ServiceError):
        services.close_poll(db, poll)
    with fresh() as check:
        assert check.get(Poll, poll.id).status == "collecting"
    mark_all_free(db, poll, services.upsert_user(db, "1", "x"))
    other = make_player(db, campaign, "2", "Aria")
    mark_all_free(db, poll, other)
    services.close_poll(db, poll)  # and it can still be closed properly afterwards
    assert poll.status == "voting"


def test_deadline_timer_and_organizer_click_cannot_both_decree(db):
    _, poll, _ = voting_poll(db, vote_hours=1)
    with fresh() as timer, fresh() as human:
        stale = human.get(Poll, poll.id)
        stale_status = stale.status
        poll_t = timer.get(Poll, poll.id)
        poll_t.vote_deadline = datetime.now(timezone.utc) - timedelta(minutes=1)
        timer.commit()
        assert services.auto_confirm_due(timer) == [poll.id]
        assert stale_status == "voting"  # the human's view is stale
        with pytest.raises(ServiceError):
            services.confirm_poll(human, stale)
    with fresh() as check:
        assert [n.kind for n in check.scalars(select(Notification))].count("confirmed") == 1


# ------------------------------------------------ deleting a campaign cleans everything


def make_full_campaign(db):
    campaign, poll, (owner, aria, _) = voting_poll(db)
    services.cast_vote(db, poll, aria, poll.candidates[0].id)
    db.add(PollMessage(poll_id=poll.id, channel_id=CHANNEL, message_id="123"))
    db.commit()
    return campaign, poll


def test_delete_campaign_removes_notifications_messages_votes_and_availability(db):
    campaign, poll = make_full_campaign(db)
    assert count(db, Notification) and count(db, PollMessage) and count(db, Vote)
    services.delete_campaign(db, campaign.id)
    with fresh() as check:
        for model in (Campaign, Poll, Candidate, Vote, Availability, Notification, PollMessage):
            assert count(check, model) == 0, model.__name__


def test_a_recycled_poll_id_does_not_inherit_a_dead_polls_discord_message(db):
    campaign, poll = make_full_campaign(db)
    old_id = poll.id
    services.delete_campaign(db, campaign.id)
    owner = services.upsert_user(db, "7", "New DM")
    fresh_campaign, _ = services.create_campaign(db, owner, name="New", guild_id="1", channel_id="2")
    new_poll = open_poll(db, fresh_campaign)
    assert new_poll.id == old_id  # SQLite reuses the id: the dangerous case
    snap = load_poll_snapshot(db, new_poll.id)
    assert snap.message_id is None


def test_deleting_through_the_api_cleans_up_too(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    pid = client.post(f"/api/campaigns/{cid}/polls", json={
        "timezone": "UTC", "date_start": "2026-12-01",
        "window_start": "18:00:00", "window_end": "22:00:00", "duration_min": 120}).json()["id"]
    with fresh() as db:
        db.add(Notification(kind="vote_open", poll_id=pid))
        db.add(PollMessage(poll_id=pid, channel_id="1", message_id="2"))
        db.commit()
    assert client.delete(f"/api/campaigns/{cid}").status_code == 204
    with fresh() as db:
        assert count(db, Notification) == 0 and count(db, PollMessage) == 0


# ------------------------------------------------ one open poll, cancel, repost


def test_second_open_poll_is_refused_by_the_service_for_every_caller(db):
    campaign, _ = make_campaign(db)
    open_poll(db, campaign)
    with pytest.raises(ServiceError) as exc:
        open_poll(db, campaign)
    assert exc.value.status == 409


def test_web_api_also_refuses_a_second_open_poll(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    body = {"timezone": "UTC", "date_start": "2026-12-01",
            "window_start": "18:00:00", "window_end": "22:00:00", "duration_min": 120}
    assert client.post(f"/api/campaigns/{cid}/polls", json=body).status_code == 201
    assert client.post(f"/api/campaigns/{cid}/polls", json=body).status_code == 409


def test_cancel_frees_the_campaign_for_a_new_poll(db):
    campaign, _ = make_campaign(db)
    poll = open_poll(db, campaign)
    services.cancel_poll(db, poll)
    assert poll.status == "cancelled"
    open_poll(db, campaign, title="again")  # no longer blocked
    assert count(db, Notification) == 0  # nothing was posted to Discord, so nothing to retire


def test_cancel_of_a_posted_vote_retires_the_buttons(db):
    _, poll, _ = voting_poll(db)
    world = World()
    run(world.processor.run_once())
    vote_msg = world.channel.sent[0]
    services.cancel_poll(db, poll)
    run(world.processor.run_once())
    assert vote_msg.edits[-1]["view"] is None
    assert "burned" in vote_msg.edits[-1]["embed"].description
    assert len(world.channel.sent) == 1  # edited in place, nothing new posted


def test_a_session_that_already_happened_cannot_be_cancelled(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    with fresh() as other:  # pretend the session was in the past
        row = other.get(Poll, poll.id)
        row.confirmed_start_utc = datetime.now(timezone.utc) - timedelta(days=1)
        other.commit()
    db.refresh(poll)
    with pytest.raises(ServiceError) as exc:
        services.cancel_poll(db, poll)
    assert exc.value.status == 409 and poll.status == "confirmed"


def test_cancel_command_is_organizer_only(db):
    campaign, _ = make_campaign(db)
    make_player(db, campaign, "2", "Aria")
    open_poll(db, campaign)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_cancel(db, ARIA, GUILD, CHANNEL)
    assert exc.value.status == 403
    actions.cmd_cancel(db, DM, GUILD, CHANNEL)
    with pytest.raises(ServiceError) as exc:
        actions.cmd_cancel(db, DM, GUILD, CHANNEL)
    assert exc.value.status == 409


def test_cancel_endpoint_is_organizer_only(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    pid = client.post(f"/api/campaigns/{camp['id']}/polls", json={
        "timezone": "UTC", "date_start": "2026-12-01",
        "window_start": "18:00:00", "window_end": "22:00:00", "duration_min": 120}).json()["id"]
    player = make_client()
    login(player, "2", "Aria")
    player.post("/api/join", json={"invite_code": camp["invite_code"]})
    assert player.post(f"/api/polls/{pid}/cancel").status_code == 403
    assert client.post(f"/api/polls/{pid}/cancel").json()["status"] == "cancelled"
    assert client.post(f"/api/polls/{pid}/cancel").status_code == 409


# ------------------------------------------------ outbox: backoff, ordering, refresh


def test_backoff_schedule_grows_then_caps():
    delays = [outbox_mod.retry_delay(n).total_seconds() for n in range(1, 9)]
    assert delays == [15, 30, 60, 120, 240, 480, 600, 600]
    assert outbox_mod.MAX_ATTEMPTS >= 10  # roughly an hour of tolerance, not 25 seconds
    total = sum(outbox_mod.retry_delay(n).total_seconds() for n in range(1, outbox_mod.MAX_ATTEMPTS))
    assert total >= 3000


def test_a_failure_schedules_the_retry_instead_of_hammering(db):
    voting_poll(db)
    world = World()
    world.fail_with = RuntimeError("down")
    run(world.processor.run_once())
    row = notification_rows()[0]
    assert row.attempts == 1 and row.retry_after > datetime.now(timezone.utc) + timedelta(seconds=10)


def test_confirmation_cannot_overtake_a_vote_message_that_is_still_failing(db):
    _, poll, _ = voting_poll(db)
    world = World()
    world.fail_with = RuntimeError("discord is down")
    run(world.processor.run_once())  # vote_open fails, enters backoff
    services.confirm_poll(db, poll)  # the deadline fires meanwhile
    world.fail_with = None
    run(world.processor.run_once())
    assert world.channel.sent == []  # the announcement waits behind the vote message
    skip_backoff()
    run(world.processor.run_once())
    titles = [m.embed.title for m in world.channel.sent]
    assert titles[0].endswith("Choose Your Hour") and titles[-1] == "The Session Is Decreed"


def test_one_run_drains_a_backlog_in_order(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)  # vote_open and confirmed both queued
    world = World()
    assert run(world.processor.run_once()) == 2
    assert [m.embed.title for m in world.channel.sent][-1] == "The Session Is Decreed"


def test_web_votes_refresh_the_discord_tallies_once(client, db):
    from conftest import make_client as mk
    campaign, poll, (owner, aria, _) = voting_poll(db)
    world = World()
    run(world.processor.run_once())
    vote_msg = world.channel.sent[0]
    web = mk()
    login(web, "2", "Aria")  # same discord id as the player in the fixture
    cand = poll.candidates[0].id
    assert web.post(f"/api/polls/{poll.id}/votes", json={"candidate_id": cand}).status_code == 200
    assert web.post(f"/api/polls/{poll.id}/votes", json={"candidate_id": cand}).status_code == 200
    with fresh() as check:
        assert [n.kind for n in check.scalars(select(Notification).where(Notification.processed_at.is_(None)))] == ["vote_update"]
    run(world.processor.run_once())
    assert "**1** votes" in vote_msg.edits[-1]["embed"].fields[0].value


def test_vote_update_does_nothing_once_the_poll_is_decided(db):
    _, poll, _ = voting_poll(db)
    world = World()
    run(world.processor.run_once())
    vote_msg = world.channel.sent[0]
    with fresh() as other:
        services.enqueue(other, "vote_update", poll.id)
        other.commit()
    services.confirm_poll(db, poll)
    edits_before = len(vote_msg.edits)
    run(world.processor.run_once())
    # the only edit is the freeze caused by "confirmed", not a stale refresh
    assert len(vote_msg.edits) == edits_before + 1 and vote_msg.edits[-1]["view"] is None


def test_enqueue_once_coalesces(db):
    _, poll, _ = voting_poll(db)
    for _ in range(5):
        services.enqueue_once(db, "vote_update", poll.id)
        db.commit()
    assert count(db, Notification) == 2  # vote_open + one vote_update


def test_editing_the_vote_message_needs_no_read_history_permission(db):
    """The fake channel has no fetch_message at all: the code must use partial messages."""
    _, poll, _ = voting_poll(db)
    world = World()
    assert not hasattr(world.channel, "fetch_message")
    run(world.processor.run_once())
    services.confirm_poll(db, poll)
    run(world.processor.run_once())
    assert world.channel.sent[0].edits


# ------------------------------------------------ bot supervision


class FakeBot:
    behaviours: list = []
    instances: list = []

    def __init__(self):
        self.ready = False
        self.closed = False
        FakeBot.instances.append(self)

    async def start(self, token):
        action = FakeBot.behaviours.pop(0)
        if isinstance(action, BaseException):
            raise action
        if action == "ready-then-end":
            self.ready = True
        return None

    def is_ready(self):
        return self.ready

    async def close(self):
        self.closed = True


@pytest.fixture()
def supervised(monkeypatch):
    FakeBot.behaviours, FakeBot.instances = [], []
    sleeps = []

    async def fake_sleep(seconds):
        sleeps.append(seconds)
        if len(sleeps) > 20:
            raise asyncio.CancelledError

    monkeypatch.setattr("app.bot.client.ChronomancerBot", FakeBot)
    monkeypatch.setattr(background.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(config, "DISCORD_BOT_TOKEN", "x")
    return sleeps


def test_transient_startup_failures_are_retried_with_backoff(supervised):
    err = discord.HTTPException(type("R", (), {"status": 503, "reason": "Service Unavailable"})(), "down")
    FakeBot.behaviours = [err, RuntimeError("boom"), err, discord.LoginFailure("bad token")]
    bg = background.Background()
    asyncio.run(bg._supervise_bot())
    assert supervised == [5, 10, 20]  # three retries with growing delay, then the permanent failure
    assert len(FakeBot.instances) == 4 and all(b.closed for b in FakeBot.instances[:3])
    assert bg.bot is None


def test_a_rejected_token_stops_without_retrying(supervised):
    FakeBot.behaviours = [discord.LoginFailure("Improper token has been passed.")]
    bg = background.Background()
    asyncio.run(bg._supervise_bot())
    assert supervised == [] and len(FakeBot.instances) == 1


def test_backoff_restarts_after_a_healthy_session(supervised):
    FakeBot.behaviours = [RuntimeError("a"), RuntimeError("b"), "ready-then-end",
                          RuntimeError("c"), discord.LoginFailure("stop")]
    asyncio.run(background.Background()._supervise_bot())
    # failures back off 5, 10; the healthy run resets to 5; the next failure starts doubling again
    assert supervised == [5, 10, 5, 10]


def test_slash_command_sync_failure_does_not_kill_the_bot(monkeypatch):
    from app.bot.client import ChronomancerBot

    async def go():
        bot = ChronomancerBot()

        async def boom(*a, **k):
            raise discord.HTTPException(type("R", (), {"status": 429, "reason": "Too Many"})(), "rate limited")

        monkeypatch.setattr(bot.tree, "sync", boom)
        monkeypatch.setattr(config, "DISCORD_DEV_GUILD_ID", "")
        await bot.setup_hook()  # must not raise
        await bot.close()

    asyncio.run(go())


# ------------------------------------------------ DST, validation, uniform 404s


def test_spring_forward_window_has_no_duplicate_slots():
    slots = generate_slots(date(2026, 3, 8), date(2026, 3, 8), time(0), time(6),
                           "America/Los_Angeles", 30)
    assert len(slots) == len(set(slots)) == 10  # five elapsed hours, not six
    assert slots == sorted(slots)


def test_fall_back_window_keeps_the_repeated_hour():
    slots = generate_slots(date(2026, 11, 1), date(2026, 11, 1), time(0), time(4),
                           "America/Los_Angeles", 30)
    assert len(slots) == len(set(slots)) == 10  # five elapsed hours: the 1am hour happens twice
    assert slots == sorted(slots)


def test_ordinary_days_are_unchanged():
    slots = generate_slots(date(2026, 6, 10), date(2026, 6, 10), time(18), time(22),
                           "America/Los_Angeles", 30)
    assert len(slots) == 8 and slots[0] == datetime(2026, 6, 11, 1, 0, tzinfo=timezone.utc)


def test_duration_that_needs_more_slots_than_the_window_has_is_rejected(db):
    campaign, _ = make_campaign(db)
    with pytest.raises(ServiceError) as exc:
        open_poll(db, campaign, slot_minutes=45, window_start=time(18), window_end=time(22),
                  duration_min=240)  # 4h window = 5 whole 45-minute slots; 4h needs 6
    assert exc.value.status == 422


def test_absurd_timezone_strings_are_422_not_500(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    body = {"date_start": "2026-12-01", "window_start": "18:00:00",
            "window_end": "22:00:00", "duration_min": 120}
    for tz in ("x" * 5000, "Mars/Base", "../../etc/passwd", "", "\x00"):
        assert client.post(f"/api/campaigns/{cid}/polls", json={**body, "timezone": tz}).status_code == 422, tz


def test_poll_endpoints_do_not_reveal_which_ids_exist(client):
    login(client, "1", "DM")
    cid = client.post("/api/campaigns", json={"name": "x"}).json()["id"]
    pid = client.post(f"/api/campaigns/{cid}/polls", json={
        "timezone": "UTC", "date_start": "2026-12-01",
        "window_start": "18:00:00", "window_end": "22:00:00", "duration_min": 120}).json()["id"]
    outsider = make_client()
    login(outsider, "99", "Stranger")
    real = outsider.get(f"/api/polls/{pid}")
    fake = outsider.get("/api/polls/987654")
    assert (real.status_code, real.json()) == (fake.status_code, fake.json())


def test_join_is_safe_to_repeat(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    player = make_client()
    login(player, "2", "Aria")
    for _ in range(3):
        assert player.post("/api/join", json={"invite_code": camp["invite_code"]}).status_code == 200
    assert len(client.get(f"/api/campaigns/{camp['id']}").json()["members"]) == 2


def test_campaign_json_says_whether_it_is_linked_to_discord(client):
    login(client, "1", "DM")
    camp = client.post("/api/campaigns", json={"name": "x"}).json()
    assert camp["discord_linked"] is False
    with fresh() as db:
        row = db.get(Campaign, camp["id"])
        row.guild_id, row.channel_id = "1", "2"
        db.commit()
    assert client.get(f"/api/campaigns/{camp['id']}").json()["discord_linked"] is True


# ------------------------------------------------ message content


def test_organizer_text_cannot_inject_markdown_or_mentions_into_embeds(db):
    campaign, owner = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign, title="[Free nitro](https://evil.example) @everyone **x**")
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    services.close_poll(db, poll)
    snap = load_poll_snapshot(db, poll.id)
    title = vote_embed(snap).title
    # The opening bracket is backslash-escaped, so Discord shows literal text, not a link.
    assert r"\[Free nitro]" in title and r"\*\*x\*\*" in title
    assert "@everyone" not in title  # a zero-width space breaks the mention
    services.confirm_poll(db, poll)
    done = confirmed_embed(load_poll_snapshot(db, poll.id)).description
    assert r"\[Free nitro]" in done and "@everyone" not in done


def test_frozen_vote_message_no_longer_asks_for_votes(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    embed = vote_embed(load_poll_snapshot(db, poll.id))
    assert "Cast your vote" not in embed.description and "ended" in embed.description


def test_cancelled_embed_wording(db):
    _, poll, _ = voting_poll(db)
    services.cancel_poll(db, poll)
    assert "burned" in cancelled_embed(load_poll_snapshot(db, poll.id)).description


# ------------------------------------------------ squatting, ported to the consolidated commands


def test_a_squatted_channel_can_be_reclaimed_by_a_server_admin(db):
    squatter = DUser("66", "Squatter", can_manage=True)
    actions.cmd_setup(db, squatter, GUILD, CHANNEL, name="Squat")
    # the rightful group's manager is not the organizer of the squatter's campaign...
    with pytest.raises(ServiceError):
        actions.cmd_setup(db, ARIA, GUILD, CHANNEL, name="Real")      # an ordinary member: refused
    # ...but an admin can free the channel, and the real group can claim it
    actions.cmd_unlink(db, ADMIN, GUILD, CHANNEL)
    assert services.campaign_for_channel(db, GUILD, CHANNEL) is None
    actions.cmd_setup(db, DM, GUILD, CHANNEL, name="Real")
    assert services.campaign_for_channel(db, GUILD, CHANNEL).name == "Real"

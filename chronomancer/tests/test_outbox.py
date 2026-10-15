import asyncio
import re
from datetime import datetime, timedelta, timezone

import discord
import pytest
from sqlalchemy import select

from app import services
from app.bot import outbox as outbox_mod
from app.bot.outbox import OutboxProcessor
from app.bot.snapshots import load_poll_snapshot
from app.bot.views import (
    CONFIRM_TEMPLATE, VOTE_TEMPLATE, ConfirmButton, VoteButton, build_vote_view,
    confirmed_embed, vote_embed,
)
from app.models import Notification, PollMessage

from helpers import CHANNEL, GUILD, fresh, make_campaign, open_poll, voting_poll


class FakeResponse:
    status = 404
    reason = "Not Found"


class FakeMessage:
    def __init__(self, channel, message_id, embed, view):
        self.channel, self.id, self.embed, self.view = channel, message_id, embed, view
        self.edits = []

    async def edit(self, **kwargs):
        self.edits.append(kwargs)


class FakeChannel:
    def __init__(self, channel_id):
        self.id = int(channel_id)
        self.sent = []
        self.by_id = {}
        self.missing_messages = False

    async def send(self, *, content=None, embed=None, view=None, allowed_mentions=None):
        msg = FakeMessage(self, 9000 + len(self.sent), embed, view)
        msg.content, msg.allowed_mentions = content, allowed_mentions
        self.sent.append(msg)
        self.by_id[msg.id] = msg
        return msg

    def get_partial_message(self, message_id):
        channel = self

        class Partial:
            async def edit(self, **kwargs):
                if channel.missing_messages:
                    raise discord.NotFound(FakeResponse(), "Unknown Message")
                await channel.by_id[message_id].edit(**kwargs)

        return Partial()


class FakeEvent:
    def __init__(self, event_id, kwargs, guild):
        self.id, self.kwargs, self.guild, self.deleted = event_id, kwargs, guild, False

    async def delete(self, *, reason=None):
        self.deleted = True
        self.guild.events.pop(self.id, None)


class FakeHttp:
    """Discord's REST API for scheduled events, as the repeating-event code calls it. Like the
    real thing it refuses a request that lacks the fields Discord requires."""

    def __init__(self, guild):
        self.guild = guild
        self.calls = []            # (method, event_id, payload)
        self.reject_rules = False  # answer 400 to anything carrying a recurrence_rule

    async def request(self, route, **kwargs):
        payload = kwargs.get("json")
        event_id = route.url.rstrip("/").rsplit("/", 1)[-1] if route.url.count("/scheduled-events/") else None
        self.calls.append((route.method, event_id, payload))
        if payload is not None:
            for field in ("name", "entity_type", "entity_metadata", "scheduled_start_time",
                          "scheduled_end_time", "privacy_level"):
                assert field in payload or route.method == "PATCH", f"{field} is required"
            if self.reject_rules and "recurrence_rule" in payload:
                raise discord.HTTPException(type("R", (), {"status": 400, "reason": "bad"})(), "bad rule")
        store = self.guild.series
        if route.method == "DELETE" and event_id and int(event_id) in self.guild.events:
            self.guild.events.pop(int(event_id))  # an event made earlier through discord.py's own call
            return
        if route.method == "POST":
            self.guild._next += 1
            store[str(self.guild._next)] = dict(payload)
            return {"id": str(self.guild._next)}
        if event_id not in store:
            raise discord.NotFound(FakeResponse(), "Unknown Scheduled Event")
        if route.method == "PATCH":
            store[event_id].update(payload)
            return store[event_id]
        del store[event_id]


class FakeGuild:
    """Just enough of discord.Guild for scheduled events."""

    def __init__(self, can_create=True):
        self.id = int(GUILD)
        self.series = {}  # event id -> fields: events made through the raw API (repeating ones)
        self._state = type("State", (), {})()
        self._state.http = FakeHttp(self)
        self.events, self.created, self._next = {}, [], 7000
        self.me = type("Me", (), {"guild_permissions": type(
            "P", (), {"create_events": can_create, "manage_events": False})()})()

    async def create_scheduled_event(self, **kwargs):
        # Discord answers 400 (TAG_FIELD_MISSING) unless the event type is stated explicitly.
        assert kwargs.get("entity_type") == discord.EntityType.external, "entity_type is required"
        assert kwargs.get("location") and kwargs.get("end_time"), "external events need both"
        self._next += 1
        event = FakeEvent(self._next, kwargs, self)
        self.events[event.id] = event
        self.created.append(event)
        return event

    async def fetch_scheduled_event(self, event_id):
        if event_id not in self.events:
            raise discord.NotFound(FakeResponse(), "Unknown Scheduled Event")
        return self.events[event_id]


class World:
    """One fake channel and guild plus the processor wired to them."""

    def __init__(self, channel_id=CHANNEL, can_create_events=True):
        self.channel = FakeChannel(channel_id)
        self.guild = FakeGuild(can_create_events)
        self.fail_with = None
        self.processor = OutboxProcessor(self.get_channel, self.get_guild)

    async def get_guild(self, guild_id):
        assert guild_id == int(GUILD), "bot asked for the wrong server"
        return self.guild

    async def get_channel(self, channel_id):
        if self.fail_with:
            raise self.fail_with
        assert channel_id == self.channel.id, "bot asked for the wrong channel"
        return self.channel


def run(coro):
    return asyncio.run(coro)


def notification_rows():
    with fresh() as db:
        return db.scalars(select(Notification).order_by(Notification.id)).all()


def skip_backoff():
    """Pretend the retry delay has elapsed."""
    with fresh() as db:
        for n in db.scalars(select(Notification).where(Notification.processed_at.is_(None))):
            if n.retry_after is not None:
                n.retry_after = datetime.now(timezone.utc) - timedelta(seconds=1)
        db.commit()


# ---------------------------------------------------------------- vote_open


def test_vote_message_is_posted_with_buttons_and_remembered(db):
    campaign, poll, _ = voting_poll(db)
    world = World()

    async def go():
        return await world.processor.run_once()

    assert run(go()) == 1
    assert len(world.channel.sent) == 1
    msg = world.channel.sent[0]
    assert "Choose Your Hour" in msg.embed.title and "Session 5" in msg.embed.title
    ids = [i.item.custom_id for i in msg.view.children]
    assert ids[:-1] == [f"cm:vote:{poll.id}:{c.id}" for c in poll.candidates]
    assert ids[-1] == f"cm:confirm:{poll.id}"
    assert msg.allowed_mentions.everyone is False and msg.allowed_mentions.users is False
    with fresh() as other:
        stored = other.get(PollMessage, poll.id)
        assert (stored.channel_id, stored.message_id) == (CHANNEL, str(msg.id))
    assert all(n.processed_at and n.error is None for n in notification_rows())


def test_running_again_does_not_repost(db):
    voting_poll(db)
    world = World()

    async def go():
        await world.processor.run_once()
        return await world.processor.run_once()

    assert run(go()) == 0
    assert len(world.channel.sent) == 1


def test_concurrent_runs_do_not_double_post(db):
    voting_poll(db)
    world = World()

    async def go():
        await asyncio.gather(*(world.processor.run_once() for _ in range(5)))

    run(go())
    assert len(world.channel.sent) == 1


def test_plain_theme_vote_message_uses_plain_words(db):
    voting_poll(db, theme="plain")
    world = World()
    run(world.processor.run_once())
    assert world.channel.sent[0].embed.title.endswith("Vote for a time")
    assert world.channel.sent[0].view.children[-1].item.label == "Confirm event"


# ---------------------------------------------------------------- confirmed


def test_confirmation_freezes_vote_message_and_announces(db):
    campaign, poll, (owner, aria, _) = voting_poll(db)
    world = World()
    run(world.processor.run_once())
    vote_msg = world.channel.sent[0]
    services.cast_vote(db, poll, aria, poll.candidates[-1].id)
    services.confirm_poll(db, poll)
    run(world.processor.run_once())
    assert len(world.channel.sent) == 2
    assert vote_msg.edits and vote_msg.edits[-1]["view"] is None  # buttons removed
    announcement = world.channel.sent[1].embed
    assert announcement.title == "The Session Is Decreed"
    assert re.search(r"<t:\d+:F>", announcement.description)
    assert "Session 5" in announcement.description


def test_confirmation_still_announces_if_vote_message_was_deleted(db):
    _, poll, _ = voting_poll(db)
    world = World()
    run(world.processor.run_once())
    world.channel.missing_messages = True
    services.confirm_poll(db, poll)
    run(world.processor.run_once())
    assert len(world.channel.sent) == 2  # announcement went out despite NotFound
    assert all(n.processed_at for n in notification_rows())


def test_confirmation_without_a_recorded_vote_message_still_announces(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)  # vote_open never delivered
    world = World()
    run(world.processor.run_once())
    kinds = [m.embed.title for m in world.channel.sent]
    assert "The Session Is Decreed" in kinds


# ---------------------------------------------------------------- failure handling


def test_campaign_without_a_channel_is_skipped_not_retried(db):
    from datetime import date
    from helpers import make_player, mark_all_free
    owner = services.upsert_user(db, "1", "DM")
    campaign, _ = services.create_campaign(db, owner, name="Web only", min_quorum=1)
    poll = open_poll(db, campaign)
    mark_all_free(db, poll, owner)
    services.close_poll(db, poll)
    world = World()
    assert run(world.processor.run_once()) == 1
    row = notification_rows()[0]
    assert row.processed_at and "not linked" in row.error and row.attempts == 1
    assert world.channel.sent == []


def test_transient_failures_are_retried_then_given_up(db):
    voting_poll(db)
    world = World()
    world.fail_with = discord.Forbidden(FakeResponse(), "Missing Access")

    async def go():
        for _ in range(outbox_mod.MAX_ATTEMPTS - 1):
            await world.processor.run_once()
            skip_backoff()
        mid = notification_rows()[0]
        await world.processor.run_once()
        return mid

    mid = run(go())
    assert mid.processed_at is None and mid.attempts == outbox_mod.MAX_ATTEMPTS - 1
    last = notification_rows()[0]
    assert last.processed_at and last.attempts == outbox_mod.MAX_ATTEMPTS
    assert "Forbidden" in last.error
    # and it stays given-up: no further sends even once the channel works again
    world.fail_with = None
    assert run(world.processor.run_once()) == 0 and world.channel.sent == []


def test_recovery_after_a_transient_failure_delivers_exactly_once(db):
    voting_poll(db)
    world = World()
    world.fail_with = RuntimeError("network down")
    run(world.processor.run_once())
    assert world.channel.sent == [] and notification_rows()[0].processed_at is None
    world.fail_with = None
    run(world.processor.run_once())
    assert world.channel.sent == []  # still backing off: not retried immediately
    skip_backoff()
    run(world.processor.run_once())
    run(world.processor.run_once())
    assert len(world.channel.sent) == 1
    assert notification_rows()[0].processed_at


def test_one_bad_notification_does_not_block_the_rest(db):
    _, poll, _ = voting_poll(db)
    with fresh() as other:
        other.add(Notification(kind="mystery", poll_id=poll.id))  # first in line after vote_open
        other.commit()
    services.confirm_poll(db, poll)
    world = World()
    run(world.processor.run_once())
    titles = [m.embed.title for m in world.channel.sent]
    assert any("Choose Your Hour" in t for t in titles) and "The Session Is Decreed" in titles
    rows = notification_rows()
    assert all(r.processed_at for r in rows)
    assert any(r.kind == "mystery" and "unknown" in r.error for r in rows)


# ---------------------------------------------------------------- embeds and buttons


def test_vote_embed_contents_and_limits(db):
    _, poll, (owner, aria, borin) = voting_poll(db, vote_hours=24)
    services.cast_vote(db, poll, aria, poll.candidates[0].id)
    snap = load_poll_snapshot(db, poll.id)

    async def build():
        return vote_embed(snap)

    embed = run(build())
    field = embed.fields[0]
    assert field.name == "Auspicious Times"
    assert field.value.count("<t:") == 2 * len(poll.candidates)  # absolute and relative
    assert "**1** votes" in field.value and "**0** votes" in field.value
    assert any(f.name == "Voting ends" for f in embed.fields)
    assert len(embed.title) <= 256 and len(field.value) <= 1024
    assert embed.footer.text == "120 min"


def test_hostile_titles_cannot_break_the_embed(db):
    from helpers import mark_all_free, make_player
    campaign, owner = make_campaign(db)
    aria = make_player(db, campaign, "2", "Aria")
    poll = open_poll(db, campaign, title="@everyone " + "x" * 110)
    for u in (owner, aria):
        mark_all_free(db, poll, u)
    services.close_poll(db, poll)
    snap = load_poll_snapshot(db, poll.id)
    assert len(vote_embed(snap).title) <= 256


def test_vote_embed_after_confirmation_drops_the_deadline(db):
    _, poll, _ = voting_poll(db, vote_hours=24)
    services.confirm_poll(db, poll)
    embed = vote_embed(load_poll_snapshot(db, poll.id))
    assert all(f.name != "Voting ends" for f in embed.fields)


def test_confirmed_embed_shows_timestamp(db):
    _, poll, _ = voting_poll(db)
    services.confirm_poll(db, poll)
    embed = confirmed_embed(load_poll_snapshot(db, poll.id))
    assert re.search(r"<t:\d+:F>", embed.description) and "?" not in embed.description


def test_button_ids_fit_discord_limits_and_match_templates(db):
    _, poll, _ = voting_poll(db)
    snap = load_poll_snapshot(db, poll.id)

    async def build():
        return build_vote_view(snap)

    view = run(build())
    assert 1 < len(view.children) <= 6
    for child in view.children:
        cid = child.item.custom_id
        assert len(cid) <= 100
        assert re.fullmatch(VOTE_TEMPLATE, cid) or re.fullmatch(CONFIRM_TEMPLATE, cid)
    assert isinstance(view.children[0], VoteButton) and isinstance(view.children[-1], ConfirmButton)
    assert view.timeout is None  # persistent


def test_buttons_can_be_rebuilt_from_custom_id_after_restart():
    async def go():
        vote = await VoteButton.from_custom_id(
            None, discord.ui.Button(label="Vote 2"), re.fullmatch(VOTE_TEMPLATE, "cm:vote:12:345"))
        confirm = await ConfirmButton.from_custom_id(
            None, discord.ui.Button(label="Decree"), re.fullmatch(CONFIRM_TEMPLATE, "cm:confirm:12"))
        return vote, confirm

    vote, confirm = run(go())
    assert (vote.poll_id, vote.candidate_id) == (12, 345) and confirm.poll_id == 12


@pytest.mark.parametrize("cid", ["cm:vote:1", "cm:vote:a:b", "cm:confirm:", "cm:vote:1:2:3 ", "other:vote:1:2"])
def test_malformed_custom_ids_do_not_match(cid):
    assert not re.fullmatch(VOTE_TEMPLATE, cid) and not re.fullmatch(CONFIRM_TEMPLATE, cid)

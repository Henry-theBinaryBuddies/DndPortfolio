"""Commands used inside a thread of the campaign's channel resolve to that channel's campaign."""
import asyncio

import discord

from app import services
from app.bot import actions, commands

from helpers import CHANNEL, GUILD, make_campaign, voting_poll


class FakeParent:
    def __init__(self, channel_id, can_post=True):
        self.id = int(channel_id)
        self._can_post = can_post

    def permissions_for(self, member):
        return type("P", (), {"view_channel": self._can_post, "send_messages": self._can_post,
                              "embed_links": self._can_post})()


class FakeThread(discord.Thread):
    """A thread without a connection: knows its id and its parent channel."""

    def __init__(self, thread_id, parent):
        self.id, self.parent_id, self._parent = thread_id, parent.id, parent

    @property
    def parent(self):
        return self._parent


class FakeResponse:
    def __init__(self):
        self.sent = []

    async def send_message(self, content=None, **kwargs):
        self.sent.append((content, kwargs))


class FakeInteraction:
    def __init__(self, channel, channel_id, user_id=2):
        self.channel, self.channel_id, self.guild_id = channel, channel_id, int(GUILD)
        self.response = FakeResponse()
        self.guild = type("G", (), {"me": object()})()
        self.user = type("U", (), {"id": user_id, "name": "aria", "global_name": "Aria", "avatar": None})()
        self.permissions = type("P", (), {"administrator": False, "manage_guild": False,
                                          "manage_channels": False})()


def run(coro):
    return asyncio.run(coro)


def in_thread(thread_id=9999, parent_id=CHANNEL):
    parent = FakeParent(parent_id)
    thread = FakeThread(thread_id, parent)
    return FakeInteraction(thread, thread.id), parent


def test_the_home_channel_of_a_thread_is_its_parent():
    interaction, parent = in_thread()
    assert commands.home_channel_id(interaction) == int(CHANNEL)
    assert commands.home_channel(interaction) is parent


def test_a_normal_channel_is_its_own_home():
    plain = FakeInteraction(FakeParent(CHANNEL), int(CHANNEL))
    assert commands.home_channel_id(plain) == int(CHANNEL)
    assert commands.home_channel(plain) is plain.channel


def test_schedule_works_from_inside_a_thread(db):
    make_campaign(db)
    interaction, _ = in_thread()
    reply = run(commands._run(interaction, actions.cmd_schedule))
    assert reply is not None and "Curse of Strahd" in interaction.response.sent[0][0]
    assert interaction.response.sent[0][1]["ephemeral"] is True


def test_a_thread_of_another_channel_does_not_find_the_campaign(db):
    make_campaign(db)
    interaction, _ = in_thread(parent_id="777")        # a thread of some other channel
    assert run(commands._run(interaction, actions.cmd_schedule)) is None
    assert "No campaign lives in this channel" in interaction.response.sent[0][0]


def test_setup_inside_a_thread_binds_the_parent_channel_not_the_thread(db):
    interaction, _ = in_thread()
    interaction.permissions = type("P", (), {"administrator": False, "manage_guild": False,
                                             "manage_channels": True})()
    run(commands._run(interaction, actions.cmd_setup, name="Thread-made"))
    campaign = services.campaign_for_channel(db, GUILD, CHANNEL)
    assert campaign is not None and campaign.channel_id == CHANNEL
    assert services.campaign_for_channel(db, GUILD, "9999") is None


def test_buttons_pressed_in_a_thread_are_honoured(db):
    campaign, poll, _ = voting_poll(db)
    interaction, _ = in_thread()
    out = actions.vote_click(db, actions.DUser("2", "Aria"), poll.id, poll.candidates[0].id,
                             interaction.guild_id, commands.home_channel_id(interaction))
    assert out.ok


def test_the_bot_checks_its_permissions_in_the_parent_channel():
    interaction, parent = in_thread()
    interaction.guild = type("G", (), {"me": object()})()
    assert commands._bot_can_post(interaction) is True
    parent._can_post = False
    assert commands._bot_can_post(interaction) is False

"""Slash commands. Thin wrappers: parse Discord input, run an action in a worker thread,
reply. Replies never ping anyone (AllowedMentions.none)."""
import asyncio
import logging
from typing import Optional

import discord
from discord import app_commands

from ..services import ServiceError
from . import actions, wording
from .actions import DUser

log = logging.getLogger("chronomancer.commands")
NO_MENTIONS = discord.AllowedMentions.none()

FREQUENCIES = (("One-off (no repeat)", "none"), ("Weekly", "weekly"), ("Every two weeks", "biweekly"),
               ("Monthly, same weekday (like the 4th Saturday)", "monthly"), ("Annually", "annually"))


def make_duser(interaction: discord.Interaction) -> DUser:
    """Who is acting. Uses the account's global name and avatar, not the per-server nickname
    or avatar, so one server's nickname never overwrites the profile shown in another."""
    user = interaction.user
    perms = interaction.permissions
    return DUser(
        id=str(user.id),
        name=user.global_name or user.name,
        avatar_url=user.avatar.url if user.avatar else None,
        can_manage=bool(perms.administrator or perms.manage_guild or perms.manage_channels),
    )


def home_channel(interaction: discord.Interaction):
    """The channel a campaign is bound to. Inside a thread that is the thread's parent, so the
    group can talk about the schedule in a thread of its channel."""
    channel = interaction.channel
    if isinstance(channel, discord.Thread) and channel.parent is not None:
        return channel.parent
    return channel


def home_channel_id(interaction: discord.Interaction):
    channel = interaction.channel
    if isinstance(channel, discord.Thread):
        return channel.parent_id
    return interaction.channel_id


def _bot_can_make_events(interaction: discord.Interaction) -> bool:
    guild = interaction.guild
    if guild is None or guild.me is None:
        return True  # cannot tell; the outbox reports a real failure
    perms = guild.me.guild_permissions
    return perms.create_events or perms.manage_events


def _bot_can_post(interaction: discord.Interaction) -> bool:
    guild, channel = interaction.guild, home_channel(interaction)
    if guild is None or guild.me is None or channel is None:
        return True  # cannot tell; the outbox will report a real failure later
    perms = channel.permissions_for(guild.me)
    return perms.view_channel and perms.send_messages and perms.embed_links


async def _run(interaction: discord.Interaction, fn, *args, **kwargs) -> actions.Reply | None:
    """Run an action; on a user-facing failure reply ephemerally and return None."""
    try:
        reply = await asyncio.to_thread(
            actions.with_db, lambda db: fn(db, make_duser(interaction), interaction.guild_id,
                                           home_channel_id(interaction), *args, **kwargs))
    except ServiceError as exc:
        await interaction.response.send_message(actions.error_text(exc), ephemeral=True)
        return None
    await interaction.response.send_message(
        reply.text, ephemeral=reply.ephemeral, allowed_mentions=NO_MENTIONS)
    return reply


async def _then_flush(interaction: discord.Interaction, reply) -> None:
    """After a command that queues Discord messages, deliver them now instead of next tick."""
    if reply is None:
        return
    try:
        await interaction.client.outbox.run_once()
    except Exception:  # noqa: BLE001
        log.exception("could not flush outbox after command")


def register(tree: app_commands.CommandTree) -> None:
    theme_choices = [app_commands.Choice(name=wording.words(n).get("label", n), value=n)
                     for n in wording.available_themes()]
    frequency_choices = [app_commands.Choice(name=n, value=v) for n, v in FREQUENCIES]
    group = app_commands.Group(
        name="chronomancer", description="Run your group's schedule", guild_only=True)

    @group.command(name="setup", description="Create this channel's campaign, or change its settings")
    @app_commands.describe(
        name="Campaign name (needed the first time)",
        code="Invite code, to adopt a campaign made on the website",
        frequency="How often the group meets",
        length="Session length in minutes",
        reminders="When to remind the group before a session, like: 1d, 1h, 15m (or off)",
        theme="Wording style",
        events="Create a Discord scheduled event for each confirmed session (default: on)")
    @app_commands.choices(frequency=frequency_choices, theme=theme_choices)
    async def setup(interaction: discord.Interaction, name: Optional[str] = None,
                    code: Optional[str] = None, frequency: Optional[str] = None,
                    length: Optional[app_commands.Range[int, 15, 1440]] = None,
                    reminders: Optional[str] = None,
                    theme: Optional[str] = None, events: Optional[bool] = None):
        if not _bot_can_post(interaction):
            await interaction.response.send_message(
                "I need View Channel, Send Messages and Embed Links in this channel first.",
                ephemeral=True)
            return
        await _run(interaction, actions.cmd_setup, name=name, code=code, frequency=frequency,
                   length=length, reminders=reminders, theme=theme,
                   events=events, events_ok=_bot_can_make_events(interaction))

    @group.command(name="poll", description="Open a poll for one week of availability")
    @app_commands.describe(
        week_start="First of the seven days, like 2026-10-26 (default: today)",
        start="Earliest start each day, like 18:00 (default: 00:00)",
        end="Latest end each day, like 23:00 (default: 24:00, the whole day)",
        title="Name for this session")
    async def poll(interaction: discord.Interaction, week_start: Optional[str] = None,
                   start: str = "00:00", end: str = "24:00", title: str = ""):
        await _run(interaction, actions.cmd_poll, week_start, start, end, title)

    @group.command(name="advance", description="Close the poll into a vote, or decree the winning time")
    @app_commands.describe(vote_hours="When closing: hours the vote stays open (blank: until you advance again)")
    async def advance(interaction: discord.Interaction,
                      vote_hours: Optional[app_commands.Range[int, 1, 336]] = None):
        await _then_flush(interaction, await _run(interaction, actions.cmd_advance, vote_hours))

    @group.command(name="cancel", description="Cancel the open poll, or the next upcoming session")
    async def cancel(interaction: discord.Interaction):
        await _then_flush(interaction, await _run(interaction, actions.cmd_cancel))

    @group.command(name="unlink", description="Free this channel (the group's manager, or anyone who manages it)")
    async def unlink(interaction: discord.Interaction):
        await _run(interaction, actions.cmd_unlink)

    @tree.command(name="schedule", description="Join this group and see what to do next")
    @app_commands.guild_only()
    async def schedule(interaction: discord.Interaction):
        await _run(interaction, actions.cmd_schedule, events_ok=_bot_can_make_events(interaction))

    tree.add_command(group)

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


def _bot_can_post(interaction: discord.Interaction) -> bool:
    guild, channel = interaction.guild, interaction.channel
    if guild is None or guild.me is None or channel is None:
        return True  # cannot tell; the outbox will report a real failure later
    perms = channel.permissions_for(guild.me)
    return perms.view_channel and perms.send_messages and perms.embed_links


async def _run(interaction: discord.Interaction, fn, *args) -> actions.Reply | None:
    """Run an action; on a user-facing failure reply ephemerally and return None."""
    try:
        reply = await asyncio.to_thread(
            actions.with_db, fn, make_duser(interaction), interaction.guild_id, interaction.channel_id, *args
        )
    except ServiceError as exc:
        await interaction.response.send_message(actions.error_text(exc), ephemeral=True)
        return None
    await interaction.response.send_message(
        reply.text, ephemeral=reply.ephemeral, allowed_mentions=NO_MENTIONS
    )
    return reply


async def _flush_outbox(interaction: discord.Interaction) -> None:
    try:
        await interaction.client.outbox.run_once()
    except Exception:  # noqa: BLE001
        log.exception("could not flush outbox after command")


def register(tree: app_commands.CommandTree) -> None:
    theme_choices = [
        app_commands.Choice(name=wording.words(name).get("label", name), value=name)
        for name in wording.available_themes()
    ]
    frequency_choices = [
        app_commands.Choice(name=n, value=v) for n, v in (
            ("One-off (no repeat)", "none"), ("Weekly", "weekly"), ("Every two weeks", "biweekly"),
            ("Monthly", "monthly"), ("Quarterly", "quarterly"), ("Annually", "annually"))
    ]
    group = app_commands.Group(
        name="chronomancer", description="Schedule your group's sessions", guild_only=True
    )

    @group.command(name="create", description="Create a campaign tied to this channel")
    @app_commands.describe(name="Campaign name", duration="Session length in minutes",
                           quorum="Minimum players who must be free for a time to qualify",
                           theme="Wording style", frequency="How often the group meets")
    @app_commands.choices(theme=theme_choices, frequency=frequency_choices)
    async def create(interaction: discord.Interaction, name: str,
                     duration: app_commands.Range[int, 30, 1440] = 180,
                     quorum: app_commands.Range[int, 1, 50] = 2, theme: str = "dnd",
                     frequency: str = "none"):
        if not _bot_can_post(interaction):
            await interaction.response.send_message(
                "I need View Channel, Send Messages and Embed Links in this channel first.",
                ephemeral=True)
            return
        await _run(interaction, actions.cmd_create, name, duration, quorum, theme, frequency)

    @group.command(name="link", description="Tie a campaign made on the website to this channel")
    @app_commands.describe(code="The invite code shown on the campaign page")
    async def link(interaction: discord.Interaction, code: str):
        if not _bot_can_post(interaction):
            await interaction.response.send_message(
                "I need View Channel, Send Messages and Embed Links in this channel first.",
                ephemeral=True)
            return
        await _run(interaction, actions.cmd_link, code)

    @group.command(name="unlink", description="Free this channel (organizer, or anyone who manages the channel)")
    async def unlink(interaction: discord.Interaction):
        await _run(interaction, actions.cmd_unlink)

    @group.command(name="frequency", description="Set how often the group meets (organizer only)")
    @app_commands.describe(frequency="How often the group meets")
    @app_commands.choices(frequency=frequency_choices)
    async def frequency(interaction: discord.Interaction, frequency: str):
        await _run(interaction, actions.cmd_frequency, frequency)

    @group.command(name="reminders", description="Set when the group is reminded before a session")
    @app_commands.describe(when="Time(s) before the session, like: 1d, 1h, 15m (or off)")
    async def reminders(interaction: discord.Interaction, when: str):
        await _run(interaction, actions.cmd_reminders, when)

    @group.command(name="poll", description="Open a poll for one week of availability")
    @app_commands.describe(
        week_start="First of the seven days, like 2026-10-26 (blank: the next week per your frequency)",
        start="Earliest start each day, like 18:00", end="Latest end each day, like 23:00",
        length="Session length in minutes (default: the campaign's)",
        timezone="Timezone for start/end, like America/Los_Angeles (default UTC)",
        title="Name for this session",
        quorum="Minimum players who must be free (default: the campaign's)")
    async def poll(interaction: discord.Interaction, week_start: Optional[str] = None,
                   start: str = "18:00", end: str = "23:00",
                   length: Optional[app_commands.Range[int, 15, 1440]] = None,
                   timezone: str = "UTC", title: str = "",
                   quorum: Optional[app_commands.Range[int, 1, 50]] = None):
        await _run(interaction, actions.cmd_poll, week_start, start, end,
                   length, timezone, title, quorum)

    @group.command(name="close", description="Close the poll and put the best times to a vote")
    @app_commands.describe(vote_hours="Hours the vote stays open (blank: until you confirm)")
    async def close(interaction: discord.Interaction,
                    vote_hours: Optional[app_commands.Range[int, 1, 336]] = None):
        if await _run(interaction, actions.cmd_close, vote_hours):
            await _flush_outbox(interaction)

    @group.command(name="confirm", description="Confirm the winning time now")
    async def confirm(interaction: discord.Interaction):
        if await _run(interaction, actions.cmd_confirm):
            await _flush_outbox(interaction)

    @group.command(name="cancel", description="Abandon the open poll so you can start a new one")
    async def cancel(interaction: discord.Interaction):
        if await _run(interaction, actions.cmd_cancel):
            await _flush_outbox(interaction)

    @group.command(name="repost", description="Post the vote message again")
    async def repost(interaction: discord.Interaction):
        if await _run(interaction, actions.cmd_repost):
            await _flush_outbox(interaction)

    @group.command(name="status", description="See who has responded")
    async def status(interaction: discord.Interaction):
        await _run(interaction, actions.cmd_status)

    @tree.command(name="availability", description="Join this campaign and get the link to mark your times")
    @app_commands.guild_only()
    async def availability(interaction: discord.Interaction):
        await _run(interaction, actions.cmd_availability)

    tree.add_command(group)

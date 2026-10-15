import asyncio
import logging

import discord
from discord import app_commands

from .. import config
from . import actions, commands
from .outbox import OutboxProcessor
from .reminders import ReminderProcessor
from .views import ConfirmButton, VoteButton, vote_embed

log = logging.getLogger("chronomancer.bot")

# View Channels + Send Messages + Embed Links, and Create Events (1 << 44) for scheduled events.
# Create Events lets the bot make and remove its own events, narrower than Manage Events.
INVITE_PERMISSIONS = 1024 | 2048 | 16384 | (1 << 44)


def invite_url() -> str:
    return ("https://discord.com/oauth2/authorize?client_id=%s&permissions=%d"
            "&integration_type=0&scope=bot+applications.commands"
            % (config.DISCORD_CLIENT_ID, INVITE_PERMISSIONS))


class ChronomancerBot(discord.Client):
    def __init__(self):
        # Smallest possible footprint: slash commands and buttons need no privileged intents.
        intents = discord.Intents.none()
        intents.guilds = True
        super().__init__(intents=intents)
        self.tree = app_commands.CommandTree(self)
        self.outbox = OutboxProcessor(self.get_or_fetch_channel, self.get_or_fetch_guild)
        self.reminders = ReminderProcessor(self.get_or_fetch_channel, self.get_or_fetch_user)
        self.tree.on_error = self._on_command_error

    async def setup_hook(self) -> None:
        self.add_dynamic_items(VoteButton, ConfirmButton)
        commands.register(self.tree)
        # A failed sync (rate limit, transient API error) must not stop the bot: the commands
        # synced last time keep working, and buttons/outbox do not depend on the sync.
        try:
            if config.DISCORD_DEV_GUILD_ID:
                guild = discord.Object(id=int(config.DISCORD_DEV_GUILD_ID))
                self.tree.copy_global_to(guild=guild)
                synced = await self.tree.sync(guild=guild)
                log.info("synced %d commands to dev guild", len(synced))
            else:
                synced = await self.tree.sync()
                log.info("synced %d global commands", len(synced))
        except Exception as exc:  # noqa: BLE001
            log.error("slash command sync failed (%s: %s); continuing", type(exc).__name__, exc)

    async def on_ready(self) -> None:
        log.info("bot ready as %s in %d server(s)", self.user, len(self.guilds))
        if not self.guilds:
            log.info("the bot is not in any server yet. Invite it with: %s", invite_url())

    async def get_or_fetch_channel(self, channel_id: int):
        return self.get_channel(channel_id) or await self.fetch_channel(channel_id)

    async def get_or_fetch_guild(self, guild_id: int):
        return self.get_guild(guild_id) or await self.fetch_guild(guild_id)

    async def get_or_fetch_user(self, user_id: int):
        return self.get_user(user_id) or await self.fetch_user(user_id)

    # ------------------------------------------------------------ interactions

    async def _on_command_error(self, interaction: discord.Interaction, error) -> None:
        log.error("command error: %s: %s", type(error).__name__, error)
        message = "Something went wrong. Please try again."
        if interaction.response.is_done():
            await interaction.followup.send(message, ephemeral=True)
        else:
            await interaction.response.send_message(message, ephemeral=True)

    async def _apologise(self, interaction: discord.Interaction) -> None:
        """Last-resort reply so a button never just shows Discord's 'interaction failed'."""
        message = "Something went wrong. Please try again."
        try:
            if interaction.response.is_done():
                await interaction.followup.send(message, ephemeral=True)
            else:
                await interaction.response.send_message(message, ephemeral=True)
        except discord.HTTPException:
            pass

    async def handle_vote(self, interaction: discord.Interaction, poll_id: int, candidate_id: int):
        try:
            outcome = await asyncio.to_thread(
                actions.with_db, actions.vote_click, commands.make_duser(interaction), poll_id,
                candidate_id, interaction.guild_id, commands.home_channel_id(interaction),
            )
            if not (outcome.ok and outcome.snapshot):
                await interaction.response.send_message(outcome.text, ephemeral=True)
                return
            # Refresh the tallies on the public message, then confirm privately.
            await interaction.response.edit_message(embed=vote_embed(outcome.snapshot))
            await interaction.followup.send(outcome.text, ephemeral=True)
        except Exception:  # noqa: BLE001
            log.exception("vote button failed")
            await self._apologise(interaction)

    async def handle_confirm(self, interaction: discord.Interaction, poll_id: int):
        try:
            outcome = await asyncio.to_thread(
                actions.with_db, actions.confirm_click, commands.make_duser(interaction), poll_id,
                interaction.guild_id, commands.home_channel_id(interaction),
            )
            await interaction.response.send_message(outcome.text, ephemeral=True)
        except Exception:  # noqa: BLE001
            log.exception("confirm button failed")
            await self._apologise(interaction)
            return
        if outcome.ok:
            try:
                await self.outbox.run_once()
            except Exception:  # noqa: BLE001
                log.exception("could not flush outbox after confirm")

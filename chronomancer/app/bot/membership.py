"""Keeps group membership honest: people who have left the Discord server stop counting.

Every few hours the bot asks Discord, for each person in a linked campaign, whether they are
still in the server. Those who are not are marked as having left: they no longer count toward
a poll's players, are not pinged or DMed, and lose web access. They come back automatically if
they use /schedule or a vote button again. This needs no privileged intent (it asks about one
member at a time instead of listening for everyone).
"""
import asyncio
import logging
import time

import discord
from sqlalchemy import select

from .. import db as dbmod, services
from ..models import Campaign, Member, User

log = logging.getLogger("chronomancer.membership")

INTERVAL_SECONDS = 6 * 3600
FIRST_RUN_DELAY = 60      # seconds after startup
PAUSE = 0.2               # between lookups, to stay clear of Discord's rate limits
MAX_CHECKS = 500          # per run, so one huge server cannot monopolise the loop


class MembershipSync:
    def __init__(self, get_guild, clock=time.monotonic):
        self._get_guild = get_guild
        self._clock = clock
        self._last = clock() - INTERVAL_SECONDS + FIRST_RUN_DELAY
        self._lock = asyncio.Lock()

    async def run_if_due(self) -> int:
        if self._clock() - self._last < INTERVAL_SECONDS:
            return 0
        return await self.run_once()

    @staticmethod
    def _targets() -> dict:
        """guild id -> [(member row id, discord id)] for people we might need to check.
        Organizers are skipped: a campaign must always have someone able to run it."""
        with dbmod.SessionLocal() as db:
            rows = db.execute(
                select(Campaign.guild_id, Member.id, User.discord_id)
                .join(Member, Member.campaign_id == Campaign.id)
                .join(User, User.id == Member.user_id)
                .where(Campaign.guild_id.is_not(None), Member.left_at.is_(None),
                       Member.role != "organizer")).all()
        grouped = {}
        for guild_id, member_id, discord_id in rows:
            if guild_id.isdigit() and discord_id.isdigit():
                grouped.setdefault(int(guild_id), []).append((member_id, int(discord_id)))
        return grouped

    @staticmethod
    def _mark(member_ids: list) -> int:
        with dbmod.SessionLocal() as db:
            return services.mark_members_left(db, member_ids)

    async def run_once(self) -> int:
        """Returns how many people were found to have left."""
        async with self._lock:
            self._last = self._clock()
            targets = await asyncio.to_thread(self._targets)
            gone, checked = [], 0
            for guild_id, members in targets.items():
                try:
                    guild = await self._get_guild(guild_id)
                except discord.HTTPException:
                    continue  # we cannot see this server: learn nothing rather than mark everyone gone
                for member_id, discord_id in members:
                    if checked >= MAX_CHECKS:
                        break
                    checked += 1
                    try:
                        await guild.fetch_member(discord_id)
                    except discord.NotFound:
                        gone.append(member_id)
                    except discord.HTTPException:
                        pass  # a hiccup is not evidence that someone left
                    if PAUSE:
                        await asyncio.sleep(PAUSE)
            marked = await asyncio.to_thread(self._mark, gone)
            if marked:
                log.info("marked %d member(s) as having left their Discord server", marked)
            return marked

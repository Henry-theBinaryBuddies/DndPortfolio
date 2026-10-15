"""Sends the scheduled 'your session starts soon' reminders: a channel post that mentions the
whole group, plus a DM to each member. Each reminder goes out once, survives restarts, backs
off when Discord is unreachable, and is skipped once the session has started."""
import asyncio
import logging
from dataclasses import dataclass
from datetime import datetime, timezone

import discord
from sqlalchemy import select

from .. import db as dbmod, services
from ..models import Member, Reminder, User
from .outbox import MAX_ATTEMPTS, retry_delay
from .snapshots import PollSnapshot, load_poll_snapshot
from .views import reminder_embed

log = logging.getLogger("chronomancer.reminders")

MAX_MEMBERS = 50      # one channel message mentions at most this many people
DM_PAUSE = 0.25       # seconds between DMs, to stay clear of Discord's rate limits


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class ReminderJob:
    id: int
    offset_min: int
    snap: PollSnapshot | None
    member_ids: list


class ReminderProcessor:
    def __init__(self, get_channel, get_user):
        # get_channel / get_user: async callables(int) -> a messageable / a User
        self._get_channel = get_channel
        self._get_user = get_user
        self._lock = asyncio.Lock()

    async def run_once(self) -> int:
        async with self._lock:
            ids = await asyncio.to_thread(self._due)
            for rid in ids:
                await self._handle(rid)
            return len(ids)

    # -- database work, always on a worker thread --

    @staticmethod
    def _due() -> list:
        with dbmod.SessionLocal() as db:
            return services.due_reminders(db)

    @staticmethod
    def _load(rid: int) -> ReminderJob | None:
        with dbmod.SessionLocal() as db:
            reminder = db.get(Reminder, rid)
            if reminder is None or reminder.sent_at is not None:
                return None
            snap = load_poll_snapshot(db, reminder.poll_id)
            members = []
            if snap is not None:
                members = [int(d) for d in db.scalars(
                    select(User.discord_id).join(Member, Member.user_id == User.id)
                    .where(Member.campaign_id == snap.campaign_id, Member.left_at.is_(None))
                    .order_by(Member.id))
                    if d.isdigit()]
            return ReminderJob(reminder.id, reminder.offset_min, snap, members)

    @staticmethod
    def _finish(rid: int, *, done: bool, error: str | None = None, dm_ok: int = 0,
                dm_failed: int = 0) -> None:
        with dbmod.SessionLocal() as db:
            r = db.get(Reminder, rid)
            if r is None:
                return
            r.attempts += 1
            r.error = error[:300] if error else None
            r.dm_ok, r.dm_failed = dm_ok, dm_failed
            if done or r.attempts >= MAX_ATTEMPTS:
                r.sent_at = _now()  # delivered, or given up: either way never sent again
                r.retry_after = None
            else:
                r.retry_after = _now() + retry_delay(r.attempts)
            db.commit()

    # -- delivery --

    async def _handle(self, rid: int) -> None:
        try:
            job = await asyncio.to_thread(self._load, rid)
            if job is None:
                return
            snap = job.snap
            if snap is None or snap.status != "confirmed" or snap.confirmed_start is None:
                await asyncio.to_thread(self._finish, rid, done=True,
                                        error="session is no longer scheduled")
                return
            if _now() >= snap.confirmed_start:
                await asyncio.to_thread(self._finish, rid, done=True,
                                        error="session had already started")
                return
            ok, failed = await self._deliver(snap, job)
            await asyncio.to_thread(self._finish, rid, done=True, dm_ok=ok, dm_failed=failed)
        except Exception as exc:  # noqa: BLE001  (channel unreachable: back off and retry)
            log.warning("reminder %s failed: %s: %s", rid, type(exc).__name__, exc)
            await asyncio.to_thread(self._finish, rid, done=False, error=f"{type(exc).__name__}: {exc}")

    async def _deliver(self, snap: PollSnapshot, job: ReminderJob) -> tuple:
        ids = job.member_ids[:MAX_MEMBERS]
        embed = reminder_embed(snap)
        if snap.channel_id is not None:
            channel = await self._get_channel(snap.channel_id)
            # The channel post comes first: if it fails, nothing has been DMed yet, so the
            # whole reminder can be retried without anyone getting two copies.
            await channel.send(
                content=" ".join(f"<@{i}>" for i in ids) or None,
                embed=embed,
                # Mention exactly the group's members: never @everyone, never a role.
                allowed_mentions=discord.AllowedMentions(
                    everyone=False, roles=False, users=[discord.Object(id=i) for i in ids]),
            )
        ok = failed = 0
        for uid in ids:
            try:
                user = await self._get_user(uid)
                await user.send(embed=embed)
                ok += 1
            except discord.Forbidden:
                failed += 1  # their DMs are closed; the channel mention already reached them
            except discord.HTTPException as exc:
                failed += 1
                log.info("could not DM a member for reminder (HTTP %s)", getattr(exc, "status", "?"))
            if DM_PAUSE:
                await asyncio.sleep(DM_PAUSE)
        return ok, failed

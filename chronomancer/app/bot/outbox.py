"""Delivers queued notifications to Discord. Durable: rows stay queued while the bot is
offline and are sent on the next run. At-least-once, with exponential backoff, and strictly
in order per poll (a confirmation never overtakes the vote message it follows)."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import discord
from sqlalchemy import select

from .. import db as dbmod
from ..models import Notification, PollMessage
from .snapshots import PollSnapshot, load_poll_snapshot
from .views import (
    build_vote_view, cancelled_embed, confirmed_embed, recurred_embed, session_cancelled_embed,
    vote_embed,
)

log = logging.getLogger("chronomancer.outbox")

# Retry delays: 15s, 30s, 60s, 2m, 4m, 8m, then 10m each. Twelve attempts is roughly an
# hour of outage tolerance before a message is given up on (the organizer can /repost).
MAX_ATTEMPTS = 12
BATCH = 50


def retry_delay(attempts: int) -> timedelta:
    return timedelta(seconds=min(15 * 2 ** (attempts - 1), 600))


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Undeliverable(Exception):
    """Retrying will not help (for example the campaign has no Discord channel)."""


class OutboxProcessor:
    def __init__(self, get_channel):
        # get_channel: async callable(int) -> a messageable channel
        self._get_channel = get_channel
        self._lock = asyncio.Lock()  # command handlers and the timer may both trigger a run

    async def run_once(self) -> int:
        """Deliver everything that is due. One notification per poll is eligible at a time
        (to keep order), so keep going in rounds until nothing more is ready."""
        handled = 0
        async with self._lock:
            for _ in range(20):
                ids = await asyncio.to_thread(self._pending_ids)
                if not ids:
                    break
                for nid in ids:
                    await self._handle(nid)
                handled += len(ids)
        return handled

    # -- database work, always on a worker thread --

    @staticmethod
    def _pending_ids() -> list:
        """Oldest waiting notification per poll, if it is due. Later ones for the same poll
        wait their turn, so ordering is preserved even while an earlier one is backing off."""
        with dbmod.SessionLocal() as db:
            rows = db.execute(
                select(Notification.id, Notification.poll_id, Notification.retry_after)
                .where(Notification.processed_at.is_(None))
                .order_by(Notification.id).limit(BATCH * 4)
            ).all()
        now = _now()
        seen, ready = set(), []
        for nid, poll_id, retry_after in rows:
            if poll_id in seen:
                continue
            seen.add(poll_id)
            if retry_after is None or retry_after <= now:
                ready.append(nid)
        return ready[:BATCH]

    @staticmethod
    def _load(nid: int):
        with dbmod.SessionLocal() as db:
            n = db.get(Notification, nid)
            if n is None or n.processed_at is not None:
                return None
            return n.kind, load_poll_snapshot(db, n.poll_id)

    @staticmethod
    def _finish(nid: int, error: str | None, done: bool) -> None:
        with dbmod.SessionLocal() as db:
            n = db.get(Notification, nid)
            if n is None:
                return
            n.attempts += 1
            n.error = error[:300] if error else None
            if done or n.attempts >= MAX_ATTEMPTS:
                n.processed_at = _now()
                n.retry_after = None
            else:
                n.retry_after = _now() + retry_delay(n.attempts)
            db.commit()

    @staticmethod
    def _store_message(poll_id: int, channel_id: int, message_id: int) -> None:
        with dbmod.SessionLocal() as db:
            row = db.get(PollMessage, poll_id)
            if row is None:
                db.add(PollMessage(poll_id=poll_id, channel_id=str(channel_id),
                                   message_id=str(message_id)))
            else:
                row.channel_id, row.message_id = str(channel_id), str(message_id)
            db.commit()

    # -- delivery --

    async def _handle(self, nid: int) -> None:
        try:
            loaded = await asyncio.to_thread(self._load, nid)
            if loaded is None:
                return
            kind, snap = loaded
            if snap is None:
                raise Undeliverable("poll no longer exists")
            if snap.channel_id is None:
                raise Undeliverable("campaign is not linked to a Discord channel")
            handler = {
                "vote_open": self._send_vote,
                "vote_update": self._refresh_vote,
                "confirmed": self._send_confirmed,
                "recurred": self._send_recurred,
                "cancelled": self._retire_vote,
            }.get(kind)
            if handler is None:
                raise Undeliverable(f"unknown notification kind {kind!r}")
            await handler(snap)
            await asyncio.to_thread(self._finish, nid, None, True)
        except Undeliverable as exc:
            log.warning("notification %s skipped: %s", nid, exc)
            await asyncio.to_thread(self._finish, nid, str(exc), True)
        except Exception as exc:  # noqa: BLE001  (network, permissions: back off and retry)
            log.warning("notification %s failed: %s: %s", nid, type(exc).__name__, exc)
            await asyncio.to_thread(self._finish, nid, f"{type(exc).__name__}: {exc}", False)

    async def _edit_original(self, snap: PollSnapshot, **changes) -> None:
        """Edit the poll's vote message in place. Uses a partial message, which needs no
        Read Message History permission. Best effort: the message may have been deleted."""
        if not (snap.message_id and snap.message_channel_id):
            return
        try:
            where = await self._get_channel(snap.message_channel_id)
            await where.get_partial_message(snap.message_id).edit(**changes)
        except Exception as exc:  # noqa: BLE001
            log.info("could not edit vote message for poll %s: %s", snap.poll_id, exc)

    async def _send_vote(self, snap: PollSnapshot) -> None:
        channel = await self._get_channel(snap.channel_id)
        if snap.message_id:  # a repost: retire the old buttons first
            await self._edit_original(snap, view=None)
        message = await channel.send(
            embed=vote_embed(snap), view=build_vote_view(snap),
            allowed_mentions=discord.AllowedMentions.none(),
        )
        await asyncio.to_thread(self._store_message, snap.poll_id, channel.id, message.id)

    async def _refresh_vote(self, snap: PollSnapshot) -> None:
        if snap.status == "voting":
            await self._edit_original(snap, embed=vote_embed(snap))

    async def _send_confirmed(self, snap: PollSnapshot) -> None:
        await self._edit_original(snap, embed=vote_embed(snap), view=None)  # freeze final tallies
        channel = await self._get_channel(snap.channel_id)
        await channel.send(embed=confirmed_embed(snap),
                           allowed_mentions=discord.AllowedMentions.none())

    async def _send_recurred(self, snap: PollSnapshot) -> None:
        if snap.status != "confirmed":  # cancelled or replaced before the announcement went out
            return
        channel = await self._get_channel(snap.channel_id)
        await channel.send(embed=recurred_embed(snap), allowed_mentions=discord.AllowedMentions.none())

    async def _retire_vote(self, snap: PollSnapshot) -> None:
        await self._edit_original(snap, embed=cancelled_embed(snap), view=None)
        if snap.confirmed_start is not None:  # a decided session was called off: say so
            channel = await self._get_channel(snap.channel_id)
            await channel.send(embed=session_cancelled_embed(snap),
                               allowed_mentions=discord.AllowedMentions.none())

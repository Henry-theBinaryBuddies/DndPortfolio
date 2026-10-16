"""Delivers queued notifications to Discord. Durable: rows stay queued while the bot is
offline and are sent on the next run. At-least-once, with exponential backoff, and strictly
in order per poll (a confirmation never overtakes the vote message it follows)."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

import discord
from sqlalchemy import select

from .. import db as dbmod
from ..models import Campaign, DiscordCleanup, Notification, Poll, PollMessage
from . import events
from .snapshots import PollSnapshot, load_poll_snapshot
from .views import (
    build_vote_view, cancelled_embed, confirmed_embed, recurred_embed, reschedule_embed,
    session_cancelled_embed, vote_embed,
)

log = logging.getLogger("chronomancer.outbox")

# Retry delays: 15s, 30s, 60s, 2m, 4m, 8m, then 10m each. Twelve attempts is roughly an
# hour of outage tolerance before a message is given up on (the failure is kept in the row's error).
MAX_ATTEMPTS = 12
BATCH = 50


def retry_delay(attempts: int) -> timedelta:
    return timedelta(seconds=min(15 * 2 ** (attempts - 1), 600))


def _now() -> datetime:
    return datetime.now(timezone.utc)


class Undeliverable(Exception):
    """Retrying will not help (for example the campaign has no Discord channel)."""


class OutboxProcessor:
    def __init__(self, get_channel, get_guild=None):
        # get_channel / get_guild: async callables(int) -> a messageable channel / a guild
        self._get_channel = get_channel
        self._get_guild = get_guild
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
            handled += await self._drain_cleanup()
        return handled

    # -- clearing out Discord after a group was deleted --

    @staticmethod
    def _cleanup_due() -> list:
        with dbmod.SessionLocal() as db:
            now = _now()
            rows = db.scalars(select(DiscordCleanup).where(DiscordCleanup.processed_at.is_(None))
                              .order_by(DiscordCleanup.id).limit(BATCH * 4)).all()
            return [(r.id, r.kind, r.guild_id, r.channel_id, r.target_id) for r in rows
                    if r.retry_after is None or r.retry_after <= now][:BATCH]

    @staticmethod
    def _cleanup_finish(cid: int, error: str | None, done: bool) -> None:
        with dbmod.SessionLocal() as db:
            row = db.get(DiscordCleanup, cid)
            if row is None:
                return
            row.attempts += 1
            row.error = error[:300] if error else None
            if done or row.attempts >= MAX_ATTEMPTS:
                row.processed_at, row.retry_after = _now(), None
            else:
                row.retry_after = _now() + retry_delay(row.attempts)
            db.commit()

    async def _drain_cleanup(self) -> int:
        """Remove the Discord events and retire the vote buttons of deleted groups. Safe to
        repeat: an event or message that is already gone counts as done."""
        rows = await asyncio.to_thread(self._cleanup_due)
        for cid, kind, guild_id, channel_id, target_id in rows:
            try:
                if kind == "event":
                    if not guild_id or self._get_guild is None:
                        raise Undeliverable("the Discord server is not known")
                    guild = await self._get_guild(int(guild_id))
                    await events.delete(guild, target_id, "Chronomancer: group deleted")
                else:
                    if not channel_id:
                        raise Undeliverable("the channel is not known")
                    where = await self._get_channel(int(channel_id))
                    try:
                        await where.get_partial_message(int(target_id)).edit(
                            embed=discord.Embed(title="Poll closed",
                                                description="This group was deleted, so voting is over."),
                            view=None)
                    except discord.NotFound:
                        pass  # the message is already gone
                await asyncio.to_thread(self._cleanup_finish, cid, None, True)
            except (Undeliverable, discord.Forbidden, discord.NotFound) as exc:
                log.warning("cleanup %s skipped: %s", cid, exc)  # retrying cannot help
                await asyncio.to_thread(self._cleanup_finish, cid, f"{type(exc).__name__}: {exc}", True)
            except Exception as exc:  # noqa: BLE001  (network trouble: back off and try again)
                log.warning("cleanup %s failed: %s: %s", cid, type(exc).__name__, exc)
                await asyncio.to_thread(self._cleanup_finish, cid, f"{type(exc).__name__}: {exc}", False)
        return len(rows)

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
    def _store_event(poll_id: int, event_id: str | None, guild_id=None) -> None:
        with dbmod.SessionLocal() as db:
            poll = db.get(Poll, poll_id)
            if poll is None:
                if event_id is not None:  # the group was deleted while this event was being made
                    db.add(DiscordCleanup(kind="event", guild_id=str(guild_id) if guild_id else None,
                                          target_id=str(event_id)))
                    db.commit()
                return
            poll.discord_event_id = event_id
            if guild_id is not None:
                poll.campaign.events_guild_id = str(guild_id)
            db.commit()

    @staticmethod
    def _store_series(campaign_id: int, event_id: str | None, sig: str | None, guild_id=None) -> None:
        with dbmod.SessionLocal() as db:
            campaign = db.get(Campaign, campaign_id)
            if campaign is None:
                if event_id is not None:  # the group was deleted while this event was being made
                    db.add(DiscordCleanup(kind="event", guild_id=str(guild_id) if guild_id else None,
                                          target_id=str(event_id)))
                    db.commit()
                return
            campaign.series_event_id, campaign.series_event_sig = event_id, sig
            if guild_id is not None:
                campaign.events_guild_id = str(guild_id)
            db.commit()

    @staticmethod
    def _store_message(poll_id: int, channel_id: int, message_id: int) -> None:
        with dbmod.SessionLocal() as db:
            if db.get(Poll, poll_id) is None:  # deleted while the vote message was being posted
                db.add(DiscordCleanup(kind="message", channel_id=str(channel_id), target_id=str(message_id)))
                db.commit()
                return
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
            # Removing events must still work after the channel was unlinked.
            if snap.channel_id is None and not (kind == "event_sync" and snap.events_guild_id):
                raise Undeliverable("campaign is not linked to a Discord channel")
            handler = {
                "vote_open": self._send_vote,
                "vote_update": self._refresh_vote,
                "confirmed": self._send_confirmed,
                "recurred": self._send_recurred,
                "reschedule": self._send_reschedule,
                "event_sync": self._sync_event,
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
        if snap.message_id:  # a vote message already exists (a repeat delivery): retire its buttons first
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

    async def _sync_event(self, snap: PollSnapshot) -> None:
        """Keep Discord's scheduled events in step with the group. A repeating group has ONE
        repeating event, moved to follow its next session; a one-off group has one event per
        decided session. Everything is removed when events are off or the channel is unlinked."""
        guild_id = snap.guild_id or snap.events_guild_id
        series_wanted = snap.events_enabled and snap.linked and snap.cadence != "none"
        single_wanted = (snap.status == "confirmed" and snap.events_enabled and snap.linked
                         and snap.cadence == "none"
                         and snap.confirmed_start is not None and snap.confirmed_start > _now())
        stale_series = bool(snap.series_event_id) and not series_wanted
        moved_series = series_wanted and snap.next_start is not None and not (
            snap.series_event_id and snap.series_event_sig == self._series_sig(snap))
        replaced_single = series_wanted and bool(snap.discord_event_id)
        wrong_single = not series_wanted and single_wanted != bool(snap.discord_event_id)
        if not (stale_series or moved_series or replaced_single or wrong_single):
            return  # already as it should be
        if self._get_guild is None or guild_id is None:
            raise Undeliverable("cannot reach the Discord server")
        guild = await self._get_guild(guild_id)
        if snap.series_event_id and not series_wanted:
            await events.delete(guild, snap.series_event_id, "Chronomancer: events turned off or group changed")
            await asyncio.to_thread(self._store_series, snap.campaign_id, None, None)
            snap.series_event_id = snap.series_event_sig = None
        if series_wanted:
            await self._sync_series(guild, snap)
            if snap.discord_event_id:  # this session's one-off event is replaced by the series
                await events.delete(guild, snap.discord_event_id, "Chronomancer: now a repeating event")
                await asyncio.to_thread(self._store_event, snap.poll_id, None)
            return
        await self._sync_single(guild, snap, single_wanted)

    @staticmethod
    def _series_payload(snap: PollSnapshot) -> dict:
        start = snap.next_start
        return events.event_payload(
            name=snap.next_title, start=start, end=start + timedelta(minutes=snap.next_duration),
            location=snap.campaign_url,
            description=f"{snap.campaign_name}: scheduled with Chronomancer. Details: {snap.campaign_url}",
            rule=events.recurrence_rule(snap.cadence, start))

    @classmethod
    def _series_sig(cls, snap: PollSnapshot) -> str:
        return events.signature(cls._series_payload(snap))

    async def _sync_series(self, guild, snap: PollSnapshot) -> None:
        if snap.next_start is None:
            return  # nothing decided to point at: leave the event as it is
        payload = self._series_payload(snap)
        sig = events.signature(payload)
        if snap.series_event_id and snap.series_event_sig == sig:
            return
        perms = guild.me.guild_permissions if guild.me is not None else None
        if perms is not None and not (perms.create_events or perms.manage_events):
            raise Undeliverable("missing the Create Events permission")
        event_id = snap.series_event_id
        if event_id:
            try:
                await events.send(guild, "PATCH", event_id, payload, "Chronomancer: session moved")
            except discord.NotFound:
                event_id = None  # deleted by hand: make it again
        if not event_id:
            created = await events.send(guild, "POST", None, payload, "Chronomancer: session confirmed")
            event_id = str(created["id"])
        await asyncio.to_thread(self._store_series, snap.campaign_id, event_id, sig, guild.id)

    async def _sync_single(self, guild, snap: PollSnapshot, wanted: bool) -> None:
        if wanted == bool(snap.discord_event_id):
            return
        if not wanted:
            try:
                await (await guild.fetch_scheduled_event(int(snap.discord_event_id))).delete(
                    reason="Chronomancer: session cancelled or events turned off")
            except discord.NotFound:
                pass  # someone already removed it
            await asyncio.to_thread(self._store_event, snap.poll_id, None)
            return
        perms = guild.me.guild_permissions if guild.me is not None else None
        if perms is not None and not (perms.create_events or perms.manage_events):
            raise Undeliverable("missing the Create Events permission")
        event = await guild.create_scheduled_event(
            name=snap.display_title[:100],
            start_time=snap.confirmed_start, end_time=snap.session_end,
            entity_type=discord.EntityType.external,  # discord.py will not guess it from a location
            location=snap.campaign_url[:100], privacy_level=discord.PrivacyLevel.guild_only,
            description=f"{snap.campaign_name}: scheduled with Chronomancer. Details: {snap.campaign_url}"[:1000],
            reason="Chronomancer: session confirmed",
        )
        await asyncio.to_thread(self._store_event, snap.poll_id, str(event.id), guild.id)

    async def _send_reschedule(self, snap: PollSnapshot) -> None:
        if snap.status != "collecting":  # already closed or cancelled before this went out
            return
        channel = await self._get_channel(snap.channel_id)
        ids = snap.member_ids[:50]
        await channel.send(
            content=" ".join(f"<@{i}>" for i in ids) or None, embed=reschedule_embed(snap),
            allowed_mentions=discord.AllowedMentions(
                everyone=False, roles=False, users=[discord.Object(id=i) for i in ids]))

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

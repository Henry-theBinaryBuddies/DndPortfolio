"""Background work that lives alongside the web server: the Discord bot (supervised), auto-
confirming polls whose vote deadline has passed, and delivering queued Discord messages."""
import asyncio
import logging
import time

from . import config, db as dbmod, services

log = logging.getLogger("chronomancer.background")

BOT_RETRY_MIN = 5
BOT_RETRY_MAX = 300


def _db_tick() -> tuple:
    """The time-driven database work: confirm votes whose deadline passed, and schedule the
    next session of repeating groups whose latest session just ended."""
    with dbmod.SessionLocal() as db:
        confirmed, scheduled = services.auto_confirm_due(db), services.roll_recurrences(db)
        services.purge_expired_web_sessions(db)
        return confirmed, scheduled


def _compact() -> int:
    with dbmod.SessionLocal() as db:
        return services.compact_finished_polls(db)


class Background:
    def __init__(self):
        self.bot = None
        self._tasks: list = []
        self._next_compaction = None  # monotonic time; None until the first tick

    async def start(self) -> None:
        if config.BOT_ENABLED:
            self._tasks.append(asyncio.create_task(self._supervise_bot(), name="discord-bot"))
        if config.BACKGROUND_ENABLED:
            self._tasks.append(asyncio.create_task(self._loop(), name="background-loop"))

    async def _supervise_bot(self) -> None:
        """Keep the bot running. discord.py already reconnects after network drops; this
        covers failures it does not retry (an API hiccup while logging in, an exception in
        setup). A rejected token is permanent, so that one stops with a clear message."""
        import discord  # imported lazily: discord.py is heavy and unused when the bot is off

        from .bot.client import ChronomancerBot

        delay = BOT_RETRY_MIN
        while True:
            bot = ChronomancerBot()
            self.bot = bot
            outcome = "stopped"
            try:
                await bot.start(config.DISCORD_BOT_TOKEN)
            except asyncio.CancelledError:
                raise
            except discord.LoginFailure:
                log.error("Discord rejected the bot token. Fix DISCORD_BOT_TOKEN and restart. "
                          "The website keeps running without the bot.")
                self.bot = None
                return
            except Exception as exc:  # noqa: BLE001
                outcome = f"failed ({type(exc).__name__}: {exc})"
            if bot.is_ready():
                delay = BOT_RETRY_MIN  # it had been healthy: start the backoff over
            log.error("Discord bot %s; restarting in %ds", outcome, delay)
            try:
                await bot.close()
            except Exception:  # noqa: BLE001
                pass
            await asyncio.sleep(delay)
            delay = min(delay * 2, BOT_RETRY_MAX)

    async def _loop(self) -> None:
        while True:
            try:
                confirmed, scheduled = await asyncio.to_thread(_db_tick)
                if confirmed:
                    log.info("auto-confirmed polls %s", confirmed)
                if scheduled:
                    log.info("scheduled the next session (polls %s)", scheduled)
                bot = self.bot
                if bot is not None and bot.is_ready():
                    await bot.outbox.run_once()
                    await bot.reminders.run_once()
                    await bot.membership.run_if_due()
                await self._compact_if_due()
            except asyncio.CancelledError:
                raise
            except Exception:  # noqa: BLE001
                log.exception("background tick failed")
            await asyncio.sleep(config.TICK_SECONDS)

    async def _compact_if_due(self) -> None:
        """Slim old history now and then. It runs after the Discord work, never delaying it, in its own
        try block so a failure cannot disturb anything else, and the next run is scheduled first so a
        failing sweep retries on the interval instead of every tick. The first run waits a minute."""
        if not config.COMPACT_ENABLED:
            return
        now = time.monotonic()
        if self._next_compaction is None:
            self._next_compaction = now + 60
            return
        if now < self._next_compaction:
            return
        self._next_compaction = now + config.COMPACT_EVERY_SECONDS
        try:
            removed = await asyncio.to_thread(_compact)
            if removed:
                log.info("compacted old availability: %d rows removed", removed)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001
            log.exception("history compaction failed; will retry later")

    async def stop(self) -> None:
        for task in self._tasks:
            task.cancel()
        for task in self._tasks:
            try:
                await task
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass
        if self.bot is not None:
            await self.bot.close()

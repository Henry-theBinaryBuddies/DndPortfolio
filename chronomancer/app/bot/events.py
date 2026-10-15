"""Discord scheduled events, including the repeating kind. discord.py cannot send a repeat
rule, so these go to Discord's API directly (the same route the library uses, with the
library's own authentication and rate-limit handling)."""
import hashlib
import json
import logging
from datetime import datetime, timezone

import discord
from discord.http import Route

from .. import services

log = logging.getLogger("chronomancer.events")

# Discord's recurrence frequencies (weekday numbers match Python's: Monday is 0).
YEARLY, MONTHLY, WEEKLY = 0, 1, 2


def _iso(when: datetime) -> str:
    return when.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def recurrence_rule(cadence: str, start: datetime) -> dict | None:
    """How Discord should repeat an event that starts at `start`, or None for a one-off group.
    Only what Discord can express is offered: weekly, every two weeks, monthly on the same Nth
    weekday, and yearly on the same date."""
    when = start.astimezone(timezone.utc)
    rule = {"start": _iso(when), "interval": 1}
    if cadence in ("weekly", "biweekly"):
        rule.update(frequency=WEEKLY, interval=2 if cadence == "biweekly" else 1,
                    by_weekday=[when.weekday()])
    elif cadence == "monthly":
        rule.update(frequency=MONTHLY,
                    by_n_weekday=[{"n": services.week_of_month(when.date()), "day": when.weekday()}])
    elif cadence == "annually":
        rule.update(frequency=YEARLY, by_month=[when.month], by_month_day=[when.day])
    else:
        return None
    return rule


def event_payload(*, name: str, start: datetime, end: datetime, location: str, description: str,
                  rule: dict | None) -> dict:
    payload = {
        "name": name[:100],
        "privacy_level": 2,  # guild only
        "entity_type": 3,    # external: a place outside Discord, here the group's web page
        "entity_metadata": {"location": location[:100]},
        "scheduled_start_time": _iso(start),
        "scheduled_end_time": _iso(end),
        "description": description[:1000],
    }
    if rule is not None:
        payload["recurrence_rule"] = rule
    return payload


def signature(payload: dict) -> str:
    """A fingerprint of what an event was last set to, so nothing is sent when nothing changed."""
    return hashlib.sha256(json.dumps(payload, sort_keys=True).encode()).hexdigest()


async def request(guild, method: str, event_id, payload: dict | None = None, reason: str | None = None):
    path = "/guilds/{guild_id}/scheduled-events" + ("/{event_id}" if event_id else "")
    ids = {"guild_id": guild.id, **({"event_id": int(event_id)} if event_id else {})}
    opts = {"reason": reason} if reason else {}
    if payload is not None:
        opts["json"] = payload
    return await guild._state.http.request(Route(method, path, **ids), **opts)


async def send(guild, method: str, event_id, payload: dict, reason: str):
    """Create (POST) or change (PATCH) an event. If Discord rejects the repeat rule, the event
    is still made without it, rather than leaving the group with no event at all."""
    try:
        return await request(guild, method, event_id, payload, reason)
    except discord.HTTPException as exc:
        if getattr(exc, "status", None) != 400 or "recurrence_rule" not in payload:
            raise
        log.warning("Discord refused the repeat rule (%s); making a one-off event instead", exc)
        plain = {k: v for k, v in payload.items() if k != "recurrence_rule"}
        return await request(guild, method, event_id, plain, reason)


async def delete(guild, event_id, reason: str) -> None:
    try:
        await request(guild, "DELETE", event_id, None, reason)
    except discord.NotFound:
        pass  # someone already removed it

"""The two spend protections, and finding who is asking.

* ``RateLimiter`` limits how often one address may start a request (per minute and per hour).
* ``DailyCap`` limits how many AI calls the whole service makes in one UTC day, whoever asks. It is the hard ceiling on
  spend: it lives in the database, so it holds across restarts and across any number of simultaneous visitors.

Both take a clock as an argument. In real use that is the system clock; in tests it is a fake the test moves by hand,
so no test has to wait for time to pass.
"""

import ipaddress
import threading
import time
from collections import deque
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from datetime import UTC, datetime

from cauldron.service.store import MonsterStore


# --- per-address rate limit -----------------------------------------------------------------------------


@dataclass(frozen=True)
class RateDecision:
    allowed: bool
    retry_after: float = 0.0  # seconds until a refused request could succeed


class RateLimiter:
    """A sliding window: for each address, keep the times of its recent requests and count those inside each window.

    ``limits`` is a list of (window in seconds, most requests in that window). Every window must have room for a
    request to be allowed. A refused request is not recorded, so hammering while blocked does not extend the block.
    """

    def __init__(self, limits: Sequence[tuple[float, int]], clock: Callable[[], float] = time.monotonic, max_keys: int = 10_000) -> None:
        self._limits = list(limits)
        self._longest = max(window for window, _ in self._limits)
        self._clock = clock
        self._max_keys = max_keys
        self._hits: dict[str, deque[float]] = {}
        self._lock = threading.Lock()

    @property
    def tracked(self) -> int:
        """How many addresses are currently remembered."""
        return len(self._hits)

    def allow(self, key: str) -> RateDecision:
        now = self._clock()
        with self._lock:
            if key not in self._hits and len(self._hits) >= self._max_keys:
                self._forget_idle(now)  # make room for a newcomer, never for (and at the cost of) someone already tracked
            hits = self._hits.setdefault(key, deque())
            while hits and now - hits[0] >= self._longest:
                hits.popleft()
            wait = 0.0
            for window, most in self._limits:
                inside = [t for t in hits if now - t < window]
                if len(inside) >= most:
                    # The request that would free a place is the oldest one in this window.
                    wait = max(wait, inside[-most] + window - now)
            if wait > 0:
                return RateDecision(False, wait)
            hits.append(now)
            return RateDecision(True)

    def _forget_idle(self, now: float) -> None:
        for key in [k for k, hits in self._hits.items() if not hits or now - hits[-1] >= self._longest]:
            del self._hits[key]
        # A flood of brand-new addresses could still fill the table: as a last resort drop the oldest entry
        # (a dict remembers insertion order), so memory can never grow without bound.
        while len(self._hits) >= self._max_keys:
            del self._hits[next(iter(self._hits))]


# --- global daily cap -----------------------------------------------------------------------------------


def _utc_now() -> datetime:
    return datetime.now(UTC)


class DailyCap:
    """At most ``limit`` AI calls per UTC day. ``reserve`` takes one call from the allowance (before the call is made,
    so a failed call still counts: the cap is a ceiling on attempts, not on successes)."""

    def __init__(self, store: MonsterStore, limit: int, clock: Callable[[], datetime] = _utc_now) -> None:
        self._store = store
        self._limit = limit
        self._clock = clock

    def _today(self) -> str:
        return self._clock().astimezone(UTC).date().isoformat()

    def reserve(self) -> bool:
        return self._store.try_reserve_call(self._today(), self._limit)

    def remaining(self) -> int:
        return max(0, self._limit - self._store.usage(self._today()).calls)

    def exhausted(self) -> bool:
        return self.remaining() == 0

    def record_tokens(self, input_tokens: int, output_tokens: int) -> None:
        self._store.record_usage(self._today(), input_tokens=input_tokens, output_tokens=output_tokens)


# --- who is asking --------------------------------------------------------------------------------------


def client_address(headers: Mapping[str, str], peer: str | None, trusted_header: str | None) -> str:
    """The address to rate-limit. Behind a tunnel the socket address is the tunnel's, so a configured header
    (for example ``CF-Connecting-IP``) holds the visitor's. A header is believed only when configured, because anyone can
    send any header, and only when it really looks like an address."""
    if trusted_header:
        wanted = trusted_header.lower()
        value = next((v for k, v in headers.items() if k.lower() == wanted), None)
        if value:
            # A proxy adds the address it saw to the END of the list; anything before that is whatever the visitor sent.
            last = value.split(",")[-1].strip()
            try:
                return _bucket(ipaddress.ip_address(last))
            except ValueError:
                pass
    return peer or "unknown"


def _bucket(address: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str:
    """The unit that is rate-limited. A home connection gets a whole /64 of IPv6 addresses and can send each request from a new one,
    so an IPv6 visitor is identified by the /64 (its network prefix); an IPv4 visitor by the address."""
    if isinstance(address, ipaddress.IPv6Address):
        if address.ipv4_mapped is not None:
            return str(address.ipv4_mapped)
        return str(ipaddress.ip_network(f"{address}/64", strict=False))
    return str(address)

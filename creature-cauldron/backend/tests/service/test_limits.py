"""The two spend protections (per-address rate limit, global daily cap) and finding the visitor's address."""

import threading
from datetime import UTC, datetime, timedelta, timezone

import pytest

from cauldron.service.limits import DailyCap, RateLimiter, client_address
from cauldron.service.store import MonsterStore


class FakeClock:
    """A clock the test moves by hand, so no test ever waits."""

    def __init__(self, start: float = 1000.0) -> None:
        self.now = start

    def __call__(self) -> float:
        return self.now


# --- the rate limiter -----------------------------------------------------------------------------------


def test_requests_inside_the_limit_are_allowed() -> None:
    limiter = RateLimiter([(60, 3)], clock=FakeClock())
    assert [limiter.allow("1.2.3.4").allowed for _ in range(3)] == [True, True, True]


def test_the_request_over_the_limit_is_refused_with_a_wait_time() -> None:
    clock = FakeClock()
    limiter = RateLimiter([(60, 3)], clock=clock)
    for _ in range(3):
        limiter.allow("a")
    clock.now += 10
    decision = limiter.allow("a")
    assert not decision.allowed
    assert decision.retry_after == pytest.approx(50)  # the first hit leaves the window 60 seconds after it was made


def test_the_limit_frees_up_as_the_window_moves_on() -> None:
    clock = FakeClock()
    limiter = RateLimiter([(60, 2)], clock=clock)
    limiter.allow("a")
    limiter.allow("a")
    assert not limiter.allow("a").allowed
    clock.now += 61
    assert limiter.allow("a").allowed


def test_each_address_has_its_own_allowance() -> None:
    limiter = RateLimiter([(60, 1)], clock=FakeClock())
    assert limiter.allow("a").allowed
    assert not limiter.allow("a").allowed
    assert limiter.allow("b").allowed


def test_the_tightest_window_decides() -> None:
    clock = FakeClock()
    limiter = RateLimiter([(60, 3), (3600, 5)], clock=clock)
    allowed = 0
    for minute in range(10):  # three a minute would be 30 an hour, but the hourly limit is 5
        clock.now += 61
        for _ in range(3):
            allowed += limiter.allow("a").allowed
    assert allowed == 5


def test_a_refused_request_does_not_count_against_the_visitor() -> None:
    clock = FakeClock()
    limiter = RateLimiter([(60, 1)], clock=clock)
    limiter.allow("a")
    for _ in range(20):  # hammering while blocked must not extend the block
        limiter.allow("a")
    clock.now += 61
    assert limiter.allow("a").allowed


def test_idle_addresses_are_forgotten() -> None:
    clock = FakeClock()
    limiter = RateLimiter([(60, 5)], clock=clock, max_keys=100)
    for i in range(100):
        limiter.allow(f"visitor-{i}")
    clock.now += 120  # every one of them is idle now
    limiter.allow("fresh")
    assert limiter.tracked == 1


def test_a_flood_of_new_addresses_cannot_grow_memory_without_bound() -> None:
    limiter = RateLimiter([(60, 5)], clock=FakeClock(), max_keys=100)
    for i in range(150):  # nothing is idle, because the clock never moves
        limiter.allow(f"visitor-{i}")
    assert limiter.tracked == 100


# --- the daily cap --------------------------------------------------------------------------------------


def day(y: int, m: int, d: int, hour: int = 12) -> datetime:
    return datetime(y, m, d, hour, tzinfo=UTC)


@pytest.fixture
def store():
    s = MonsterStore(":memory:")
    yield s
    s.close()


def test_calls_are_reserved_until_the_cap_is_reached(store) -> None:
    cap = DailyCap(store, limit=3, clock=lambda: day(2026, 10, 20))
    assert [cap.reserve() for _ in range(5)] == [True, True, True, False, False]
    assert cap.remaining() == 0
    assert cap.exhausted()


def test_a_new_day_starts_with_a_fresh_allowance(store) -> None:
    now = [day(2026, 10, 20, 23)]
    cap = DailyCap(store, limit=1, clock=lambda: now[0])
    assert cap.reserve()
    assert cap.exhausted()
    now[0] = day(2026, 10, 21, 0)
    assert not cap.exhausted()
    assert cap.reserve()


def test_the_day_is_the_utc_day(store) -> None:
    # 22:00 on 20 October at UTC-5 is already 03:00 UTC on the 21st
    cap = DailyCap(store, limit=5, clock=lambda: datetime(2026, 10, 20, 22, tzinfo=timezone(timedelta(hours=-5))))
    cap.reserve()
    assert store.usage("2026-10-21").calls == 1
    assert store.usage("2026-10-20").calls == 0


def test_remaining_counts_down(store) -> None:
    cap = DailyCap(store, limit=4, clock=lambda: day(2026, 10, 20))
    assert cap.remaining() == 4
    cap.reserve()
    assert cap.remaining() == 3


def test_token_use_is_recorded_for_the_day(store) -> None:
    cap = DailyCap(store, limit=4, clock=lambda: day(2026, 10, 20))
    cap.reserve()
    cap.record_tokens(input_tokens=1200, output_tokens=800)
    used = store.usage("2026-10-20")
    assert (used.calls, used.input_tokens, used.output_tokens) == (1, 1200, 800)


def test_the_cap_holds_when_many_requests_arrive_at_once(store) -> None:
    cap = DailyCap(store, limit=20, clock=lambda: day(2026, 10, 20))
    results: list[bool] = []
    lock = threading.Lock()

    def worker() -> None:
        got = cap.reserve()
        with lock:
            results.append(got)

    threads = [threading.Thread(target=worker) for _ in range(60)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sum(results) == 20
    assert store.usage("2026-10-20").calls == 20


# --- finding the visitor's address ----------------------------------------------------------------------


def test_the_socket_address_is_used_by_default() -> None:
    assert client_address({"cf-connecting-ip": "9.9.9.9"}, "1.2.3.4", None) == "1.2.3.4"


def test_a_trusted_header_overrides_the_socket_address() -> None:
    assert client_address({"CF-Connecting-IP": "9.9.9.9"}, "127.0.0.1", "CF-Connecting-IP") == "9.9.9.9"


def test_a_forwarded_for_list_uses_its_last_address() -> None:
    # A proxy appends the address it saw to the END; anything earlier is whatever the visitor chose to send.
    assert client_address({"x-forwarded-for": "9.9.9.9, 10.0.0.1"}, "127.0.0.1", "X-Forwarded-For") == "10.0.0.1"


def test_a_header_that_is_not_an_address_is_ignored() -> None:
    assert client_address({"x-forwarded-for": "not an ip; drop table"}, "127.0.0.1", "X-Forwarded-For") == "127.0.0.1"


def test_a_missing_trusted_header_falls_back_to_the_socket() -> None:
    assert client_address({}, "127.0.0.1", "CF-Connecting-IP") == "127.0.0.1"


def test_no_address_at_all_gets_a_shared_placeholder() -> None:
    assert client_address({}, None, None) == "unknown"


def test_a_full_table_never_resets_a_visitor_who_is_already_tracked() -> None:
    clock = FakeClock()
    limiter = RateLimiter([(60, 1)], clock=clock, max_keys=3)
    for key in ("a", "b", "c"):
        assert limiter.allow(key).allowed
    # The table is full of live entries. "a" is the oldest, but asking again must still be refused, not wiped.
    assert not limiter.allow("a").allowed

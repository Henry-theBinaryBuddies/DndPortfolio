"""Small in-memory sliding-window rate limiter. Per process; fine for one server instance."""
import threading
import time
from collections import defaultdict, deque

from fastapi import HTTPException, Request


class RateLimiter:
    def __init__(self, limit: int, window_seconds: float):
        self.limit = limit
        self.window = window_seconds
        self._hits = defaultdict(deque)
        self._lock = threading.Lock()

    def check(self, key: str) -> None:
        now = time.monotonic()
        with self._lock:
            hits = self._hits[key]
            while hits and now - hits[0] > self.window:
                hits.popleft()
            if len(hits) >= self.limit:
                raise HTTPException(429, "too many requests, slow down")
            hits.append(now)
            if len(self._hits) > 10_000:  # bound memory under key-spraying
                for k in [k for k, v in self._hits.items() if not v or now - v[-1] > self.window]:
                    del self._hits[k]

    def reset(self) -> None:
        with self._lock:
            self._hits.clear()


auth_limiter = RateLimiter(limit=30, window_seconds=60)
availability_limiter = RateLimiter(limit=60, window_seconds=60)


def limit_auth(request: Request) -> None:
    # Behind a reverse proxy run uvicorn with --proxy-headers so this is the real client IP.
    auth_limiter.check(request.client.host if request.client else "unknown")

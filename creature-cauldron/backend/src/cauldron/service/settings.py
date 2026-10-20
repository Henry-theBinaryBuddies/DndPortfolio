"""Settings for the service, read from environment variables.

Everything the operator may want to change lives here, with safe defaults, and a wrong value stops the server from
starting with a message that names the variable. The Anthropic API key is deliberately NOT here: it is read only by the
Haiku generator, straight from ``ANTHROPIC_API_KEY``, so it can never be printed or logged through the settings.
"""

import os
from collections.abc import Mapping
from dataclasses import dataclass
from pathlib import Path

from cauldron.rules import CR_LABELS

PROJECT = Path(__file__).resolve().parents[4]  # the creature-cauldron folder


class SettingsError(ValueError):
    """A setting has a value the service cannot use. The message names the environment variable."""


def _integer(env: Mapping[str, str], name: str, default: int, low: int, high: int) -> int:
    raw = env.get(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError:
        raise SettingsError(f"{name} must be a whole number, got {raw!r}") from None
    if not low <= value <= high:
        raise SettingsError(f"{name} must be between {low} and {high}, got {value}")
    return value


def _origins(env: Mapping[str, str]) -> tuple[str, ...]:
    raw = env.get("CAULDRON_ALLOWED_ORIGINS")
    if raw is None:
        return ("http://localhost:5199",)
    origins = tuple(part.strip() for part in raw.split(",") if part.strip())
    if not origins:
        raise SettingsError("CAULDRON_ALLOWED_ORIGINS needs at least one origin")
    for origin in origins:
        if not origin.startswith(("http://", "https://")) or "*" in origin:
            raise SettingsError(f"CAULDRON_ALLOWED_ORIGINS must list exact origins such as https://name.github.io, got {origin!r}")
    return origins


@dataclass(frozen=True)
class Settings:
    database_path: Path
    library_dir: Path  # where the static monster files (SRD and samples) are read from
    allowed_origins: tuple[str, ...]
    daily_cap: int  # the most Haiku calls in one UTC day, retries included
    ip_per_minute: int  # AI generations one address may start per minute
    ip_per_hour: int
    cache_per_minute: int  # requests answered from the cache cost nothing, so their limit is looser
    max_retries: int  # extra attempts after a monster fails validation
    max_cr: str  # the highest challenge rating that may be generated
    trusted_proxy_header: str | None  # for example "CF-Connecting-IP"; None means use the socket address
    model: str
    max_output_tokens: int

    @classmethod
    def from_env(cls, env: Mapping[str, str] | None = None) -> "Settings":
        env = os.environ if env is None else env
        max_cr = env.get("CAULDRON_MAX_CR", "17")
        if max_cr not in CR_LABELS:
            raise SettingsError(f"CAULDRON_MAX_CR must be a challenge rating from 0 to 30, got {max_cr!r}")
        return cls(
            database_path=Path(env.get("CAULDRON_DATABASE", str(PROJECT / "backend" / "data" / "cauldron.sqlite3"))),
            library_dir=Path(env.get("CAULDRON_LIBRARY_DIR", str(PROJECT / "frontend" / "public" / "data"))),
            allowed_origins=_origins(env),
            daily_cap=_integer(env, "CAULDRON_DAILY_CAP", 150, 1, 100_000),
            ip_per_minute=_integer(env, "CAULDRON_IP_PER_MINUTE", 3, 1, 1000),
            ip_per_hour=_integer(env, "CAULDRON_IP_PER_HOUR", 10, 1, 10_000),
            cache_per_minute=_integer(env, "CAULDRON_CACHE_PER_MINUTE", 30, 1, 10_000),
            max_retries=_integer(env, "CAULDRON_MAX_RETRIES", 2, 0, 5),
            max_cr=max_cr,
            trusted_proxy_header=env.get("CAULDRON_TRUSTED_PROXY_HEADER") or None,
            model=env.get("CAULDRON_MODEL", "claude-haiku-5-5"),
            max_output_tokens=_integer(env, "CAULDRON_MAX_OUTPUT_TOKENS", 4000, 500, 16_000),
        )

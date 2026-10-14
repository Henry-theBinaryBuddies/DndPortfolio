import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def _load_dotenv(path: Path) -> None:
    """Minimal .env reader. Real environment variables win over the file."""
    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv(ROOT / ".env")

DEV_MODE = os.environ.get("CHRONOMANCER_DEV", "0") == "1"
DATABASE_URL = os.environ.get("DATABASE_URL") or f"sqlite:///{(ROOT / 'chronomancer.db').as_posix()}"
SECRET_KEY = os.environ.get("SECRET_KEY") or ("dev-only-secret" if DEV_MODE else None)

# Where this app is reachable by players. Used for links the bot posts into Discord.
PUBLIC_BASE_URL = (os.environ.get("PUBLIC_BASE_URL") or "http://localhost:8000").rstrip("/")

# Discord. The token and secret are only ever read from the environment, never logged.
DISCORD_BOT_TOKEN = os.environ.get("DISCORD_BOT_TOKEN", "")
DISCORD_CLIENT_ID = os.environ.get("DISCORD_CLIENT_ID", "")
DISCORD_CLIENT_SECRET = os.environ.get("DISCORD_CLIENT_SECRET", "")
DISCORD_REDIRECT_URI = os.environ.get("DISCORD_REDIRECT_URI") or f"{PUBLIC_BASE_URL}/auth/callback"
# Optional: sync slash commands to one test server instantly instead of globally.
DISCORD_DEV_GUILD_ID = os.environ.get("DISCORD_DEV_GUILD_ID", "")



def redirect_uri_problem(uri: str) -> str | None:
    """Explain why a redirect URI cannot work with our callback route, or None if it is fine."""
    from urllib.parse import urlparse

    parsed = urlparse(uri)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        return "it is not a full http(s) URL"
    if parsed.netloc.lower().endswith("discord.com"):
        return ("it points at discord.com (that looks like a bot invite link, which belongs in "
                "your browser, not in .env)")
    if parsed.path != "/auth/callback":
        return "its path must be exactly /auth/callback"
    return None


REDIRECT_URI_PROBLEM = redirect_uri_problem(DISCORD_REDIRECT_URI)

BOT_ENABLED = bool(DISCORD_BOT_TOKEN) and os.environ.get("CHRONOMANCER_BOT", "1") != "0"
# Discord login needs the app credentials AND a redirect URI that can actually work.
OAUTH_ENABLED = bool(DISCORD_CLIENT_ID and DISCORD_CLIENT_SECRET) and REDIRECT_URI_PROBLEM is None
BACKGROUND_ENABLED = os.environ.get("CHRONOMANCER_BACKGROUND", "1") != "0"
TICK_SECONDS = 5

MAX_VOTE_TOP_N = 5
MAX_POLL_DAYS = 31
MAX_VOTE_HOURS = 24 * 14

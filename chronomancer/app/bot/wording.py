"""Theme wording for bot messages: the same web/themes/<name>.json files the web UI uses."""
import json
from functools import lru_cache

from .. import config

THEMES_DIR = config.ROOT / "web" / "themes"
DEFAULT_THEME = "dnd"


def available_themes() -> list:
    return sorted(p.stem for p in THEMES_DIR.glob("*.json"))


@lru_cache(maxsize=None)
def _load(theme: str) -> dict:
    path = THEMES_DIR / f"{theme}.json"
    return json.loads(path.read_text(encoding="utf-8"))


def words(theme: str | None) -> dict:
    # Only ever opens files that exist in THEMES_DIR; unknown names fall back to the default.
    name = theme if theme in available_themes() else DEFAULT_THEME
    return _load(name)


class _Safe(dict):
    def __missing__(self, key):
        return "{" + key + "}"


def t(theme: str | None, key: str, **kwargs) -> str:
    template = words(theme).get(key) or words(DEFAULT_THEME).get(key) or key
    return template.format_map(_Safe(kwargs))

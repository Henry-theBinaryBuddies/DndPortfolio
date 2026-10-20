"""The move menu in the web page is a copy of the server's moves; this keeps the two from drifting apart."""

import json
import re
from pathlib import Path

from cauldron.remix.moves import MOVES

MENU = Path(__file__).parents[3] / "frontend" / "src" / "lib" / "remixMoves.ts"
STRING = r'"(?:[^"\\]|\\.)*"'  # a JSON string, escapes allowed
ROW = re.compile(
    rf"\{{ key: ({STRING}), label: ({STRING}), group: ({STRING}), blurb: ({STRING}), needsDamage: (true|false), needsNotTiny: (true|false) \}}"
)


def test_the_page_menu_lists_exactly_the_servers_moves() -> None:
    rows = ROW.findall(MENU.read_text(encoding="utf-8"))
    page = [(json.loads(k), json.loads(l), json.loads(g), json.loads(b), d == "true", t == "true") for k, l, g, b, d, t in rows]
    server = [(m.key, m.label, m.group, m.blurb, m.needs_damage, m.needs_not_tiny) for m in MOVES.values()]
    assert page == server

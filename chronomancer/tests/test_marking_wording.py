"""The three answers are worded and ordered the same everywhere: 1 click available (green),
2 clicks maybe (yellow), 3 clicks not available (red). The word is 'maybe', never 'if needed'."""
import json
import re
from pathlib import Path

import pytest

from app.bot import wording

ROOT = Path(__file__).resolve().parent.parent
POLL_PAGE = (ROOT / "web" / "poll.html").read_text(encoding="utf-8")


def source_files():
    for pattern in ("app/**/*.py", "web/**/*.html", "web/**/*.js", "web/**/*.json", "web/**/*.css"):
        yield from ROOT.glob(pattern)


def test_nothing_says_if_needed_any_more():
    offenders = [str(f.relative_to(ROOT)) for f in source_files()
                 if re.search(r"if[ _-]?needed", f.read_text(encoding="utf-8"), re.IGNORECASE)]
    assert offenders == []


@pytest.mark.parametrize("theme", wording.available_themes())
def test_every_theme_names_the_three_answers_the_same_way(theme):
    words = wording.words(theme)
    assert (words["free"], words["maybe"], words["no"]) == ("Available", "Maybe", "Not available")
    assert words["botMaybeWord"] == "maybe"  # the Discord vote message says "maybe" too


def test_the_legend_lists_the_clicks_in_order_with_their_colours():
    legend = POLL_PAGE[POLL_PAGE.index('<ul class="legend"'):POLL_PAGE.index("</ul>")]
    entries = re.findall(r'class="swatch (cell-\w+)"></span> <strong>(\d) clicks?</strong> <span data-t="(\w+)"', legend)
    assert entries == [("cell-free", "1", "free"), ("cell-maybe", "2", "maybe"), ("cell-no", "3", "no")]


@pytest.mark.parametrize("theme", wording.available_themes())
def test_the_hint_explains_the_sequence_and_how_to_undo(theme):
    hint = wording.words(theme)["gridHint"].lower()
    for phrase in ("once for available", "twice for maybe", "three times for not available", "clears"):
        assert phrase in hint, phrase


def test_the_colours_match_the_meaning_in_both_themes():
    for name in wording.available_themes():
        css = (ROOT / "web" / "css" / "themes" / f"{name}.css").read_text(encoding="utf-8")
        def hexval(var):
            return re.search(rf"--{var}:\s*#([0-9a-fA-F]{{6}})", css).group(1)
        def rgb(h):
            return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
        (fr, fg, fb), (mr, mg, mb), (nr, ng, nb) = rgb(hexval("free")), rgb(hexval("maybe")), rgb(hexval("no"))
        assert fg > fr and fg > fb, f"{name}: available must be green"
        assert mr > mb and mg > mb and abs(mr - mg) < 80, f"{name}: maybe must be yellow"
        assert nr > ng and nr > nb, f"{name}: not available must be red"

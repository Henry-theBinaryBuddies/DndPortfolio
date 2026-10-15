"""Both themes must stay readable: text, links, buttons and status colours keep enough contrast
against the surfaces they sit on (WCAG AA is 4.5:1 for normal text)."""
import re
from pathlib import Path

import pytest

from app.bot import wording

THEMES = Path(__file__).resolve().parent.parent / "web" / "css" / "themes"
BASE = (Path(__file__).resolve().parent.parent / "web" / "css" / "base.css").read_text(encoding="utf-8")


def colour(theme, name):
    css = (THEMES / f"{theme}.css").read_text(encoding="utf-8")
    match = re.search(rf"--{name}:\s*#([0-9a-fA-F]{{6}})\b", css)
    assert match, f"{theme}: --{name} must be a plain #rrggbb colour"
    h = match.group(1)
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def luminance(rgb):
    lin = [c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]


def contrast(a, b):
    hi, lo = sorted((luminance(a), luminance(b)), reverse=True)
    return (hi + 0.05) / (lo + 0.05)


PAIRS = [
    ("text", "panel"), ("text", "bg"), ("muted", "panel"), ("link", "panel"), ("accent", "panel"),
    ("label", "panel"), ("text", "input-bg"), ("button-text", "button-bg"),
    ("danger", "panel"), ("ok", "panel"),
]


@pytest.mark.parametrize("theme", wording.available_themes())
@pytest.mark.parametrize("fg,bg", PAIRS)
def test_text_is_readable_on_its_surface(theme, fg, bg):
    ratio = contrast(colour(theme, fg), colour(theme, bg))
    assert ratio >= 4.5, f"{theme}: {fg} on {bg} is only {ratio:.1f}:1"


@pytest.mark.parametrize("theme", wording.available_themes())
def test_the_three_answers_stand_apart_from_an_empty_cell(theme):
    empty = colour(theme, "cell-bg")
    for answer in ("free", "maybe", "no"):
        assert contrast(colour(theme, answer), empty) >= 2.0, f"{theme}: {answer} blends into empty cells"


@pytest.mark.parametrize("theme", wording.available_themes())
def test_every_theme_defines_what_the_shared_styles_need(theme):
    css = (THEMES / f"{theme}.css").read_text(encoding="utf-8")
    for var in re.findall(r"var\(--([a-z-]+)\)", BASE):  # variables used with no fallback
        assert f"--{var}:" in css, f"{theme} does not define --{var}"


def test_animation_respects_reduced_motion():
    assert "prefers-reduced-motion: reduce" in BASE


def test_no_screen_width_is_forced_wider_than_the_phone():
    assert "overflow-wrap: anywhere" in BASE and "min-width: 0" in BASE

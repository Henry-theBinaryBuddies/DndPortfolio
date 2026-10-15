"""The D&D imagery: every drawing is a safe, well-formed SVG that the theme actually uses, the
plain theme stays free of it, and the selectors that place it still match the pages."""
import re
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

WEB = Path(__file__).resolve().parent.parent / "web"
IMG = WEB / "img"
DND = (WEB / "css" / "themes" / "dnd.css").read_text(encoding="utf-8")
PLAIN = (WEB / "css" / "themes" / "plain.css").read_text(encoding="utf-8")
PAGES = {p.name: p.read_text(encoding="utf-8") for p in WEB.glob("*.html")}
ALL_HTML = "\n".join(PAGES.values())
DRAWINGS = sorted(IMG.glob("*.svg"))


def test_there_is_a_cast_of_classic_characters():
    names = {p.stem for p in DRAWINGS}
    assert {"wizard", "wizard-figure", "dragon", "dragon-head", "helm", "hourglass", "castle",
            "sword", "swords", "shield", "crown", "potion", "scroll", "d20", "skyline"} <= names


@pytest.mark.parametrize("path", DRAWINGS, ids=lambda p: p.name)
def test_each_drawing_is_a_plain_well_formed_svg(path):
    text = path.read_text(encoding="utf-8")
    root = ET.fromstring(text)  # well-formed
    assert root.tag.endswith("svg") and root.get("viewBox")
    lowered = text.lower()
    for forbidden in ("<script", "onload", "onclick", "href=", "<image", "<foreignobject", "javascript:"):
        assert forbidden not in lowered, f"{path.name} contains {forbidden}"
    assert len(text) < 12_000, "drawings are small shapes, not embedded pictures"


@pytest.mark.parametrize("path", DRAWINGS, ids=lambda p: p.name)
def test_the_theme_uses_every_drawing(path):
    assert f"img/{path.name}" in DND, f"{path.name} is never declared"
    declared = re.search(rf"--(img-[\w-]+):\s*url\(\"\.\./\.\./img/{re.escape(path.name)}\"\)", DND)
    assert declared, path.name
    applied = len(re.findall(rf"var\(--{declared.group(1)}\)", DND))
    assert applied >= 1, f"{path.name} is declared but no rule shows it"


def test_every_image_the_theme_names_exists():
    named = re.findall(r'url\("\.\./\.\./img/([\w-]+\.svg)"\)', DND)
    assert named and all((IMG / n).is_file() for n in named)


def test_the_plain_theme_has_no_imagery():
    assert "img/" not in PLAIN and "mask" not in PLAIN


def test_imagery_is_decoration_only():
    """Drawn with CSS masks, so there is no img element for a screen reader to announce."""
    assert "<img" not in ALL_HTML and 'src="/img' not in ALL_HTML
    assert "mask:" in DND and "pointer-events: none" in DND


def test_the_headings_and_buttons_it_decorates_still_exist_on_the_pages():
    keys = set(re.findall(r'(?:h2|button)\[data-t="(\w+)"\]', DND))
    assert keys
    for key in keys:
        assert f'data-t="{key}"' in ALL_HTML, f"the theme decorates data-t={key}, which no page has"
    for hook in ("h1#name", "h1#title", "#confirmed h2", "#campaign-list", "#polls"):
        ident = re.search(r"#([\w-]+)", hook).group(1)
        assert f'id="{ident}"' in ALL_HTML, hook


def test_large_decoration_is_left_off_phones():
    phone = DND[DND.index("@media (max-width: 900px)"):]
    assert "html::before, html::after { display: none; }" in phone
    assert "@media (max-width: 640px)" in phone


def test_the_backdrop_sits_behind_the_content_and_never_takes_clicks():
    block = DND[DND.index("html::before, html::after {"):]
    block = block[:block.index("}")]
    assert "z-index: -2" in block and "pointer-events: none" in block and "position: fixed" in block

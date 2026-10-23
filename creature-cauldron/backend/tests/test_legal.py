"""The legal files ship with the data, so these tests keep them honest: the credits are the same on both sides, the licence text is
whole, and every source of monsters has its line in the Section 15 notice."""

import re
from pathlib import Path

from cauldron.options import Source
from cauldron.rules import A5E_ATTRIBUTION, SRD_ATTRIBUTION

ROOT = Path(__file__).parents[2]
LEGAL = ROOT / "frontend" / "public" / "legal"
OGL = (LEGAL / "OGL-1.0a.txt").read_text(encoding="utf-8")
PAGE = (LEGAL / "licences.html").read_text(encoding="utf-8")
ATTRIBUTION_TS = (ROOT / "frontend" / "src" / "lib" / "attribution.ts").read_text(encoding="utf-8")


def ts_constant(name: str) -> str:
    match = re.search(rf'export const {name} =\s*"(.*)";', ATTRIBUTION_TS)
    assert match is not None, name
    return match.group(1)


def test_the_credits_in_the_page_are_the_ones_the_server_stamps_on_monsters() -> None:
    assert ts_constant("SRD_ATTRIBUTION") == SRD_ATTRIBUTION
    assert ts_constant("A5E_ATTRIBUTION") == A5E_ATTRIBUTION


def test_the_licence_text_is_whole() -> None:
    assert OGL.startswith("OPEN GAME LICENSE Version 1.0a")
    for part in ("Definitions:", "Use of Product Identity:", "Identification:", "Copy of this License:", "Termination:", "Reformation:", "COPYRIGHT NOTICE", "END OF LICENSE"):
        assert part in OGL, part
    assert "perpetual, worldwide, royalty-free, non-exclusive" in OGL


def test_section_15_has_a_line_for_every_source_we_use() -> None:
    notice = OGL.rsplit("COPYRIGHT NOTICE", 1)[1]
    assert "Open Game License v 1.0a Copyright 2000, Wizards of the Coast, Inc." in notice
    assert "System Reference Document 5.1" in notice  # Source.SRD
    assert "A5E System Reference Document (A5ESRD)" in notice and "EN Publishing" in notice  # Source.A5E
    assert "Creature Cauldron" in notice  # monsters generated, reskinned and combined
    assert {Source.SRD, Source.A5E} <= set(Source)  # add a line above when a new importer's source is added to this list


def test_the_page_carries_the_same_notice_and_says_what_is_open_and_what_is_not() -> None:
    assert "Open Game Content" in PAGE and "Product Identity" in PAGE
    assert "A5E System Reference Document (A5ESRD)" in PAGE and "System Reference Document 5.1" in PAGE
    assert "not affiliated with or endorsed by" in PAGE


def test_the_code_licence_is_mit() -> None:
    licence = (ROOT / "LICENSE").read_text(encoding="utf-8")
    assert licence.startswith("MIT License") and "Permission is hereby granted, free of charge" in licence

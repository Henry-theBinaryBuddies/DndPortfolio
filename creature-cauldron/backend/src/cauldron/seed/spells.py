"""Reads the SRD's spellcasting traits into structured spellcasting data.

The SRD writes spellcasting as a sentence followed by bullet lines:

    The mage is a 9th-level spellcaster. Its spellcasting ability is Intelligence (spell save DC 14, +6 to hit
    with spell attacks). The mage has the following wizard spells prepared:

    - Cantrips (at will): fire bolt, light
    - 1st level (4 slots): detect magic, shield
    - At will: ...   - 3/day each: ...   - 1/day: ...

Each bullet becomes a spell list. The same safety rule as for actions applies: the result is kept only if
``Spellcasting.to_text()`` writes the SRD's words back exactly (apart from the bullets becoming sentences);
otherwise None is returned and the caller keeps the trait as plain text.
"""

import re

from pydantic import ValidationError

from cauldron.monster import Abilities, SpellPerDay, SpellRef, SpellSlotLevel, Spellcasting
from cauldron.options import Ability
from cauldron.dice import ability_modifier

_LIST_LINE = re.compile(
    r"^-?\s*(?P<heading>Cantrips \(at will\)|At will|(?P<level>\d)(?:st|nd|rd|th) level \((?P<slots>\d+) slots?\)|(?P<uses>\d)/day(?P<each> each)?): (?P<list>.+?)\.?$"
)


def split_spell_list(text: str) -> list[str]:
    """Splits "a, b (c, d), e" at the commas that are not inside brackets."""
    parts: list[str] = []
    depth = 0
    current = ""
    for char in text:
        if char == "(":
            depth += 1
        elif char == ")":
            depth = max(0, depth - 1)
        if char == "," and depth == 0:
            parts.append(current)
            current = ""
        else:
            current += char
    parts.append(current)
    return [part.strip() for part in parts if part.strip()]


def spell_ref(text: str) -> SpellRef:
    """"levitate (self only)" becomes name "levitate" with the note "self only"."""
    bracket = text.find(" (")
    if bracket == -1 or not text.endswith(")"):
        return SpellRef(name=text)
    return SpellRef(name=text[:bracket], note=text[bracket + 2 : -1])


def parse_spellcasting(entry: dict, abilities: Abilities, proficiency_bonus: int) -> Spellcasting | None:
    """The structured spellcasting for one special ability, or None if its wording is not recognised exactly."""
    try:
        return _parse(entry, abilities, proficiency_bonus)
    except (ValueError, KeyError, ValidationError):
        return None


def _parse(entry: dict, abilities: Abilities, proficiency_bonus: int) -> Spellcasting | None:
    lines = [line.strip() for line in entry["desc"].split("\n") if line.strip()]
    if not lines:
        return None

    intro_parts: list[str] = []
    footer_parts: list[str] = []
    cantrips: list[SpellRef] = []
    at_will: list[SpellRef] = []
    slots: list[SpellSlotLevel] = []
    per_day: list[SpellPerDay] = []
    seen_list = False

    for line in lines:
        match = _LIST_LINE.match(line)
        if match is None:
            (footer_parts if seen_list else intro_parts).append(line)
            continue
        seen_list = True
        spells = [spell_ref(s) for s in split_spell_list(match["list"])]
        if match["heading"] == "At will":
            at_will += spells
        elif match["heading"].startswith("Cantrips"):
            cantrips += spells
        elif match["level"] is not None:
            slots.append(SpellSlotLevel(level=int(match["level"]), slots=int(match["slots"]), spells=spells))
        else:
            per_day.append(SpellPerDay(uses=int(match["uses"]), each=match["each"] is not None, spells=spells))

    if not seen_list:
        return None

    data = entry["spellcasting"]
    ability = Ability(data["ability"]["index"])
    modifier = ability_modifier(getattr(abilities, ability.value))
    result = Spellcasting(
        ability=ability,
        dc=data.get("dc", 8 + proficiency_bonus + modifier),
        attack_bonus=data.get("modifier", proficiency_bonus + modifier),
        innate=entry["name"] == "Innate Spellcasting",
        intro=" ".join(intro_parts),
        cantrips=cantrips,
        slots=slots,
        at_will=at_will,
        per_day=per_day,
        footer=" ".join(footer_parts),
    )

    # The round trip: the sentences we write must equal the SRD's words, with each bullet ending in a full stop.
    expected = " ".join(intro_parts + [re.sub(r"^-\s*", "", line) if line.endswith(".") else re.sub(r"^-\s*", "", line) + "." for line in lines if _LIST_LINE.match(line)] + footer_parts)
    return result if result.to_text() == expected else None

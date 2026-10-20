"""The Monster model, mirroring frontend/src/types/monster.ts (schema version 1, 2014 rules).

Everything the stat block shows is a typed field. Pydantic checks types and ranges when a Monster is made, so
a Monster that exists is always well formed; rules checks (is the CR right, does the DC add up) come later
in the validator.
"""

import re
from typing import Annotated

from pydantic import Field, field_validator

from cauldron.actions import AnyAction, Prose, TextAction
from cauldron.base import CauldronModel
from cauldron.dice import parse_dice
from cauldron.options import (
    Ability,
    CreatureType,
    DamageTheme,
    DamageType,
    Environment,
    Feature,
    Role,
    Size,
    Source,
)

Score = Annotated[int, Field(ge=1, le=30)]
Short = Annotated[str, Field(min_length=1, max_length=100)]

_ORDINALS = ["", "1st", "2nd", "3rd", "4th", "5th", "6th", "7th", "8th", "9th"]


# --- spellcasting ---------------------------------------------------------------------------------------


class SpellRef(CauldronModel):
    """One spell, with an optional note such as "self only"."""

    name: Short
    note: Short | None = None

    def text(self) -> str:
        return f"{self.name} ({self.note})" if self.note else self.name


class SpellSlotLevel(CauldronModel):
    level: int = Field(ge=1, le=9)  # cantrips are kept in Spellcasting.cantrips
    slots: int = Field(ge=1, le=10)
    spells: list[SpellRef]


class SpellPerDay(CauldronModel):
    uses: int = Field(ge=1, le=10)
    each: bool  # True for "3/day each", False for "1/day" shared between the listed spells
    spells: list[SpellRef]


def _spell_list(spells: list[SpellRef]) -> str:
    return ", ".join(spell.text() for spell in spells)


class Spellcasting(CauldronModel):
    """Spellcasting as data. The stat block sentence is built from it by ``to_text``."""

    ability: Ability
    dc: int = Field(ge=1, le=30)
    attack_bonus: int = Field(ge=-5, le=30)
    innate: bool
    intro: Prose  # the sentence(s) before the spell lists
    cantrips: list[SpellRef]
    slots: list[SpellSlotLevel]
    at_will: list[SpellRef]
    per_day: list[SpellPerDay]
    footer: Prose  # any sentence after the lists; usually empty

    @property
    def caster_level(self) -> int | None:
        """"a 9th-level spellcaster" gives 9. None when the intro does not say."""
        match = re.search(r"(\d+)(?:st|nd|rd|th)-level spellcaster", self.intro, re.IGNORECASE)
        return int(match.group(1)) if match else None

    def with_numbers(self, dc: int, attack_bonus: int) -> "Spellcasting":
        """A copy with a new save DC and spell attack bonus, also rewritten in the intro sentence that quotes them."""
        intro = re.sub(r"spell save DC \d+", f"spell save DC {dc}", self.intro)
        sign = "+" if attack_bonus >= 0 else "-"
        intro = re.sub(r"[+-]\d+ to hit with spell attacks", f"{sign}{abs(attack_bonus)} to hit with spell attacks", intro)
        return self.model_copy(update={"dc": dc, "attack_bonus": attack_bonus, "intro": intro})

    def to_text(self) -> str:
        lines: list[str] = []
        if self.cantrips:
            lines.append(f"Cantrips (at will): {_spell_list(self.cantrips)}.")
        for entry in self.slots:
            word = "slot" if entry.slots == 1 else "slots"
            lines.append(f"{_ORDINALS[entry.level]} level ({entry.slots} {word}): {_spell_list(entry.spells)}.")
        if self.at_will:
            lines.append(f"At will: {_spell_list(self.at_will)}.")
        for entry in self.per_day:
            each = " each" if entry.each else ""
            lines.append(f"{entry.uses}/day{each}: {_spell_list(entry.spells)}.")
        return " ".join(part for part in [self.intro, *lines, self.footer] if part)


# --- legendary actions ----------------------------------------------------------------------------------


class LegendaryOption(CauldronModel):
    name: Short
    cost: int = Field(ge=1, le=3)
    text: Prose


class LegendaryActions(CauldronModel):
    per_round: int = Field(ge=1, le=5)
    options: list[LegendaryOption] = Field(min_length=1)


def legendary_intro(monster_name: str, per_round: int) -> str:
    """The standard sentence that introduces a monster's legendary actions."""
    name = monster_name.lower()
    return (
        f"The {name} can take {per_round} legendary actions, choosing from the options below. "
        "Only one legendary action can be used at a time and only at the end of another creature's turn. "
        f"The {name} regains spent legendary actions at the start of its turn."
    )


# --- the stat block's smaller parts ---------------------------------------------------------------------


class ArmorClass(CauldronModel):
    value: int = Field(ge=1, le=40)
    note: Short | None = None


class HitPoints(CauldronModel):
    average: int = Field(ge=1, le=10000)
    dice: str

    @field_validator("dice")
    @classmethod
    def _dice_must_be_readable(cls, value: str) -> str:
        parse_dice(value)
        return value


class Speeds(CauldronModel):
    walk: int | None = Field(default=None, ge=0, le=500)
    fly: int | None = Field(default=None, ge=0, le=500)
    swim: int | None = Field(default=None, ge=0, le=500)
    climb: int | None = Field(default=None, ge=0, le=500)
    burrow: int | None = Field(default=None, ge=0, le=500)
    hover: bool | None = None


class Abilities(CauldronModel):
    """The six ability scores, each 1 to 30."""

    str: Score
    dex: Score
    con: Score
    int: Score
    wis: Score
    cha: Score


class Senses(CauldronModel):
    darkvision: int | None = Field(default=None, ge=0, le=1000)
    blindsight: int | None = Field(default=None, ge=0, le=1000)
    tremorsense: int | None = Field(default=None, ge=0, le=1000)
    truesight: int | None = Field(default=None, ge=0, le=1000)
    passive_perception: int = Field(ge=1, le=40)


class Challenge(CauldronModel):
    cr: Short  # as printed: "1/4", "12"
    cr_value: float = Field(ge=0, le=30)
    xp: int = Field(ge=0)
    proficiency_bonus: int = Field(ge=2, le=9)


# --- the monster ----------------------------------------------------------------------------------------


class Monster(CauldronModel):
    # identity and provenance
    id: Annotated[str, Field(min_length=1, max_length=100)]
    schema_version: int = Field(ge=1)
    name: Short
    source: Source
    validated: bool
    parent_id: str | None = None
    generator: str | None = None
    attribution: str | None = None

    # core stat block
    size: Size
    type: CreatureType
    subtypes: list[Short]
    alignment: Short
    armor_class: ArmorClass
    hit_points: HitPoints
    speeds: Speeds
    abilities: Abilities
    saves: dict[Ability, int]
    skills: dict[str, int]
    vulnerabilities: list[DamageType]
    resistances: list[DamageType]
    immunities: list[DamageType]
    condition_immunities: list[Short]
    senses: Senses
    languages: Annotated[str, Field(max_length=200)]
    challenge: Challenge

    # abilities
    traits: list[TextAction]
    actions: list[AnyAction]
    bonus_actions: list[AnyAction]
    reactions: list[AnyAction]
    legendary_actions: LegendaryActions | None = None
    spellcasting: Spellcasting | None = None

    # discovery tags
    environments: list[Environment]
    role: Role
    damage_themes: list[DamageTheme]
    features: list[Feature]

    # presentation
    description: Prose

    def all_actions(self) -> list[AnyAction]:
        """Actions, bonus actions and reactions, in the order a stat block lists them."""
        return [*self.actions, *self.bonus_actions, *self.reactions]

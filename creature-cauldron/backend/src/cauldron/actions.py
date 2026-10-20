"""The action class hierarchy: everything a monster can do on its turn.

This is the object-oriented heart of the model, so the ideas are worth naming:

* ``Action`` is an *abstract base class*. It says what every action must be able to do (``describe``) but is not
  an action itself, so ``Action(...)`` raises TypeError.
* ``AttackAction``, ``SaveAction``, ``MultiattackAction`` and ``TextAction`` are *subclasses*. Each *inherits*
  the shared parts (a name) and *overrides* ``describe`` with its own wording.
* *Polymorphism*: code can hold a list of ``Action`` objects and call ``describe`` on each, without knowing or
  caring which kind each one is. Python picks the right version at run time.

The sentences mirror frontend/src/lib/renderAction.ts, so the server and the page print the same stat block.
"""

from abc import ABC, abstractmethod
from typing import Annotated, Literal

from pydantic import Field, field_validator

from cauldron.base import CauldronModel
from cauldron.dice import format_damage_roll, parse_dice
from cauldron.options import ABILITY_NAMES, Ability, AreaShape, AttackMode, DamageType, SaveSuccess

Name = Annotated[str, Field(min_length=1, max_length=100)]
Prose = Annotated[str, Field(max_length=2000)]

_ATTACK_LABELS: dict[AttackMode, str] = {
    AttackMode.MELEE_WEAPON: "Melee Weapon Attack",
    AttackMode.RANGED_WEAPON: "Ranged Weapon Attack",
    AttackMode.MELEE_SPELL: "Melee Spell Attack",
    AttackMode.RANGED_SPELL: "Ranged Spell Attack",
}
_NUMBER_WORDS = ["zero", "one", "two", "three", "four", "five", "six"]


def _number_word(n: int) -> str:
    return _NUMBER_WORDS[n] if n < len(_NUMBER_WORDS) else str(n)


# --- small pieces ---------------------------------------------------------------------------------------


class DamageRoll(CauldronModel):
    dice: str  # for example "2d6"
    bonus: int = Field(ge=-20, le=100)
    type: DamageType

    @field_validator("dice")
    @classmethod
    def _dice_must_be_readable(cls, value: str) -> str:
        # A validator runs when the object is made. parse_dice raises ValueError, which Pydantic turns
        # into a ValidationError, so bad dice can never get into a Monster.
        parse_dice(value)
        return value

    def text(self) -> str:
        return f"{format_damage_roll(self.dice, self.bonus)} {self.type.value} damage"


class Recharge(CauldronModel):
    min: int = Field(ge=2, le=6)  # recharges on a roll of min-6

    @property
    def label(self) -> str:
        return "Recharge 6" if self.min >= 6 else f"Recharge {self.min}–6"


def _damage_list(rolls: list[DamageRoll]) -> str:
    return " plus ".join(roll.text() for roll in rolls)


def _with_effects(text: str, effects: str | None) -> str:
    return f"{text} {effects}" if effects else text


# --- the abstract base class ----------------------------------------------------------------------------


class Action(CauldronModel, ABC):
    name: Name

    @property
    def display_name(self) -> str:
        """The name as printed in the stat block. Subclasses with a recharge add it."""
        return self.name

    @abstractmethod
    def describe(self, monster_name: str) -> str:
        """The stat block prose for this action. Every subclass must provide it."""


# --- the four kinds -------------------------------------------------------------------------------------


class Range(CauldronModel):
    normal: int = Field(ge=1, le=1000)
    long: int = Field(ge=1, le=1000)


class AttackDetails(CauldronModel):
    mode: AttackMode
    ability: Ability
    to_hit: int = Field(ge=-5, le=30)
    reach: int | None = Field(default=None, ge=0, le=1000)
    range: Range | None = None
    targets: Annotated[str, Field(min_length=1, max_length=100)]


class AttackAction(Action):
    # Literal["attack"] means the only allowed value is the text "attack". It is the label that says which
    # subclass a piece of JSON belongs to.
    kind: Literal["attack"] = "attack"
    attack: AttackDetails
    damage: list[DamageRoll]
    effects_text: Prose | None = None
    conditions: list[str] | None = None

    def describe(self, monster_name: str) -> str:
        attack = self.attack
        sign = "+" if attack.to_hit >= 0 else "-"
        distances: list[str] = []
        if attack.reach is not None:
            distances.append(f"reach {attack.reach} ft.")
        if attack.range is not None:
            # Spells have one range; thrown and ammunition weapons have two.
            if attack.range.normal == attack.range.long:
                distances.append(f"range {attack.range.normal} ft.")
            else:
                distances.append(f"range {attack.range.normal}/{attack.range.long} ft.")

        where = f", {' or '.join(distances)}" if distances else ""
        lead = f"{_ATTACK_LABELS[attack.mode]}: {sign}{abs(attack.to_hit)} to hit{where}, {attack.targets}."
        hit = _with_effects(f"Hit: {_damage_list(self.damage)}.", self.effects_text)
        return f"{lead} {hit}"


class SaveDetails(CauldronModel):
    ability: Ability
    dc: int = Field(ge=1, le=30)


class Area(CauldronModel):
    shape: AreaShape
    size: int = Field(ge=1, le=1000)
    width: int | None = Field(default=None, ge=1, le=1000)

    def phrase(self) -> str:
        match self.shape:
            case AreaShape.RADIUS:
                return f"{self.size}-foot radius"
            case AreaShape.CONE:
                return f"{self.size}-foot cone"
            case AreaShape.CUBE:
                return f"{self.size}-foot cube"
            case AreaShape.SPHERE:
                return f"{self.size}-foot-radius sphere"
            case AreaShape.LINE:
                width = f" that is {self.width} feet wide" if self.width else ""
                return f"{self.size}-foot line{width}"


class SaveAction(Action):
    kind: Literal["save"] = "save"
    recharge: Recharge | None = None
    save: SaveDetails
    area: Area | None = None
    on_fail: list[DamageRoll]
    on_success: SaveSuccess
    effects_text: Prose | None = None

    @property
    def display_name(self) -> str:
        return f"{self.name} ({self.recharge.label})" if self.recharge else self.name

    def describe(self, monster_name: str) -> str:
        who = f"Each creature in a {self.area.phrase()}" if self.area else "The target"
        text = f"{who} must make a DC {self.save.dc} {ABILITY_NAMES[self.save.ability]} saving throw"
        if self.on_fail:
            text += f", taking {_damage_list(self.on_fail)} on a failed save"
            if self.on_success == SaveSuccess.HALF:
                text += ", or half as much damage on a successful one"
        return _with_effects(f"{text}.", self.effects_text)


class MultiattackEntry(CauldronModel):
    action: Name
    count: int = Field(ge=1, le=20)


class MultiattackAction(Action):
    kind: Literal["multiattack"] = "multiattack"
    sequence: list[MultiattackEntry] = Field(min_length=1)
    text: Prose | None = None

    def describe(self, monster_name: str) -> str:
        """Built from the sequence: "makes two cutlass attacks", or
        "makes three attacks: one with its bite and two with its claws". Plurals just add an "s";
        set ``text`` to override the whole sentence."""
        if self.text:
            return self.text
        subject = f"The {monster_name.lower()}"
        if len(self.sequence) == 1:
            entry = self.sequence[0]
            plural = "s" if entry.count > 1 else ""
            return f"{subject} makes {_number_word(entry.count)} {entry.action.lower()} attack{plural}."

        total = sum(entry.count for entry in self.sequence)
        parts = [
            f"{_number_word(e.count)} with its {e.action.lower()}{'s' if e.count > 1 else ''}" for e in self.sequence
        ]
        joined = f"{', '.join(parts[:-1])} and {parts[-1]}"
        return f"{subject} makes {_number_word(total)} attacks: {joined}."


class TextAction(Action):
    kind: Literal["text"] = "text"
    text: Prose
    recharge: Recharge | None = None

    @property
    def display_name(self) -> str:
        return f"{self.name} ({self.recharge.label})" if self.recharge else self.name

    def describe(self, monster_name: str) -> str:
        return self.text


# The union of the four kinds. When JSON is read, Pydantic looks at "kind" to pick the right class
# (a "discriminated union"). Action above is the abstract parent; AnyAction is "any one of its children".
AnyAction = Annotated[
    AttackAction | SaveAction | MultiattackAction | TextAction,
    Field(discriminator="kind"),
]

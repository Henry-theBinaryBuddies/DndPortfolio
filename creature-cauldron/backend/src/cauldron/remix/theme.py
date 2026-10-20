"""Themes: what a monster's main damage is, and how giving it a new theme changes its damage and its defences.

A theme is one of the ten damage themes (fire, cold, ...). Applying one does four things, all by code:

1. The monster's main damage type becomes the theme's type (an elemental type is preferred over physical damage, so a
   red dragon's fire is replaced, not its bite).
2. The old theme's immunity or resistance is traded for the new theme's.
3. If it has no such defence at all, it gains a resistance to the new theme.
4. It gains a vulnerability from a fixed table (fire and cold are each other's weakness, necrotic and radiant likewise,
   acid is weak to cold and poison to radiant); lightning, thunder, force and psychic have no good opposite, so none.

The result also lists what changed, in plain words, for the "What changed" summary.
"""

import re
from collections import defaultdict
from dataclasses import dataclass

from cauldron.actions import AttackAction, SaveAction
from cauldron.dice import average_dice
from cauldron.monster import DamageText, Monster
from cauldron.options import DamageTheme, DamageType
from cauldron.templates import swap_damage_type

_THEMES = {t.value for t in DamageTheme}
_TYPES = {t.value: t for t in DamageType}
# "63 (18d6) fire damage" gives the amount and the type; "fire damage" alone gives just the type.
_AMOUNT_AND_TYPE = re.compile(r"(\d+) \([^)]*\) ([a-z]+) damage")
_TYPE_ONLY = re.compile(r"\b([a-z]+) damage\b")

_VULNERABILITY: dict[DamageTheme, DamageType] = {
    DamageTheme.FIRE: DamageType.COLD,
    DamageTheme.COLD: DamageType.FIRE,
    DamageTheme.NECROTIC: DamageType.RADIANT,
    DamageTheme.RADIANT: DamageType.NECROTIC,
    DamageTheme.ACID: DamageType.COLD,
    DamageTheme.POISON: DamageType.RADIANT,
}


@dataclass(frozen=True)
class ThemeResult:
    monster: Monster
    changes: list[str]


def vulnerability_to(theme: DamageTheme) -> DamageType | None:
    """The damage type a monster of this theme is weak to, or None when the theme has no good opposite."""
    return _VULNERABILITY.get(theme)


# --- main damage ----------------------------------------------------------------------------------------


def _text_weights(text: str | None, weights: dict[DamageType, float]) -> None:
    """Adds the damage written in some text: by amount where one is given, otherwise a small weight per mention."""
    lowered = (text or "").lower()
    counted = 0
    for amount, kind in _AMOUNT_AND_TYPE.findall(lowered):
        if kind in _TYPES:
            weights[_TYPES[kind]] += int(amount)
            counted += 1
    mentions = [m for m in _TYPE_ONLY.findall(lowered) if m in _TYPES]
    for kind in mentions[counted:]:
        weights[_TYPES[kind]] += 1


def damage_weights(monster: Monster) -> dict[DamageType, float]:
    """How much of each damage type the monster deals (attack and save damage, and damage written in action text)."""
    weights: dict[DamageType, float] = defaultdict(float)
    for action in monster.all_actions():
        if isinstance(action, AttackAction):
            for roll in action.damage:
                weights[roll.type] += average_dice(roll.dice, roll.bonus)
            _text_weights(action.effects_text, weights)
        elif isinstance(action, SaveAction):
            for roll in action.on_fail:
                weights[roll.type] += average_dice(roll.dice, roll.bonus)
            _text_weights(action.effects_text, weights)
        else:
            _text_weights(action.text, weights)
    if monster.legendary_actions is not None:
        for option in monster.legendary_actions.options:
            _text_weights(option.text, weights)
    return dict(weights)


def primary_damage(monster: Monster) -> DamageType | None:
    """The monster's main damage type: the elemental type it deals most of, else its main physical type, else None."""
    weights = damage_weights(monster)
    if not weights:
        return None
    elemental = {t: w for t, w in weights.items() if t.value in _THEMES}
    pool = elemental or weights
    return sorted(pool, key=lambda t: (-pool[t], t.value))[0]


# --- applying a theme -----------------------------------------------------------------------------------


def _edit_line(text: str | None, removed: set[DamageType], added: list[DamageType]) -> str | None:
    """Keeps an exactly-printed defence line in step with the type list that changed beside it."""
    if text is None:
        return None
    parts = [p for p in text.split("; ") if p not in {r.value for r in removed}]
    parts += [a.value for a in added if a.value not in parts]
    return "; ".join(parts)


def _describe(label_set: str, label_verb: str, before: list[DamageType], after: list[DamageType]) -> str | None:
    removed, added = [t for t in before if t not in after], [t for t in after if t not in before]
    if removed and added:
        return f"{label_set}: {removed[0].value} → {added[0].value}"
    if added:
        return f"Now {label_verb} {added[0].value}"
    if removed:
        return f"No longer {label_verb} {removed[0].value}"
    return None


def apply_theme(monster: Monster, theme: DamageTheme) -> ThemeResult:
    new = DamageType(theme.value)
    changes: list[str] = []

    source = primary_damage(monster)
    current = monster
    if source is not None and source != new:
        current = swap_damage_type(current, source, new, defences=False)
        changes.append(f"Main damage: {source.value} → {new.value}")

    # The old theme: the elemental type that was swapped out, else the monster's own first theme tag.
    if source is not None and source.value in _THEMES:
        old_theme: DamageType | None = source
    else:
        old_theme = DamageType(monster.damage_themes[0].value) if monster.damage_themes else None

    immunities, resistances, vulnerabilities = list(current.immunities), list(current.resistances), list(current.vulnerabilities)

    def trade(items: list[DamageType]) -> bool:
        if old_theme is None or old_theme == new or old_theme not in items:
            return False
        items[items.index(old_theme)] = new
        items[:] = list(dict.fromkeys(items))
        return True

    if not trade(immunities):
        trade(resistances)
    if new not in immunities and new not in resistances:
        resistances.append(new)

    if new in vulnerabilities:
        vulnerabilities.remove(new)
    weakness = vulnerability_to(theme)
    if weakness is not None and weakness not in vulnerabilities and weakness not in immunities and weakness not in resistances:
        vulnerabilities.append(weakness)

    # Keep any exactly-printed defence wording in step with the lists.
    text = current.damage_text
    if text is not None:
        text = DamageText(
            vulnerabilities=_edit_line(text.vulnerabilities, set(current.vulnerabilities) - set(vulnerabilities), [t for t in vulnerabilities if t not in current.vulnerabilities]),
            resistances=_edit_line(text.resistances, set(current.resistances) - set(resistances), [t for t in resistances if t not in current.resistances]),
            immunities=_edit_line(text.immunities, set(current.immunities) - set(immunities), [t for t in immunities if t not in current.immunities]),
        )

    for message in (
        _describe("Immunity", "immune to", current.immunities, immunities),
        _describe("Resistance", "resists", current.resistances, resistances),
        _describe("Vulnerability", "vulnerable to", current.vulnerabilities, vulnerabilities),
    ):
        if message:
            changes.append(message)

    shaped = current.model_copy(
        update={
            "immunities": immunities,
            "resistances": resistances,
            "vulnerabilities": vulnerabilities,
            "damage_text": text,
            "damage_themes": [theme],
        }
    )
    return ThemeResult(shaped, changes)

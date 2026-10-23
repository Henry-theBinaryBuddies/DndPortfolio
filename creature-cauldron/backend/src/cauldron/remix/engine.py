"""The remix engine: a theme, then a signature move, then (optionally) a level up, all by code.

``remix`` does the work. ``resolve`` turns the visitor's choices, including "surprise", into a definite theme and move,
using a random generator that is passed in (so a test can make the same "random" choices every time).

Everything here is pure: it returns a new monster and a list of what changed, in plain words. The AI's part (the new name,
the description and the move's name) happens elsewhere, afterwards.
"""

import random
from dataclasses import dataclass

from cauldron.features import derive_features
from cauldron.monster import Monster
from cauldron.options import CreatureType, DamageTheme
from cauldron.remix.moves import MOVES, Move, available_moves, make_context
from cauldron.remix.theme import apply_theme, primary_damage
from cauldron.templates import level_up as apply_level_up

SURPRISE = "surprise"

# When a move is chosen without a theme, its damage follows the kind of creature.
_DEFAULT_THEME: dict[CreatureType, DamageTheme] = {
    CreatureType.ABERRATION: DamageTheme.PSYCHIC,
    CreatureType.BEAST: DamageTheme.POISON,
    CreatureType.CELESTIAL: DamageTheme.RADIANT,
    CreatureType.CONSTRUCT: DamageTheme.LIGHTNING,
    CreatureType.DRAGON: DamageTheme.FIRE,
    CreatureType.ELEMENTAL: DamageTheme.FIRE,
    CreatureType.FEY: DamageTheme.PSYCHIC,
    CreatureType.FIEND: DamageTheme.FIRE,
    CreatureType.GIANT: DamageTheme.THUNDER,
    CreatureType.HUMANOID: DamageTheme.FORCE,
    CreatureType.MONSTROSITY: DamageTheme.POISON,
    CreatureType.OOZE: DamageTheme.ACID,
    CreatureType.PLANT: DamageTheme.POISON,
    CreatureType.UNDEAD: DamageTheme.NECROTIC,
}
_THEMES = {t.value: t for t in DamageTheme}


@dataclass(frozen=True)
class RemixResult:
    monster: Monster
    changes: list[str]


def current_theme(monster: Monster) -> DamageTheme:
    """The monster's own theme: its main elemental damage, else its first theme tag, else one for its kind of creature."""
    main = primary_damage(monster)
    if main is not None and main.value in _THEMES:
        return _THEMES[main.value]
    return monster.damage_themes[0] if monster.damage_themes else _DEFAULT_THEME[monster.type]


def resolve(monster: Monster, theme: str | None, move: str | None, rng: random.Random) -> tuple[str | None, str | None]:
    """Decides the "surprise" parts of a request, using `rng`; every other choice is passed through unchanged.

    A surprise theme is never the theme the monster already has (that would change nothing), and a surprise move is
    only ever one that fits. Whether a move the visitor named fits is not decided here: `create_reskin` refuses it.
    """
    if theme == SURPRISE:
        theme = rng.choice([t.value for t in DamageTheme if t is not current_theme(monster)])
    if move == SURPRISE:
        fitting = available_moves(monster)
        move = rng.choice(fitting).key if fitting else None
    return theme, move


def _find(key: str) -> Move:
    if key not in MOVES:
        raise ValueError(f'Unknown move "{key}".')
    return MOVES[key]


def remix(
    monster: Monster, theme: DamageTheme | None, move_key: str | None, move_name: str, level_up: bool = False, defences: bool = True
) -> RemixResult:
    """The remixed monster and what changed. Needs at least one of a theme, a move or a level up.

    With `defences` False a theme changes the damage only: the monster keeps its resistances and immunities."""
    if theme is None and move_key is None and not level_up:
        raise ValueError("There is nothing to change: choose a theme, a move or a level up.")
    move = _find(move_key) if move_key is not None else None
    if move is not None and not move.applies_to(monster):
        raise ValueError(f"The move {move.label} does not fit this monster.")

    changes: list[str] = []
    shaped = monster
    if theme is not None:
        themed = apply_theme(shaped, theme, defences)
        shaped, changes = themed.monster, list(themed.changes)

    if move is not None:
        addition = move.build(make_context(shaped, theme if theme is not None else current_theme(monster), move_name))
        shaped = shaped.model_copy(
            update={
                "actions": [*shaped.actions, *addition.actions],
                "bonus_actions": [*shaped.bonus_actions, *addition.bonus_actions],
                "reactions": [*shaped.reactions, *addition.reactions],
                "traits": [*shaped.traits, *addition.traits],
            }
        )
        shaped = shaped.model_copy(update={"features": derive_features(shaped)})
        changes.append(addition.summary)

    if level_up:
        old_cr = shaped.challenge.cr
        shaped = apply_level_up(shaped)
        changes.append(f"Level up: CR {old_cr} \u2192 CR {shaped.challenge.cr}, with more hit points, better armor and harder hits")

    return RemixResult(shaped, changes)

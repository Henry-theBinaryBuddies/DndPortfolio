"""The brief: a request with every gap filled in.

A visitor may pick only a few filters ("undead, CR 3 to 4"). Before asking the AI, the service decides the rest at
random (F-18) so repeated requests give varied monsters. The result is a ``Brief``: plain data made only of values from the
fixed option lists. The random generator is passed in, so tests can make the same "random" choices every time.
"""

import random
from dataclasses import dataclass

from cauldron.options import CreatureType, DamageTheme, Environment, Feature, Role, Size
from cauldron.rules import CR_LABELS, cr_value
from cauldron.service.models import GenerateRequest

# Roughly half of monsters get a damage theme when the visitor did not choose one.
_THEME_CHANCE = 0.5


@dataclass(frozen=True)
class Brief:
    cr: str
    type: CreatureType
    size: Size
    environment: Environment
    role: Role
    damage_theme: DamageTheme | None
    features: tuple[Feature, ...]


def effective_bounds(request: GenerateRequest, max_cr: str) -> tuple[float, float] | None:
    """The challenge rating range to generate in: the request's bounds, cut off at the cap. None if nothing is left."""
    low = request.cr_min if request.cr_min is not None else 0.0
    high = min(request.cr_max if request.cr_max is not None else float("inf"), cr_value(max_cr))
    return (float(low), float(high)) if low <= high else None


def build_brief(request: GenerateRequest, max_cr: str, rng: random.Random) -> Brief:
    """Fills every gap in the request with a random choice from the right list."""
    bounds = effective_bounds(request, max_cr)
    if bounds is None:
        raise ValueError("The requested challenge rating range is above what can be generated.")
    low, high = bounds
    candidates = [label for label in CR_LABELS if low <= cr_value(label) <= high]

    if request.damage_themes:
        theme: DamageTheme | None = rng.choice(request.damage_themes)
    else:
        theme = rng.choice(list(DamageTheme)) if rng.random() < _THEME_CHANCE else None

    return Brief(
        cr=rng.choice(candidates),
        type=rng.choice(request.types or list(CreatureType)),
        size=rng.choice(request.sizes or list(Size)),
        environment=rng.choice(request.environments or list(Environment)),
        role=rng.choice(request.roles or list(Role)),
        damage_theme=theme,
        features=tuple(request.features),
    )

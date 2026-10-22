"""The messages the service sends and receives.

They mirror ``frontend/src/lib/generatorApi.ts``. Requests use the camelCase names the web page uses (``crMin``,
``damageThemes``); inside Python they are snake_case. Every field comes from a fixed option list, so no free text can
reach the AI model, and unknown fields are refused outright.
"""

import hashlib
from enum import StrEnum
from typing import Annotated, Literal

from pydantic import ConfigDict, Field, field_validator, model_validator
from pydantic.alias_generators import to_camel

from cauldron.base import CauldronModel
from cauldron.monster import Monster
from cauldron.remix.engine import SURPRISE
from cauldron.remix.graft import MAX_BORROW
from cauldron.remix.moves import MOVES
from cauldron.options import CreatureType, DamageTheme, Environment, Feature, Role, Size
from cauldron.rules import CR_LABELS, cr_value

_LADDER_VALUES = {cr_value(label) for label in CR_LABELS}
Id = Annotated[str, Field(min_length=1, max_length=100)]


class ApiModel(CauldronModel):
    """A request model: camelCase on the wire, snake_case in Python, unknown fields refused."""

    model_config = ConfigDict(extra="forbid", alias_generator=to_camel, populate_by_name=True)


def _unique(values: list) -> list:
    return list(dict.fromkeys(values))


class GenerateRequest(ApiModel):
    cr_min: float | None = None
    cr_max: float | None = None
    types: Annotated[list[CreatureType], Field(max_length=50)] = Field(default_factory=list)
    sizes: Annotated[list[Size], Field(max_length=50)] = Field(default_factory=list)
    environments: Annotated[list[Environment], Field(max_length=50)] = Field(default_factory=list)
    roles: Annotated[list[Role], Field(max_length=50)] = Field(default_factory=list)
    damage_themes: Annotated[list[DamageTheme], Field(max_length=50)] = Field(default_factory=list)
    features: Annotated[list[Feature], Field(max_length=50)] = Field(default_factory=list)
    # Monsters the visitor already has, so a cached answer is always a new one.
    exclude_ids: list[Id] = Field(default_factory=list, max_length=500)

    @field_validator("cr_min", "cr_max")
    @classmethod
    def _real_challenge_rating(cls, value: float | None) -> float | None:
        if value is not None and value not in _LADDER_VALUES:
            raise ValueError("must be a real challenge rating: 0, 1/8, 1/4, 1/2, or 1 to 30")
        return value

    @field_validator("types", "sizes", "environments", "roles", "damage_themes", "features")
    @classmethod
    def _no_repeats(cls, value: list) -> list:
        return _unique(value)

    @model_validator(mode="after")
    def _minimum_not_above_maximum(self) -> "GenerateRequest":
        if self.cr_min is not None and self.cr_max is not None and self.cr_min > self.cr_max:
            raise ValueError("crMin cannot be above crMax")
        return self


class ReskinRequest(ApiModel):
    """A reskin names an existing monster by id. The monster itself is never sent, so none of its text can reach the model.

    A remix is a ``theme`` and/or a signature ``move``, optionally with ``level_up``. Theme and move may each be "surprise",
    which the server decides (see ``settle``). ``damage_only`` makes a theme change the damage alone, leaving the monster's
    resistances and immunities as they were. A ``reflavor`` is a request on its own: a new name, description and ability
    names, and no number changed at all. A polymorph names a ``donor_id`` and either ``borrow`` (the keys of the donor's features to
    take, from the graft options) or ``forge_chooses`` (the AI picks them); it may also ``level_up`` and ask for ``legendary``
    actions.
    """

    base_id: Id
    theme: str | None = None
    damage_only: bool = False
    move: str | None = None
    level_up: bool = False
    reflavor: bool = False
    donor_id: Id | None = None
    borrow: Annotated[list[Annotated[str, Field(min_length=1, max_length=120)]], Field(max_length=MAX_BORROW)] = Field(default_factory=list)
    forge_chooses: bool = False
    legendary: bool = False

    @field_validator("theme")
    @classmethod
    def _a_known_theme(cls, value: str | None) -> str | None:
        if value is not None and value != SURPRISE and value not in {t.value for t in DamageTheme}:
            raise ValueError("theme must be one of the damage themes, or surprise")
        return value

    @field_validator("move")
    @classmethod
    def _a_known_move(cls, value: str | None) -> str | None:
        if value is not None and value != SURPRISE and value not in MOVES:
            raise ValueError("move must be one of the signature moves, or surprise")
        return value

    @model_validator(mode="after")
    def _something_to_do(self) -> "ReskinRequest":
        if self.damage_only and self.theme is None:
            raise ValueError("damageOnly needs a theme to apply")
        if (self.borrow or self.forge_chooses or self.legendary) and self.donor_id is None:
            raise ValueError("borrowing needs a donor")
        if self.donor_id is not None:
            if not self.borrow and not self.forge_chooses:
                raise ValueError("choose what to borrow, or let the forge choose")
            if self.borrow and self.forge_chooses:
                raise ValueError("either choose what to borrow or let the forge choose, not both")
            if self.theme is not None or self.move is not None or self.reflavor:
                raise ValueError("a polymorph cannot be combined with a theme, a move or a reflavor")
        changes_numbers = self.theme is not None or self.move is not None or self.level_up or self.donor_id is not None
        if self.reflavor and changes_numbers:
            raise ValueError("a reflavor changes no numbers, so it cannot be combined with a theme, a move, a level up or a polymorph")
        if not self.reflavor and not changes_numbers:
            raise ValueError("a reskin needs a reflavor, a theme, a move, a polymorph or a level up")
        return self

    @property
    def has_surprise(self) -> bool:
        return SURPRISE in (self.theme, self.move)

    @property
    def cache_key(self) -> str:
        """The same request always gives the same key, so a repeated reskin is answered from the store.

        A request that still has a "surprise" in it has no meaningful key: settle it first."""
        theme = f"{self.theme}{'!' if self.damage_only else ''}" if self.theme else "-"
        parts = f"{self.base_id}|{theme}|{self.move or '-'}|{'up' if self.level_up else '-'}|{'flavor' if self.reflavor else '-'}|{self.donor_id or '-'}:{','.join(sorted(self.borrow))}{'!legendary' if self.legendary else ''}"
        return hashlib.sha256(parts.encode()).hexdigest()


class GraftOptionsRequest(ApiModel):
    """Which of a donor's features a base monster could borrow."""

    base_id: Id
    donor_id: Id


class FailureReason(StrEnum):
    """The reasons the web page already knows how to show."""

    OFFLINE = "offline"
    RESTING = "resting"
    RATE_LIMITED = "rate-limited"
    INVALID = "invalid"
    ERROR = "error"


class BorrowOption(CauldronModel):
    key: str
    kind: str
    label: str


class GraftOptions(CauldronModel):
    ok: Literal[True] = True
    options: list[BorrowOption]


class GenerateSuccess(CauldronModel):
    ok: Literal[True] = True
    monster: Monster
    notes: list[str] = Field(default_factory=list)


class GenerateFailure(CauldronModel):
    ok: Literal[False] = False
    reason: FailureReason
    message: str

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
from cauldron.options import CreatureType, DamageTheme, DamageType, Environment, Feature, Role, Size
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


class DamageSwap(ApiModel):
    # "from" is a Python keyword, so the field is from_ and the wire name is set by hand.
    from_: DamageType = Field(alias="from")
    to: DamageType

    @model_validator(mode="after")
    def _a_real_change(self) -> "DamageSwap":
        if self.from_ == self.to:
            raise ValueError("a damage swap must change the type")
        return self


class ReskinRequest(ApiModel):
    """A reskin names an existing monster by id. The monster itself is never sent, so none of its text can reach the model."""

    base_id: Id
    damage_swap: DamageSwap | None = None
    template: Literal["level_up"] | None = None

    @model_validator(mode="after")
    def _something_to_do(self) -> "ReskinRequest":
        if self.damage_swap is None and self.template is None:
            raise ValueError("a reskin needs a damage swap, a template, or both")
        return self

    @property
    def cache_key(self) -> str:
        """The same request always gives the same key, so a repeated reskin is answered from the store."""
        swap = f"{self.damage_swap.from_.value}>{self.damage_swap.to.value}" if self.damage_swap else "-"
        return hashlib.sha256(f"{self.base_id}|{swap}|{self.template or '-'}".encode()).hexdigest()


class FailureReason(StrEnum):
    """The reasons the web page already knows how to show."""

    OFFLINE = "offline"
    RESTING = "resting"
    RATE_LIMITED = "rate-limited"
    INVALID = "invalid"
    ERROR = "error"


class GenerateSuccess(CauldronModel):
    ok: Literal[True] = True
    monster: Monster
    notes: list[str] = Field(default_factory=list)


class GenerateFailure(CauldronModel):
    ok: Literal[False] = False
    reason: FailureReason
    message: str

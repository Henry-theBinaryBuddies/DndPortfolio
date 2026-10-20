"""The draft: the part of a monster the AI is asked to write.

The AI fills in a ``MonsterDraft`` (the creative and mechanical choices). Code then adds everything else, so the AI can never
claim a source, mark itself validated, invent an attribution or pick its own feature tags. In particular the challenge
block (XP, proficiency bonus) is computed from the challenge rating label by the SRD tables, and the feature tags are
derived from the stat block.
"""

from pydantic import Field, field_validator

from cauldron.actions import AnyAction, TextAction
from cauldron.base import CauldronModel
from cauldron.features import derive_features
from cauldron.monster import (
    Abilities,
    ArmorClass,
    Challenge,
    HitPoints,
    LegendaryActions,
    Monster,
    Senses,
    Short,
    Speeds,
    Spellcasting,
)
from cauldron.actions import Prose
from cauldron.options import Ability, CreatureType, DamageTheme, DamageType, Environment, Role, Size, Source
from cauldron.rules import CR_LABELS, cr_value, proficiency_bonus, xp_for_cr


class MonsterDraft(CauldronModel):
    name: Short
    size: Size
    type: CreatureType
    subtypes: list[Short] = Field(default_factory=list)
    alignment: Short
    armor_class: ArmorClass
    hit_points: HitPoints
    speeds: Speeds
    abilities: Abilities
    saves: dict[Ability, int] = Field(default_factory=dict)
    skills: dict[str, int] = Field(default_factory=dict)
    vulnerabilities: list[DamageType] = Field(default_factory=list)
    resistances: list[DamageType] = Field(default_factory=list)
    immunities: list[DamageType] = Field(default_factory=list)
    condition_immunities: list[Short] = Field(default_factory=list)
    senses: Senses
    languages: str = "—"
    cr: str  # the challenge rating label, for example "5" or "1/4"
    traits: list[TextAction] = Field(default_factory=list)
    actions: list[AnyAction] = Field(default_factory=list)
    bonus_actions: list[AnyAction] = Field(default_factory=list)
    reactions: list[AnyAction] = Field(default_factory=list)
    legendary_actions: LegendaryActions | None = None
    spellcasting: Spellcasting | None = None
    environments: list[Environment] = Field(default_factory=list)
    role: Role
    damage_themes: list[DamageTheme] = Field(default_factory=list)
    description: Prose

    @field_validator("cr")
    @classmethod
    def _a_real_challenge_rating(cls, value: str) -> str:
        if value not in CR_LABELS:
            raise ValueError("cr must be a challenge rating: 0, 1/8, 1/4, 1/2, or 1 to 30")
        return value


def draft_json_schema() -> dict:
    """The JSON schema the AI must follow, made from the draft model so the two can never drift apart."""
    return MonsterDraft.model_json_schema()


def monster_from_draft(draft: MonsterDraft, generator: str, new_id: str) -> Monster:
    """A full Monster from a draft. Code supplies identity, provenance, the challenge block and the feature tags."""
    data = draft.model_dump(exclude={"cr"})
    monster = Monster(
        **data,
        id=new_id,
        schema_version=1,
        source=Source.AI,
        validated=False,
        generator=generator,
        challenge=Challenge(cr=draft.cr, cr_value=cr_value(draft.cr), xp=xp_for_cr(draft.cr), proficiency_bonus=proficiency_bonus(draft.cr)),
        features=[],
    )
    return monster.model_copy(update={"features": derive_features(monster)})

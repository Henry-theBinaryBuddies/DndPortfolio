"""The fixed option lists. They mirror frontend/src/lib/options.ts, so both sides agree on every allowed value.

An Enum is a class whose instances are a fixed set of named values. StrEnum makes each one also a string, so
`Size.LARGE == "large"` is True and the values read and write as plain JSON strings.
"""

from enum import StrEnum


class Size(StrEnum):
    TINY = "tiny"
    SMALL = "small"
    MEDIUM = "medium"
    LARGE = "large"
    HUGE = "huge"
    GARGANTUAN = "gargantuan"


class CreatureType(StrEnum):
    ABERRATION = "aberration"
    BEAST = "beast"
    CELESTIAL = "celestial"
    CONSTRUCT = "construct"
    DRAGON = "dragon"
    ELEMENTAL = "elemental"
    FEY = "fey"
    FIEND = "fiend"
    GIANT = "giant"
    HUMANOID = "humanoid"
    MONSTROSITY = "monstrosity"
    OOZE = "ooze"
    PLANT = "plant"
    UNDEAD = "undead"


class DamageType(StrEnum):
    ACID = "acid"
    BLUDGEONING = "bludgeoning"
    COLD = "cold"
    FIRE = "fire"
    FORCE = "force"
    LIGHTNING = "lightning"
    NECROTIC = "necrotic"
    PIERCING = "piercing"
    POISON = "poison"
    PSYCHIC = "psychic"
    RADIANT = "radiant"
    SLASHING = "slashing"
    THUNDER = "thunder"


class DamageTheme(StrEnum):
    """The damage types a creature can be themed around. Weapon damage is not a theme."""

    ACID = "acid"
    COLD = "cold"
    FIRE = "fire"
    FORCE = "force"
    LIGHTNING = "lightning"
    NECROTIC = "necrotic"
    POISON = "poison"
    PSYCHIC = "psychic"
    RADIANT = "radiant"
    THUNDER = "thunder"


class Role(StrEnum):
    BRUTE = "brute"
    SKIRMISHER = "skirmisher"
    CONTROLLER = "controller"
    ARTILLERY = "artillery"
    LURKER = "lurker"
    LEADER = "leader"
    SOLO = "solo"


class Environment(StrEnum):
    ARCTIC = "arctic"
    COAST = "coast"
    DESERT = "desert"
    FOREST = "forest"
    GRASSLAND = "grassland"
    HILL = "hill"
    MOUNTAIN = "mountain"
    SWAMP = "swamp"
    UNDERDARK = "underdark"
    UNDERWATER = "underwater"
    URBAN = "urban"
    DUNGEON = "dungeon"
    PLANAR = "planar"


class Feature(StrEnum):
    """Derived by code from the stat block, never trusted from the AI."""

    FLYING = "flying"
    SWIMMING = "swimming"
    MULTIATTACK = "multiattack"
    BREATH_WEAPON = "breath-weapon"
    LEGENDARY = "legendary"
    SPELLCASTING = "spellcasting"
    REGENERATION = "regeneration"


class Ability(StrEnum):
    STR = "str"
    DEX = "dex"
    CON = "con"
    INT = "int"
    WIS = "wis"
    CHA = "cha"


class Source(StrEnum):
    SRD = "srd"
    A5E = "a5e"  # Monstrous Menagerie (Advanced 5th Edition), imported from Open5e
    CURATED = "curated"
    AI = "ai"
    RESKIN = "reskin"


class AttackMode(StrEnum):
    MELEE_WEAPON = "melee_weapon"
    RANGED_WEAPON = "ranged_weapon"
    MELEE_SPELL = "melee_spell"
    RANGED_SPELL = "ranged_spell"


class AreaShape(StrEnum):
    CONE = "cone"
    LINE = "line"
    RADIUS = "radius"
    CUBE = "cube"
    SPHERE = "sphere"


class SaveSuccess(StrEnum):
    HALF = "half"
    NONE = "none"


ABILITY_NAMES: dict[Ability, str] = {
    Ability.STR: "Strength",
    Ability.DEX: "Dexterity",
    Ability.CON: "Constitution",
    Ability.INT: "Intelligence",
    Ability.WIS: "Wisdom",
    Ability.CHA: "Charisma",
}

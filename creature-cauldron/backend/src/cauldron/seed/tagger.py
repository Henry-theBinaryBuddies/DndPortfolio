"""Rule-based discovery tags for imported monsters: environments, role and damage themes.

The SRD says nothing about environments or roles, so these are *guesses made by simple rules*, there only to help
people filter. They are deliberately easy to read and change: edit the tables below. ``features`` are not here;
they are derived exactly by ``cauldron.features``.
"""

import re
from dataclasses import dataclass

from cauldron.actions import Action, AttackAction
from cauldron.dice import average_dice
from cauldron.monster import Monster
from cauldron.options import AttackMode, CreatureType, DamageTheme, Environment, Role

E = Environment

# Name keywords, checked in order. Every rule whose pattern is found in the lowercase name adds its environments.
_NAME_RULES: list[tuple[str, list[Environment]]] = [
    (r"white dragon|winter wolf|yeti|polar bear|mammoth|ice mephit|ice devil|frost giant|remorhaz", [E.ARCTIC]),
    (r"red dragon", [E.MOUNTAIN, E.HILL]),
    (r"blue dragon", [E.DESERT, E.COAST]),
    (r"green dragon", [E.FOREST]),
    (r"black dragon", [E.SWAMP]),
    (r"brass dragon", [E.DESERT]),
    (r"bronze dragon", [E.COAST]),
    (r"copper dragon", [E.HILL, E.MOUNTAIN]),
    (r"gold dragon", [E.GRASSLAND, E.HILL]),
    (r"silver dragon", [E.MOUNTAIN, E.ARCTIC]),
    (r"shark|whale|octopus|quipper|sea horse|kraken|sahuagin|merrow|water elemental|plesiosaurus|marid|aboleth|sea hag", [E.UNDERWATER]),
    (r"crab|merfolk|giant sea", [E.COAST]),
    (r"crocodile|frog|toad|lizardfolk|giant lizard|bullywug|green hag|will-o|shambling mound|black dragon", [E.SWAMP]),
    (r"camel|scorpion|dust mephit|djinni|efreeti|sphinx|lamia|dune|mummy", [E.DESERT]),
    (r"eagle|griffon|hippogriff|roc\b|wyvern|manticore|harpy|chimera|cloud giant|stone giant|storm giant", [E.MOUNTAIN]),
    (r"goat|hill giant|ogre|troll|orc\b|ettin", [E.HILL]),
    (r"wolf|bear|boar|deer|elk|owl|dryad|treant|awakened|sprite|pixie|satyr|centaur|unicorn|worg|spider|ettercap|blink dog|badger|bugbear|goblin|hobgoblin|ape|baboon", [E.FOREST]),
    (r"horse|pony|mule|lion|hyena|jackal|gnoll|rhinoceros|elephant|tiger|panther|draft", [E.GRASSLAND]),
    (r"drow|duergar|deep gnome|gelatinous|ochre jelly|black pudding|gray ooze|cloaker|roper|rust monster|piercer|darkmantle|hook horror|purple worm|drider|myconid|shrieker|violet fungus|gibbering|bat\b|bats\b|grick|giant centipede", [E.UNDERDARK]),
    (r"skeleton|zombie|ghoul|ghast|wight|wraith|specter|ghost|vampire|lich|animated armor|flying sword|rug of smothering|gargoyle|golem|shield guardian|helmed horror|mimic|minotaur|banshee|carrion|mummy", [E.DUNGEON]),
    (r"commoner|noble|guard|bandit|thug|spy|scout|acolyte|priest|knight|veteran|gladiator|cult|assassin|\brat|raven|\bcat\b|mastiff|archmage|mage|druid|berserker|tribal", [E.URBAN]),
    (r"mephit|salamander|xorn|azer|invisible stalker|air elemental|earth elemental|fire elemental|couatl|deva|planetar|solar|imp\b|quasit|devil|demon|balor|marilith|vrock|hezrou|glabrezu|nalfeshnee|succubus|incubus|erinyes|hell hound|nightmare|rakshasa", [E.PLANAR]),
]

_TYPE_FALLBACK: dict[CreatureType, list[Environment]] = {
    CreatureType.ABERRATION: [E.UNDERDARK],
    CreatureType.BEAST: [E.FOREST, E.GRASSLAND],
    CreatureType.CELESTIAL: [E.PLANAR],
    CreatureType.CONSTRUCT: [E.DUNGEON],
    CreatureType.DRAGON: [E.MOUNTAIN],
    CreatureType.ELEMENTAL: [E.PLANAR],
    CreatureType.FEY: [E.FOREST],
    CreatureType.FIEND: [E.PLANAR, E.DUNGEON],
    CreatureType.GIANT: [E.HILL, E.MOUNTAIN],
    CreatureType.HUMANOID: [E.URBAN, E.GRASSLAND],
    CreatureType.MONSTROSITY: [E.FOREST, E.HILL],
    CreatureType.OOZE: [E.DUNGEON, E.UNDERDARK],
    CreatureType.PLANT: [E.FOREST, E.SWAMP],
    CreatureType.UNDEAD: [E.DUNGEON, E.URBAN],
}

_CONTROL_WORDS = re.compile(r"paralyzed|restrained|charmed|frightened|stunned|blinded|petrified|incapacitated|grappled|entangle", re.IGNORECASE)
_AMBUSH_WORDS = re.compile(r"invisible|surprise attack|ambush|false appearance|camouflage|sneak attack|shadow stealth", re.IGNORECASE)
_LEADER_WORDS = re.compile(r"leadership|rally|command|allies within|other creatures of its choice|allied", re.IGNORECASE)
_MOBILE_WORDS = re.compile(r"nimble escape|pack tactics|charge|pounce|flyby|disengage|hit and run|spider climb", re.IGNORECASE)
_DAMAGE_WORD = re.compile(r"([a-z]+) damage")

_ELEMENTS = [theme for theme in DamageTheme]


@dataclass(frozen=True)
class Tags:
    environments: list[Environment]
    role: Role
    damage_themes: list[DamageTheme]


# --- helpers --------------------------------------------------------------------------------------------


def _action_text(action: Action, monster_name: str) -> str:
    return f"{action.name}. {action.describe(monster_name)}"


def _all_action_text(monster: Monster) -> str:
    parts = [_action_text(a, monster.name) for a in monster.all_actions()]
    if monster.legendary_actions:
        parts += [f"{o.name}. {o.text}" for o in monster.legendary_actions.options]
    return " ".join(parts)


def _trait_text(monster: Monster) -> str:
    return " ".join(f"{t.name}. {t.text}" for t in monster.traits)


def _average(action: AttackAction) -> int:
    return sum(average_dice(r.dice, r.bonus) for r in action.damage)


# --- the three tag kinds --------------------------------------------------------------------------------


def _environments(monster: Monster) -> list[Environment]:
    name = monster.name.lower()
    found: list[Environment] = []
    for pattern, environments in _NAME_RULES:
        if re.search(pattern, name):
            found += [e for e in environments if e not in found]
    if not found:
        found = list(_TYPE_FALLBACK[monster.type])
    speeds = monster.speeds
    if speeds.swim and speeds.swim > (speeds.walk or 0) and Environment.UNDERWATER not in found:
        found.insert(0, Environment.UNDERWATER)
    return found[:3]


def _role(monster: Monster) -> Role:
    if monster.legendary_actions is not None:
        return Role.SOLO

    if monster.spellcasting is not None:
        return Role.CONTROLLER

    attacks = [a for a in monster.actions if isinstance(a, AttackAction)]
    ranged = [a for a in attacks if a.attack.mode in (AttackMode.RANGED_WEAPON, AttackMode.RANGED_SPELL)]
    melee = [a for a in attacks if a not in ranged]
    if ranged and (not melee or max(map(_average, ranged)) >= max(map(_average, melee))):
        return Role.ARTILLERY

    actions = _all_action_text(monster)
    if _CONTROL_WORDS.search(actions):
        return Role.CONTROLLER

    stealth = max((bonus for skill, bonus in monster.skills.items() if skill.lower() == "stealth"), default=0)
    everything = f"{actions} {_trait_text(monster)}"
    if stealth >= 5 or _AMBUSH_WORDS.search(everything) or monster.speeds.burrow:
        return Role.LURKER

    if _LEADER_WORDS.search(everything):
        return Role.LEADER

    speeds = monster.speeds
    if speeds.fly or speeds.climb or (speeds.walk or 0) >= 40 or _MOBILE_WORDS.search(everything):
        return Role.SKIRMISHER
    return Role.BRUTE


def _damage_themes(monster: Monster) -> list[DamageTheme]:
    mentioned = set(_DAMAGE_WORD.findall(_all_action_text(monster).lower()))
    mentioned.update(t.value for t in monster.immunities)
    return [theme for theme in _ELEMENTS if theme.value in mentioned][:3]


def tag(monster: Monster) -> Tags:
    """Environments, role and damage themes for one monster."""
    return Tags(environments=_environments(monster), role=_role(monster), damage_themes=_damage_themes(monster))

"""The SRD importer: raw entries from the community data to validated Monsters.

``import_monster`` converts one entry. ``import_all`` converts the whole file, skipping excluded entries, running
every monster through the Validator, and collecting what happened so a report can be written.

Principles: official numbers are kept as printed; experience points and proficiency bonus come from the SRD
tables, not the community file; anything that cannot be typed exactly stays text (nothing is lost); every
monster carries the exact SRD attribution.
"""

import re
from dataclasses import dataclass, field

from cauldron.actions import Action, TextAction
from cauldron.features import derive_features
from cauldron.monster import (
    Abilities,
    ArmorClass,
    Challenge,
    DamageText,
    HitPoints,
    LegendaryActions,
    Monster,
    Senses,
    Speeds,
)
from cauldron.options import Ability, CreatureType, Size, Source
from cauldron.rules import SRD_ATTRIBUTION, cr_value, proficiency_bonus, xp_for_cr
from cauldron.seed.action_parser import _name_with_usage, _recharge, parse_action, parse_legendary_action
from cauldron.seed.corrections import EXCLUDED, OVERRIDES
from cauldron.seed.damage import parse_damage_line
from cauldron.seed.spells import parse_spellcasting
from cauldron.seed.tagger import tag
from cauldron.validator import Finding, Status, ValidationContext, Validator

_CR_LABELS = {0.125: "1/8", 0.25: "1/4", 0.5: "1/2"}
_FEET = re.compile(r"(\d+)\s*ft")
_SWARM_TYPE = re.compile(r"swarm of (\w+) beasts", re.IGNORECASE)
LEGENDARY_PER_ROUND = 3  # the SRD data does not carry the intro sentence; every SRD legendary monster uses 3


@dataclass
class ImportedMonster:
    monster: Monster
    notes: list[str] = field(default_factory=list)


@dataclass
class ImportResult:
    monsters: list[Monster] = field(default_factory=list)
    excluded: dict[str, str] = field(default_factory=dict)  # raw index -> reason
    rejected: list[tuple[str, list[Finding]]] = field(default_factory=list)
    import_notes: dict[str, list[str]] = field(default_factory=dict)  # monster name -> notes from the importer
    validator_notes: dict[str, list[Finding]] = field(default_factory=dict)  # monster name -> notes from the validator


# --- small field converters -----------------------------------------------------------------------------


def _feet(text: str) -> int:
    match = _FEET.search(text)
    if match is None:
        raise ValueError(f'No distance in "{text}"')
    return int(match.group(1))


def _cr_label(value: float) -> str:
    return _CR_LABELS.get(value, str(int(value)))


def _armor_class(entries: list[dict]) -> ArmorClass:
    """The first armor class is the value. Others ("11 while prone", "15 with mage armor") go in the note."""

    def label(entry: dict) -> str | None:
        kind = entry["type"]
        if kind == "natural":
            return "natural armor"
        if kind == "armor":
            return ", ".join(item["name"].lower() for item in entry.get("armor", [])) or None
        if kind == "spell":
            return entry["spell"]["name"].lower()
        if kind == "condition":
            return entry["condition"]["name"].lower()
        return None

    first, *others = entries
    parts: list[str] = []
    if label(first):
        parts.append(label(first))  # type: ignore[arg-type]
    for entry in others:
        word = "while" if entry["type"] == "condition" else "with"
        parts.append(f"{entry['value']} {word} {label(entry)}")
    return ArmorClass(value=first["value"], note=", ".join(parts) or None)


def _speeds(raw: dict) -> Speeds:
    values = {key: _feet(raw[key]) for key in ("walk", "fly", "swim", "climb", "burrow") if key in raw}
    return Speeds(**values, hover=True if raw.get("hover") else None)


def _senses(raw: dict) -> Senses:
    values = {key: _feet(raw[key]) for key in ("darkvision", "blindsight", "tremorsense", "truesight") if key in raw}
    return Senses(**values, passive_perception=raw["passive_perception"])


def _proficiencies(raw: dict) -> tuple[dict[Ability, int], dict[str, int]]:
    saves: dict[Ability, int] = {}
    skills: dict[str, int] = {}
    for entry in raw["proficiencies"]:
        index = entry["proficiency"]["index"]
        if index.startswith("saving-throw-"):
            saves[Ability(index.removeprefix("saving-throw-"))] = entry["value"]
        elif index.startswith("skill-"):
            skills[entry["proficiency"]["name"].removeprefix("Skill: ")] = entry["value"]
    return saves, skills


def _type_and_subtypes(raw: dict) -> tuple[CreatureType, list[str]]:
    subtypes = [raw["subtype"]] if raw.get("subtype") else []
    swarm = _SWARM_TYPE.fullmatch(raw["type"])
    if swarm:
        return CreatureType.BEAST, [raw["type"]] + subtypes
    return CreatureType(raw["type"]), subtypes


# --- one monster ----------------------------------------------------------------------------------------


def import_monster(raw: dict, *, source: Source = Source.SRD, attribution: str = SRD_ATTRIBUTION, id_prefix: str = "srd") -> ImportedMonster:
    """Converts one raw SRD entry. Applies the known corrections first. The A5E importer reuses this with its own source,
    credit and id prefix."""
    raw = {**raw, **OVERRIDES.get(raw["index"], {})}
    notes: list[str] = []

    abilities = Abilities(
        str=raw["strength"], dex=raw["dexterity"], con=raw["constitution"],
        int=raw["intelligence"], wis=raw["wisdom"], cha=raw["charisma"],
    )
    label = _cr_label(raw["challenge_rating"])
    pb = proficiency_bonus(label)
    xp = xp_for_cr(label)
    if label == "0" and raw["xp"] == 0:
        xp = 0  # the SRD prints "0 or 10 XP" for CR 0: creatures with no effective attacks are worth none
    elif raw["xp"] != xp:
        notes.append(f"The community file gave {raw['xp']} experience points; the SRD table says {xp} for CR {label}.")
    if raw["proficiency_bonus"] != pb:
        notes.append(f"The community file gave proficiency bonus {raw['proficiency_bonus']}; the SRD table says {pb}.")

    # Traits: spellcasting becomes structured data, everything else is a text action.
    traits: list[TextAction] = []
    spellcasting = None
    for entry in raw.get("special_abilities", []):
        if entry.get("spellcasting"):
            spellcasting = parse_spellcasting(entry, abilities, pb)
            if spellcasting is not None:
                continue
            notes.append(f'"{entry["name"]}" is kept as text: its spell lists were not in a recognised form.')
        traits.append(
            TextAction(
                name=_name_with_usage(entry["name"], entry.get("usage")),
                text=entry["desc"],
                recharge=_recharge(entry.get("usage")),
            )
        )

    def actions(key: str) -> list[Action]:
        return [parse_action(e, raw["name"], abilities, pb) for e in raw.get(key, [])]

    legendary = None
    if raw.get("legendary_actions"):
        legendary = LegendaryActions(
            per_round=LEGENDARY_PER_ROUND,
            options=[parse_legendary_action(e) for e in raw["legendary_actions"]],
        )
        notes.append(f"Legendary actions per round set to {LEGENDARY_PER_ROUND}: the data does not give the number.")

    saves, skills = _proficiencies(raw)
    vulnerabilities, vulnerability_text = parse_damage_line(raw["damage_vulnerabilities"])
    resistances, resistance_text = parse_damage_line(raw["damage_resistances"])
    immunities, immunity_text = parse_damage_line(raw["damage_immunities"])
    damage_text = None
    if vulnerability_text or resistance_text or immunity_text:
        damage_text = DamageText(vulnerabilities=vulnerability_text, resistances=resistance_text, immunities=immunity_text)

    creature_type, subtypes = _type_and_subtypes(raw)
    monster = Monster(
        id=f"{id_prefix}-{raw['index']}",
        schema_version=1,
        name=raw["name"],
        source=source,
        validated=False,
        attribution=attribution,
        size=Size(raw["size"].lower()),
        type=creature_type,
        subtypes=subtypes,
        alignment=raw["alignment"],
        armor_class=_armor_class(raw["armor_class"]),
        hit_points=HitPoints(average=raw["hit_points"], dice=raw["hit_points_roll"]),
        speeds=_speeds(raw["speed"]),
        abilities=abilities,
        saves=saves,
        skills=skills,
        vulnerabilities=vulnerabilities,
        resistances=resistances,
        immunities=immunities,
        damage_text=damage_text,
        condition_immunities=[c["name"].lower() for c in raw["condition_immunities"]],
        senses=_senses(raw["senses"]),
        languages=raw["languages"] or "—",
        challenge=Challenge(cr=label, cr_value=cr_value(label), xp=xp, proficiency_bonus=pb),
        traits=traits,
        actions=actions("actions"),
        bonus_actions=[],
        reactions=actions("reactions"),
        legendary_actions=legendary,
        spellcasting=spellcasting,
        environments=[],
        role="brute",  # replaced just below
        damage_themes=[],
        features=[],
        description=raw.get("desc", ""),
    )

    tags = tag(monster)
    monster = monster.model_copy(
        update={
            "environments": tags.environments,
            "role": tags.role,
            "damage_themes": tags.damage_themes,
            "features": derive_features(monster),
        }
    )
    return ImportedMonster(monster=monster, notes=notes)


# --- everything -----------------------------------------------------------------------------------------


def import_all(raw_monsters: list[dict]) -> ImportResult:
    """Imports the whole data set and validates every monster. Rejected monsters are reported, not returned."""
    result = ImportResult()
    validator = Validator()
    names: set[str] = set()

    for raw in raw_monsters:
        index = raw["index"]
        if index in EXCLUDED:
            result.excluded[index] = EXCLUDED[index]
            continue

        imported = import_monster(raw)
        report = validator.validate(imported.monster, ValidationContext(existing_names=frozenset(names)))
        if imported.notes:
            result.import_notes[imported.monster.name] = imported.notes
        if report.notes:
            result.validator_notes[imported.monster.name] = report.notes
        if report.status is Status.REJECTED:
            result.rejected.append((imported.monster.name, report.errors))
            continue
        names.add(imported.monster.name)
        result.monsters.append(report.monster)
    return result

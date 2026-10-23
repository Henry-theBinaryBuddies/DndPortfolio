"""Reskin helpers: a damage-type swap, renaming a monster inside its own text, and level up.

The AI may only rename and re-describe a monster. Every change to its numbers is made here, by code, so a
reskin can never invent statistics. The results are new monsters; run them through the Validator.
"""

import re
from collections.abc import Callable

from cauldron.actions import Action, AttackAction, DamageRoll, SaveAction
from cauldron.dice import ability_modifier, parse_dice
from cauldron.monster import Challenge, DamageText, HitPoints, Monster
from cauldron.options import DamageTheme, DamageType
from cauldron.rules import hit_die, proficiency_bonus, step_cr

_THEMES = {theme.value for theme in DamageTheme}


# --- every piece of prose ---------------------------------------------------------------------------------


def _rewrite_text(monster: Monster, fn: Callable[[str | None], str | None]) -> Monster:
    """A copy with `fn` applied to every piece of prose: the effects of attacks and saves, the text of other actions, traits,
    legendary options and the spellcasting intro and footer. Numbers and types are left to the caller."""

    def action(a: Action) -> Action:
        if isinstance(a, (AttackAction, SaveAction)):
            return a.model_copy(update={"effects_text": fn(a.effects_text)})
        return a.model_copy(update={"text": fn(a.text)})  # a multiattack or a text action

    legendary = monster.legendary_actions
    if legendary is not None:
        legendary = legendary.model_copy(update={"options": [o.model_copy(update={"text": fn(o.text)}) for o in legendary.options]})
    spellcasting = monster.spellcasting
    if spellcasting is not None:
        spellcasting = spellcasting.model_copy(update={"intro": fn(spellcasting.intro), "footer": fn(spellcasting.footer)})
    return monster.map_actions(action).model_copy(
        update={"traits": [t.model_copy(update={"text": fn(t.text)}) for t in monster.traits], "legendary_actions": legendary, "spellcasting": spellcasting}
    )


# --- the damage-type swap -------------------------------------------------------------------------------


def swap_damage_type(monster: Monster, old: DamageType, new: DamageType, defences: bool = True) -> Monster:
    """A copy with every use of `old` replaced by `new` in attacks, saves, resistances, immunities,
    vulnerabilities and damage themes (with `defences=False`, only the damage the monster deals changes and its defences are
    left exactly as they were). The words "<type> damage" are also replaced inside action and trait text,
    so text-only actions (most SRD breath weapons) stay consistent; other wording is left for the renamer."""

    phrase = re.compile(r"\b" + re.escape(old.value) + r" damage\b", re.IGNORECASE)

    def swapped(match: re.Match[str]) -> str:
        return (new.value.capitalize() if match.group(0)[0].isupper() else new.value) + " damage"  # "Fire damage" stays capital

    def words(text: str | None) -> str | None:
        return None if text is None else phrase.sub(swapped, text)

    def roll(r: DamageRoll) -> DamageRoll:
        return r.model_copy(update={"type": new}) if r.type == old else r

    def rolls(a: Action) -> Action:
        if isinstance(a, AttackAction):
            return a.model_copy(update={"damage": [roll(r) for r in a.damage]})
        if isinstance(a, SaveAction):
            return a.model_copy(update={"on_fail": [roll(r) for r in a.on_fail]})
        return a

    dealt = _rewrite_text(monster, words).map_actions(rolls)
    if not defences:
        return dealt

    def types(items: list[DamageType]) -> list[DamageType]:
        # dict.fromkeys drops repeats but keeps the order.
        return list(dict.fromkeys(new if t == old else t for t in items))

    # Themes are only the elemental types, so a swap to a weapon type just drops the theme.
    theme_names = dict.fromkeys(new.value if t.value == old.value else t.value for t in monster.damage_themes)
    line = re.compile(r"\b" + re.escape(old.value) + r"\b")
    text = monster.damage_text
    if text is not None:
        text = DamageText(**{field: None if value is None else line.sub(new.value, value) for field, value in text.model_dump().items()})
    return dealt.model_copy(
        update={
            "resistances": types(monster.resistances),
            "immunities": types(monster.immunities),
            "vulnerabilities": types(monster.vulnerabilities),
            "damage_text": text,
            "damage_themes": [DamageTheme(name) for name in theme_names if name in _THEMES],
        }
    )


# --- the monster's own name in its text -----------------------------------------------------------------


def name_rewriter(old_name: str, new_name: str) -> Callable[[str | None], str | None]:
    """A function that makes a piece of text call a monster by its new name wherever it used the old one (see `retarget_name`)."""
    old_name, new_name = old_name.strip(), new_name.strip()
    if not old_name or old_name.lower() == new_name.lower():
        return lambda text: text
    plain = re.sub(r"\s*\(.*?\)", "", old_name).split(",")[0].strip()
    # One pass with both spellings, longest first, so replaced text is never searched again.
    alternatives = sorted({old_name, plain} - {""}, key=len, reverse=True)
    pattern = re.compile(r"(?<![A-Za-z])(?:" + "|".join(re.escape(a) for a in alternatives) + r")(?![A-Za-z])", re.IGNORECASE)

    def said(text: str | None) -> str | None:
        if text is None:
            return None
        return pattern.sub(lambda m: new_name.lower() if m.group(0) == m.group(0).lower() else new_name, text)

    return said


def retarget_name(monster: Monster, old_name: str, new_name: str) -> Monster:
    """A copy whose text calls the monster by its new name wherever the text used the old one.

    SRD text speaks of the monster by name ("If damage reduces the zombie to 0 hit points..."), so a reskin called
    "Ironbound Revenant" would still say "the zombie". Whole words only, case-insensitive. A mention written in lower
    case (the SRD convention) becomes the new name in lower case; a capitalised one keeps the new name's capitals. A
    name in brackets or after a comma ("Giant Rat (Diseased)") is also matched by its plain part ("giant rat").
    """
    return _rewrite_text(monster, name_rewriter(old_name, new_name))


# --- level up -------------------------------------------------------------------------------------------


def _level_up_hit_points(monster: Monster) -> HitPoints:
    """About 1.5x the average, using as many hit dice as that needs, with the dice and average kept consistent."""
    sides = hit_die(monster.size)
    con = ability_modifier(monster.abilities.con)
    old_count = parse_dice(monster.hit_points.dice).count
    target = (monster.hit_points.average * 3 + 1) // 2
    per_die = (sides + 1) / 2 + con
    count = max(1, round(target / per_die)) if per_die > 0 else (old_count * 3 + 1) // 2
    return HitPoints.for_dice(count, sides, con)


def level_up(monster: Monster) -> Monster:
    """A copy about one challenge rating stronger: about 1.5x hit points, +1 armor class, +1 to every attack, save DC and
    damage roll, and one step higher challenge rating. When the higher rating raises the proficiency bonus, saves, skills,
    passive Perception and every attack and DC rise with it. Identity (id, name, source, parent) is left to the caller, and
    the attribution is kept, because a derived work keeps the credit of its source."""
    new_cr = step_cr(monster.challenge.cr, 1)
    pb_gain = proficiency_bonus(new_cr) - monster.challenge.proficiency_bonus
    boost = 1 + pb_gain  # +1 for leveling up, plus whatever the new proficiency bonus adds

    def damage(rolls: list[DamageRoll]) -> list[DamageRoll]:
        return [r.model_copy(update={"bonus": r.bonus + 1}) for r in rolls]

    def action(a: Action) -> Action:
        if isinstance(a, AttackAction):
            attack = a.attack.model_copy(update={"to_hit": a.attack.to_hit + boost})
            return a.model_copy(update={"attack": attack, "damage": damage(a.damage)})
        if isinstance(a, SaveAction):
            save = a.save.model_copy(update={"dc": a.save.dc + boost})
            return a.model_copy(update={"save": save, "on_fail": damage(a.on_fail)})
        return a

    spellcasting = monster.spellcasting
    if spellcasting is not None:
        spellcasting = spellcasting.with_numbers(spellcasting.dc + boost, spellcasting.attack_bonus + boost)

    return monster.map_actions(action).model_copy(
        update={
            "armor_class": monster.armor_class.model_copy(update={"value": monster.armor_class.value + 1}),
            "hit_points": _level_up_hit_points(monster),
            "saves": {ability: bonus + pb_gain for ability, bonus in monster.saves.items()},
            "skills": {skill: bonus + pb_gain for skill, bonus in monster.skills.items()},
            "senses": monster.senses.model_copy(
                update={"passive_perception": monster.senses.passive_perception + (pb_gain if "Perception" in monster.skills else 0)}
            ),
            "challenge": Challenge.for_cr(new_cr),
            "spellcasting": spellcasting,
        }
    )

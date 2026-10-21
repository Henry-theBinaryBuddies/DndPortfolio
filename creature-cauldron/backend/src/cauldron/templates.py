"""Reskin helpers: a damage-type swap and monster templates such as "level up".

The AI may only rename and re-describe a monster. Every change to its numbers is made here, by code, so a
reskin can never invent statistics. The result is a new, unvalidated monster; run it through the Validator.

Template is an abstract base class (like Action and Check): it fixes what every template must do (``apply``)
and each subclass says how. Adding "swarm" later means writing one more subclass and registering it.
"""

import re
from abc import ABC, abstractmethod

from cauldron.actions import Action, AttackAction, DamageRoll, MultiattackAction, SaveAction, TextAction
from cauldron.dice import ability_modifier, format_dice, parse_dice
from cauldron.monster import DamageText, Monster
from cauldron.options import Ability, DamageTheme, DamageType, Source
from cauldron.rules import cr_value, hit_die, proficiency_bonus, step_cr, xp_for_cr

_THEMES = {theme.value for theme in DamageTheme}


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

    def action(a: Action) -> Action:
        if isinstance(a, AttackAction):
            return a.model_copy(update={"damage": [roll(r) for r in a.damage], "effects_text": words(a.effects_text)})
        if isinstance(a, SaveAction):
            return a.model_copy(update={"on_fail": [roll(r) for r in a.on_fail], "effects_text": words(a.effects_text)})
        if isinstance(a, MultiattackAction):
            return a.model_copy(update={"text": words(a.text)})
        if isinstance(a, TextAction):
            return a.model_copy(update={"text": words(a.text)})
        return a

    def trait(t: TextAction) -> TextAction:
        return t.model_copy(update={"text": words(t.text)})

    legendary = monster.legendary_actions
    if legendary is not None:
        legendary = legendary.model_copy(update={"options": [o.model_copy(update={"text": words(o.text)}) for o in legendary.options]})

    def types(items: list[DamageType]) -> list[DamageType]:
        # dict.fromkeys drops repeats but keeps the order.
        return list(dict.fromkeys(new if t == old else t for t in items))

    dealt = {
        "actions": [action(a) for a in monster.actions],
        "bonus_actions": [action(a) for a in monster.bonus_actions],
        "reactions": [action(a) for a in monster.reactions],
        "traits": [trait(t) for t in monster.traits],
        "legendary_actions": legendary,
    }
    if not defences:
        return monster.model_copy(update=dealt)

    # Themes are only the elemental types, so a swap to a weapon type just drops the theme.
    theme_names = dict.fromkeys(new.value if t.value == old.value else t.value for t in monster.damage_themes)
    line = re.compile(r"\b" + re.escape(old.value) + r"\b")
    text = monster.damage_text
    if text is not None:
        text = DamageText(**{field: None if value is None else line.sub(new.value, value) for field, value in text.model_dump().items()})
    return monster.model_copy(
        update={
            **dealt,
            "resistances": types(monster.resistances),
            "immunities": types(monster.immunities),
            "vulnerabilities": types(monster.vulnerabilities),
            "damage_text": text,
            "damage_themes": [DamageTheme(name) for name in theme_names if name in _THEMES],
        }
    )


_DAMAGE_WORD = re.compile(r"\b([a-z]+) damage\b")
_DAMAGE_NAMES = {t.value: t for t in DamageType}


def _types_named_in(text: str | None) -> set[DamageType]:
    """The damage types written as "<type> damage" in some text."""
    return {_DAMAGE_NAMES[w] for w in _DAMAGE_WORD.findall((text or "").lower()) if w in _DAMAGE_NAMES}


def damage_dealt_by(monster: Monster) -> list[DamageType]:
    """The damage types a monster DEALS, sorted: those are the ones a reskin can swap.

    It counts attack and save damage, and the damage named in the text of actions, bonus actions, reactions and legendary
    options (most SRD breath weapons are text). It deliberately does not count what the monster resists, is immune to or
    is vulnerable to, nor damage mentioned in a trait (that is usually damage the monster takes). A zombie is immune to
    poison but deals only bludgeoning, so only bludgeoning is offered."""
    found: set[DamageType] = set()
    for a in monster.all_actions():
        if isinstance(a, AttackAction):
            found.update(r.type for r in a.damage)
            found |= _types_named_in(a.effects_text)
        elif isinstance(a, SaveAction):
            found.update(r.type for r in a.on_fail)
            found |= _types_named_in(a.effects_text)
        else:  # a multiattack or a text action
            found |= _types_named_in(a.text)
    if monster.legendary_actions is not None:
        for option in monster.legendary_actions.options:
            found |= _types_named_in(option.text)
    return sorted(found)


# --- the monster's own name in its text -----------------------------------------------------------------


def retarget_name(monster: Monster, old_name: str, new_name: str) -> Monster:
    """A copy whose text calls the monster by its new name wherever the text used the old one.

    SRD text speaks of the monster by name ("If damage reduces the zombie to 0 hit points..."), so a reskin called
    "Ironbound Revenant" would still say "the zombie". Whole words only, case-insensitive. A mention written in lower
    case (the SRD convention) becomes the new name in lower case; a capitalised one keeps the new name's capitals. A
    name in brackets or after a comma ("Giant Rat (Diseased)") is also matched by its plain part ("giant rat").
    """
    old_name, new_name = old_name.strip(), new_name.strip()
    if not old_name or old_name.lower() == new_name.lower():
        return monster
    plain = re.sub(r"\s*\(.*?\)", "", old_name).split(",")[0].strip()
    # One pass with both spellings, longest first, so replaced text is never searched again.
    alternatives = sorted({old_name, plain} - {""}, key=len, reverse=True)
    pattern = re.compile(r"(?<![A-Za-z])(?:" + "|".join(re.escape(a) for a in alternatives) + r")(?![A-Za-z])", re.IGNORECASE)

    def said(text: str | None) -> str | None:
        if text is None:
            return None
        return pattern.sub(lambda m: new_name.lower() if m.group(0) == m.group(0).lower() else new_name, text)

    def action(a: Action) -> Action:
        if isinstance(a, (AttackAction, SaveAction)):
            return a.model_copy(update={"effects_text": said(a.effects_text)})
        return a.model_copy(update={"text": said(a.text)})  # a multiattack or a text action

    legendary = monster.legendary_actions
    if legendary is not None:
        legendary = legendary.model_copy(update={"options": [o.model_copy(update={"text": said(o.text)}) for o in legendary.options]})
    spellcasting = monster.spellcasting
    if spellcasting is not None:
        spellcasting = spellcasting.model_copy(update={"intro": said(spellcasting.intro), "footer": said(spellcasting.footer)})

    return monster.model_copy(
        update={
            "traits": [t.model_copy(update={"text": said(t.text)}) for t in monster.traits],
            "actions": [action(a) for a in monster.actions],
            "bonus_actions": [action(a) for a in monster.bonus_actions],
            "reactions": [action(a) for a in monster.reactions],
            "legendary_actions": legendary,
            "spellcasting": spellcasting,
        }
    )


# --- templates ------------------------------------------------------------------------------------------


class Template(ABC):
    name: str

    @abstractmethod
    def apply(self, monster: Monster) -> Monster:
        """A new monster built from this one. The original is never changed."""


class LevelUpTemplate(Template):
    """A level-up, about one challenge rating stronger:  about 1.5x hit points, +1 armor class, +1 to every attack, save DC and damage roll,
    and one step higher challenge rating. When the higher rating raises the proficiency bonus, saves, skills
    and every attack and DC rise with it."""

    name = "level_up"

    def apply(self, monster: Monster) -> Monster:
        old_cr = monster.challenge.cr
        new_cr = step_cr(old_cr, 1)
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

        return monster.model_copy(
            update={
                "id": f"{monster.id}-level-up",
                "name": f"Leveled {monster.name}",
                "source": Source.RESKIN,
                "validated": False,
                "parent_id": monster.id,
                "generator": "template:level_up",
                # attribution is deliberately kept: a derived work keeps the credit of its source
                "armor_class": monster.armor_class.model_copy(update={"value": monster.armor_class.value + 1}),
                "hit_points": self._hit_points(monster),
                "saves": {ability: bonus + pb_gain for ability, bonus in monster.saves.items()},
                "skills": {skill: bonus + pb_gain for skill, bonus in monster.skills.items()},
                "senses": monster.senses.model_copy(
                    update={"passive_perception": monster.senses.passive_perception + (pb_gain if "Perception" in monster.skills else 0)}
                ),
                "challenge": monster.challenge.model_copy(
                    update={
                        "cr": new_cr,
                        "cr_value": cr_value(new_cr),
                        "xp": xp_for_cr(new_cr),
                        "proficiency_bonus": proficiency_bonus(new_cr),
                    }
                ),
                "actions": [action(a) for a in monster.actions],
                "bonus_actions": [action(a) for a in monster.bonus_actions],
                "reactions": [action(a) for a in monster.reactions],
                "spellcasting": spellcasting,
            }
        )

    @staticmethod
    def _hit_points(monster: Monster):
        """About 1.5x the average, using as many hit dice as that needs, with the dice and average kept consistent."""
        sides = hit_die(monster.size)
        con = ability_modifier(monster.abilities.con)
        old_count = parse_dice(monster.hit_points.dice).count
        target = (monster.hit_points.average * 3 + 1) // 2
        per_die = (sides + 1) / 2 + con
        count = max(1, round(target / per_die)) if per_die > 0 else (old_count * 3 + 1) // 2
        bonus = count * con
        average = max(1, (count * (sides + 1) + 2 * bonus) // 2)
        return monster.hit_points.model_copy(update={"dice": format_dice(count, sides, bonus), "average": average})


_TEMPLATES: dict[str, Template] = {template.name: template for template in [LevelUpTemplate()]}


def get_template(name: str) -> Template:
    """The template with this name. Raises KeyError for an unknown one."""
    return _TEMPLATES[name]

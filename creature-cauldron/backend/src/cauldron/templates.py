"""Reskin helpers: a damage-type swap and monster templates such as "elite".

The AI may only rename and re-describe a monster. Every change to its numbers is made here, by code, so a
reskin can never invent statistics. The result is a new, unvalidated monster; run it through the Validator.

Template is an abstract base class (like Action and Check): it fixes what every template must do (``apply``)
and each subclass says how. Adding "swarm" later means writing one more subclass and registering it.
"""

import re
from abc import ABC, abstractmethod

from cauldron.actions import Action, AttackAction, DamageRoll, MultiattackAction, SaveAction, TextAction
from cauldron.dice import ability_modifier, format_dice, parse_dice
from cauldron.monster import Monster
from cauldron.options import Ability, DamageTheme, DamageType, Source
from cauldron.rules import cr_value, hit_die, proficiency_bonus, step_cr, xp_for_cr

_THEMES = {theme.value for theme in DamageTheme}


# --- the damage-type swap -------------------------------------------------------------------------------


def swap_damage_type(monster: Monster, old: DamageType, new: DamageType) -> Monster:
    """A copy with every use of `old` replaced by `new` in attacks, saves, resistances, immunities,
    vulnerabilities and damage themes. The words "<type> damage" are also replaced inside action and trait text,
    so text-only actions (most SRD breath weapons) stay consistent; other wording is left for the renamer."""

    phrase = re.compile(r"\b" + re.escape(old.value) + r" damage\b")

    def words(text: str | None) -> str | None:
        return None if text is None else phrase.sub(f"{new.value} damage", text)

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

    # Themes are only the elemental types, so a swap to a weapon type just drops the theme.
    theme_names = dict.fromkeys(new.value if t.value == old.value else t.value for t in monster.damage_themes)
    return monster.model_copy(
        update={
            "actions": [action(a) for a in monster.actions],
            "bonus_actions": [action(a) for a in monster.bonus_actions],
            "reactions": [action(a) for a in monster.reactions],
            "traits": [trait(t) for t in monster.traits],
            "legendary_actions": legendary,
            "resistances": types(monster.resistances),
            "immunities": types(monster.immunities),
            "vulnerabilities": types(monster.vulnerabilities),
            "damage_themes": [DamageTheme(name) for name in theme_names if name in _THEMES],
        }
    )


def damage_types_in(monster: Monster) -> list[DamageType]:
    """The damage types a monster deals or resists, sorted. These are the ones a reskin can swap."""
    found: set[DamageType] = set()
    for a in monster.all_actions():
        if isinstance(a, AttackAction):
            found.update(r.type for r in a.damage)
        if isinstance(a, SaveAction):
            found.update(r.type for r in a.on_fail)
    found.update(monster.resistances, monster.immunities, monster.vulnerabilities)
    return sorted(found)


# --- templates ------------------------------------------------------------------------------------------


class Template(ABC):
    name: str

    @abstractmethod
    def apply(self, monster: Monster) -> Monster:
        """A new monster built from this one. The original is never changed."""


class EliteTemplate(Template):
    """A tougher version: about 1.5x hit points, +1 armor class, +1 to every attack, save DC and damage roll,
    and one step higher challenge rating. When the higher rating raises the proficiency bonus, saves, skills
    and every attack and DC rise with it."""

    name = "elite"

    def apply(self, monster: Monster) -> Monster:
        old_cr = monster.challenge.cr
        new_cr = step_cr(old_cr, 1)
        pb_gain = proficiency_bonus(new_cr) - monster.challenge.proficiency_bonus
        boost = 1 + pb_gain  # +1 for being elite, plus whatever the new proficiency bonus adds

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
                "id": f"{monster.id}-elite",
                "name": f"Elite {monster.name}",
                "source": Source.RESKIN,
                "validated": False,
                "parent_id": monster.id,
                "generator": "template:elite",
                # attribution is deliberately kept: a derived work keeps the credit of its source
                "armor_class": monster.armor_class.model_copy(update={"value": monster.armor_class.value + 1}),
                "hit_points": self._hit_points(monster),
                "saves": {ability: bonus + pb_gain for ability, bonus in monster.saves.items()},
                "skills": {skill: bonus + pb_gain for skill, bonus in monster.skills.items()},
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


_TEMPLATES: dict[str, Template] = {template.name: template for template in [EliteTemplate()]}


def get_template(name: str) -> Template:
    """The template with this name. Raises KeyError for an unknown one."""
    return _TEMPLATES[name]

"""Polymorph, graft mode: a monster borrows chosen features from a second creature, all by code.

The base keeps what makes it itself: its hit points, armor class, ability scores, skills and its own attacks. The visitor (or
the AI, when the forge chooses) picks from a list of things the donor has that the base could take:

* ``speed:<mode>``   a movement mode (fly, swim, climb, burrow) the base lacks or has more slowly
* ``sense:<name>``   a sense (darkvision, blindsight, tremorsense, truesight) likewise
* ``trait:<name>``   one of the donor's traits
* ``attack:<name>``  one of the donor's typed attacks or saves, re-rolled to the base's own damage budget
* ``damage``         the donor's main damage type, with its defences (what a theme does)

Every borrowed number is brought down to what the base could do: an attack is rolled from the base's damage budget at the
base's attack bonus, a save uses the base's own DC, and damage written inside borrowed text is
capped the same way. That keeps the result near the base's challenge rating, which the tests check on thousands of pairs.

Legendary actions are a separate, optional tick for a base that has none. If the donor has them they are borrowed (the ones that
still make sense on the hybrid); otherwise code builds the usual set of three a round from the hybrid's own attacks.
"""

import re
from dataclasses import dataclass

from cauldron.actions import Action, Area, AttackAction, AttackDetails, SaveAction, SaveDetails, TextAction
from cauldron.dice import average_dice
from cauldron.features import derive_features
from cauldron.cr.measure import action_damage
from cauldron.monster import LegendaryActions, LegendaryOption, Monster, Senses, Speeds
from cauldron.options import AreaShape, AttackMode, DamageTheme, DamageType, Size
from cauldron.remix.engine import RemixResult, current_theme
from cauldron.remix.moves import Context, best_attack, dice_for, make_context
from cauldron.remix.theme import apply_theme, primary_damage
from cauldron.templates import level_up as apply_level_up
from cauldron.templates import name_rewriter

MAX_BORROW = 10  # features borrowed at once; keeps the list of changes within a monster's limit
MAX_PICKS = 4  # features the AI may choose when the forge chooses

_THEMES = {t.value for t in DamageTheme}
_MOVEMENT = ("fly", "swim", "climb", "burrow")
_SENSES = ("darkvision", "blindsight", "tremorsense", "truesight")
# Traits that carry the rules themselves or point at things the base does not have.
_NOT_BORROWABLE = {"legendary resistance", "spellcasting", "innate spellcasting", "shapechanger", "multiattack"}
_BIG = {Size.LARGE, Size.HUGE, Size.GARGANTUAN}
_DAMAGE_IN_TEXT = re.compile(r"(\d+) \(\d+d\d+(?: [+-] \d+)?\) ([a-z]+) damage")
_DC = re.compile(r"\bDC (\d+)")
_TO_HIT = re.compile(r"\+(\d+) to hit")
_FOOT_AREA = re.compile(r"(\d+)-foot(?:-radius)? (cone|line|cube|radius|sphere)")
_SPELL_TO_WEAPON = {AttackMode.MELEE_SPELL: AttackMode.MELEE_WEAPON, AttackMode.RANGED_SPELL: AttackMode.RANGED_WEAPON}


@dataclass(frozen=True)
class Borrowable:
    """One thing the donor could lend: a stable key for the request, its kind, and a label for the visitor."""

    key: str
    kind: str  # "movement", "sense", "trait", "attack" or "damage"
    label: str


def _plain(name: str) -> str:
    """A name as the CR measure and multiattacks spell it: no bracket, lower case, singular ("Claws" and "Claw" are one)."""
    return re.sub(r"\s*\(.*?\)", "", name).strip().lower().removesuffix("s")


_KINDS = {t.value for t in DamageType}


def _damage_types(action: AttackAction | SaveAction | TextAction) -> list[DamageType]:
    if isinstance(action, TextAction):  # most SRD breath weapons are written as text
        return list(dict.fromkeys(DamageType(kind) for _, kind in _DAMAGE_IN_TEXT.findall(action.text) if kind in _KINDS))
    rolls = action.damage if isinstance(action, AttackAction) else action.on_fail
    return list(dict.fromkeys(r.type for r in rolls))


def _damaging(action: Action, donor: Monster) -> bool:
    """A typed attack or save that deals damage, or a text action that does and stands alone (it does not lean on another
    of the donor's actions by name, as a swallow leans on its bite)."""
    if isinstance(action, TextAction):
        text = action.text.lower()
        others = (_plain(a.name) for a in donor.all_actions() if a is not action)
        return bool(_damage_types(action)) and "legendary" not in text and not any(len(n) >= 4 and n in text for n in others)
    return isinstance(action, (AttackAction, SaveAction)) and bool(_damage_types(action))


def _attack_label(action: AttackAction | SaveAction | TextAction) -> str:
    types = "/".join(t.value for t in _damage_types(action))
    if isinstance(action, AttackAction):
        return f"{action.name} ({types}, {'ranged' if action.attack.range is not None else 'melee'} attack)"
    if isinstance(action, SaveAction):
        return f"{action.name} ({types}, {'area save' if action.area is not None else 'save'})"
    area = _FOOT_AREA.search(action.text) is not None
    return f"{action.name} ({types}, {'area ' if area else ''}{'save' if 'saving throw' in action.text else 'attack'})"


def _trait_ok(trait: TextAction, base: Monster, donor: Monster) -> bool:
    """A trait is lent only if it stands alone: it is not a rule-carrying one, the base has no trait of that name, and its text
    does not point at an action of the donor's by name."""
    name = _plain(trait.name)
    if name in _NOT_BORROWABLE or name in {_plain(t.name) for t in base.traits}:
        return False
    text = trait.text.lower()
    if "legendary" in text or "lair" in text:
        return False
    return not any(len(n) >= 4 and n in text for n in (_plain(a.name) for a in donor.all_actions()))


def borrowable(base: Monster, donor: Monster) -> list[Borrowable]:
    """Everything the donor could lend the base, in a fixed order: movement, senses, main damage, traits, attacks."""
    found: list[Borrowable] = []
    for mode in _MOVEMENT:
        lent, own = getattr(donor.speeds, mode), getattr(base.speeds, mode)
        if lent and (not own or lent > own):
            hover = " (hover)" if mode == "fly" and donor.speeds.hover else ""
            found.append(Borrowable(f"speed:{mode}", "movement", f"{mode.capitalize()} {lent} ft.{hover}"))
    for sense in _SENSES:
        lent, own = getattr(donor.senses, sense), getattr(base.senses, sense)
        if lent and (not own or lent > own):
            found.append(Borrowable(f"sense:{sense}", "sense", f"{sense.capitalize()} {lent} ft."))
    main = primary_damage(donor)
    if main is not None and main.value in _THEMES and main != primary_damage(base):
        found.append(Borrowable("damage", "damage", f"Main damage: {main.value}, with its defences"))
    seen: set[str] = set()
    for trait in donor.traits:
        if _trait_ok(trait, base, donor) and trait.name.lower() not in seen:
            seen.add(trait.name.lower())
            found.append(Borrowable(f"trait:{trait.name}", "trait", trait.name))
    if best_attack(base) >= 2:  # an attack needs a damage budget to be rolled from
        own_names = {_plain(a.name) for a in base.all_actions()}
        for action in donor.actions:
            if _damaging(action, donor) and _plain(action.name) not in own_names and action.name.lower() not in seen:
                seen.add(action.name.lower())
                found.append(Borrowable(f"attack:{action.name}", "attack", _attack_label(action)))  # type: ignore[arg-type]
    return found


# --- making the borrowed pieces fit the base --------------------------------------------------------------


def _text_cap(ctx: Context) -> int:
    """The most damage a borrowed piece of text may deal: half the base's budget, or a small amount for a monster that deals none."""
    return max(2, round(ctx.budget * 0.5)) if ctx.budget else 3


def _fitted_text(text: str | None, ctx: Context, donor: Monster, cap: int | None = None) -> str | None:
    """Borrowed prose as the base would say it: the donor's name becomes the base's, each damage amount is capped (`cap`, by
    default a small share of the budget), a DC and an attack bonus become the base's, and an area is no bigger than the base's."""
    if text is None:
        return None
    cap = _text_cap(ctx) if cap is None else cap

    def damage(match: re.Match[str]) -> str:
        kind = match.group(2)
        if kind not in {t.value for t in DamageType}:
            return match.group(0)
        roll = dice_for(max(2, min(int(match.group(1)), cap)), DamageType(kind))
        return ctx.phrase(roll)

    def area(match: re.Match[str]) -> str:
        limit = (60 if ctx.monster.size in _BIG else 30) * (2 if match.group(2) == "line" else 1)
        return match.group(0).replace(match.group(1), str(min(int(match.group(1)), limit)), 1)

    text = _DAMAGE_IN_TEXT.sub(damage, text)
    text = _DC.sub(f"DC {ctx.dc}", text)
    text = _TO_HIT.sub(f"+{ctx.attack_bonus} to hit", text)
    text = _FOOT_AREA.sub(area, text)
    text = name_rewriter(donor.name, ctx.monster.name)(text)
    # SRD text also calls the donor by its kind alone ("the dragon exhales"), which is its name's last word.
    kind = _plain(donor.name.split(",")[0]).split()[-1].removesuffix("s") if donor.name.strip() else ""
    if len(kind) >= 3:
        text = re.sub(rf"\b([Tt]he) {re.escape(kind)}s?\b", lambda m: f"{m.group(1)} {ctx.monster.name.lower()}", text)
    return text


def _rolls(action: AttackAction | SaveAction, ctx: Context):
    """The action's damage re-rolled to the base's budget, split between its damage types as the donor split it (two at most)."""
    rolls = action.damage if isinstance(action, AttackAction) else action.on_fail
    averages = [(average_dice(r.dice, r.bonus), r.type) for r in rolls]
    top = sorted(averages, key=lambda pair: -pair[0])[:2]
    total = sum(avg for avg, _ in top) or 1
    return [dice_for(max(2, int(ctx.budget * avg / total)), kind) for avg, kind in top]


def _area_cap(base: Monster, area: Area) -> Area:
    cap = 60 if base.size in _BIG else 30
    if area.shape is AreaShape.LINE:
        cap *= 2
    return area.model_copy(update={"size": min(area.size, cap)})


def _borrowed_attack(action: AttackAction | SaveAction | TextAction, ctx: Context, donor: Monster) -> Action:
    if isinstance(action, TextAction):  # its whole text is the attack, so each damage amount may use the budget (shared if several)
        mentions = max(1, len(_DAMAGE_IN_TEXT.findall(action.text)))
        return action.model_copy(update={"text": _fitted_text(action.text, ctx, donor, max(2, ctx.budget // mentions))})
    effects = _fitted_text(action.effects_text, ctx, donor)
    if isinstance(action, SaveAction):
        return action.model_copy(
            update={
                "save": SaveDetails(ability=action.save.ability, dc=ctx.dc),
                "area": _area_cap(ctx.monster, action.area) if action.area is not None else None,
                "on_fail": _rolls(action, ctx),
                "effects_text": effects,
            }
        )
    details = action.attack
    reach_cap = 10 if ctx.monster.size in _BIG else 5
    return action.model_copy(
        update={
            "attack": AttackDetails(
                mode=_SPELL_TO_WEAPON.get(details.mode, details.mode),
                ability=ctx.attack_ability,
                to_hit=ctx.attack_bonus,
                reach=None if details.reach is None else min(details.reach, reach_cap),
                range=details.range,
                targets=details.targets,
            ),
            "damage": _rolls(action, ctx),
            "effects_text": effects,
        }
    )


# --- legendary actions ------------------------------------------------------------------------------------


def _usable_option(option: LegendaryOption, shaped: Monster, donor: Monster) -> bool:
    """A donor's legendary option still makes sense on the hybrid: every action of the donor's it names, the hybrid has too, and
    it does not cast spells the hybrid cannot."""
    text = option.text.lower()
    if "spell" in text and shaped.spellcasting is None:
        return False
    if re.search(r"\bfl(y|ies|ying)\b", text) and not shaped.speeds.fly:
        return False
    own = {_plain(a.name) for a in shaped.all_actions()}
    named = (_plain(a.name) for a in donor.all_actions())
    return all(n in own for n in named if len(n) >= 4 and n in text)


def standard_legendary_actions(monster: Monster, borrowed: list[Action]) -> LegendaryActions:
    """Three a round, as the 2014 books do it: an attack (1), a move (1), and, when the hybrid borrowed an ability that is not
    on a recharge, that ability (2). Every number is the monster's own, since each option only repeats something it can do."""
    who = f"the {monster.name.lower()}"
    options: list[LegendaryOption] = []
    attacks = [a for a in monster.actions if isinstance(a, AttackAction)]
    if attacks:
        best = max(attacks, key=action_damage)
        options.append(LegendaryOption(name=f"{best.name} Attack", cost=1, text=f"{who.capitalize()} makes one {best.name.lower()} attack."))
    options.append(LegendaryOption(name="Move", cost=1, text=f"{who.capitalize()} moves up to its speed without provoking opportunity attacks."))
    for action in borrowed:
        if isinstance(action, (AttackAction, SaveAction, TextAction)) and getattr(action, "recharge", None) is None:
            verb = "makes one {} attack" if isinstance(action, AttackAction) else "uses its {}"
            options.append(LegendaryOption(name=action.name, cost=2, text=f"{who.capitalize()} {verb.format(action.name.lower())}."))
            break
    return LegendaryActions(per_round=3, options=options)


def _legendary(shaped: Monster, donor: Monster, borrowed: list[Action], ctx: Context) -> tuple[LegendaryActions, str]:
    """The legendary actions for the hybrid and one line saying where they came from."""
    lent = donor.legendary_actions
    if lent is not None:
        kept = [
            o.model_copy(update={"text": _fitted_text(o.text, ctx, donor) or o.text}) for o in lent.options if _usable_option(o, shaped, donor)
        ]
        if kept:
            return LegendaryActions(per_round=lent.per_round, options=kept), f"Legendary actions: {lent.per_round} a round, borrowed from {donor.name}"
    return standard_legendary_actions(shaped, borrowed), "Legendary actions: 3 a round, built from its own attacks"


# --- grafting ---------------------------------------------------------------------------------------------


def graft(base: Monster, donor: Monster, keys: list[str], level_up: bool = False, legendary: bool = False) -> RemixResult:
    """The base with the chosen features of the donor, and what changed. Raises ValueError for a key the donor cannot lend, or for
    legendary actions on a base that already has them."""
    if legendary and base.legendary_actions is not None:
        raise ValueError(f"{base.name} already has legendary actions.")
    offered = {b.key: b for b in borrowable(base, donor)}
    chosen = list(dict.fromkeys(keys))
    unknown = [k for k in chosen if k not in offered]
    if unknown or not chosen:
        raise ValueError(f"{donor.name} cannot lend that to {base.name}." if unknown else "Nothing was chosen to borrow.")

    changes = [f"Polymorph: features borrowed from {donor.name}"]
    shaped = base

    if "damage" in chosen:
        themed = apply_theme(shaped, DamageTheme(primary_damage(donor).value))  # type: ignore[union-attr]
        shaped = themed.monster
        changes += themed.changes

    ctx = make_context(shaped, current_theme(shaped), "Borrowed")
    speeds, senses = shaped.speeds, shaped.senses
    traits, actions, themes = list(shaped.traits), list(shaped.actions), list(shaped.damage_themes)
    borrowed_actions: list[Action] = []
    for key in chosen:
        kind, _, name = key.partition(":")
        label = offered[key].label
        if kind == "speed":
            update = {name: getattr(donor.speeds, name)}
            if name == "fly" and donor.speeds.hover:
                update["hover"] = True
            speeds = Speeds.model_validate({**speeds.model_dump(), **update})
        elif kind == "sense":
            senses = Senses.model_validate({**senses.model_dump(), name: getattr(donor.senses, name)})
        elif kind == "trait":
            trait = next(t for t in donor.traits if t.name == name)
            traits.append(trait.model_copy(update={"text": _fitted_text(trait.text, ctx, donor)}))
        elif kind == "attack":
            action = next(a for a in donor.actions if a.name == name and _damaging(a, donor))
            borrowed = _borrowed_attack(action, ctx, donor)  # type: ignore[arg-type]
            actions.append(borrowed)
            borrowed_actions.append(borrowed)
            themes += [DamageTheme(t.value) for t in _damage_types(borrowed) if t.value in _THEMES and DamageTheme(t.value) not in themes]  # type: ignore[arg-type]
        if kind != "damage":
            changes.append(f"Borrowed {kind if kind != 'speed' else 'movement'}: {label}")

    shaped = shaped.model_copy(update={"speeds": speeds, "senses": senses, "traits": traits, "actions": actions, "damage_themes": themes})
    if legendary:
        grant, line = _legendary(shaped, donor, borrowed_actions, ctx)
        shaped = shaped.model_copy(update={"legendary_actions": grant})
        changes.append(line)
    shaped = shaped.model_copy(update={"features": derive_features(shaped)})

    if level_up:
        old_cr = shaped.challenge.cr
        shaped = apply_level_up(shaped)
        changes.append(f"Level up: CR {old_cr} → CR {shaped.challenge.cr}, with more hit points, better armor and harder hits")
    return RemixResult(shaped, changes)

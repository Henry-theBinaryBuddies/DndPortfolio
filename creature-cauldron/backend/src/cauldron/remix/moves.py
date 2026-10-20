"""Signature moves: the new abilities a remix can give a monster.

Each move is a small class (like ``Action``, ``Check`` and ``Template``): an abstract ``Move`` fixes what every move must
do, and eighteen subclasses each say how. A move builds ordinary typed actions (or a trait or reaction) with every number
worked out by code from the monster's own proficiency bonus, ability scores and best attack. The AI only supplies the
move's *name*; the mechanics sentences are written here, in the 2014 stat block style.

The rule that keeps a remix CR neutral: a signature move is an *alternative* to one of the monster's attacks, never extra
output on top. So no move's damage may exceed the monster's best single attack (the tests check this on every SRD monster).
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass, field

from cauldron.actions import Action, AttackAction, AttackDetails, DamageRoll, Range, Recharge, SaveAction, SaveDetails, TextAction, Area
from cauldron.cr.measure import action_damage, measure
from cauldron.dice import average_dice, ability_modifier
from cauldron.monster import Monster
from cauldron.options import Ability, AreaShape, AttackMode, DamageTheme, DamageType, SaveSuccess, Size

_SIDES = (4, 6, 8, 10, 12)
_ABILITIES = ("str", "dex", "con", "int", "wis", "cha")
_BIG = {Size.LARGE, Size.HUGE, Size.GARGANTUAN}


# --- the shared numbers ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Context:
    """Everything a move needs, worked out once: the monster, the theme, the move's name and the numbers."""

    monster: Monster
    theme: DamageTheme
    name: str
    pb: int
    dc: int  # 8 + proficiency + the best ability modifier, but never above what the monster's own attacks and saves reach
    attack_ability: Ability
    attack_bonus: int  # proficiency + the better of Strength and Dexterity
    best: float  # the average damage of its best single attack
    budget: int  # the most damage one use of a signature attack may deal

    @property
    def damage_type(self) -> DamageType:
        return DamageType(self.theme.value)

    @property
    def who(self) -> str:
        """How text speaks of the monster: "the ogre"."""
        return f"the {self.monster.name.lower()}"

    def roll(self, fraction: float = 1.0) -> DamageRoll:
        """A damage roll in the theme's type worth `fraction` of the budget (never more)."""
        return dice_for(max(2, int(self.budget * fraction)), self.damage_type)

    def phrase(self, roll: DamageRoll) -> str:
        """"7 (2d6) cold damage"."""
        return f"{average_dice(roll.dice, roll.bonus)} ({roll.dice}) {roll.type.value} damage"


def best_attack(monster: Monster) -> float:
    return max((action_damage(a) for a in monster.actions if a.kind != "multiattack"), default=0.0)


def make_context(monster: Monster, theme: DamageTheme, name: str) -> Context:
    mods = {a: ability_modifier(getattr(monster.abilities, a)) for a in _ABILITIES}
    ability = Ability.DEX if mods["dex"] > mods["str"] else Ability.STR
    best = best_attack(monster)
    budget = max(2, round(best * 0.75)) if best >= 2 else 0
    # A signature move must not make the monster hit harder than it already does: the cap keeps a monster whose best
    # ability is a mental one (a deva) from jumping a challenge rating on the strength of one new save.
    dc = 8 + monster.challenge.proficiency_bonus + max(mods.values())
    own = measure(monster).offense_bonus
    if own is not None:
        dc = min(dc, 8 + own)
    return Context(
        monster=monster,
        theme=theme,
        name=name,
        pb=monster.challenge.proficiency_bonus,
        dc=dc,
        attack_ability=ability,
        attack_bonus=monster.challenge.proficiency_bonus + mods[ability.value],
        best=best,
        budget=budget,
    )


def dice_for(average: int, damage_type: DamageType) -> DamageRoll:
    """Dice (no bonus) whose average is as close to `average` as possible without going over, using fewer, bigger dice."""
    best: tuple[int, int, int] | None = None  # (average reached, sides, count)
    for sides in _SIDES:
        count = 0
        while average_dice(f"{count + 1}d{sides}") <= average and count < 12:
            count += 1
        if count >= 1:
            reached = average_dice(f"{count}d{sides}")
            if best is None or (reached, sides) > (best[0], best[1]):
                best = (reached, sides, count)
    assert best is not None, average  # callers never ask for less than 2
    return DamageRoll(dice=f"{best[2]}d{best[1]}", bonus=0, type=damage_type)


# --- what a move builds ---------------------------------------------------------------------------------


@dataclass(frozen=True)
class Addition:
    """What a move adds to a monster, and one line saying so for the "What changed" summary."""

    summary: str
    actions: list[Action] = field(default_factory=list)
    bonus_actions: list[Action] = field(default_factory=list)
    reactions: list[Action] = field(default_factory=list)
    traits: list[TextAction] = field(default_factory=list)


class Move(ABC):
    key: str
    label: str
    group: str  # "Offence", "Control", "Area" or "Defence and mobility"
    blurb: str  # one line for the menu
    needs_damage = True  # most moves need the monster to deal damage, so there is something to be an alternative to
    needs_not_tiny = False

    def applies_to(self, monster: Monster) -> bool:
        if self.needs_damage and best_attack(monster) < 2:
            return False
        return not (self.needs_not_tiny and monster.size is Size.TINY)

    @abstractmethod
    def build(self, ctx: Context) -> Addition:
        """The actions, traits or reactions this move adds."""

    # shared builders, so each move reads as its idea and not as boilerplate
    def _attack(self, ctx: Context, fraction: float, effects: str | None, *, ranged: bool = False) -> AttackAction:
        reach = 10 if ctx.monster.size in _BIG else 5
        return AttackAction(
            name=ctx.name,
            attack=AttackDetails(
                mode=AttackMode.RANGED_WEAPON if ranged else AttackMode.MELEE_WEAPON,
                ability=ctx.attack_ability,
                to_hit=ctx.attack_bonus,
                reach=None if ranged else reach,
                range=Range(normal=30, long=90) if ranged else None,
                targets="one creature" if not ranged else "one target",
            ),
            damage=[ctx.roll(fraction)],
            effects_text=effects,
        )

    def _save(
        self,
        ctx: Context,
        ability: Ability,
        *,
        damage: float | None,
        effects: str | None = None,
        area: Area | None = None,
        recharge: Recharge | None = None,
    ) -> SaveAction:
        return SaveAction(
            name=ctx.name,
            recharge=recharge,
            save=SaveDetails(ability=ability, dc=ctx.dc),
            area=area,
            on_fail=[ctx.roll(damage)] if damage else [],
            on_success=SaveSuccess.HALF if damage and area is not None else SaveSuccess.NONE,
            effects_text=effects,
        )

    def _done(self, ctx: Context, **parts) -> Addition:
        return Addition(summary=f"New move: {ctx.name} ({self.label.lower()})", **parts)


def _radius(monster: Monster) -> int:
    return {Size.LARGE: 15, Size.HUGE: 20, Size.GARGANTUAN: 30}.get(monster.size, 10)


def _cone(monster: Monster) -> int:
    return 15 if monster.size not in _BIG else 30


# --- offence --------------------------------------------------------------------------------------------

# The simple riders: the save, and the condition on a failure. Fire, cold, acid and force have longer wording of their own below.
_RIDERS = {
    DamageTheme.POISON: ("Constitution", "poisoned until the end of its next turn"),
    DamageTheme.LIGHTNING: ("Constitution", "unable to take reactions until the end of its next turn"),
    DamageTheme.THUNDER: ("Constitution", "deafened until the end of its next turn"),
    DamageTheme.NECROTIC: ("Constitution", "unable to regain hit points until the end of its next turn"),
    DamageTheme.RADIANT: ("Constitution", "blinded until the end of its next turn"),
    DamageTheme.PSYCHIC: ("Wisdom", "frightened of {who} until the end of its next turn"),
}


class Rider(Move):
    key, label, group = "rider", "On-hit rider", "Offence"
    blurb = "An attack whose hit also inflicts a condition that fits the theme."

    def build(self, ctx: Context) -> Addition:
        if ctx.theme is DamageTheme.FIRE:
            burn = ctx.roll(0.34)
            effect = f"The target must succeed on a DC {ctx.dc} Dexterity saving throw or catch fire, taking {ctx.phrase(burn)} at the start of its next turn."
        elif ctx.theme is DamageTheme.COLD:
            effect = f"The target must succeed on a DC {ctx.dc} Constitution saving throw or have its speed halved until the end of its next turn."
        elif ctx.theme is DamageTheme.ACID:
            effect = f"The target must succeed on a DC {ctx.dc} Dexterity saving throw or its armor corrodes: its AC is reduced by 1 until the end of its next turn."
        elif ctx.theme is DamageTheme.FORCE:
            effect = f"The target must succeed on a DC {ctx.dc} Strength saving throw or be knocked prone."
        else:
            ability, result = _RIDERS[ctx.theme]
            effect = f"The target must succeed on a DC {ctx.dc} {ability} saving throw or be {result.format(who=ctx.who)}."
        return self._done(ctx, actions=[self._attack(ctx, 0.75, effect)])


class OpeningStrike(Move):
    key, label, group = "opening_strike", "Opening strike", "Offence"
    blurb = "A first blow that hits harder against a creature that has not yet acted."

    def build(self, ctx: Context) -> Addition:
        extra = ctx.roll(0.5)
        effect = f"If the target has not yet acted in the combat, it takes an extra {ctx.phrase(extra)}."
        return self._done(ctx, actions=[self._attack(ctx, 0.6, effect)])


class Drain(Move):
    key, label, group = "drain", "Drain", "Offence"
    blurb = "An attack that heals the monster for half the damage it deals."

    def build(self, ctx: Context) -> Addition:
        effect = f"{ctx.who[0].upper()}{ctx.who[1:]} regains hit points equal to half the damage dealt."
        return self._done(ctx, actions=[self._attack(ctx, 0.8, effect)])


class Lob(Move):
    key, label, group = "lob", "Lob", "Offence"
    blurb = "A ranged attack in the theme's damage, for monsters that otherwise fight up close."

    def build(self, ctx: Context) -> Addition:
        return self._done(ctx, actions=[self._attack(ctx, 0.8, None, ranged=True)])


class Sunder(Move):
    key, label, group = "sunder", "Sunder", "Offence"
    blurb = "A strike that damages the target's armor, lowering its AC briefly."

    def build(self, ctx: Context) -> Addition:
        effect = "The target's armor is damaged: its AC is reduced by 1 until the end of its next turn. This effect does not stack."
        return self._done(ctx, actions=[self._attack(ctx, 0.8, effect)])


# --- control --------------------------------------------------------------------------------------------


class GraspingStrike(Move):
    key, label, group = "grasping_strike", "Grasping strike", "Control"
    blurb = "A hit that grapples and restrains the target."

    def build(self, ctx: Context) -> Addition:
        effect = f"The target is grappled (escape DC {ctx.dc}). Until this grapple ends, the target is restrained, and {ctx.who} can't use this attack on another target."
        return self._done(ctx, actions=[self._attack(ctx, 0.7, effect)])


class SlowingTouch(Move):
    key, label, group = "slowing_touch", "Slowing touch", "Control"
    blurb = "A hit that can halve the target's speed."

    def build(self, ctx: Context) -> Addition:
        effect = f"The target must succeed on a DC {ctx.dc} Constitution saving throw or have its speed halved until the end of its next turn."
        return self._done(ctx, actions=[self._attack(ctx, 0.7, effect)])


class Pull(Move):
    key, label, group = "pull", "Pull", "Control"
    blurb = "Drags a target toward the monster and knocks it prone."
    needs_not_tiny = True

    def build(self, ctx: Context) -> Addition:
        effect = f"A Large or smaller target is pulled up to 15 feet in a straight line toward {ctx.who} and knocked prone."
        return self._done(ctx, actions=[self._save(ctx, Ability.STR, damage=0.6, effects=effect)])


class Dazzle(Move):
    key, label, group = "dazzle", "Dazzle", "Control"
    blurb = "A flash that can blind nearby creatures."
    needs_damage = False

    def build(self, ctx: Context) -> Addition:
        area = Area(shape=AreaShape.RADIUS, size=15)
        effect = "On a failure, the creature is blinded until the end of its next turn."
        return self._done(ctx, actions=[self._save(ctx, Ability.CON, damage=None, effects=effect, area=area, recharge=Recharge(min=5))])


class DreadPresence(Move):
    key, label, group = "dread_presence", "Dread presence", "Control"
    blurb = "A chilling presence that can frighten creatures nearby."
    needs_damage = False

    def build(self, ctx: Context) -> Addition:
        area = Area(shape=AreaShape.RADIUS, size=30)
        effect = (
            f"On a failure, the creature is frightened of {ctx.who} for 1 minute. A frightened creature can repeat the saving throw "
            "at the end of each of its turns, ending the effect on itself on a success."
        )
        return self._done(ctx, actions=[self._save(ctx, Ability.WIS, damage=None, effects=effect, area=area, recharge=Recharge(min=5))])


class Leap(Move):
    key, label, group = "leap", "Leap", "Control"
    blurb = "Springs at a target and can knock it prone."
    needs_not_tiny = True

    def build(self, ctx: Context) -> Addition:
        effect = f"If {ctx.who} moved at least 10 feet in a straight line toward the target first, a failed save also knocks the target prone."
        return self._done(ctx, actions=[self._save(ctx, Ability.STR, damage=0.6, effects=effect)])


# --- area -----------------------------------------------------------------------------------------------


class Burst(Move):
    key, label, group = "burst", "Burst", "Area"
    blurb = "A recharging burst of the theme's damage all around the monster."

    def build(self, ctx: Context) -> Addition:
        area = Area(shape=AreaShape.RADIUS, size=_radius(ctx.monster))
        return self._done(ctx, actions=[self._save(ctx, Ability.DEX, damage=1.0, area=area, recharge=Recharge(min=5))])


class Spray(Move):
    key, label, group = "spray", "Spray", "Area"
    blurb = "A recharging cone of the theme's damage."

    def build(self, ctx: Context) -> Addition:
        area = Area(shape=AreaShape.CONE, size=_cone(ctx.monster))
        return self._done(ctx, actions=[self._save(ctx, Ability.DEX, damage=1.0, area=area, recharge=Recharge(min=5))])


class Aura(Move):
    key, label, group = "aura", "Aura", "Area"
    blurb = "Creatures that start their turn next to the monster take a little damage."

    def build(self, ctx: Context) -> Addition:
        text = f"Any creature that starts its turn within 10 feet of {ctx.who} takes {ctx.phrase(ctx.roll(0.34))}."
        return self._done(ctx, traits=[TextAction(name=ctx.name, text=text)])


class DeathBurst(Move):
    key, label, group = "death_burst", "Death burst", "Area"
    blurb = "When it dies, it explodes in the theme's damage."

    def build(self, ctx: Context) -> Addition:
        text = (
            f"When {ctx.who} dies, it explodes. Each creature within 10 feet of it must make a DC {ctx.dc} Dexterity saving throw, "
            f"taking {ctx.phrase(ctx.roll(0.9))} on a failed save, or half as much damage on a successful one."
        )
        return self._done(ctx, traits=[TextAction(name=ctx.name, text=text)])


# --- defence and mobility -------------------------------------------------------------------------------


class Backlash(Move):
    key, label, group = "backlash", "Backlash", "Defence and mobility"
    blurb = "A reaction that hurts a creature that hits the monster in melee."

    def build(self, ctx: Context) -> Addition:
        text = f"When a creature within 5 feet of {ctx.who} hits it with a melee attack, the attacker takes {ctx.phrase(ctx.roll(0.34))}."
        return self._done(ctx, reactions=[TextAction(name=ctx.name, text=text)])


class BlinkStep(Move):
    key, label, group = "blink_step", "Blink step", "Defence and mobility"
    blurb = "A short teleport as a bonus action."
    needs_damage = False

    def build(self, ctx: Context) -> Addition:
        text = f"{ctx.who[0].upper()}{ctx.who[1:]} teleports up to 20 feet to an unoccupied space it can see."
        return self._done(ctx, bonus_actions=[TextAction(name=ctx.name, text=text, recharge=Recharge(min=4))])


class WardFlicker(Move):
    key, label, group = "ward_flicker", "Ward flicker", "Defence and mobility"
    blurb = "A reaction that can turn aside a hit."
    needs_damage = False

    def build(self, ctx: Context) -> Addition:
        text = f"When a creature {ctx.who} can see hits it with an attack, {ctx.who} gains +2 AC against that attack, potentially causing it to miss."
        return self._done(ctx, reactions=[TextAction(name=ctx.name, text=text, recharge=Recharge(min=5))])


# --- the menu -------------------------------------------------------------------------------------------

MOVES: dict[str, Move] = {
    move.key: move
    for move in (
        Rider(), OpeningStrike(), Drain(), Lob(), Sunder(),
        GraspingStrike(), SlowingTouch(), Pull(), Dazzle(), DreadPresence(), Leap(),
        Burst(), Spray(), Aura(), DeathBurst(),
        Backlash(), BlinkStep(), WardFlicker(),
    )
}


def available_moves(monster: Monster) -> list[Move]:
    """The moves that make sense for this monster, in menu order."""
    return [move for move in MOVES.values() if move.applies_to(monster)]

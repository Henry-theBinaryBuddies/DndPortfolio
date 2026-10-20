"""The validator: deterministic rules every monster must pass before it is stored or shown as valid.

The design, in object-oriented terms:

* ``Check`` is an abstract base class with one method, ``run``. Each rule from docs/REQUIREMENTS.md section 6 is
  a subclass that knows only its own rule.
* ``Validator`` holds a list of checks and runs them in turn. It does not know what any check does, so adding a
  rule means writing one new subclass and putting it in the list (composition).
* Checks never change the monster they are given. They return a corrected *copy* plus a list of findings.

Outcomes: a check can auto-correct a number, reject the monster, or (for official SRD monsters) only note a
difference, because official statistics are kept as printed.

Not here yet: the "recomputed CR within one step of the claimed CR" check. It needs a CR calculator, and the
Dungeon Master's Guide table that such a calculator is normally built on is not in the SRD. It will be built
later from SRD monsters themselves.
"""

from abc import ABC, abstractmethod
from collections.abc import Sequence
from dataclasses import dataclass, field
from enum import StrEnum

from cauldron.actions import AttackAction, SaveAction
from cauldron.blocklist import blocked_term
from cauldron.dice import ability_modifier, format_dice, parse_dice
from cauldron.features import derive_features
from cauldron.monster import Monster
from cauldron.options import Ability, Source
from cauldron.rules import SRD_ATTRIBUTION, cr_value, hit_die, proficiency_bonus, xp_for_cr

# Attack bonuses and save DCs may sit up to this far above the plain rule (proficiency + ability). Magic
# weapons, expertise and the elite template all add a little, so only larger gaps are treated as mistakes.
BONUS_TOLERANCE = 3
MAX_LEGENDARY_PER_ROUND = 3


class Outcome(StrEnum):
    CORRECTED = "corrected"  # a number was fixed automatically
    NOTED = "noted"  # a difference was seen but, for an SRD monster, left as printed
    REJECT = "reject"  # the monster cannot be used


class Status(StrEnum):
    ACCEPTED = "accepted"  # nothing needed changing
    CORRECTED = "corrected"  # accepted after automatic fixes
    REJECTED = "rejected"


@dataclass(frozen=True)
class Finding:
    check: str
    outcome: Outcome
    message: str


@dataclass(frozen=True)
class ValidationContext:
    """What the checks may need to know about the world around the monster."""

    existing_names: frozenset[str] = frozenset()


@dataclass
class CheckResult:
    monster: Monster
    findings: list[Finding] = field(default_factory=list)


@dataclass
class ValidationReport:
    status: Status
    monster: Monster
    findings: list[Finding]

    @property
    def errors(self) -> list[Finding]:
        return [f for f in self.findings if f.outcome is Outcome.REJECT]

    @property
    def corrections(self) -> list[Finding]:
        return [f for f in self.findings if f.outcome is Outcome.CORRECTED]

    @property
    def notes(self) -> list[Finding]:
        return [f for f in self.findings if f.outcome is Outcome.NOTED]


def _normal(name: str) -> str:
    return " ".join(name.lower().split())


def _modifier(monster: Monster, ability: Ability) -> int:
    return ability_modifier(getattr(monster.abilities, ability.value))


# --- the abstract base class ----------------------------------------------------------------------------


class Check(ABC):
    name: str

    @abstractmethod
    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        """Look at the monster and return it (or a corrected copy) with what was found."""

    def _result(self, monster: Monster, *findings: Finding) -> CheckResult:
        return CheckResult(monster=monster, findings=list(findings))

    def _finding(self, outcome: Outcome, message: str) -> Finding:
        return Finding(check=self.name, outcome=outcome, message=message)


# --- the checks -----------------------------------------------------------------------------------------


class NameCheck(Check):
    name = "name"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        findings: list[Finding] = []
        term = blocked_term(monster.name)
        if term is not None:
            findings.append(self._finding(Outcome.REJECT, f'The name contains "{term}", which is not ours to use.'))
        if _normal(monster.name) in {_normal(n) for n in context.existing_names}:
            findings.append(self._finding(Outcome.REJECT, f'A monster called "{monster.name}" already exists.'))
        return self._result(monster, *findings)


class DerivedFieldsCheck(Check):
    """Challenge value, XP and proficiency bonus all follow from the challenge rating label."""

    name = "derived fields"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        label = monster.challenge.cr
        try:
            expected_value = cr_value(label)
        except ValueError:
            return self._result(monster, self._finding(Outcome.REJECT, f'"{label}" is not a challenge rating.'))

        wanted = {
            "cr_value": expected_value,
            "xp": xp_for_cr(label),
            "proficiency_bonus": proficiency_bonus(label),
        }
        findings = [
            self._finding(Outcome.CORRECTED, f"{key} was {getattr(monster.challenge, key)} and should be {value} for CR {label}.")
            for key, value in wanted.items()
            if getattr(monster.challenge, key) != value
        ]
        if not findings:
            return self._result(monster)
        return self._result(monster.model_copy(update={"challenge": monster.challenge.model_copy(update=wanted)}), *findings)


class HitPointsCheck(Check):
    """The hit die follows the size, the bonus is Constitution modifier x dice, and the average follows."""

    name = "hit points"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        count = parse_dice(monster.hit_points.dice).count
        sides = hit_die(monster.size)
        bonus = count * _modifier(monster, Ability.CON)
        dice = format_dice(count, sides, bonus)
        average = max(1, (count * (sides + 1) + 2 * bonus) // 2)

        findings: list[Finding] = []
        if dice != monster.hit_points.dice:
            findings.append(self._finding(Outcome.CORRECTED, f"Hit dice were {monster.hit_points.dice} and should be {dice} for a {monster.size.value} creature with this Constitution."))
        if average != monster.hit_points.average:
            findings.append(self._finding(Outcome.CORRECTED, f"Average hit points were {monster.hit_points.average} and should be {average}."))
        if not findings:
            return self._result(monster)
        fixed = monster.hit_points.model_copy(update={"dice": dice, "average": average})
        return self._result(monster.model_copy(update={"hit_points": fixed}), *findings)


class AttackBonusCheck(Check):
    """An attack roll is proficiency bonus plus the stated ability modifier (magic may add a little)."""

    name = "attack bonus"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        findings: list[Finding] = []

        def fix(action: AttackAction) -> AttackAction:
            expected = monster.challenge.proficiency_bonus + _modifier(monster, action.attack.ability)
            extra = action.attack.to_hit - expected
            if 0 <= extra <= BONUS_TOLERANCE:
                return action
            findings.append(self._finding(Outcome.CORRECTED, f'"{action.name}" had +{action.attack.to_hit} to hit and should have +{expected}.'))
            return action.model_copy(update={"attack": action.attack.model_copy(update={"to_hit": expected})})

        def fix_all(actions: list) -> list:
            return [fix(a) if isinstance(a, AttackAction) else a for a in actions]

        updated = monster.model_copy(
            update={
                "actions": fix_all(monster.actions),
                "bonus_actions": fix_all(monster.bonus_actions),
                "reactions": fix_all(monster.reactions),
            }
        )
        return self._result(updated if findings else monster, *findings)


class SaveDcCheck(Check):
    """A save DC is 8 + proficiency bonus + an ability modifier. The model does not say which ability, so any of
    the six is accepted; a DC no ability can reach is moved to the nearest one that can."""

    name = "save DC"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        pb = monster.challenge.proficiency_bonus
        reachable = sorted({8 + pb + _modifier(monster, ability) for ability in Ability})
        findings: list[Finding] = []

        def fix(action: SaveAction) -> SaveAction:
            dc = action.save.dc
            if any(0 <= dc - base <= BONUS_TOLERANCE for base in reachable):
                return action
            nearest = min(reachable, key=lambda base: (abs(dc - base), base))
            findings.append(self._finding(Outcome.CORRECTED, f'"{action.name}" had DC {dc}, which no ability reaches. Changed to DC {nearest}.'))
            return action.model_copy(update={"save": action.save.model_copy(update={"dc": nearest})})

        def fix_all(actions: list) -> list:
            return [fix(a) if isinstance(a, SaveAction) else a for a in actions]

        updated = monster.model_copy(
            update={
                "actions": fix_all(monster.actions),
                "bonus_actions": fix_all(monster.bonus_actions),
                "reactions": fix_all(monster.reactions),
            }
        )
        return self._result(updated if findings else monster, *findings)


class SpellcastingCheck(Check):
    """Spell save DC is 8 + proficiency + casting ability modifier, and the attack bonus is proficiency + it."""

    name = "spellcasting"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        spellcasting = monster.spellcasting
        if spellcasting is None:
            return self._result(monster)
        pb = monster.challenge.proficiency_bonus
        mod = _modifier(monster, spellcasting.ability)
        dc, attack = 8 + pb + mod, pb + mod

        findings: list[Finding] = []
        if not 0 <= spellcasting.dc - dc <= BONUS_TOLERANCE:
            findings.append(self._finding(Outcome.CORRECTED, f"Spell save DC was {spellcasting.dc} and should be {dc}."))
        else:
            dc = spellcasting.dc
        if not 0 <= spellcasting.attack_bonus - attack <= BONUS_TOLERANCE:
            findings.append(self._finding(Outcome.CORRECTED, f"Spell attack bonus was {spellcasting.attack_bonus} and should be {attack}."))
        else:
            attack = spellcasting.attack_bonus
        if not findings:
            return self._result(monster)

        fixed = spellcasting.with_numbers(dc, attack)
        return self._result(monster.model_copy(update={"spellcasting": fixed}), *findings)


class LegendaryCheck(Check):
    """At most three legendary actions per round, and no option may cost more than the pool."""

    name = "legendary actions"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        legendary = monster.legendary_actions
        if legendary is None:
            return self._result(monster)

        findings: list[Finding] = []
        per_round = legendary.per_round
        if per_round > MAX_LEGENDARY_PER_ROUND:
            findings.append(self._finding(Outcome.CORRECTED, f"{per_round} legendary actions per round is too many; changed to {MAX_LEGENDARY_PER_ROUND}."))
            per_round = MAX_LEGENDARY_PER_ROUND

        options = []
        for option in legendary.options:
            if option.cost > per_round:
                findings.append(self._finding(Outcome.CORRECTED, f'"{option.name}" cost {option.cost}, more than the {per_round} available. Changed to {per_round}.'))
                option = option.model_copy(update={"cost": per_round})
            options.append(option)
        if not findings:
            return self._result(monster)
        fixed = legendary.model_copy(update={"per_round": per_round, "options": options})
        return self._result(monster.model_copy(update={"legendary_actions": fixed}), *findings)


class FeaturesCheck(Check):
    """Feature tags are derived from the stat block, never taken on trust."""

    name = "features"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        expected = derive_features(monster)
        if expected == monster.features:
            return self._result(monster)
        message = f"Features were {[f.value for f in monster.features]} and should be {[f.value for f in expected]}."
        return self._result(monster.model_copy(update={"features": expected}), self._finding(Outcome.CORRECTED, message))


class AttributionCheck(Check):
    """SRD monsters must carry the exact CC-BY attribution, and nobody may misquote it."""

    name = "attribution"

    def run(self, monster: Monster, context: ValidationContext) -> CheckResult:
        text = monster.attribution
        if monster.source is Source.SRD:
            if text != SRD_ATTRIBUTION:
                return self._result(monster, self._finding(Outcome.REJECT, "An SRD monster must carry the exact SRD 5.1 attribution statement."))
        elif text is not None and "system reference document" in text.lower() and text != SRD_ATTRIBUTION:
            return self._result(monster, self._finding(Outcome.REJECT, "The SRD attribution must be quoted exactly, not paraphrased."))
        return self._result(monster)


def default_checks() -> list[Check]:
    return [
        NameCheck(),
        DerivedFieldsCheck(),
        HitPointsCheck(),
        AttackBonusCheck(),
        SaveDcCheck(),
        SpellcastingCheck(),
        LegendaryCheck(),
        FeaturesCheck(),
        AttributionCheck(),
    ]


# --- the validator --------------------------------------------------------------------------------------


class Validator:
    def __init__(self, checks: Sequence[Check] | None = None) -> None:
        self.checks: list[Check] = list(checks) if checks is not None else default_checks()

    def validate(self, monster: Monster, context: ValidationContext | None = None) -> ValidationReport:
        """Runs every check over a copy of the monster. The monster passed in is never changed."""
        context = context or ValidationContext()
        current = monster
        findings: list[Finding] = []
        official = monster.source is Source.SRD

        for check in self.checks:
            result = check.run(current, context)
            if official:
                # Official statistics stay as printed: corrections become notes and the monster is not altered.
                findings += [
                    Finding(f.check, Outcome.NOTED, f.message) if f.outcome is Outcome.CORRECTED else f
                    for f in result.findings
                ]
            else:
                findings += result.findings
                current = result.monster

        if any(f.outcome is Outcome.REJECT for f in findings):
            return ValidationReport(Status.REJECTED, current, findings)
        status = Status.CORRECTED if any(f.outcome is Outcome.CORRECTED for f in findings) else Status.ACCEPTED
        return ValidationReport(status, current.model_copy(update={"validated": True}), findings)

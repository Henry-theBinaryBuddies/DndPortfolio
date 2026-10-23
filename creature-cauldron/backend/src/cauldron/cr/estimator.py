"""The CR estimator: a rough second opinion on a monster's challenge rating.

It is built from the SRD monsters themselves (see ``calibrate.py``), not from the Dungeon Master's Guide. A
``Calibration`` holds four curves, one number per step of the CR ladder, saying what a typical SRD monster at that CR
has: hit points, damage per round, armor class and offensive bonus. To estimate a monster:

1. Read the hit point curve backwards: which CR typically has this many (effective) hit points? Armor class above
   what that CR typically has counts as extra hit points, and below counts as fewer.
2. Do the same for damage per round, with the offensive bonus as the adjustment.
3. Average the two positions and round to a CR.

Positions are steps along the CR ladder (0 is CR 0, 1 is CR 1/8, ... 33 is CR 30), not CR values, so the gap between
CR 1/8 and CR 1/4 counts the same as the gap between CR 29 and CR 30.
"""

from dataclasses import dataclass

from cauldron.cr.curves import invert
from cauldron.cr.measure import Measures, measure
from cauldron.monster import Monster
from cauldron.rules import CR_LABELS


@dataclass(frozen=True)
class Calibration:
    hp_curve: list[float]
    dpr_curve: list[float]
    ac_curve: list[float]
    bonus_curve: list[float]
    ac_weight: float  # how much each point of armor class above or below the curve changes effective hit points
    bonus_weight: float  # the same for the offensive bonus and damage
    defense_share: float  # how much of the answer comes from the defensive half (0 to 1)
    reliable_index: int  # the highest ladder position with enough SRD monsters behind it to trust


@dataclass(frozen=True)
class CrEstimate:
    cr: str  # the estimated challenge rating, for example "5"
    position: float  # where on the ladder, before rounding
    defensive_position: float
    offensive_position: float
    reliable: bool  # False when the estimate is above what the SRD data covers well

    @property
    def index(self) -> int:
        return CR_LABELS.index(self.cr)


def value_at(curve: list[float], position: float) -> float:
    """The curve's value at a fractional position, in a straight line between steps."""
    low = max(0, min(int(position), len(curve) - 1))
    high = min(low + 1, len(curve) - 1)
    return curve[low] + (curve[high] - curve[low]) * (position - low)


def _scale(weight: float, difference: float) -> float:
    """1 plus weight per point of difference, never below 0.1 so a huge shortfall cannot make a value negative."""
    return max(0.1, 1.0 + weight * difference)


def estimate_with(calibration: Calibration, measures: Measures) -> CrEstimate:
    # Defence: effective hit points, adjusted for armor class.
    hp_position = invert(calibration.hp_curve, measures.effective_hp)
    ac_gap = measures.ac - value_at(calibration.ac_curve, hp_position)
    defensive = invert(calibration.hp_curve, measures.effective_hp * _scale(calibration.ac_weight, ac_gap))

    # Offence: damage per round, adjusted for the offensive bonus. No damage at all is the bottom of the ladder.
    if measures.dpr <= 0:
        offensive = 0.0
    else:
        dpr_position = invert(calibration.dpr_curve, measures.dpr)
        gap = 0.0 if measures.offense_bonus is None else measures.offense_bonus - value_at(calibration.bonus_curve, dpr_position)
        offensive = invert(calibration.dpr_curve, measures.dpr * _scale(calibration.bonus_weight, gap))

    share = calibration.defense_share
    position = share * defensive + (1 - share) * offensive
    index = max(0, min(round(position), len(CR_LABELS) - 1))
    return CrEstimate(
        cr=CR_LABELS[index],
        position=position,
        defensive_position=defensive,
        offensive_position=offensive,
        reliable=index <= calibration.reliable_index,
    )


def committed_calibration() -> Calibration:
    """The calibration saved in the repository (made by ``python -m cauldron.cr.calibrate``)."""
    from cauldron.cr import calibration_table as t

    return Calibration(
        hp_curve=t.HP_CURVE,
        dpr_curve=t.DPR_CURVE,
        ac_curve=t.AC_CURVE,
        bonus_curve=t.BONUS_CURVE,
        ac_weight=t.AC_WEIGHT,
        bonus_weight=t.BONUS_WEIGHT,
        defense_share=t.DEFENSE_SHARE,
        reliable_index=CR_LABELS.index(t.RELIABLE_UP_TO),
    )


def estimate(monster: Monster) -> CrEstimate:
    """The estimated challenge rating of a monster, from the committed calibration."""
    return estimate_with(committed_calibration(), measure(monster))


def tolerance_steps(claimed_index: int) -> int:
    """How many ladder steps an estimate may differ from the claimed CR before it counts as a disagreement.

    It depends on the band the claimed CR is in, because the estimator is much sharper at low CRs than at high ones.
    The numbers come from the calibration: the fewest steps within which 90% of the SRD monsters in that band fall.
    """
    from cauldron.cr import calibration_table as t

    for last_step, steps in sorted(t.TOLERANCE_BANDS.items()):
        if claimed_index <= last_step:
            return steps
    return max(t.TOLERANCE_BANDS.values())

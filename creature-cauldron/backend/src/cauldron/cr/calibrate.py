"""Builds the CR calibration from the SRD monsters: ``python -m cauldron.cr.calibrate``.

What it does:

1. Imports the SRD monsters and measures each one (hit points, damage per round, armor class, offensive bonus).
2. For each measure, fits a never-decreasing curve over the CR ladder: the average at each CR that has monsters, smoothed
   so it cannot dip (isotonic fit), with straight lines across CRs that have none (18, and 25 to 29).
3. Chooses the three tuning numbers (armor weight, bonus weight, defence share) that estimate best, judged by
   *leave-one-out* testing: each monster is estimated from curves built without it, so the score is honest.
4. Writes ``calibration_table.py`` with the curves, the numbers, and the measured accuracy.

The result is a table of our own, derived from open data. It can be regenerated at any time, for example after more
monsters are added to the data.
"""

import json
from collections import defaultdict
from dataclasses import dataclass
from itertools import product
from pathlib import Path

from cauldron.cr.curves import fill_gaps, isotonic_fit
from cauldron.cr.estimator import Calibration, estimate_with
from cauldron.cr.measure import Measures, measure
from cauldron.rules import CR_LABELS
from cauldron.seed.importer import import_all

PROJECT = Path(__file__).resolve().parents[3]  # the backend folder
RAW = PROJECT / "data" / "srd-2014" / "5e-SRD-Monsters.json"
TABLE = Path(__file__).with_name("calibration_table.py")
RELIABLE_MIN_MONSTERS = 4  # a CR needs this many SRD monsters before the data around it is trusted
STEPS = len(CR_LABELS)

# Bands of the CR ladder, by the last step in each (step 7 is CR 4, step 13 is CR 10, step 20 is CR 17).
BANDS = [("CR 0 to 4", 7), ("CR 5 to 10", 13), ("CR 11 to 17", 20), ("CR 18 and up", STEPS - 1)]

AC_WEIGHTS = [0.0, 0.02, 0.04, 0.06, 0.08, 0.10]
BONUS_WEIGHTS = [0.0, 0.02, 0.04, 0.06, 0.08, 0.10]
DEFENSE_SHARES = [0.4, 0.5, 0.6, 0.7, 0.8]


@dataclass(frozen=True)
class Point:
    index: int  # position of the monster's CR on the ladder
    measures: Measures


def fit_curve(points: list[tuple[int, float]]) -> list[float]:
    """One value per ladder step from (step, value) points: step averages, smoothed to never decrease, gaps filled."""
    by_step: dict[int, list[float]] = defaultdict(list)
    for step, value in points:
        by_step[step].append(value)
    steps = sorted(by_step)
    averages = [sum(by_step[s]) / len(by_step[s]) for s in steps]
    smoothed = isotonic_fit(averages, [len(by_step[s]) for s in steps])
    sparse: list[float | None] = [None] * STEPS
    for step, value in zip(steps, smoothed, strict=True):
        sparse[step] = value
    return fill_gaps(sparse)


def curves_from(points: list[Point]) -> tuple[list[float], list[float], list[float], list[float]]:
    return (
        fit_curve([(p.index, p.measures.effective_hp) for p in points]),
        fit_curve([(p.index, p.measures.dpr) for p in points]),
        fit_curve([(p.index, float(p.measures.ac)) for p in points]),
        fit_curve([(p.index, float(p.measures.offense_bonus)) for p in points if p.measures.offense_bonus is not None]),
    )


def reliable_index(points: list[Point]) -> int:
    """The highest ladder step that has at least RELIABLE_MIN_MONSTERS SRD monsters at it or at any step below."""
    counts: dict[int, int] = defaultdict(int)
    for p in points:
        counts[p.index] += 1
    best = 0
    for step in range(STEPS):
        if counts[step] >= RELIABLE_MIN_MONSTERS:
            best = step
    return best


@dataclass(frozen=True)
class Accuracy:
    mean_abs_error: float
    within: dict[int, float]  # steps -> share of monsters estimated within that many steps


def leave_one_out(points: list[Point], weights: list[tuple[float, float, float]]) -> dict[tuple[float, float, float], list[int]]:
    """For every candidate (armor weight, bonus weight, defence share), the signed errors in ladder steps of every
    monster estimated from curves built without it."""
    errors: dict[tuple[float, float, float], list[int]] = {w: [] for w in weights}
    reliable = reliable_index(points)
    for i, point in enumerate(points):
        others = points[:i] + points[i + 1 :]
        hp, dpr, ac, bonus = curves_from(others)
        for key in weights:
            ac_weight, bonus_weight, share = key
            calibration = Calibration(hp, dpr, ac, bonus, ac_weight, bonus_weight, share, reliable)
            estimated = estimate_with(calibration, point.measures)
            errors[key].append(estimated.index - point.index)
    return errors


def accuracy_of(errors: list[int]) -> Accuracy:
    n = len(errors)
    return Accuracy(
        mean_abs_error=sum(abs(e) for e in errors) / n,
        within={k: sum(abs(e) <= k for e in errors) / n for k in (1, 2, 3, 4)},
    )


def choose_tolerance(accuracy: Accuracy, target: float = 0.9) -> int:
    """The smallest number of steps within which at least `target` of the SRD monsters fall."""
    for steps in sorted(accuracy.within):
        if accuracy.within[steps] >= target:
            return steps
    return max(accuracy.within)


def run() -> None:
    result = import_all(json.loads(RAW.read_text(encoding="utf-8")))
    points = [Point(CR_LABELS.index(m.challenge.cr), measure(m)) for m in result.monsters]
    print(f"Measured {len(points)} SRD monsters.")

    candidates = list(product(AC_WEIGHTS, BONUS_WEIGHTS, DEFENSE_SHARES))
    errors = leave_one_out(points, candidates)
    best = min(candidates, key=lambda key: (accuracy_of(errors[key]).mean_abs_error, key))
    ac_weight, bonus_weight, share = best
    accuracy = accuracy_of(errors[best])

    hp, dpr, ac, bonus = curves_from(points)
    reliable = reliable_index(points)

    # Accuracy differs a lot between bands (the low CRs are easy), so each band gets its own tolerance.
    band_text = []
    tolerances: dict[int, int] = {}
    for name, last_step in BANDS:
        first_step = 0 if not tolerances else max(tolerances) + 1
        subset = [e for e, p in zip(errors[best], points, strict=True) if first_step <= p.index <= last_step]
        if subset:
            a = accuracy_of(subset)
            tolerances[last_step] = choose_tolerance(a)
            band_text.append(
                f"{name}: {len(subset)} monsters, within 1 step {a.within[1]:.0%}, 2 steps {a.within[2]:.0%}, "
                f"3 steps {a.within[3]:.0%}; tolerance {tolerances[last_step]} steps"
            )
        else:
            tolerances[last_step] = max(tolerances.values(), default=2)
    lines = [
        '"""The CR calibration, generated by ``python -m cauldron.cr.calibrate`` from the SRD 5.1 monsters. Do not edit by hand."""',
        "",
        f"# Built from {len(points)} SRD monsters. Leave-one-out accuracy (each monster estimated without itself):",
        f"#   mean error {accuracy.mean_abs_error:.2f} steps; within 1 step {accuracy.within[1]:.0%}, 2 steps {accuracy.within[2]:.0%}, 3 steps {accuracy.within[3]:.0%}",
        *[f"#   {text}" for text in band_text],
        "",
        f"HP_CURVE = {[round(v, 2) for v in hp]}",
        f"DPR_CURVE = {[round(v, 2) for v in dpr]}",
        f"AC_CURVE = {[round(v, 2) for v in ac]}",
        f"BONUS_CURVE = {[round(v, 2) for v in bonus]}",
        f"AC_WEIGHT = {ac_weight}",
        f"BONUS_WEIGHT = {bonus_weight}",
        f"DEFENSE_SHARE = {share}",
        f'RELIABLE_UP_TO = "{CR_LABELS[reliable]}"',
        f"SAMPLE_SIZE = {len(points)}",
        f"TOLERANCE_BANDS = {tolerances}  # last ladder step of each band -> the fewest steps within which 90% of its SRD monsters fall",
        f"MEAN_ABS_ERROR = {round(accuracy.mean_abs_error, 3)}",
        f"WITHIN = {{{', '.join(f'{k}: {round(v, 3)}' for k, v in accuracy.within.items())}}}",
        "",
    ]
    TABLE.write_text("\n".join(lines), encoding="utf-8")
    print("\n".join(line for line in lines if line.startswith("#")))
    print(f"Chose armor weight {ac_weight}, bonus weight {bonus_weight}, defence share {share}; tolerances {tolerances}.")
    print(f"Wrote {TABLE}")


if __name__ == "__main__":
    run()

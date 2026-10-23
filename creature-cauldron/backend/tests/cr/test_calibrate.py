"""The calibration helpers (the full run is checked through the committed table in test_estimator.py)."""

import pytest

from cauldron.cr.calibrate import Accuracy, Point, accuracy_of, choose_tolerance, curves_from, fit_curve, leave_one_out, reliable_index
from cauldron.cr.measure import Measures
from cauldron.rules import CR_LABELS

STEPS = len(CR_LABELS)


def point(index: int, hp: float, dpr: float = 10.0, ac: int = 12, bonus: int | None = 4) -> Point:
    return Point(index, Measures(hp, ac, dpr, bonus))


def test_fit_curve_averages_each_step_and_fills_the_gaps() -> None:
    curve = fit_curve([(0, 2.0), (0, 4.0), (4, 11.0)])
    assert len(curve) == STEPS
    assert curve[0] == 3.0 and curve[4] == 11.0
    assert curve[2] == pytest.approx(7.0)  # halfway between the known steps
    assert curve[10] == 11.0  # after the last known step the value is carried on


def test_fit_curve_never_decreases_even_when_the_data_does() -> None:
    curve = fit_curve([(0, 10.0), (1, 4.0), (2, 12.0)])
    assert curve == sorted(curve)


def test_accuracy_counts_how_many_are_within_each_distance() -> None:
    result = accuracy_of([0, 1, -1, 2, -3, 0, 0, 5])
    assert isinstance(result, Accuracy)
    assert result.within[1] == 5 / 8
    assert result.within[2] == 6 / 8
    assert result.mean_abs_error == pytest.approx(12 / 8)


def test_the_tolerance_is_the_fewest_steps_that_cover_the_target_share() -> None:
    assert choose_tolerance(accuracy_of([0] * 9 + [3])) == 1  # 90% are exact
    assert choose_tolerance(accuracy_of([0] * 5 + [2] * 4 + [4])) == 2
    assert choose_tolerance(accuracy_of([4] * 10)) == 4


def test_the_reliable_step_is_the_highest_one_with_enough_monsters() -> None:
    points = [point(3, 10)] * 5 + [point(8, 20)] * 4 + [point(12, 30)] * 2
    assert reliable_index(points) == 8


def test_curves_come_from_the_measures() -> None:
    points = [point(2, 10), point(2, 20), point(5, 40)]
    hp, dpr, ac, bonus = curves_from(points)
    assert hp[2] == 15 and hp[5] == 40
    assert len(dpr) == len(ac) == len(bonus) == STEPS


def test_leave_one_out_reports_an_error_for_every_monster() -> None:
    points = [point(i % 10, 10.0 * (i % 10) + 5, 5.0 * (i % 10) + 2) for i in range(30)]
    errors = leave_one_out(points, [(0.0, 0.0, 0.5), (0.02, 0.02, 0.7)])
    assert set(errors) == {(0.0, 0.0, 0.5), (0.02, 0.02, 0.7)}
    assert all(len(v) == 30 for v in errors.values())

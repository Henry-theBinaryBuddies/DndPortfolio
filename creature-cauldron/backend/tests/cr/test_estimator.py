"""The estimator and the committed calibration."""

import json
from pathlib import Path

import pytest

from cauldron.cr import calibration_table as table
from cauldron.cr.estimator import Calibration, committed_calibration, estimate, estimate_with, tolerance_steps, value_at
from cauldron.cr.measure import Measures, measure
from cauldron.rules import CR_LABELS
from cauldron.seed.importer import import_all

RAW = json.loads((Path(__file__).parents[2] / "data" / "srd-2014" / "5e-SRD-Monsters.json").read_text(encoding="utf-8"))
SRD = import_all(RAW).monsters

# A tiny made-up calibration so the formulas can be checked by hand: one CR step is 10 more hit points,
# 5 more damage, one more armor class and one more bonus.
STEPS = len(CR_LABELS)
SIMPLE = Calibration(
    hp_curve=[10.0 * i for i in range(STEPS)],
    dpr_curve=[5.0 * i for i in range(STEPS)],
    ac_curve=[10.0 + i for i in range(STEPS)],
    bonus_curve=[float(i) for i in range(STEPS)],
    ac_weight=0.0,
    bonus_weight=0.0,
    defense_share=0.5,
    reliable_index=20,
)


def changed(**updates) -> Calibration:
    return Calibration(**{**SIMPLE.__dict__, **updates})


def test_value_at_is_a_straight_line_between_steps() -> None:
    assert value_at([0.0, 10.0, 30.0], 0.5) == 5.0
    assert value_at([0.0, 10.0, 30.0], 1.5) == 20.0
    assert value_at([0.0, 10.0, 30.0], 2.0) == 30.0
    assert value_at([0.0, 10.0, 30.0], 9.0) == 30.0


def test_both_halves_agreeing_gives_that_step() -> None:
    result = estimate_with(SIMPLE, Measures(effective_hp=100.0, ac=20, dpr=50.0, offense_bonus=10))
    assert result.position == pytest.approx(10.0)
    assert result.cr == CR_LABELS[10]
    assert result.reliable


def test_the_answer_is_the_average_of_defence_and_offence() -> None:
    result = estimate_with(SIMPLE, Measures(effective_hp=100.0, ac=20, dpr=100.0, offense_bonus=10))
    assert result.defensive_position == pytest.approx(10.0)
    assert result.offensive_position == pytest.approx(20.0)
    assert result.position == pytest.approx(15.0)


def test_defence_share_weights_the_two_halves() -> None:
    result = estimate_with(changed(defense_share=0.8), Measures(effective_hp=100.0, ac=20, dpr=100.0, offense_bonus=10))
    assert result.position == pytest.approx(0.8 * 10 + 0.2 * 20)


def test_no_damage_is_the_bottom_of_the_offensive_ladder() -> None:
    result = estimate_with(SIMPLE, Measures(effective_hp=100.0, ac=20, dpr=0.0, offense_bonus=None))
    assert result.offensive_position == 0.0


def test_armor_class_above_the_curve_counts_as_extra_hit_points() -> None:
    tough = changed(ac_weight=0.05)
    plain = estimate_with(tough, Measures(effective_hp=100.0, ac=20, dpr=50.0, offense_bonus=10))
    armoured = estimate_with(tough, Measures(effective_hp=100.0, ac=26, dpr=50.0, offense_bonus=10))
    assert armoured.defensive_position > plain.defensive_position


def test_a_better_bonus_counts_as_extra_damage() -> None:
    sharp = changed(bonus_weight=0.05)
    plain = estimate_with(sharp, Measures(effective_hp=100.0, ac=20, dpr=50.0, offense_bonus=10))
    accurate = estimate_with(sharp, Measures(effective_hp=100.0, ac=20, dpr=50.0, offense_bonus=16))
    assert accurate.offensive_position > plain.offensive_position


def test_a_missing_bonus_makes_no_adjustment() -> None:
    sharp = changed(bonus_weight=0.05)
    assert estimate_with(sharp, Measures(100.0, 20, 50.0, None)).offensive_position == pytest.approx(10.0)


def test_estimates_above_the_reliable_step_are_flagged() -> None:
    result = estimate_with(SIMPLE, Measures(effective_hp=300.0, ac=40, dpr=150.0, offense_bonus=30))
    assert result.index > 20
    assert not result.reliable


def test_the_estimate_stays_on_the_ladder() -> None:
    huge = estimate_with(SIMPLE, Measures(effective_hp=1e9, ac=40, dpr=1e9, offense_bonus=40))
    assert huge.cr == CR_LABELS[-1]
    tiny = estimate_with(SIMPLE, Measures(effective_hp=1.0, ac=1, dpr=0.0, offense_bonus=None))
    assert tiny.cr == CR_LABELS[0]


# --- the committed calibration --------------------------------------------------------------------------


def test_the_committed_curves_cover_the_whole_ladder_and_never_decrease() -> None:
    for curve in (table.HP_CURVE, table.DPR_CURVE, table.AC_CURVE, table.BONUS_CURVE):
        assert len(curve) == STEPS
        assert curve == sorted(curve)


def test_the_committed_calibration_records_how_it_was_made() -> None:
    assert table.SAMPLE_SIZE == len(SRD) == 333
    assert table.RELIABLE_UP_TO in CR_LABELS
    assert 0 < table.MEAN_ABS_ERROR < 2
    assert table.WITHIN[2] > 0.85


def test_the_tolerance_grows_with_the_challenge_rating() -> None:
    low = tolerance_steps(CR_LABELS.index("2"))
    mid = tolerance_steps(CR_LABELS.index("8"))
    high = tolerance_steps(CR_LABELS.index("25"))
    assert 1 <= low <= mid
    assert high >= 1


def test_most_srd_monsters_fall_inside_their_tolerance() -> None:
    # In-sample (the curves saw these monsters), so this must be at least as good as the recorded leave-one-out figure.
    inside = 0
    for m in SRD:
        claimed = CR_LABELS.index(m.challenge.cr)
        if abs(estimate(m).index - claimed) <= tolerance_steps(claimed):
            inside += 1
    assert inside / len(SRD) >= 0.9


def test_more_hit_points_never_lower_the_estimate() -> None:
    base = next(m for m in SRD if m.name == "Ogre")
    bigger = base.model_copy(update={"hit_points": base.hit_points.model_copy(update={"average": base.hit_points.average * 2})})
    assert estimate(bigger).position >= estimate(base).position


def test_known_monsters_land_close() -> None:
    by_name = {m.name: m for m in SRD}
    assert abs(estimate(by_name["Goblin"]).index - CR_LABELS.index("1/4")) <= 1
    assert abs(estimate(by_name["Ogre"]).index - CR_LABELS.index("2")) <= 2
    assert abs(estimate(by_name["Adult Red Dragon"]).index - CR_LABELS.index("17")) <= 4


def test_measuring_then_estimating_matches_the_shortcut() -> None:
    goblin = next(m for m in SRD if m.name == "Goblin")
    assert estimate(goblin) == estimate_with(committed_calibration(), measure(goblin))

"""The curve helpers: a never-decreasing fit, filling empty steps, and reading a curve backwards."""

import pytest

from cauldron.cr.curves import fill_gaps, invert, isotonic_fit


# --- isotonic fit ---------------------------------------------------------------------------------------


def test_data_that_already_rises_is_left_alone() -> None:
    assert isotonic_fit([1.0, 2.0, 4.0], [1, 1, 1]) == [1.0, 2.0, 4.0]


def test_a_dip_is_averaged_with_its_neighbour() -> None:
    # 5 then 3 breaks the rule, so both become their average: 4.
    assert isotonic_fit([1.0, 5.0, 3.0, 6.0], [1, 1, 1, 1]) == [1.0, 4.0, 4.0, 6.0]


def test_the_average_respects_how_many_monsters_each_point_holds() -> None:
    # A point backed by three monsters pulls harder than one backed by one: (5*3 + 3*1) / 4 = 4.5.
    assert isotonic_fit([5.0, 3.0], [3, 1]) == [4.5, 4.5]


def test_a_long_fall_is_flattened_to_the_overall_average() -> None:
    assert isotonic_fit([9.0, 6.0, 3.0], [1, 1, 1]) == [6.0, 6.0, 6.0]


def test_the_result_never_decreases() -> None:
    fitted = isotonic_fit([3.0, 9.0, 2.0, 8.0, 1.0, 10.0], [2, 1, 3, 1, 2, 5])
    assert fitted == sorted(fitted)


def test_the_inputs_must_match_in_length() -> None:
    with pytest.raises(ValueError):
        isotonic_fit([1.0, 2.0], [1])


def test_no_points_gives_no_curve() -> None:
    assert isotonic_fit([], []) == []


# --- filling empty steps --------------------------------------------------------------------------------


def test_empty_steps_are_filled_in_a_straight_line_between_known_ones() -> None:
    assert fill_gaps([2.0, None, None, 8.0]) == [2.0, 4.0, 6.0, 8.0]


def test_steps_before_the_first_and_after_the_last_copy_the_nearest_known_value() -> None:
    assert fill_gaps([None, 3.0, None, 5.0, None]) == [3.0, 3.0, 4.0, 5.0, 5.0]


def test_all_empty_is_an_error() -> None:
    with pytest.raises(ValueError):
        fill_gaps([None, None])


# --- reading a curve backwards ---------------------------------------------------------------------------


def test_invert_finds_the_position_where_the_curve_reaches_a_value() -> None:
    curve = [0.0, 10.0, 20.0, 30.0]
    assert invert(curve, 0.0) == 0.0
    assert invert(curve, 15.0) == pytest.approx(1.5)
    assert invert(curve, 30.0) == 3.0


def test_invert_clamps_outside_the_curve() -> None:
    curve = [10.0, 20.0, 30.0]
    assert invert(curve, 1.0) == 0.0
    assert invert(curve, 99.0) == 2.0


def test_invert_uses_the_middle_of_a_flat_stretch() -> None:
    # The curve sits at 20 from position 1 to 3, so any value of 20 is "somewhere in the middle": position 2.
    assert invert([10.0, 20.0, 20.0, 20.0, 30.0], 20.0) == 2.0


def test_invert_of_a_value_inside_a_plateau_neighbour_still_interpolates() -> None:
    assert invert([10.0, 20.0, 20.0, 30.0], 25.0) == pytest.approx(2.5)

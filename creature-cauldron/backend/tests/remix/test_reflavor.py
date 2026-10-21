"""Reflavor: new names for a monster's own abilities, with every number left alone."""

from cauldron.actions import MultiattackAction
from cauldron.remix.reflavor import MAX_RENAMES, apply_renames, rename_candidates, split_name


def test_a_usage_note_is_split_from_the_name() -> None:
    assert split_name("Enslave (3/Day)") == ("Enslave", " (3/Day)")
    assert split_name("Fire Breath (Recharge 5-6)") == ("Fire Breath", " (Recharge 5-6)")
    assert split_name("Bite") == ("Bite", "")


def test_the_rules_own_names_are_not_candidates(named) -> None:
    dragon = rename_candidates(named("Adult Red Dragon"))
    assert "Bite" in dragon and "Fire Breath" in dragon
    assert "Multiattack" not in dragon and "Legendary Resistance" not in dragon
    assert len(dragon) <= MAX_RENAMES


def test_a_rename_changes_the_name_and_nothing_else(named) -> None:
    wolf = named("Wolf")
    result = apply_renames(wolf, [("Bite", "Rimefang Snap")])
    assert [a.name for a in result.monster.actions] == ["Rimefang Snap"]
    restored = result.monster.actions[0].model_copy(update={"name": "Bite"})
    assert restored == wolf.actions[0]  # every number is as it was
    assert result.monster.hit_points == wolf.hit_points and result.monster.challenge == wolf.challenge
    assert result.changes == ["Renamed Bite → Rimefang Snap"]


def test_the_usage_note_survives_a_rename(named) -> None:
    aboleth = named("Aboleth")
    result = apply_renames(aboleth, [("Enslave", "Bind Mind")])
    assert "Bind Mind (3/Day)" in [a.name for a in result.monster.actions]


def test_a_multiattack_follows_the_names_it_points_at(named) -> None:
    dragon = named("Adult Red Dragon")
    result = apply_renames(dragon, [("Bite", "Cinder Maw")])
    multi = next(a for a in result.monster.actions if isinstance(a, MultiattackAction))
    assert "Cinder Maw" in [entry.action for entry in multi.sequence] and "Bite" not in [entry.action for entry in multi.sequence]
    assert multi.text is not None and "bite" not in multi.text.lower() and "cinder maw" in multi.text


def test_traits_can_be_renamed_too(named) -> None:
    wolf = named("Wolf")
    result = apply_renames(wolf, [("Keen Hearing and Smell", "Hound's Senses")])
    assert "Hound's Senses" in [t.name for t in result.monster.traits]


def test_names_the_monster_does_not_have_are_ignored(named) -> None:
    wolf = named("Wolf")
    assert apply_renames(wolf, [("Tail Slap", "Whip Crack")]).monster == wolf


def test_a_rename_that_would_collide_with_another_ability_is_ignored(named) -> None:
    dragon = named("Adult Red Dragon")
    result = apply_renames(dragon, [("Bite", "Claw")])  # "Claw" is already one of its attacks
    assert result.monster == dragon


def test_two_renames_to_the_same_new_name_keep_only_the_first(named) -> None:
    dragon = named("Adult Red Dragon")
    result = apply_renames(dragon, [("Bite", "Cinder Maw"), ("Claw", "Cinder Maw")])
    assert [c for c in result.changes] == ["Renamed Bite → Cinder Maw"]


def test_names_that_are_empty_or_too_long_are_ignored(named) -> None:
    wolf = named("Wolf")
    assert apply_renames(wolf, [("Bite", "   ")]).monster == wolf
    assert apply_renames(wolf, [("Bite", "x" * 41)]).monster == wolf


def test_a_blocked_name_is_reported_so_the_ai_can_try_again(named) -> None:
    wolf = named("Wolf")
    result = apply_renames(wolf, [("Bite", "Beholder Gaze")])
    assert result.monster == wolf and result.problems and "beholder" in result.problems[0]


def test_old_names_are_matched_without_regard_to_case_and_the_original_is_unchanged(named) -> None:
    wolf = named("Wolf")
    before = wolf.model_dump()
    result = apply_renames(wolf, [("bite", "Rimefang Snap")])
    assert result.monster.actions[0].name == "Rimefang Snap"
    assert wolf.model_dump() == before

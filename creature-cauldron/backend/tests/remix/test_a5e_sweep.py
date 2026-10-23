"""Remix and polymorph on the A5E monsters: they are new bases and donors, so everything must still come out valid."""

import json
import random
from pathlib import Path

import pytest

from cauldron.monster import Monster
from cauldron.options import DamageTheme, Source
from cauldron.remix.engine import remix
from cauldron.remix.graft import borrowable, graft
from cauldron.remix.moves import available_moves
from cauldron.validator import Validator

A5E = Path(__file__).parents[3] / "frontend" / "public" / "data" / "a5e-monsters.json"


@pytest.fixture(scope="module")
def a5e() -> list[Monster]:
    return [Monster.model_validate(m) for m in json.loads(A5E.read_text(encoding="utf-8"))]


def as_reskin(monster: Monster) -> Monster:
    return monster.model_copy(update={"source": Source.RESKIN, "validated": False})


def new_complaints(base: Monster, result: Monster) -> list[str]:
    before = {f.message for f in Validator().validate(as_reskin(base)).findings}
    return [f.message for f in Validator().validate(as_reskin(result)).findings if f.message not in before and "CR consistency" not in f.message and "Claimed CR" not in f.message]


def test_remixing_a5e_monsters_stays_valid(a5e) -> None:
    themes = list(DamageTheme)
    problems: list[str] = []
    checked = 0
    for i, base in enumerate(a5e[::4]):
        moves = available_moves(base)
        if not moves:
            continue
        move = moves[i % len(moves)]
        theme = themes[(i * 3) % len(themes)]
        where = f"{base.name} + {theme.value} + {move.key}"
        try:
            monster = remix(base, theme, move.key, "Probe Move").monster
            assert Monster.model_validate(monster.model_dump(mode="json")) == monster
        except Exception as error:  # noqa: BLE001
            problems.append(f"{where}: {error!r}"[:160])
            continue
        checked += 1
        if complaint := new_complaints(base, monster):
            problems.append(f"{where}: {complaint[0]}")
    assert checked > 100, checked
    assert not problems, "\n".join(problems[:10]) + f"\n({len(problems)} problems in {checked} remixes)"


def test_polymorphing_a5e_monsters_with_srd_ones_stays_valid(a5e, everyone) -> None:
    rng = random.Random(77)
    pool = [*a5e, *everyone]
    problems: list[str] = []
    checked = 0
    for _ in range(1200):
        base, donor = rng.sample(pool, 2)
        if base.id == donor.id:
            continue
        offered = borrowable(base, donor)
        if not offered:
            continue
        chosen = [b.key for b in rng.sample(offered, rng.randint(1, min(5, len(offered))))]
        legendary = base.legendary_actions is None and rng.random() < 0.4
        where = f"{base.name} <- {donor.name}: {chosen}{' + legendary' if legendary else ''}"
        try:
            monster = graft(base, donor, chosen, legendary=legendary).monster
            assert Monster.model_validate(monster.model_dump(mode="json")) == monster
        except Exception as error:  # noqa: BLE001
            problems.append(f"{where}: {error!r}"[:160])
            continue
        checked += 1
        if complaint := new_complaints(base, monster):
            problems.append(f"{where}: {complaint[0]}")
    assert checked > 1000, checked
    assert not problems, "\n".join(problems[:10]) + f"\n({len(problems)} problems in {checked} grafts)"

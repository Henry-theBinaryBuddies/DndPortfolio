"""A manual check of the real Haiku generator: ``python -m cauldron.service.smoke --yes``.

This makes REAL calls to the Anthropic API and costs a small amount of money (a fraction of a cent per call). Because of that
it refuses to run without ``--yes``, and it uses a throwaway in-memory database and a cap of a few calls, so it can never touch
the real library or burn the real daily allowance. Run it yourself, after setting ANTHROPIC_API_KEY.
"""

import argparse
import os
import sys
from collections.abc import Mapping, Sequence
from datetime import UTC, datetime

from cauldron.service.haiku import HaikuGenerator
from cauldron.service.limits import DailyCap
from cauldron.service.models import GenerateFailure, GenerateRequest
from cauldron.service.service import GenerationService
from cauldron.service.settings import Settings
from cauldron.service.store import MonsterStore

# Haiku 5.5 list prices per million tokens, only used for the cost estimate printed at the end.
INPUT_DOLLARS_PER_MILLION = 0.10
OUTPUT_DOLLARS_PER_MILLION = 0.50


def main(argv: Sequence[str] | None = None, env: Mapping[str, str] | None = None) -> int:
    env = os.environ if env is None else env
    parser = argparse.ArgumentParser(description="Generate one monster with the real Haiku model, as a smoke test.")
    parser.add_argument("--yes", action="store_true", help="confirm that you accept the (small) cost of real API calls")
    parser.add_argument("--type", default="undead", help="creature type to ask for (default: undead)")
    parser.add_argument("--cr", type=float, default=3, help="challenge rating to ask for (default: 3)")
    args = parser.parse_args(argv)

    if not args.yes:
        print("This makes real calls to the Anthropic API and costs a small amount of money. Add --yes to go ahead.")
        return 2
    if not env.get("ANTHROPIC_API_KEY", "").strip():
        print("ANTHROPIC_API_KEY is not set. Set it in this terminal first (see backend/README.md).")
        return 1

    settings = Settings.from_env({**env, "CAULDRON_DATABASE": ":memory:"})
    store = MonsterStore(":memory:")
    cap = DailyCap(store, limit=3)  # one try and two retries at most
    service = GenerationService(settings, store, HaikuGenerator(settings), cap, {})
    request = GenerateRequest.model_validate({"types": [args.type], "crMin": args.cr, "crMax": args.cr})

    result = service.create(request)
    used = store.usage(datetime.now(UTC).date().isoformat())
    cost = used.input_tokens / 1e6 * INPUT_DOLLARS_PER_MILLION + used.output_tokens / 1e6 * OUTPUT_DOLLARS_PER_MILLION
    print(f"Calls made: {used.calls}; tokens in/out: {used.input_tokens}/{used.output_tokens}; about ${cost:.4f}")

    if isinstance(result, GenerateFailure):
        print(f"FAILED ({result.reason.value}): {result.message}")
        return 1
    monster = result.monster
    print(f"OK: {monster.name} ({monster.size.value} {monster.type.value}, CR {monster.challenge.cr}, {monster.hit_points.average} HP, AC {monster.armor_class.value})")
    for note in result.notes:
        print(f"  corrected: {note}")
    print(f"  {monster.description}")
    return 0


if __name__ == "__main__":
    sys.exit(main())

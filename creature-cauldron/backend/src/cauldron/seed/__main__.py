"""Runs the SRD import: ``python -m cauldron.seed``.

Reads backend/data/srd-2014/5e-SRD-Monsters.json, imports and validates every monster, then writes
frontend/public/data/srd-monsters.json (what the web page loads) and backend/data/srd-import-report.md.
"""

import argparse
import json
from pathlib import Path

from cauldron.seed.importer import import_all
from cauldron.seed.report import write_report

PROJECT = Path(__file__).resolve().parents[4]  # the creature-cauldron folder


def main() -> None:
    parser = argparse.ArgumentParser(description="Import the SRD 5.1 monsters.")
    parser.add_argument("--raw", type=Path, default=PROJECT / "backend" / "data" / "srd-2014" / "5e-SRD-Monsters.json")
    parser.add_argument("--out", type=Path, default=PROJECT / "frontend" / "public" / "data" / "srd-monsters.json")
    parser.add_argument("--report", type=Path, default=PROJECT / "backend" / "data" / "srd-import-report.md")
    args = parser.parse_args()

    raw_monsters = json.loads(args.raw.read_text(encoding="utf-8"))
    result = import_all(raw_monsters)

    # exclude_none keeps the file small: fields that are not set are simply left out.
    payload = [monster.model_dump(mode="json", exclude_none=True) for monster in result.monsters]
    args.out.write_text(json.dumps(payload, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    args.report.write_text(write_report(result), encoding="utf-8")
    print(f"Wrote {len(payload)} monsters to {args.out}")
    print(f"Wrote the report to {args.report}")
    if result.rejected:
        print(f"{len(result.rejected)} monsters were rejected; see the report.")


if __name__ == "__main__":
    main()

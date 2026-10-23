"""Known problems in the community data, found by checking it against the official SRD 5.1 (see
backend/data/srd-2014/SOURCE.md). Experience points and proficiency bonus are not listed here: they are always
derived from the challenge rating with the SRD's own tables."""

# Entries that are not in the SRD 5.1 and so must not be used.
EXCLUDED: dict[str, str] = {
    "half-red-dragon-veteran": "Not in the SRD 5.1 (found only in the community file).",
}

# Official values where the community file is wrong. Keys are the raw field names.
OVERRIDES: dict[str, dict[str, object]] = {
    "cult-fanatic": {"hit_points": 33, "hit_points_roll": "6d8+6"},
}

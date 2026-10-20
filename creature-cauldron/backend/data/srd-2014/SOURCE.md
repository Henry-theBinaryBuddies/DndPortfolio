# SRD 2014 monster data: provenance

`5e-SRD-Monsters.json` is a community copy of the monsters in the **System Reference Document 5.1**. It is the raw
input of the seed importer (`cauldron/seed`). It is kept unchanged so the import can be repeated exactly.

| | |
|---|---|
| Source repository | https://github.com/5e-bits/5e-srd-api |
| Path | `packages/5e-database/src/2014/en/5e-SRD-Monsters.json` |
| Last commit touching the file | `9c619f00dbc69fa1c0abed1f1faf85a9c9eba05b` (2026-09-23, "feat!: make monster action count always a string (#1280)") |
| Downloaded | 2026-10-20 |
| Code license | MIT (`LICENSE-5e-bits-MIT.md`, copied here as the MIT license requires) |
| Content license | The repository says the underlying material is released under the Open Gaming License 1.0a. The same SRD 5.1 text is also published by Wizards of the Coast under CC-BY-4.0, and **we credit it under CC-BY-4.0** with the exact statement in `cauldron/rules.py` (`SRD_ATTRIBUTION`), as the SRD requires. |

## Verified against the official document

The official SRD 5.1 (Creative Commons edition, 403 pages) was used as the source of truth. Every monster in this
file was checked for its name, armor class, hit points (with dice), challenge rating with XP, and ability scores.

Result: 326 of 334 entries matched completely. The other eight are explained below and handled by
`cauldron/seed/corrections.py`.

| Entry | Problem in the community file | What the importer does |
|---|---|---|
| Half-Red Dragon Veteran | Not in SRD 5.1 | Excluded |
| Brass Dragon Wyrmling | XP 100; the SRD says CR 1 is 200 XP | XP is always derived from CR using the SRD table |
| Dretch | XP 25; the SRD says CR 1/4 is 50 XP | Same |
| Riding Horse | XP 25; the SRD says CR 1/4 is 50 XP | Same |
| Deep Gnome (Svirfneblin) | XP 50; the SRD says CR 1/2 is 100 XP | Same |
| Cult Fanatic | Hit points 22 (6d8 - 5); the SRD says 33 (6d8 + 6) | Corrected to the official value |
| Saber-Toothed Tiger, Will-o'-Wisp | Names looked different only because of PDF punctuation | None needed |

The official document has about 318 stat blocks and the community file has 334 entries. The extra entries are most likely
the separate shapechanger forms (vampire, werebear, wererat and so on) and the diseased giant rat, which the community
file lists as their own monsters. After excluding Half-Red Dragon Veteran, 333 are imported.

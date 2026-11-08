# Audit 21 — independently built clothing and armor

2026-11-06. Reviewed clean Effigy Engine source at db06383, branch claude/sidequest1, and the live localhost:5201 app. No production source/model changes by this audit. No Meshy assets or new dependencies. Parent .idea/.claude/CLAUDE.md/out entries predated the audit and were left alone.

## Conclusion

The first outfits are implemented for both families and pass the tested geometry/export cases. Audit 20's jaw budget and anchor ordering issues have been addressed. The main new regression is interactive latency: clothing fitting remains synchronous during sculpt edits. Stabilize performance and the edge finish before expanding the catalog.

## Findings for Claude

### P1 — Garment fitting blocks sculpt interaction for seconds, including face-only edits

`src/main.ts:130-139`, `src/builder.ts:152-166`, `src/bodySurface.ts:57-60`, `src/garments.ts:118-125,456-599`.

Print preparation is off-thread, but the sculpt's swap still calls buildBust synchronously. That now calls bodySurface and buildOutfit. bodyKey includes every numeric slider for the family, and the outfit cache is owned by that BodySurface object. A cheekbone edit therefore invalidates all garment fitting even though it barely affects the torso. The garment source comment that face edits fit nothing anew is not true with this key.

Measured draft builds (Node/Vitest wall time; hardware/load dependent, not browser input latency benchmarks):

| Case | First probe | Repeat after full unit suite finished |
|---|---:|---:|
| Human, armor+cowl, cold | 4.61 s | 3.71 s |
| Same cached shape/outfit | 1.39 s | 2.24 s |
| Same human, only cheekbones changed to 0.61 | 4.47 s | 3.96 s |
| Dragonborn, armor+cowl, cold | 4.45 s | 4.42 s |

The repeat's bare human draft took 1.53 s. Browser tests were still running during that repeat, so these are not isolated benchmark numbers; they establish multi-second synchronous work, not a precise speedup ratio. Mesh counts: human armor+cowl draft 289,098 triangles; Dragonborn 607,694. Live outfit selection and sculpt controls also visibly waited for rebuilds.

Move sculpt garment fitting to a latest-request worker, or provide a genuinely cheap garment draft and settle the fitted result asynchronously. Keep the old complete figure until a replacement succeeds (swap currently removes/disposes it before buildBust, so a fitting error can leave the view without a complete model). Separate torso/fitting dependencies from unrelated face appearance where valid; do not blindly omit weight/muscle/neck/expression changes that do affect the fitting region. Cache topology/adjacency and smooth support fields rather than repeatedly allocating neighbor lists and running 120-150 smoothing passes per piece. Retain complete-assembly export validation.

### P2 — Finish the plate boundaries before adding small detail

`src/garments.ts:456-469,598-620`, `src/builder.ts:341-350`.

Live clay views show visibly scalloped/jagged edges at the gorget and pauldron rims on the human and Dragonborn, plus shallow dents across the plates. They read more like a rough shell than a clean hard plate. The painted cloak hides much of it; clay exposes it. Evidence is saved as audit21-human-armour.png, audit21-dragon-armour.png, and audit21-halfling-armour.png in the Codex outputs directory.

Investigate the cut-boundary representation, not just shading: grow smooths rim coordinates in base/bare, while within (the eventual inner wall) retains the original boundary; outer smoothing and relief then produce another edge. That mismatch is a candidate source of uneven walls, not a proven sole cause. Fit smooth paired inner/outer edge loops, preserve body clearance, and check for self-crossings/skin exposure. Strict closure is already passing in the tested cases; the problem here is sculpt finish, not a demonstrated open STL.

### P2 — Treat tabletop clothing detail as a separate scale target

`src/garments.ts:36-108`, `src/fit.ts`, `src/print.ts`.

The existing garment tabletop test reports the armored/cowled human at 30.6 mm bust height, torso 60%, with the cloak setting its reach. The minimum wanted is 45 mm. This is honestly reported in the preview; preserve that warning and expose the actual size prominently instead of relying on generic “about 60 mm overall” copy.

Relief constants are full-size millimeters and shrink with the fitted bust: at a scale around 0.35-0.4, a 1 mm rim is about 0.35-0.4 mm and a 0.5 mm fold about 0.18-0.2 mm. These are smaller than the raised-feature target in print.ts (0.6 mm). That is a design/physical-validation gap, not proof that they cannot print. Use tabletop-aware broad forms and a printed coupon before increasing fine detail. Do not force a 45 mm bust height by allowing the cloak/pauldrons outside the requested base footprint.

## Audit 20 follow-up confirmed

- Dragonborn fold assertions again allow zero significant reversals, including jaw opening in combined extremes and 0.1-step opening checks with neck/torso/expression variants. The suite passed; no recurrence of the 150-triangle allowance.
- Shoulder anchors are now chosen outside the measured collar; misses throw explicit errors. An additional 96-case audit covered 8 races × 3 builds × torso {0.6,1.1} × paired light/heavy weight/muscle extremes, with no missing or misordered anchors.
- castRay uses the normal matrix rather than transformDirection.
- Preparation client covers messageerror, submission failure and superseded jobs; stale preview results are checked before installation.
- Original/procedural tunic, jerkin, breastplate, gorget, pauldrons, cloak/cowl and clasps are integrated with part metadata, character save/load, paint and garment-aware grooming.

## Additional geometry review

- Raw garment closure probe: neutral elf, halfling and gnome at torso 0.6, armor+cowl. Every generated garment had zero open/shared edges after welding. This tests the former anchor problem builds, not every clothing/race combination.
- Draft grooming/garment containment probe: human and dwarf, long hair+full beard+armor+cowl. Per race, sampled 907 curtain and 1,101 beard outer vertices, excluding faded roots/inner surfaces. Ray-parity checks found none inside the garment solids. This is sampled draft-vertex containment, not a guarantee against every triangle crossing or carved-detail intersection.
- Live review: human armor+cowl in paint, human armor without cloak in clay, Dragonborn armor in clay, neutral minimum-torso halfling armor in clay. The basic silhouettes and layering work. Cloak/cowl bulk and plate-edge quality remain art-direction work.

## Validation

- Production build: passed TypeScript + Vite. Existing Manifold node:module browser-externalization and large main chunk warnings remain.
- Existing unit suite: 181/181 tests, 17 files, passed in 222.91 s; includes strict garment unions at the tested torso/family extremes.
- Additional audit probes: anchor/closure, sampled grooming containment, and repeated build timings completed. Temporary test files were removed from src; reproduction files/results are outside the repo in C:/Users/iamlo/Documents/Codex/2026-10-26/can/outputs/ (audit21-probe.ts/json, audit21-overlap.ts/json, audit21-timing.ts and audit21-timing-isolated.json). Copy a .ts probe into src to run; its imports are relative to src.
- Browser suite: running, final result appended below. Uses installed Chrome against the existing localhost:5201 dev server, with no managed test webServer, to avoid the prior server teardown stall. Temporary config will be removed.
- No slicing or physical printing. No commit/push. Source remained at db06383 throughout source review.

Final browser result: all 13 tests passed (3.2 minutes), and the runner exited normally. Temporary config removed. git diff --check passed; no production source changes.

# Audit 19: model cleanup and clothing/armor preparation

2026-11-04. Reviewed local HEAD b75eed1 on claude/sidequest1 and the live app at localhost:5201. Changes below are in the real application working tree, uncommitted. No dependencies or external assets added. No Meshy community, generated, or other Meshy assets are to be used. The existing Blender Studio CC0 base meshes remain the project's existing inputs; this pass introduces only original procedural changes.

## Model improvements applied by Codex

- `src/params.ts:198`: keep the human planes as approved; give every other humanoid a restrained, explicit planes weight in skeleton data. Elf/half-elf/tiefling also get finer, lower brows through the existing data fields. These are weighted extensions of the existing sculpt, not eight newly authored heads. Dwarf/orc retain broad jaws; halfling and gnome retain softer forms.
- `src/deform.ts:53`: read the planes weight once per head rather than per vertex.
- `src/sculptForms.ts:43`: replace high-frequency contour ripples with broader, lower-amplitude clump endings. This reduces a source of aliasing at the temples; it does not replace the head topology or completely eliminate mesh-stepped edges.
- `src/beard.ts:19`: lower the amplitude and frequency of the upper cheek contour. Keep mouth clearance, sideburn exclusion and the printable beard volume.
- `src/hairShell.ts:775`: turn long hair's elliptical section gently along its length, vary depth and add three broad lobes instead of a uniform band. The section remains bounded by the clearance width already sampled around the body. Existing unequal tips remain. This is a modest shape refinement, not a complete long-hair resculpt; the main curtain still needs more art direction.
- `src/dragonborn.ts:167`: add a small continuous muzzle finishing warp: taper the forward muzzle laterally and raise the central nasal bridge. Apply it with the same eye exclusion as face controls. It runs in both viewer and export; scale-cell data and mesh connectivity remain the source asset's. This is a finishing pass, not a replacement Dragonborn model.
- `src/dragonborn.ts:65,260`: reuse the horn rotation axis instead of allocating a Vector3 for each horn vertex.
- `src/dragonborn.test.ts:115`: replace the obsolete exact source/rest equality with checks for actual forward taper, bounded displacement, unchanged eyes/torso, and the existing control behavior. Fold and strict-merge guards remain intact.

Important source distinction: the Dragonborn binary and Blender sculpt script were not regenerated. The neutral in-app model is now the source sculpt plus the documented finishing warp. If this pass is later baked into the Blender source, remove the runtime finish at the same time to avoid applying it twice.

## Existing fixes confirmed

The earlier criticism was already addressed in current HEAD: planes/brow settings are data-driven, hair edges fade toward a scalp-root tone, the orc cheek guard uses the unshaped base rather than its own skull, carving limits depth along the normal rather than clamping coordinates, and long tresses have a rounder section. Do not redo those older patches blindly.

## Cleanup and preparation for Claude, in priority order

### P1: share a body surface and garment attachment contract before adding outfits

`src/face.ts:22,55`, `src/dragonborn.ts:177`, `src/hairShell.ts:596`.

Humanoids expose Bust positions/normals and ray helpers; Dragonborn has its own Shaped result and different torso warp. Long hair privately samples a radial body envelope. A collar/pauldron builder must not duplicate either family's deformation math or fit to a painted, transformed scene group by accident.

Expose the final unadorned body surface in one declared local frame with a stable shape key, spatial query, underside cut and named collar/shoulder/sternum anchors. Provide a family adapter for each model. Build clothing after the body, before hair/beard clearance. Use a body-only BVH or cached envelope; do not rebuild full hair, teeth and brows for garment fitting. Be explicit about normals: castRay currently returns a world-space hit point with an untransformed local face normal. Its current identity-frame callers are fine; transform normals or declare local-frame-only queries before reusing it for positioned armor.

### P1: keep print preparation responsive as geometry grows

`src/main.ts:405`, `src/fit.ts:61`, `src/export.ts:44,80`.

preparePrint and the repeated torso-fit builds still run synchronously on the page; the 30 ms timeout lets the status paint but does not move the work off-thread. Existing tests reported 8.5 s for the orc fit and 11.6 s for the dwarf fit during this run (test-process timings, not browser interaction benchmarks). A garment layer will add more work to every fit try. Move preparation/fitting to a worker, retain generation IDs for stale results, and cache body/garment fitting independently of appearance. Preserve the draft-first fit plus final detailed extent check.

For Dragonborn export, scales and horns share the full 201,881-vertex position attribute. collectBust copies that entire array for each piece before joining; it also has remapped eyes. Compact referenced vertices or export the canonical joined indexed surface once, while preserving render material regions. Never independently cap those open material-region pieces: together they are one closed surface. This is an allocation/copy issue, not a failed current STL.

### P2: register part semantics once

`src/paint.ts:659`, `src/fit.ts:34`, `src/export.ts:59`, `src/printPreview.ts:24`, `src/character.ts:9`.

Names currently select paint, fit descriptions and special export behavior in separate places. Define typed part metadata for material kind, human-readable name, joined solid identity and fitting role before adding cloth/metal/leather. Keep geometry, paint, export and saved clothing choices coordinated; old files must default to no outfit. Include outfit geometry settings in print cache invalidation without making color edits rebuild garments. Avoid one growing chain of outfit-specific name checks.

### P2: preserve the current family when randomizing

`src/ui.ts` Randomize action calls `src/params.ts:369` randomParams(), which always starts as humanoid and never rolls Dragonborn controls. On a Dragonborn it jumps families. Make the action family-aware (or name a separate random-character action) before also giving it clothing choices.

### P2: avoid a redundant Dragonborn settled rebuild

`src/main.ts:220`, `src/dragonborn.ts:177,322`.

The same draft-then-carved timer applies to both families, but Dragonborn has its scales in the asset and no separate detailed build. The shape cache saves the warp, yet the second pass still recreates groups, materials, eye normals and repaint work. Skip the second pass for families whose geometry detail is unchanged, while still scheduling token refresh correctly. Verify cache behavior rather than claiming the draft is a lower-resolution dragon.

## Size, sculpt and print constraints that armor must respect

- Default Dragonborn fits a 25 mm base at roughly 32.3 mm bust height, scale 0.355, torso about 81%. It does NOT reach the 45-55 mm target. The existing status correctly reports this; armor needs the same complete-assembly bounds. Do not promise uniform visual scale across families, shrink only the naked torso, or ignore pauldrons/capes when fitting.
- The Dragonborn still has no throat gusset; its builder reports support requirements. Thin horn/spine tips and actual slicer behavior still need physical validation. Watertight is not a guarantee of support-free or durable printing.
- Long hair still reaches over collar/shoulder space. Add a combined body+outfit clearance surface and a low-collar fallback for long beards. Do not hide clipping by moving an entire hairstyle outward.
- Start with one thick, closed low-collar tunic and one breastplate/pauldron option. Fit both families at torso extremes; then expand styles. Use geometry for hems, plate thickness and major folds; shader-only grain does not exist in STL.

## Verification

- Production build passed (TypeScript + Vite). Existing warnings: browser externalization of node:module inside Manifold, and large main chunk.
- Full Vitest suite: 155/155 passed across 12 files, including strict Dragonborn merges at default and simultaneous control extremes, fold checks, and long-hair exports.
- After the final scalp/beard contour changes: affected builder, sculptForms and paint tests passed, 82/82 across 3 files (137.55 s).
- Dragonborn browser tests: 2/2 passed using installed Chrome through a temporary config, then removed. The default Playwright attempt failed immediately before the test bodies ran; no browser download or dependency change was made.
- Live review: human, feminine half-elf with long hair, masculine dwarf with full beard, Dragonborn in clay at three-quarter; screenshot artifacts are in the Codex outputs folder. This is sample visual review, not a claim that every combination has been aesthetically approved.
- No physical print/slicer validation. No commit or push.

Final whitespace check: git diff --check passed. Seven source/test files plus this handoff are the only Effigy Engine changes. Parent .idea/.claude/CLAUDE.md/out entries predated this pass and were left alone.

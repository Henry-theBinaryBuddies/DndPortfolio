# Audit 20 — clothing readiness and Dragonborn expressions

2026-11-05. Reviewed HEAD ecd68ab on claude/sidequest1 plus the existing uncommitted Dragonborn v4/expression and bodySurface edits. No production code or model assets changed by this audit. Preserve those working changes. No Meshy assets, dependency changes, commits or pushes.

## Findings for Claude

### P1 — Do not replace the Dragonborn fold guard with an unlocalized budget

`src/dragonborn.test.ts:197-200`, `src/dragonborn.ts:285-291`, `tools/sculpt_dragonborn.py:984`.

The current working test accepts up to 150 significant reversed triangle normals when jawOpen is 1, and excludes jawOpen from the combined all-controls fold test. The comment says reversals are confined to the throat, but the assertion only counts them over the whole surface. A reversal in an eye, lip, tooth or visible cheek could now pass too. Strict union tests still run with open jaws; those passing does not establish an undistorted source surface.

Independent probe, using the same area/sliver filters and normal-dot criterion as the existing test: 138 reversals with only jawOpen=1; 134 with jawOpen=1 and the other Dragonborn/expressions at 1 (torso=1). Source-space bounds of affected vertices: x about -0.442..0.440, y -1.371..-0.262, z 0.008..0.414. This metric is an orientation comparison, not an exact triangle-intersection test. Nevertheless it reproduces the regression the old guard rejected, and its region extends over a substantial vertical band.

Fix the generated jaw weights/hinge transition or cap the supported opening until it is clean. Restore a strong guard; if any exceptions are justified, identify triangles/anatomical regions explicitly and verify genuine intersections and strict STL output separately. Test intermediate opening values and combinations with neck/torso extremes, not just endpoints. Do not increase the budget to make new failures green.

Visual review at full opening: the teeth/fangs and real mouth cavity add useful character. The lower jaw reads as a thin wedge in profile and the rear interior stretches into a broad flat surface in clay. Refine the throat/corner transition before declaring expressions complete. Evidence: audit20-dragon-open.png and audit20-dragon-open-profile.png in Codex outputs.

### P1 — Collar/shoulder anchors violate their existing ordering invariant at supported torso settings

`src/bodySurface.ts:104-140`; coverage gap in `src/bodySurface.test.ts:26-64`.

A 52-case probe covered all 8 humanoid races × 3 builds × torso {0.6,1.1}, plus Dragonborn torso/neck corners. Three cases fail the existing test's invariant that collar points lie inside the shoulder anchors:

| Race/build/torso | Collar maximum absolute x | Right shoulder x |
|---|---:|---:|
| Elf / neutral / 0.6 | 0.438390 | 0.436827 |
| Halfling / neutral / 0.6 | 0.461791 | 0.435801 |
| Gnome / neutral / 0.6 | 0.455929 | 0.425392 |

All these collar samples are on the mesh (nearest distances below 2e-16), so this is not a ray miss. The inferred neck base/ring and shoulder anchor selection conflict on slim neutral bodies. A garment using them can start its shoulder inside its collar. Resolve the anatomical selection or explicitly revise the fitting contract with a valid alternative; do not just remove the comparison. Keep the three cases as regressions. Also make near() report no candidate instead of silently returning vertex zero, and report collar-ray failure rather than emitting the axis as a valid surface point.

Reproduction after loading normal assets: bodySurface({...applyRace(defaultParams(), 'gnome'), body:'neutral', torso:0.6}, assets); compare max(abs(x)) over anchors.collar with anchors.shoulders.right.position.x. Full temporary probe and measured output are preserved outside the source tree at:

- C:/Users/iamlo/Documents/Codex/2026-10-26/can/outputs/audit20-probe.ts (copy into src to run with Vitest; relative imports target src)
- C:/Users/iamlo/Documents/Codex/2026-10-26/can/outputs/audit20-anchors.json

### P2 — Transform surface normals with the inverse transpose

`src/face.ts:61`.

transformDirection(mesh.matrixWorld) handles rotation/uniform scale, but is incorrect for nonuniform scale: a surface normal must use a Matrix3 normal matrix from matrixWorld. This is relevant before fitting scaled/posed armor. A rotated plane with a diagonal normal and unequal x/z scale gives a reproducible difference. Add that test when correcting it. Current identity-frame attachment calls are not evidence that the general helper is correct.

### P2 — Finish preparation-worker failure and stale-work handling

`src/prepareClient.ts:22-36`, `src/main.ts:415-424`, `src/ui.ts:294-312`.

The worker is a real improvement. Its client handles error but not messageerror; a synchronous postMessage failure also leaves an entry in waiting. Centralize failure cleanup for both worker fault events and synchronous submission errors. Add a worker failure/retry test so print buttons always recover.

Generation checks currently live after the preview callback has installed the returned group. Editing during a long preparation can therefore install an outdated preview before the UI callback asks to rebuild the current sculpt. Check the generation before attaching the group, and dispose/reject stale results without displaying them. A generation ID labels results but does not cancel stale fitting work. Prefer latest-request scheduling/cancellation where repeated requests occur. Browser tests currently cover tokens and family loading, not these new preparation failure/race paths.

## What improved since audit 19

Confirmed in commits: shared cached body surface and named anchors for both families; one metadata table used by paint/fit/export; family-aware Randomize; one Dragonborn build rather than draft plus settled duplicate; compact export of shared Dragonborn vertices; worker print preparation. The earlier runtime muzzle finish was baked into the original Blender sculpt and removed from the runtime, avoiding double application. Mouth corners also fade rather than continuing as a jowl slit.

The uncommitted v4 asset adds a true mouth interior, teeth, tongue, jaw weights and expressions. These are substantial improvements; the findings above address their validation and fitting boundaries. No clothing mesh is implemented yet. Keep new clothing entirely original/procedural as directed by the user.

## Validation and scope

- Production TypeScript/Vite build: passed. Existing Manifold node:module externalization and large-main-chunk warnings remain.
- Existing Vitest suite: 166/166 passed across 14 files (174.11 s). This includes the newly permissive fold guard, so the pass is not a clean-surface certificate.
- Additional audit probe: failed its collar invariant in 3 of 52 cases; recorded the jaw counts above. The temporary probe was removed from src and saved outside the repo for reproduction.
- Browser suite: running; final result appended below. Used installed Chrome through a temporary config, with no dependency/download changes.
- Live app: reviewed Dragonborn neutral/open jaw in clay and paint, profile/three-quarter, and completed worker print preview. Preview: scale about 36%, 32.4 mm bust, 50.8 mm overall, 25×25 mm, torso slimmed to 60%; warns correctly that Dragonborn has no throat gusset.
- No slicing/physical print. Do not claim 45–55 mm bust height on this base; bulky armor/capes will tighten the complete-assembly fit further.

Recommendation: keep clothing scope to one tunic/breastplate after the anchor ordering and jaw regression are resolved. The shared architecture is in place; its boundary cases are not yet ready for a garment catalogue.

Browser result: all 11 test cases reported passing using installed Chrome; runner teardown stalled after the last passing case and was interrupted. Temporary config removed. The logged failed Dragonborn fetch is the intentional failure-recovery test. No production code was changed; only this report was added by the audit.

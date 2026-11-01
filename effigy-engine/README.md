# Effigy Engine

A procedural 3D character and monster designer. Shape a grim bust with sliders, then export a printable STL (a VTT token is planned).

For now it is a sculpting tool only: everything is shown in one clay material, exactly the form that prints. Colour, paint, skin shaders and archetype presets were taken out until the sculpt is right; they are in git history (up to commit `ca8ec31`).

Stack: TypeScript, Vite, Three.js, [manifold-3d](https://github.com/elalish/manifold) (merging parts into one solid), Vitest.

```
npm install
npm run dev     # http://localhost:5201
npm test
npm run build
```

## How the bust is made

The head, neck and shoulders are a **hand-sculpted CC0 base mesh** (Blender Studio's Human Base Meshes, see `public/models/README.md`), subdivided once to about 53,000 vertices so it can carry sharp structure, so the lips, nostrils, eyelids, ears and collarbones are real anatomy. Every slider, race and build is a small, smooth **deformation of that mesh**: push the brow outward, hollow the cheek, lengthen the nose tip, scale the lips about the mouth line, widen the jaw, stretch the ears. Nothing moves right around the eyes, so the lids always fit the eyeballs. The mesh is a closed solid, so it is already printable.

Eyes, horns, tusks and hair are separate meshes. The eyeballs are fitted to their sockets so the lids rest on them; horns and tusks are sculpted assets (`tools/export_horns.py`) seated on the surface by ray casting; hair is a closed shell raised from the scalp (`src/hairShell.ts`; long hair adds a draped curtain for its hanging lengths). Beards are sculpted the same way over the lower face (`src/beard.ts`). Tusks belong to half-orcs only.

Print target: an FDM printer with a 0.2 mm nozzle (one profile, in `src/print.ts`), busts 75-90 mm tall on a turned pedestal: a round disc (at least 50 mm across, wider only when a broad bust needs it) with a sloped rim, a waisted stem, and a flare out to the bust's exact underside, 24 mm tall in all. The mesh tucks in under the shoulders, so its underside is not flat: the bust is sliced at fine heights and cut flat at the lowest plane above which the outline never grows outward faster than 45 degrees (2.5 to 4 mm up, depending on the build), so nothing hangs out over the cut. The pedestal's flare matches the section at that cut exactly and is joined to it. The flare starts as low as the bust's reach needs, so it is no steeper than about 45 degrees from vertical and prints without supports (measured on the exported files: 45.2 degrees at most). Its top stays a fraction of a millimetre inside the section, which leaves a flat step of about 0.5 mm under the bust. Surface texture has to be real geometry at that scale (grooves at least about 0.4 mm wide, ridges at least 0.6 mm), so hair and beard detail is sculpted, not shaded. The export checks the file as a slicer reads it (every edge shared by exactly two triangles) and refuses otherwise; `python tools/check-stl.py <file.stl>` re-checks any exported file independently with Trimesh. Every export also measures its wall thickness (`src/thickness.ts`: rays along locally averaged normals, so carved texture on a thick core does not read as thin) and reports the share of the surface under 0.4 and 0.6 mm: on the busts tried that is 0.1-2%, all ear rims, lips, nostrils, hair edges and tips, with no broad thin plate. These sizes are design targets: print a small detail coupon at your actual settings before relying on them.

## Layout

- `public/models/head.bin` and `feminine.bin` - the base head (57,799 vertices) with a masculine and a feminine chest sculpted from the CC0 bodies, with source and license in the README beside them
- `tools/export_head.py` - the Blender script that produced `head.bin` from the CC0 bundle (including the shoulders and chest, wrapped onto the bundle's sculpted male and female bodies)
- `tools/export_horns.py` - generates the horn and tusk assets in `public/models/horns/`
- `src/assets.ts` - loads the head, horns and tusk
- `src/hair.ts` - where on the scalp hair grows
- `src/headMesh.ts` - loads the head, moves it to the eyes' midpoint, computes normals and connectivity, and holds the measured landmarks
- `src/params.ts` - the character as one plain object: sliders, races (each with a skeleton), styles, and `derive`, which turns sliders into anatomy
- `src/deform.ts` - every slider as a regional displacement of the base head
- `src/face.ts` - the deformed bust mesh, and surface lookups by ray casting
- `src/builder.ts` - assembles the head, eyes, tusks, horns, hair and beard into a Three.js group
- `src/hairShell.ts`, `src/beard.ts` - hair and beard shells, and where a beard grows
- `src/brows.ts` - sculpted eyebrows: the brow outline, raised and carved with grooves along the hair
- `src/printable.ts`, `src/export.ts`, `src/exportWorker.ts`, `src/exportStl.ts` - the STL export: every part of the bust is baked into millimetres (Z up, mirrored parts re-wound), welded, split into its closed shells, and merged with manifold-3d in a worker into one solid; a binary STL and a report (pieces, voids, size, volume) come out. The **Export STL** button is in the panel.
- `src/jaw.ts` - opening the mouth: the lower jaw turns about its hinge, with per-vertex weights solved on the mesh itself (the head has a real hollow mouth behind the lips, so opening parts them and the surface stays closed)
- `src/teeth.ts` - an upper and a lower row of teeth with their gums, and a tongue, in the mouth's cavity (shown only when the mouth is parted); the lower row and the tongue turn with the jaw
- `src/mouthFill.ts` - with the jaw shut, the hollow behind the lips (a pocket about 13 x 16 x 9 mm whose roof is a flat ceiling over air) is filled solid: the convex hull of the pocket's own walls, grown a few percent so it joins the head. It sits inside the head and cannot be seen; it takes the mouth roof out of the overhangs and keeps supports out of a pocket nobody could reach
- `src/gusset.ts`, `src/hull.ts` - an option on the export (the "Throat gusset" checkbox, on by default; the file name gets -nogusset when it is off): a wedge under the chin that slopes back to the neck at 45 degrees, so the chin's flat underside (about 9 mm of overhang, 50-130 mm2 at 70 degrees) needs no supports. It adds 0.3-0.7 cm3 and makes the throat heavier; with it off, print with the slicer's supports under the chin instead (tree supports, overhang 55 degrees). Measured on exports: steep overhang (over 55 degrees) per bust falls from 106-225 mm2 to 54-122 mm2
- `src/locks.ts` - dreadlocks and braids: each lock a closed tube that falls under gravity and goes on falling until its tip rests on the head, neck or shoulders (a printer lays the tip first, so a tip over open air has nothing to start on), with spiral (dreads) or chevron (braids) grooves, over a close crop
- `src/carve.ts` - subdivides a hair or beard shell and cuts a groove pattern into its outer surface
- `src/beardCarve.ts`, `src/hairCarve.ts` - the patterns: broad locks with a finer groove down each, running the way the hair is combed (a moustache fan for beards; radiating from the crown for a crop; down the curtain and locks of long hair), sized for the printer
- `src/print.ts` - the print scale (mm per head unit) and the smallest groove and feature that print
- `src/ui.ts` - the control panel
- `src/main.ts` - scene, camera, lights, drag to rotate, scroll to zoom, double-click to face front

## Roadmap

1. Sculpted character model, races, gendered builds, hair and beards (done)
2. Sculpted hair and beard texture: locks and grooves sized for FDM printing
3. STL export: head, hair, beard, eyes, horns, tusks, teeth and base merged into one closed solid with manifold-3d (done: checked for being one solid and watertight). To do: a minimum-wall-thickness check, support/overhang review, an independent check with Trimesh and a slicer, and a printed detail coupon
4. Circular PNG token export
5. Colour and shading, archetype presets
6. Clothing and accessories
7. Monster body plans

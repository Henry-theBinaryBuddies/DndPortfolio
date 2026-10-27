# Effigy Engine

A procedural 3D character and monster designer. Shape a grim miniature with sliders and swatches, then export a VTT token and (planned) a printable STL.

Stack: TypeScript, Vite, Three.js, Vitest.

```
npm install
npm run dev     # http://localhost:5201
npm test
npm run build
```

## How the bust is made

The head, neck and shoulders are a **hand-sculpted CC0 base mesh** (Blender Studio's Human Base Meshes, see `public/models/README.md`), subdivided once to about 53,000 vertices so it can carry sharp structure, so the lips, nostrils, eyelids, ears and collarbones are real anatomy. Every slider, race and build is a small, smooth **deformation of that mesh**: push the brow outward, hollow the cheek, lengthen the nose tip, scale the lips about the mouth line, widen the jaw, stretch the ears. Nothing moves right around the eyes, so the lids always fit the eyeballs. The mesh is a closed solid, so it is already printable.

Shading comes from cavity (a vertex below the average of its neighbours is darkened); grime, scars, eyebrows, lips, age lines, scales and a tunic are painted on as vertex colours, positioned with landmarks measured on the real head.

Eyes (solid colour or realistic with sclera, iris, pupil and cornea), horns, tusks and hair are separate meshes seated on the surface by ray casting. Horns and tusks are sculpted assets (`tools/export_horns.py`); hair is a sculpted shell raised from the scalp with strand grooves carved by its shader (`src/hairShell.ts`; long hair adds a draped curtain for its hanging lengths). Tusks belong to half-orcs only. Scales (the Scales slider) are raised plates with grooves, drawn in the skin shader.

## Layout

- `public/models/head.bin` and `feminine.bin` - the base head (57,799 vertices) with a masculine and a feminine chest sculpted from the CC0 bodies, with source and license in the README beside them
- `tools/export_head.py` - the Blender script that produced `head.bin` from the CC0 bundle (including the shoulders and chest, wrapped onto the bundle's sculpted male and female bodies)
- `tools/export_horns.py` - generates the horn and tusk assets in `public/models/horns/`
- `src/assets.ts` - loads the head, horns and tusk
- `src/hair.ts` - combs hair clumps along the scalp
- `src/headMesh.ts` - loads the head, moves it to the eyes' midpoint, computes normals and connectivity, and holds the measured landmarks
- `src/params.ts` - the character as one plain object: sliders, races (each with a skeleton), presets, colours, and `derive`, which turns sliders into anatomy
- `src/deform.ts` - every slider as a regional displacement of the base head
- `src/face.ts` - shading, painting, and surface lookups by ray casting
- `src/builder.ts` - assembles the head, eyes, tusks, horns, stitches and pauldrons into a Three.js group
- `src/ui.ts` - the control panel
- `src/main.ts` - scene, camera, lights, drag to rotate, scroll to zoom, double-click to face front

## Roadmap

1. Sculpted character model, races, presets, gendered builds (done)
2. Circular PNG token export
3. Optional PS1-style grit filter and presets
4. STL export: standee first, then full mesh at 28-32 mm
5. Monster body plans

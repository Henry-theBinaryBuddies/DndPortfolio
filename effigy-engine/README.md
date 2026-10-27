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

The head, neck and shoulders are **sculpted with a signed distance field** (SDF): a function that says how far any point is from the surface. Anatomical shapes (skull, jaw, brow, nose, lips, eyelids, ears, neck, shoulders) are blended with smooth unions and subtractions, then a surface-nets mesher turns the field into one smooth, watertight mesh. Watertight means it is already printable. The Masculine / Neutral / Feminine toggle changes the proportions inside the sculpt itself.

Hood, hair, beard, horns, pauldrons, eyes and stitches are separate meshes placed on the sculpted surface.

## Layout

- `src/params.ts` - the character as one plain object, plus slider definitions, palettes, races, presets, randomize
- `src/sdf.ts` - distance-field shapes, smooth blending, ray casting
- `src/anatomy.ts` - the sculpt itself, with the gender-dependent proportions
- `src/mesher.ts` - surface nets: field to triangle mesh, skipping empty space for speed
- `src/face.ts` - paints the mesh (ambient occlusion, grime, scars, brows, lips, tunic) and places stitches
- `src/builder.ts` - assembles the sculpt, eyes, hood, hair, beard, horns and armour into a Three.js group
- `src/ui.ts` - the control panel
- `src/main.ts` - scene, camera, lights, draft-then-final rendering, drag to rotate, double-click to face front

## Roadmap

1. Sculpted character model, races, presets, gendered builds (done)
2. Circular PNG token export
3. Optional PS1-style grit filter and presets
4. STL export: standee first, then full mesh at 28-32 mm
5. Monster body plans

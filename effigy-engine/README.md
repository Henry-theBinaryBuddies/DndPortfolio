# Effigy Engine

A procedural 3D character and monster designer. Shape a grim miniature with sliders and swatches, then export a VTT token and (planned) a printable STL.

Stack: TypeScript, Vite, Three.js, Vitest.

```
npm install
npm run dev     # http://localhost:5201
npm test
npm run build
```

## Layout

- `src/params.ts` — the character as one plain object, plus slider definitions, palettes, defaults, randomize
- `src/builder.ts` — turns a `Params` object into a Three.js mesh group
- `src/ui.ts` — the slider and swatch panel
- `src/main.ts` — scene, camera, lights, drag-to-rotate, wiring

## Roadmap

1. Character model and slider UI (this stage)
2. Circular PNG token export
3. Optional PS1-style grit filter and presets
4. STL export: standee first, then full mesh at 28-32 mm
5. Monster body plans

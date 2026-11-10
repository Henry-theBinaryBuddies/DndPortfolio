# Adventurer Anvil

A D&D character creator in the spirit of Roll20's Charactermancer: guided steps, legal choices, a finished sheet. The first rules system is 2014 5e with SRD 5.1 content; the core is built so other systems can be added as modules.

**Status (8 Nov 2026):** Milestone 1, step 2: the empty project scaffold. See [`docs/REQUIREMENTS.md`](docs/REQUIREMENTS.md) for what it will do and [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for how it is put together.

## Run it

```
cd frontend
npm install
npm run dev     # http://localhost:5205
npm test
npm run build   # static site in frontend/dist
```

Stack: TypeScript, React, Vite, Vitest (as Creature Cauldron's frontend). A Python backend joins in `backend/` at Milestone 2.

## Layout

- `frontend/src/app/`: the app shell (React screens). Calculates nothing.
- `frontend/src/core/`: system-agnostic core. No React, no game words.
- `frontend/src/systems/dnd5e-2014/`: the 2014 rules module.
- `frontend/public/packs/`: built-in content packs, loaded as data at run time.
- `frontend/src/boundaries.test.ts`: fails if the layering rule is broken.

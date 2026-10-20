# Creature Cauldron

A 2014-rules D&D monster library and generator. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the plan.

## Status

Phase 1 (front end, no back end) is in progress. Steps 1 to 6 are done:

- The Vite + React + TypeScript app runs, and the monster schema exists as TypeScript types.
- 20 hand-written sample monsters load from static JSON. Clicking one opens its 2014-style stat block in a pop-out (with print support).
- On a desktop the app fits on one page with no scrolling: party and difficulty across the top, a horizontal filter bar, then boxes for results, the encounter and saved encounters. On phones it stacks and scrolls (phone design comes later).
- The library can be filtered and sorted. A saved party plus an easy/medium/hard/deadly pick narrows the list to monsters of that difficulty (rated as a lone monster, per the 2014 DMG).
- Monsters can be favorited and added to an encounter, which shows a live difficulty rating. The encounter card has an editable name, a star and a Save button; saved encounters (unique names) are loaded from their own box.

Monsters and encounters can be exported as JSON, and a monster as an NPC actor for Foundry VTT (D&D 5e system 5.3.3, experimental until tested in a live game). See [docs/EXPORTS.md](docs/EXPORTS.md).

The party, favorites, working encounter and saved encounters live in the browser's localStorage. There is no server and no sign-in, so they stay on one browser on one device.

The sample monsters are unvalidated (`validated: false`) until the back-end validator exists.

Run the tests with `npm test` in `frontend/`.

## Run the front end

```bash
cd frontend
npm install
npm run dev
```

`npm run build` type-checks and produces a static build in `frontend/dist`.

## Layout

- `frontend/` Vite + React + TypeScript app. The sample library is `frontend/public/data/sample-monsters.json`.
- `docs/` requirements and design notes.
- `backend/` Python API (not started).

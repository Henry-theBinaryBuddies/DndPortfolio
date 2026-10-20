# Creature Cauldron

A 2014-rules D&D monster library and generator. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the plan.

## Status

Phase 1 (front end, no back end) is in progress. Steps 1 to 5 are done:

- The Vite + React + TypeScript app runs, and the monster schema exists as TypeScript types.
- 20 hand-written sample monsters load from static JSON, and each renders as a 2014-style stat block (with print support).
- The library can be filtered and sorted. A saved party plus an easy/medium/hard/deadly pick narrows the list to monsters of that difficulty (rated as a lone monster, per the 2014 DMG).
- Monsters can be favorited and added to an encounter, which shows a live difficulty rating. Encounters can be saved and loaded by name.

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

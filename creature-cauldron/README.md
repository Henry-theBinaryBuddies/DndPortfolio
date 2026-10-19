# Creature Cauldron

A 2014-rules D&D monster library and generator. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the plan.

## Status

Phase 1 (front end, no back end) is in progress. Steps 1 to 4 are done: the Vite + React + TypeScript app runs, the monster schema exists as TypeScript types, 20 hand-written sample monsters load from static JSON, each renders as a 2014-style stat block (with print support), the library can be filtered and sorted, and a saved party plus an easy/medium/hard/deadly pick narrows the list to monsters of that difficulty (rated as a lone monster, per the 2014 DMG). The sample monsters are unvalidated (`validated: false`) until the back-end validator exists.

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

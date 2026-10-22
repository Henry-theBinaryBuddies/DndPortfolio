# Creature Cauldron

A 2014-rules D&D monster library and generator. See [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md) for the plan.

## Status

Phase 1 (front end, no back end) is in progress. Steps 1 to 7 are done:

- The Vite + React + TypeScript app runs, and the monster schema exists as TypeScript types.
- The library is 20 hand-written sample monsters, 333 monsters from the System Reference Document 5.1 and 586 from the A5E Monstrous Menagerie (each made by a back-end importer and credited with its source's exact statement, shown in the page footer and under each stat block; see `docs/A5E.md` and `LICENSES.md`). All load from static JSON, and a Source filter narrows the list. The code is MIT; the monster data is under the licences on the Licences page. Clicking one opens its 2014-style stat block in a pop-out (with print support).
- On a desktop the app fits on one page with no scrolling: party and difficulty across the top, a horizontal filter bar, then boxes for results, the encounter and saved encounters. On phones it stacks and scrolls (phone design comes later).
- The library can be filtered and sorted. A saved party plus an easy/medium/hard/deadly pick narrows the list to monsters of that difficulty (rated as a lone monster, per the 2014 DMG).
- Monsters can be favorited and added to an encounter, which shows a live difficulty rating. The encounter card has an editable name, a star and a Save button; saved encounters (unique names) are loaded from their own box.
- The Results box has a Generate button (it prompts when fewer than 3 monsters match, and summarizes what it would request), and the stat block pop-out has a Reskin panel: a one-click Reflavor (new name, description and ability names, numbers unchanged) or a Polymorph (borrow ticked features, or let the forge choose, from any other creature) or a Remix (a new damage theme, optionally damage only, a signature move from a menu of 18, or "Surprise me", each optionally with a "level up"), and a "What changed" list on the result (see `docs/REMIX.md`). With no server these show "Generator offline: the library still works." Open the page with `?generator=demo` to click through the whole flow using a stand-in that returns renamed copies of library monsters. Generated and reskinned monsters are marked unvalidated and kept in the browser.
- With a server address configured (`VITE_API_URL`, set to `http://127.0.0.1:8000` for local work in `frontend/.env.development`; the numeric address on purpose, because some browsers turn `localhost` into the IPv6 address and the service listens on the IPv4 one), the same buttons talk to the Python service: the page asks it for new monsters and reskins, shows its shared library of everything it has generated, and shows "The forge is resting, back tomorrow." when the daily allowance is used up. If the server cannot be reached, the page falls back to the built-in monsters and says so in a small note. The address is fixed when the page is built; it is never read from the page's own address.

Monsters and encounters can be exported as JSON, a monster as an NPC actor for Foundry VTT (D&D 5e system 5.3.3, confirmed working), and monsters or whole encounters as 5etools homebrew files (imported with Plutonium in Foundry, confirmed working). See [docs/EXPORTS.md](docs/EXPORTS.md).

The party, favorites, working encounter and saved encounters live in the browser's localStorage. There is no server and no sign-in, so they stay on one browser on one device.

Spellcasting is stored as data (cantrips, slots per level, at will, per day, and the intro sentence), and the stat block sentence is built from it.

The SRD monsters have passed the back-end validator (`validated: true`). The 20 samples have not been through it in the page's data (they pass it in the back end's tests).

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

## Deploying

See `docs/DEPLOYMENT.md`: the page on Cloudflare Pages, the server on a home PC behind a Cloudflare Tunnel, key safety and a launch checklist. The licences are in `LICENSES.md`.

# Scenic Sorcerer

A free map maker for tabletop role-playing games. It runs in the browser, needs no account and uses no AI. Maps are
kept in the browser and in a file you save. It is the third side quest of the portfolio (Artifact 9; Artifact 8 is kept
for Adventurer's Anvil).

It was built to answer what players say is wrong with the tools they have: exports that are only a flat picture, so the
walls and doors must be redrawn in the tabletop; hex grids that do not line up when a map is imported; maps locked to the
size they were started at; paywalls and price rises; AI art; and editors that need an internet connection.

## What it does

- **Grids:** square, flat-top hex and pointy-top hex, with full, half or no snapping.
- **Rooms:** rectangles, circles, triangles, and free shapes drawn corner by corner. Select a room and drag its round
  dots to reshape it, or its square handles to stretch it (hold Shift to keep proportions). Double-click an edge to add a
  dot, or a dot to remove it. Walls can be switched off per room, so a pond is just floor.
- **Doors and windows** snap onto walls, including curved ones, and travel with their room.
- **Floors and paint:** six floor textures painted by code, and a brush that paints them freehand.
- **Stamps:** pictures you add yourself (PNG, JPG, WebP, GIF or SVG). They are kept in the browser's IndexedDB, can be
  scattered, then moved, turned, resized, flipped, tinted and given a shadow.
- **Text** with preset looks (room name, region, sea, small note), fonts, colour, halo and letter spacing.
- **GM notes** on their own layer: room numbers that count up by themselves, traps, secret doors and notes. Switch the
  layer off to see what players will see.
- **Lights and lighting preview:** the map goes dark except where lights reach. Walls and doors stop light, windows let it
  through, and rooms without walls stop nothing.
- **Levels:** several floors in one map, with the level below shown faintly for lining rooms up.
- **Layers** to show, hide and lock each kind of thing, and unlimited undo and redo.
- **Export:** a picture (PNG, JPG or WebP, up to 8192 pixels on the longest side), a Universal VTT file (`.dd2vtt`) and a
  Foundry scene (`.json`), for any level.

## Run it

All of these run on the laptop, from this folder (`scenic-sorcerer/`). You need Node 22 or newer.

```bash
npm install
```

```bash
npm run dev
```

Then open http://localhost:5202.

```bash
npm test
```

```bash
npm run build
```

The built site is in `dist/`. `npm run preview` serves it.

## How it is organised

Everything is in `src/`. The pure logic has no screen in it, so it is tested on its own (`*.test.ts` beside each file,
144 tests with Vitest).

| File | What it holds |
| --- | --- |
| `model.ts` | The map document and its limits: rooms, doors, strokes, stamps, text, GM notes, lights, levels. |
| `grid.ts` | Square and hex geometry: cell centres, corners, which cell is under a point, snapping. |
| `rooms.ts` | Rooms, walls, doors and windows; circles, triangles; reshaping and stretching; curved-wall doors. |
| `objects.ts` | Paint strokes, stamps, text, GM notes and lights, and edits that work on any of them. |
| `levels.ts` | Several levels in one map. The editor works on one level at a time; the others are stashed. |
| `lighting.ts` | Which walls stop light, and the area a light can see. |
| `exporters.ts` | Picture sizes, and the Universal VTT and Foundry files. |
| `storage.ts` | Saving and loading, with care for damaged files. |
| `render.ts`, `textures.ts` | Drawing the map, and the floor textures. |
| `assets.ts` | The stamp library in IndexedDB. |
| `main.ts`, `exportFlow.ts` | The interface. |

A saved map is a `.scenic.json` file: the map as text, with the pictures its stamps use packed inside, so it opens on any
computer. Maps from earlier versions still open. Damaged parts of a file are skipped, not trusted.

## Known limits

- **Not yet tried in a real tabletop.** The Universal VTT and Foundry files follow the formats as documented, and their
  contents are tested, but they have not been imported into Foundry or another tabletop. Foundry changes its scene format
  between versions, so a first real import may need small fixes. Foundry hex grids use the odd-r and odd-q layouts, which
  match this editor's.
- **Desktop only.** Mouse and keyboard; no touch or pen support.
- **Doors always stop light,** because there is no open or closed state yet.
- **Text is one line,** and cannot yet follow a curve.
- **Universal VTT is made for square grids.** On a hex map, use the Foundry scene.
- **No bundled art.** The stamp library starts empty; add your own pictures.
- **Not built yet:** regional, town and hex-crawl modes, the dungeon, land and town generators, print PDF, boolean shape
  editing, a building and roof tool, prefabs, elevation, and map furniture (compass, scale bar, frame).

## Putting it online

The site is static: no server, no keys, no database. Like Effigy Engine, it goes on its own Cloudflare Pages project.

1. In the Cloudflare dashboard, open Workers & Pages, choose Create, then Pages, then Connect to Git, and pick this
   repository.
2. Use these settings:

   | Setting | Value |
   | --- | --- |
   | Project name | `scenic-sorcerer` |
   | Production branch | `master` |
   | Framework preset | None |
   | Root directory | `scenic-sorcerer` |
   | Build command | `npm ci && npm run build` |
   | Build output directory | `dist` |
   | Environment variable | `NODE_VERSION` = `22` |

3. Save and deploy. After that every push to `master` rebuilds the site.
4. Open the project, then Custom domains, then Set up a custom domain, and enter `scenic.creaturecauldron.com`. When the
   domain is on the same Cloudflare account, Cloudflare adds the DNS record itself.
5. Check it: open the site, draw a room, and export a picture.

`public/_headers` is copied into the built site, and Pages sends those headers. The page may load only its own files, plus
pictures from the user's own browser (`data:` and `blob:` addresses). It talks to nothing else, so a map never leaves the
browser. This was checked by serving the built site with the same headers and running a full session in a real browser,
with no errors in the console.

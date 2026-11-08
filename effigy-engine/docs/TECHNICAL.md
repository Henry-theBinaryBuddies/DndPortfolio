# Effigy Engine: technical document

This is the maintenance document for Effigy Engine. It says how the app is built, why it is built that way, how to run, test and change it, and what is known not to work. It is written so the project can be kept going without the session that built it. The README is the short introduction; this is the long one. The audits in this folder (`audit-19`, `audit-20`, `audit-21`) are the reviews the clothing work answered.

Status, 7 Nov 2026: **feature complete.** No new features are planned. What remains:

1. **A physical test print.** The clothing has never been printed. Its verdict decides which features stay (see section 11).
2. **Hosting.** It is a static site. It is measured for that in section 10, and the plan is in section 13.

Contents:

1. What it is
2. The system at a glance
3. Repository layout
4. The character: settings, paint and files
5. The sculpt
6. Hair, beards, brows and locks
7. Clothing
8. Paint and the token
9. The print
10. Performance
11. What prints and what does not: evidence so far
12. Running and testing it
13. Hosting (planned)
14. How to change things
15. Troubleshooting
16. Decisions and the reasons for them
17. Known limits
18. History

---

## 1. What it is

Effigy Engine is a procedural D&D character designer that runs entirely in the browser.

**You get:**

- A bust (head, neck and shoulders) shaped with sliders: nine humanoid races plus the Dragonborn as a family of its own.
- Hair, beards, horns, tusks, an open mouth and expressions.
- Clothing and armour.
- Two outputs:
  - **A printable STL**, one closed solid on a turned pedestal, at full size (75-90 mm) or tabletop size (inside a one inch square).
  - **A round PNG token** for a virtual tabletop, painted.

**How it works:**

- The sculpt is real geometry. The paint is only for the picture: the STL is always the bare form.
- There is no server. Everything is computed on the visitor's machine: sculpting, clothing fits, merging the print, the token. The site is a folder of static files.

Stack: TypeScript, Vite, Three.js (drawing), manifold-3d (merging parts into one solid, WebAssembly), three-mesh-bvh (fast ray casts and nearest-point searches), Vitest (unit tests), Playwright (browser tests). Blender 5.2.3 is used offline, by the scripts in `tools/`, to make the model files; the app never runs Blender.

## 2. The system at a glance

```
 Params (the sculpt's settings)                Paint (colours)
        │                                          │
        ▼                                          │
 sculpt ── humanoid: base head + deformations (deform.ts, jaw.ts)
        └─ Dragonborn: its own model + warps (dragonborn.ts)
        │
        ▼
 bodySurface.ts ──► garments.ts  (in fitWorker.ts, off the page; cached by body shape)
        │                 │
        ▼                 ▼
 builder.ts: body + eyes + teeth + horns/tusks + clothes + hair/beard/brows/locks  ──► a Three.js group
        │
        ├──► main.ts: draws it; Painter (paint.ts) colours it; token.ts frames a picture of it
        │
        └──► print: export.ts collects the parts in mm (prepareWorker.ts, with fit.ts at tabletop size)
                    printable.ts merges them with manifold-3d (exportWorker.ts) ──► STL + report
```

Three ideas run through everything:

- **One plain object describes the character.** `Params` is the sculpt; `Paint` is the colours. They are kept apart, so a colour change never rebuilds anything and never changes the print. The print is keyed by `Params` alone (`printKey`).
- **Everything is fitted to the form, never to the scene.** Clothes are cut from the bare body (`bodySurface.ts`), and hair and beards are grown from the scalp and face. Each knows what it covers, so the next layer (hair over clothes, cloak over armour) keeps clear of it.
- **The view and the print are the same geometry.** The STL is the very meshes on screen, baked to millimetres and merged. The print preview shows exactly the parts that will be merged.

Slow work runs off the page in Web Workers:

| Worker | Job | Typical time | Started from |
|---|---|---|---|
| `fitWorker.ts` | clothing fits | 1-2 s | `fitClient.ts` |
| `prepareWorker.ts` | collecting the print's parts, the tabletop fit | seconds | `prepareClient.ts` |
| `exportWorker.ts` | the manifold merge | about 10 s for a full bust | `exportStl.ts` |

Each request carries an id, and only the newest settings are ever built, so a slider dragged during a build is built once, for where it ended.

## 3. Repository layout

Everything lives under `effigy-engine/`.

**Root:**

| Path | What it is |
|---|---|
| `index.html`, `src/main.ts`, `src/style.css` | the page: scene, camera, lights, toolbar, panel tabs, undo/redo, the build loop |
| `src/ui.ts` | the Shape tab's controls |
| `src/paintPanel.ts` | the Appearance tab (paint) and the token section |
| `public/models/` | model files the app loads (see `public/models/README.md` for formats and licences) |
| `public/backdrops/` | token backdrop pictures and `backdrops.json` |
| `assets/dragonborn/` | the Dragonborn sculpt's README and renders (not loaded by the app) |
| `tools/` | Blender scripts that make the model files, and `check-stl.py` |
| `e2e/` | Playwright browser tests (on the dev server) |
| `perf/` | the timing run against the production build (`npm run perf`, section 10) |
| `docs/` | this document and the audits |
| `dist/` | build output (`npm run build`), not edited by hand |

**The character and the sculpt:**

| File | Role |
|---|---|
| `params.ts` | `Params`, races (each a skeleton of anatomy), styles, slider definitions and bounds, `derive()` (sliders to anatomy) |
| `character.ts` | the character file (Save/Open): JSON, format `effigy-character`, version 1 |
| `assets.ts`, `headMesh.ts` | loading the base head, horns and tusk; head-local units and landmarks |
| `site.ts` | where the site's own files are: every model and backdrop address goes through `siteUrl()` (section 16) |
| `deform.ts` | every humanoid slider as a smooth regional displacement of the base head |
| `sculptForms.ts` | shared broad humanoid forms (cheek and jaw planes, hairline and beard contours) |
| `jaw.ts` | opening the mouth: the lower jaw turns on a hinge, with weights solved on the mesh |
| `face.ts` | the deformed bust mesh, and surface lookups by ray casting |
| `dragonborn.ts` | the Dragonborn family: loading its model, its warps, jaw, horns and spines, paint data |
| `builder.ts` | assembles every part into one Three.js group, named per `parts.ts` |
| `parts.ts` | one table: each part's material, label, role, and any print treatment |

**Growth on the head:**

| File | Role |
|---|---|
| `hair.ts`, `hairShell.ts`, `shellRegion.ts` | where hair grows; the hair shell, with long hair's curtain and locks |
| `beard.ts` | where beards grow, and their shells |
| `brows.ts` | sculpted eyebrows |
| `locks.ts` | dreadlocks: tubes that fall until their tips rest on the body |
| `carve.ts`, `hairCarve.ts`, `beardCarve.ts` | subdividing a shell and carving the hair or beard groove pattern into it |
| `teeth.ts`, `tusk.ts`, `mouthFill.ts` | teeth, the half-orc's tusks, filling the mouth's hidden pocket for print |

**Clothing:**

| File | Role |
|---|---|
| `bodySurface.ts` | the bare body clothes are fitted to: frame, nearest-point search, flat cut, anchors |
| `garments.ts` | every garment: tunic, jerkin and spaulders, mail, cuirass, gorget, pauldrons, cloak, clasps |
| `fitWorker.ts`, `fitClient.ts` | the clothing fit off the page |

**Paint and the token:**

| File | Role |
|---|---|
| `paint.ts` | `Paint`, race palettes, the `Painter` (materials, the skin shader, per-part colours) |
| `token.ts` | framing the painted bust into a round token picture |

**The print:**

| File | Role |
|---|---|
| `print.ts` | the print profile: `MM` (one print millimetre in head units), minimum groove and feature, base sizes, tabletop sizes |
| `underside.ts` | where the bust is cut flat so nothing overhangs the pedestal |
| `gusset.ts`, `hull.ts` | the optional throat gusset under the chin |
| `export.ts` | collecting the parts in millimetres, Z up |
| `fit.ts` | tabletop size: scale and torso slimming to fit a one inch square |
| `bounds.ts` | how far the print reaches, as the merge will trim it |
| `printPreview.ts` | the print preview, and `printKey` |
| `prepareWorker.ts`, `prepareClient.ts` | collecting the print off the page |
| `printable.ts` | weld, split shells, merge with manifold-3d, write and read STL, edge checks |
| `thickness.ts` | wall thickness sampling |
| `exportWorker.ts`, `exportStl.ts` | the merge worker, the download, and the report text |

Tests sit beside their code as `*.test.ts` (Vitest, 182 tests). `node.d.ts` declares the one Node API the tests use, so the project does not need `@types/node`.

## 4. The character: settings, paint and files

### `Params`

`Params` (`params.ts`) is one plain object holding:

- **Choices:**
  - family: humanoid or dragonborn
  - race: human, elf, half-elf, dwarf, halfling, gnome, half-orc or tiefling
  - body: masculine, neutral or feminine
  - horn style, hair style and beard style
  - outfit: none, tunic, leather, mail or armour
  - cloak: none, cloak or cowl
- **Numeric sliders,** each defined once in `NUMERIC_DEFS` with a label, range, default and the families it applies to. The ranges are deliberately bounded (faces roughly 0.2-0.8): full ranges made bizarre faces.

`derive(params)` turns the race's skeleton plus the sliders into the anatomy the sculpt reads (head width, jaw breadth, ear size, nose bridge, angularity and so on). Choosing a race keeps your edits; **Race defaults** applies the race's own values.

### `Paint`

`Paint` (`paint.ts`) is separate. It holds the colours for:

- skin or scales, eyes and their glow, hair, horns, teeth and tusks
- cloth, leather, armour and cloak
- grime

### What triggers what

- **A change of paint** only sets material values.
- **A change of `Params`** rebuilds:
  - a quick draft first;
  - then, once the controls are still, the carved build (hair and beard grooves).
- **Undo and redo** step through `Params` and `Paint` together, and a slider drag counts as one step.
- **Nothing is persisted between visits:** reloading the page starts afresh. **Save** writes a JSON file and **Open** reads it back. Older files open in newer versions: missing fields take defaults, and old files wear no clothes.

## 5. The sculpt

### Humanoids

**The base mesh:**

- It is a hand-sculpted CC0 head and shoulders from Blender Studio's Human Base Meshes, subdivided once in Blender, with chests wrapped onto the bundle's male and female bodies (`tools/export_head.py`).
- `head.bin` is 57,799 vertices and closed. `feminine.bin` holds the same vertices with a feminine chest and face; the Build toggle blends the two.
- Everything is in **head units**: the origin is between the eyes, y is up, the face looks toward +z, and one unit is 20 cm of the sculpt.
- `MM = 1/32` head unit is one millimetre of the full-size print.

**How sliders reshape it:**

- Every slider is a smooth, regional displacement of that mesh (`deform.ts`), so the base sculpt's real lips, nostrils, eyelids and ears are kept.
- Nothing moves right around the eyes, so the lids always fit the eyeballs.
- The eyeballs are fitted to their sockets.
- The head has a real hollow mouth, so **Jaw open** turns the lower jaw on a hinge (`jaw.ts`), which glides as it opens and has weights solved over the mesh.
- Teeth and a tongue sit in the cavity.

**Safety checks:**

- Every slider is tested at its extremes for folded triangles (a face normal turning over compared with the rest pose). That is how the jaw-into-neck collision was found and fixed.

### The Dragonborn

The human head could not be pushed into a convincing Dragonborn: that was tried and abandoned. So it is a separate model:

- `tools/sculpt_dragonborn.py` builds it in Blender from a signed distance field, with the scales cut as relief and the chest taken from `head.bin`.
- It writes `public/models/dragonborn.bin` (11.3 MB, about 5.4 MB gzipped) and `dragonborn.json`.
- The file also carries a coarser copy of the skin, which clothing is fitted to: its skin is about 330,000 triangles, and a tunic fitted to it was too heavy to merge.
- It is loaded only the first time the Dragonborn is chosen. If that fails, the app goes back to the humanoid and says why.
- Its sliders are smooth warps of its own sculpt: muzzle, jaw, brow plates, neck, horns, spines, plus Torso size and the expressions.
- Horns and spines move with the skin they grow from.

## 6. Hair, beards, brows and locks

These rules come from the first print: any texture that is to print has to be geometry, and detail is sized in print millimetres.

**Hair** (`hairShell.ts`):

- A closed shell raised from the scalp, its thickness profiled per style. Long hair adds a hanging curtain and side tresses.
- The hairline tapers under the skin, so it blends.

**Beards** (`beard.ts`) are shells grown the same way over the lower face, kept off the lips and ears.

**Brows** (`brows.ts`) are a low raised form with V-grooves along the hair.

**Carving** (`carve.ts`):

- Subdivides a shell twice and cuts a groove pattern into its outside.
- Patterns:
  - hair: locks about 2.4 mm apart with a 0.6 mm groove;
  - beard: locks about 2 mm apart with a 0.5 mm groove and a fine groove in each.
- The carving is cached per head and style, because it is the heaviest part of a build.

**Dreadlocks** (`locks.ts`):

- Each lock is a closed tube that falls under gravity and keeps falling until its tip rests on the body.
- The first print showed tips over open air turn to spaghetti, because a printer lays the tip first.

## 7. Clothing

All of this is in `garments.ts`, fitted to `bodySurface.ts`.

### How a garment is grown

1. Each garment is a piece of the body's own surface, cut exactly along a line drawn on it (the `edge` field): a neckline, a plate edge, a round over a shoulder.
2. The cut is smoothed along itself, so edges run clean.
3. It is stood off the body by a clearance (`thickness`). That clearance is kept from a smoothed copy of what is under it (`ground`), so cloth drapes over broad forms and plate hides even a Dragonborn's scales. It is then checked against the real body and pushed off wherever it would touch.
4. Relief is raised along the body's evened-out normals: collars, folds, ridges, plate steps, seams.
5. The outside, an inside just within the body, and a wall round the edge are closed into a solid that merges with the bust.

### The outfits

- **Tunic:** a rolled collar and soft folds.
- **Leather:** a jerkin with a V, seam welts and a baldric, plus a spaulder on each shoulder in three bands.
- **Mail:** a mail shirt with modelled rings. The mail's outside alone is subdivided to 16 triangles for each one of the body's (`Piece.fine`, `finely()`), because the body's triangles are far too large for rings.
- **Armour:** a cuirass with a ridge and rolled rim, a gorget in three lames, and pauldrons in three plates.
- **Cloak or cowl:** goes on last, over everything worn, with a rolled hem, folds down the back, an optional cowl, and two turned clasps.

### Fitting off the page

- Fits run in a worker.
- **Caching:** a fit is kept by the shape of the body wherever a garment can reach (`fitKey`), not by the settings. An edit of the face puts the same clothes back on at once, while weight, muscle, torso, jaw and neck fit them anew.
- **Layering:** the hair and beard are built over the clothes. Long hair hangs over armour, and a full beard lowers the collar.

### What the tests check

- Every outfit prints as one closed solid, for both families, at both ends of Torso size.
- Every garment stands off the body (the nearest point more than 0.2 mm off, and 95% of points more than 1 mm).
- Nothing shows through the cloak except at its very edge (under 0.6%).
- Fits are cached by shape.

**Relief sizes** (full-size millimetres; constants at the top of `garments.ts`):

| Relief | Height |
|---|---|
| tunic folds | 0.5 |
| clasp rims | 0.5 |
| jerkin and spaulder welts | 0.7 |
| mail rings | 0.7 (wire 0.3, about 2 mm apart) |
| gorget lames | 0.7 |
| gorget rim | 0.8 |
| pauldron rim and steps | 0.9 |
| spaulder bands | 0.9 |
| mail binding | 1.0 |
| cuirass rim | 1.0 |
| cloak hem | 1.0 |
| tunic collar roll | 1.2 |
| cuirass ridge | 1.4 |

`finestRelief()` names the smallest one for the tabletop note. Whether these read on a printer is the open question of section 11.

## 8. Paint and the token

### Painting

- **The `Painter`** (`paint.ts`) owns the materials. Each mesh is painted by its part's material kind (`parts.ts`).
- **The skin** is a shader:
  - a per-pixel height field for pores, furrows and age creases;
  - per-vertex weights worked out per bust: hollows, flush, lips, stubble, scalp, grime.
- **Hair** is darker down its grooves.
- **The Dragonborn** has per-scale tones and a pale underside.
- **Clay** in the toolbar shows the bare form.

### The token

**Save token PNG** (`token.ts`) draws the painted bust at three-quarter view into a round frame with an iron rim, transparent outside, at 256, 512 or 1024 px.

**Framing:**

- **Whole head and horns** fits everything above the chin.
- **Close portrait** frames the face larger.
- The token's camera is fitted once per bust and framing.
- The shoulders always run on under the lower rim, so no cut edge shows.

**Backdrops** come from `public/backdrops/`, listed in `backdrops.json`. They are AI-generated images; their record is in `CREDITS.md` there.

## 9. The print

### The pipeline (`export.ts`, `printable.ts`)

1. **Collect.** Every part is collected in millimetres with Z up. Mirrored parts are re-wound, and the eyes are grown 7% so they join the head.
2. **Weld and split.** Each part is welded and split into closed shells. A shell that is not closed is reported and left out: it is not guessed at.
3. **Merge.** manifold-3d unions everything with the pedestal and cuts at the flat cut.
4. **Clean up.** Specks are dropped. Surfaces that touch only along an edge are moved 3 microns apart, so every edge of the file is shared by exactly two triangles, as a slicer reads it.
5. **Check and refuse.** A bust that is not exactly one solid is refused, unless the diagnostic **partial** export is used.

**The report** gives:

- size, volume, triangles;
- separate pieces, voids, specks;
- the wall thickness shares under 0.4 and 0.6 mm (`thickness.ts`);
- any parts left out.

`python tools/check-stl.py file.stl` re-checks a file independently with Trimesh. It needs `pip install trimesh numpy` in a virtual environment.

### Shape for printing without supports

- **Pedestal** (`builder.ts`, `underside.ts`): 34 mm tall, at least 50 mm across. It is turned, and every surface narrows going up or widens no faster than 45 degrees.
- **Flat cut:** the bust is cut flat at the lowest height above which its outline never grows faster than 45 degrees, so nothing hangs past the pedestal.
- **Throat gusset** (`gusset.ts`, on by default): a 45-degree wedge under the chin.
- **Mouth fill** (`mouthFill.ts`): fills the hidden mouth pocket, whose roof would otherwise be a 15 mm bridge. With the jaw open it leaves a recess, so the mouth still reads as open.

### Tabletop size (`fit.ts`)

- The whole bust fits inside a 25.4 mm square, on a 25 mm, 18 mm tall base.
- The bust is scaled as large as the square allows, and the torso is slimmed only as far as that needs, never below 60%.
- Results: humans come out 31-46 mm tall depending on clothes, and Dragonborn 25-32 mm.
- All relief shrinks with the scale, and the export's note names the finest relief that falls below 0.6 mm.

**Preview print** shows exactly the parts that will be merged.

### The print profile, and a mismatch to know about

`print.ts` declares a 0.2 mm nozzle, and the carving and relief were sized for it:

- grooves at least 0.4 mm wide;
- ridges at least 0.6 mm.

The printer actually used is an Ender 3 v1 with a **0.4 mm nozzle** (the November gcode: 0.2 mm layers, 0.8 mm walls, raft, no supports, 200/60 °C). At 0.4 mm, a raised feature needs roughly 1.2 mm and a groove 0.8 mm to read reliably. Section 11 is about exactly this.

## 10. Performance

Measured 7 Nov 2026 with `npm run perf` (`perf/perf.spec.ts`), which builds the site, serves the production build with `vite preview`, and drives it in Chromium.

**The machine:** the development laptop, Windows 11 with integrated Intel UHD graphics, which is a modest machine, not a fast one.

**"Slowed"** means two things together:

- the page's CPU throttled 4×, to stand in for a slow laptop, tablet or phone;
- the network throttled to 20 Mbps down with 40 ms latency.

Chromium's CPU throttling does not reach the workers, so the clothing fits and the export in the slowed column run at full speed; on a really slower machine they would be slower too.

| What the visitor waits for | This laptop | Slowed |
|---|---|---|
| First bust on screen, from opening the page | 3.0 s | 9.8 s |
| First carved bust (hair grooves) | 4.7 s | 16.7 s |
| One step of a face slider (draft rebuild, human) | 0.65-1.2 s | 6.6-11 s |
| Carved rebuild once the slider is still (human) | 0.8 s | 5.4 s |
| Change of outfit, human, choosing to carved bust | 2.3-3.6 s (fit 0.8-1.3 s) | 7.8-9.6 s |
| First Dragonborn (loads its 11 MB model) | 1.3 s | 9.6 s |
| Change of outfit, Dragonborn | 2.7-3.1 s (fit 2.2 s) | 3.3-4.6 s |
| Export STL, full size, Dragonborn in armour and a cloak | 10 s | 15 s |

**Drawing** was timed separately, on this laptop's integrated Intel GPU, in the in-app browser: the scene drawn 30 times, waiting for the GPU each time. It is not the bottleneck:

| Bust | Triangles drawn | Time per frame |
|---|---|---|
| human, bare | 533k | 10.5 ms (about 95 fps) |
| human, armour and cowl | 649k | 12.0 ms |
| human, mail and cowl | 877k | 12.6 ms |
| Dragonborn, bare | 422k | 6.9 ms |
| Dragonborn, armour and cloak | 617k | 8.7 ms |
| Dragonborn, mail and cloak | 1,011k | 8.6 ms |

A headless browser's own frame rates were unreliable (its GPU reported shader errors), so they are not used.

### What the visitor downloads

| File | Raw | Gzipped |
|---|---|---|
| app script (`index-*.js`) | 0.77 MB | 0.21 MB |
| workers (fit, prepare, export) | 0.71 MB | (not measured) |
| manifold WebAssembly | 0.54 MB | 0.21 MB |
| `head.bin` | 2.1 MB | 1.2 MB |
| `feminine.bin` | 0.7 MB | 0.6 MB |
| horns and tusk | 0.4 MB | 0.2 MB |
| `dragonborn.bin` (only when chosen) | 11.3 MB | 5.4 MB |
| backdrops, 10 PNGs, each about 2 MB (one at a time, only when it is chosen) | 19.5 MB in all | (PNG, already compressed) |

### What it means for hosting

- **Hosting itself is no obstacle.** The page is about 4 MB on first load (about 2.2 MB compressed; the export's WebAssembly and the workers come later, when first used), the Dragonborn 11 MB more, and drawing is fast even on integrated graphics.
- **On an ordinary laptop it is usable,** with lag:
  - it opens in 3-5 s;
  - a slider step takes about 0.7 s;
  - a change of clothes takes 2-4 s, with the old bust staying on screen meanwhile;
  - an export takes about 10 s.
- **On a machine four times slower** (an older laptop, a tablet, most phones) it opens in about 10-17 s, and **dragging a face slider becomes unusable**, at 6-11 s per step.
- **The bottleneck is the humanoid draft rebuild on the page's own thread**, about 0.7 s here. It deforms the 58k-vertex head and regrows hair, brows and beard on every step. The Dragonborn's rebuilds take 0.1-0.4 s, and the clothing already runs in a worker.
- **What would make slow machines usable:** moving the draft rebuild into a worker, or making it cheaper. That is an optimisation project of its own, not done. Until then, the honest description is "desktop or laptop recommended".
- **The production build is now checked:** `npm run perf` fails if the export from the built site fails. Run it before every deploy (see section 15).

## 11. What prints and what does not: evidence so far

**Printed (Oct-Nov 2026, Ender 3 v1, 0.4 mm nozzle, 0.2 mm layers, black PLA):** a dwarf with dreadlocks and an open mouth, full size, about 5 hours. Photos are in `Test Photos/`. The print showed:

- **Read clearly:**
  - the dreadlocks' spiral grooves (about 2 mm pitch, 0.5 mm deep);
  - the broad forms of the face, the brow, the nose, the open mouth;
  - the pedestal.
- **Barely read:**
  - the beard's carved grooves;
  - the finer modelling round the eyes and mouth, which the layer lines and glossy filament swallow.
- **Failed and fixed since:**
  - dreadlock tips over open air became spaghetti; locks now land;
  - the open mouth's roof sagged; the mouth fill now handles it.

**Not printed yet:** any clothing, the cloak, the Dragonborn, horns, tusks, and tabletop size.

**The test print of 7 Nov 2026** is `out/effigy-test-human-mail-cowl.stl` (outside the project folder, not in git):

- **What it is:** a full-size human in mail with a cowl. 76 × 57 × 119 mm including the 34 mm base, 161 cm³, one closed solid, 0 bad edges.
- **What it tests:**
  - the mail's rings and binding;
  - the tunic's rolled collar (1.2 mm);
  - the cloak, its cowl, hem (1.0 mm) and overhangs;
  - the clasps' 0.5 mm rims.
- **Why one bust is enough:** those features cover the 0.5-1.2 mm range that the leather and armour relief also fall in, so its result stands for them too.
- **Overhang check before printing:** every place a layer would start over air was checked, and nothing on the clothing starts in mid-air for more than 0.6 mm. The only islands are at the eyes and nose (1.4-2.5 mm tall), as on the dwarf that printed.

**Rule agreed for the verdict:** a feature that does not communicate on a PLA FDM print is deprecated entirely. If the rings do not read as mail, the Mail outfit goes. Record the result here when the print is in.

**Known print risks, not yet fixed.** The exports were checked for every place a layer would start over open air (a local lowest point of the surface; how far it rises before it meets the rest says how long the printer builds it in mid-air). Two horn shapes fail:

- **The ram horns** (humanoid): each tip starts **about 11 mm** in mid-air.
- **The Dragonborn's horns:** each tip starts **about 23 mm** in mid-air. The 1:12 test STL in `assets/dragonborn/` also notes its horn tips and spine points are too thin, and the Dragonborn has no throat gusset (its export says so).

This is the same failure as the first print's dreadlock tips, so these busts need the slicer's supports under the horn tips, or a fix such as a small breakaway tie from each tip to the body. Under the rule above, they are candidates for removal if neither is acceptable.

Every other horn style (goat, bull, demon, antelope, stubby), the tusks, and every outfit and cloak checked have nothing that starts more than about 2.5 mm in mid-air. The only small islands are at the eyes and nose.

## 12. Running and testing it

From `effigy-engine/`:

```
npm install
npm run dev            # http://localhost:5201
npm test               # Vitest, about 3-4 minutes (the clothing and print tests are slow)
npm run test:browser   # Playwright (first: npx playwright install chromium)
npm run build          # type-check, then build to dist/
npm run preview        # serve dist/ as production would
npm run perf           # build, then time the built site in Chromium and export from it (section 10)
```

`npm run perf` takes about a minute. With `CPU=4 NET=1` before it, it times a slowed machine on a 20 Mbps connection. Its numbers go to `test-results/perf-cpu*.json`. It is the only test that runs the **production build**, so run it before every deploy. The dev server hides problems that only the build has (section 15).

**Browser tests:**

- They start their own dev server on port 5203.
- They draw WebGL in software (SwiftShader), so they are slow but the same on every machine.

**The dev hook:** in development, `window.effigy` exposes:

- the scene;
- the renderer;
- `render({yaw, distance})`, which returns a JPEG data URL of the view, useful for scripted screenshots.

It is not in the production build.

**Timing:** each build is timed as a User Timing measure. Read them with `performance.getEntriesByType("measure")` in the console:

- `effigy:draft build`
- `effigy:carved build`
- `effigy:edit to draft`
- `effigy:fit clothes`
- `effigy:token fit`
- `effigy:token`

**Remaking the model files** (Blender 5.2.3; paths to the CC0 bundle are in the scripts):

```
blender -b --factory-startup --python tools/export_head.py
blender -b --factory-startup --python tools/export_horns.py
blender -b --factory-startup --python tools/sculpt_dragonborn.py -- assets/dragonborn --app public/models
```

Commits run the full suite first (the repository's rule). The browser tests are run when the token or page behaviour changes.

## 13. Hosting (planned)

It is a static site: `npm run build` writes `dist/`, and any static host serves it. No server, no keys, no database, no running cost beyond bandwidth. The natural choice is Cloudflare Pages, like Creature Cauldron's front end.

**Things the host must do:**

- **Serve `.wasm` as `application/wasm`.** Cloudflare Pages does.
- **Compress `.bin` files.** Cloudflare compresses by content type, and `application/octet-stream` is not compressed by default. So either:
  - serve the model files gzip- or brotli-encoded (a `_headers` rule, or pre-compressed copies); or
  - accept the raw sizes: about 3 MB at first load, plus 11 MB for the Dragonborn.

  Compression roughly halves them.
- **Cache models long.** They change only when remade, so they can be cached long-term. The scripts already have content hashes in their names.
- **Mind the file size limit.** Pages allows files up to 25 MiB; the largest is 11.3 MB.

**Not decided yet:**

- the domain;
- whether the backdrops ship as PNG (19.5 MB) or are converted to WebP or JPEG.

**Before each deploy:**

1. `npm test`
2. `npm run perf`, which builds the site and checks that the built site exports
3. Upload `dist/`

The plan is to deploy after the test print is reviewed. Record the deployment steps here when it is done.

## 14. How to change things

**A slider:**

1. Add it to `NUMERIC_DEFS` in `params.ts`: key, label, range, default, families.
2. Read it in `derive()` or `deform.ts`, or in `dragonborn.ts` for the Dragonborn.
3. If it moves the body under clothes, nothing else is needed: `fitKey` reads the shape itself.
4. Add the extremes to the fold tests in `builder.test.ts`.

**A race:** add an entry to the race table in `params.ts` with its skeleton, default horn and hair styles, and default slider values, and give it a palette in `paint.ts`.

**A horn style:**

1. Add the shape to `tools/export_horns.py` and run it.
2. Add the name to `HORN_STYLES` and `SHAPE_NAMES`.
3. Before calling it printable, check its tip does not hang below its root (section 17).

**A garment:**

1. Add its constants and an edge, clearance and relief in `fit()` in `garments.ts`, following the existing pieces.
2. Name its part in `parts.ts`, with its material.
3. Add it to `finestRelief()`.
4. Add it to the outfit lists in `garments.test.ts` (names, clearance, print, cloak).
5. Keep its relief at 1.2 mm or more if it is to read on a 0.4 mm nozzle (section 11).

**The print profile:** change `print.ts`. Carving and relief read `MM`, `MIN_GROOVE` and `MIN_FEATURE`, but the relief constants in `garments.ts` and the carving patterns are in millimetres and would need resizing by hand.

## 15. Troubleshooting

| Symptom | Likely cause | What to do |
|---|---|---|
| Export says "N separate pieces" or refuses | a part is not closed, or touches the bust at only a point | use the diagnostic partial export; its report names the part and why |
| Export reports bad edges | surfaces meeting exactly along a line | they should be separated automatically; if not, the report's numbers locate it; check with `tools/check-stl.py` |
| "Fitting the clothes" stays up | the worker failed; the page falls back to fitting on the page | check the console; a fit that fails on the page too leaves the last bust shown |
| Dragonborn does not appear | `dragonborn.bin` failed to load (slow or blocked network) | the panel says so; reload, or check the file is served |
| The page is slow with the Dragonborn in mail | about 950k triangles drawn | expected (section 10); choose another outfit |
| Screenshots in the dev browser pane are stale | the pane is hidden, so animation frames stop | use `window.effigy.render()` |
| A slider edit makes a bust with folded triangles | a deformation pushed too far | the fold tests in `builder.test.ts` catch this; narrow the range or fade the displacement |
| Works in `npm run dev` but not on the built site (`npm run preview`, or once hosted) | the build's base is `./`, so its file addresses are relative; anything that resolves them somewhere other than the page goes wrong | load files through `siteUrl()` (`site.ts`), and tell a worker the page's address, as `prepareClient.ts` does; `npm run perf` catches it |
| Export fails at once with "Invalid typed array length: 5606499252" | that bug: a worker fetched the head model from `assets/models/` and was served the page; `1868833084`, a third of it, is "<!do" read as a vertex count. Fixed 7 Nov 2026 | if it comes back, check every `fetch` goes through `siteUrl()` |
| Unit tests time out | the clothing and print tests take minutes | run one file: `npx vitest run src/garments.test.ts` |

## 16. Decisions and the reasons for them

- **Sculpt from a CC0 base mesh, not primitives.** A signed-distance-field sculpt from primitives could not reach a believable face; deforming a hand-sculpted head keeps real anatomy.
- **The Dragonborn is its own model.** Pushing the human head that far looked wrong.
- **Detail is geometry, never shading, wherever it should print.** Shader detail does not print. Hair, beards and brows are carved shells, not strands, which were bushy and unprintable.
- **Clothes are fitted to the bare body, in a worker, cached by shape.** Fitting to the painted scene broke when anything else changed. Fitting on the page froze it for seconds. Caching by settings refitted on every face edit.
- **One closed solid, or refuse.** A slicer treats a broken file unpredictably, so the export does not guess or repair.
- **Paint never touches the print.** The print key is the sculpt only, so a colour change is free.
- **No supports by design.** The pedestal, flat cut, gusset, mouth fill and landing locks exist so a bust prints without supports, which scar the surface.
- **The build's base is `./`** (`vite.config.ts`), so the built site works from any folder of any host without rebuilding. The cost is that every file address is relative, so all of them go through `site.ts`, which resolves them against the page, in workers too.
- **Deprecate what does not print.** Agreed 7 Nov 2026: a feature that cannot communicate on a PLA FDM print is removed, not kept as screen-only.

## 17. Known limits

**Print:**

- **Untested features.** Clothing relief, the cloak, horns, the Dragonborn and tabletop size are unprinted. The relief was sized for a 0.2 mm nozzle; the printer has a 0.4 mm one.
- **Horn tips that start in mid-air:** the ram horns (about 11 mm) and the Dragonborn's (about 23 mm). See section 11.
- **The Dragonborn has no throat gusset:** its chin and muzzle need supports.
- **Tabletop size:** almost all carved and clothing relief falls below what prints.

**Performance:**

- **The heaviest outfit.** The Dragonborn in mail draws about 950k triangles, and the mail fit takes 1-2 s.

**Clothing looks:**

- The relief barely shows on screen: the body's fitting mesh is coarse, and the lighting is soft.
- The Dragonborn's breastplate and jerkin are uneven at the back corner of each arm, and its cloak over armour is faintly pitted.
- The mail's binding is metal-coloured, because each piece has one material.
- The ring pattern blurs a little on the tops of the shoulders.

**App:**

- Nothing is saved between visits except by **Save**.

## 18. History

- **26 Oct 2026:** started as a procedural figure. It became a bust only, then a CC0 base mesh with deformations, then sculpt-only.
- **27-28 Oct:**
  - hair, beards and brows as carved shells;
  - jaw, teeth, tusks and expressions;
  - STL export with manifold-3d;
  - wall thickness check.
- **30 Oct-2 Nov:**
  - overhang work (flat cut, gusset, mouth fill);
  - the first prints (the dwarf);
  - landing dreadlocks;
  - tabletop size;
  - procedural tusks.
- **3-4 Nov:**
  - paint and the token, with backdrops;
  - the Dragonborn as its own family.
- **5-7 Nov:**
  - clothing (tunic, armour, cloak, leather and spaulders, mail), with audits 19-21;
  - fits moved to a worker;
  - declared feature complete.

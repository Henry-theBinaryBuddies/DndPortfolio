# Dragonborn sculpt (milestone 1)

A fixed, neutral, closed-mouth Dragonborn bust, made to see whether the Dragonborn reads convincingly in plain clay before the app was built around it. Since milestone 2 the app loads it too, as the Dragonborn family (`src/dragonborn.ts`), from a lighter copy in `public/models`:

```
blender -b --factory-startup --python tools/sculpt_dragonborn.py -- assets/dragonborn --app public/models
```

That copy has no plinth (the app stands it on its own pedestal), a fifth of the triangles, and marks which triangles are horn, spine and crest and which are eye, so the paint can colour them, and which vertices are on which horn, spine or crest, so the shape controls can move them, and each scale's own tone and how pale the underside is, for the paint and its mouth: the teeth and the inside of the mouth for the paint, and how far each vertex turns with the lower jaw; and a coarser copy of the skin (a fifth of its triangles, each of its vertices one of the model's) that clothing is fitted to (model version 5; the file format is described in the script).

**Source:** `tools/sculpt_dragonborn.py`. Every form is written down there as numbers (a signed distance field for the head and neck, the scales cut as relief), so this folder holds only its renders. The chest and shoulders come from the human bust the app already ships (`public/models/head.bin`, from Blender Studio's CC0 Human Base Meshes; see `public/models/README.md`). Everything else is original to this project.

**Rebuild** (Blender 5.2.3, about a minute; the first run also spends a minute or two working out the chest's field, then keeps it in the output folder):

```
blender -b --factory-startup --python tools/sculpt_dragonborn.py -- assets/dragonborn --renders
```

This writes `dragonborn.blend` (open it in Blender to look around or sculpt by hand), `dragonborn_test.stl`, and the two renders. The `.blend`, the STL and the cached chest field are large and regenerated, so git ignores them.

## Revision of 16 Nov 2026

A second pass over the sculpt, all in the script:

- **Eyes:** an upper and a lower lid over each eyeball. The upper one comes down lower toward the nose, so the eye scowls instead of staring like a marble.
- **Muzzle:** lower and narrower toward the tip, with crisper edges, a faint ridge from each brow to its nostril, and a bony plate between the brows that runs down onto the bridge. The nostrils swell out to each side of the tip and open sideways.
- **Brow:** three short swept-back horns along each brow ridge, left smooth (too small to carry scales).
- **Jaw:** a swelling over each fang's root and an edge along the lower jaw back to its angle.
- **Crest:** the four fins over the crown are longer and swept back.
- **Scales:** a row of squarish scales along each lip, the lower row set half a scale along from the upper; larger shields on top of the muzzle; a ring of fine scales round each eye.

**The mouth, revised 17 Nov 2026.** A predator's teeth, of mixed sizes and curving back toward their tips, in place of the even rows: large and small in turn down the upper jaw, the lower teeth standing between them, a pair across the front of the lower jaw, and outside the lips the great fang with a smaller one behind and before it, and two more across the tip of the muzzle, so several show with the mouth shut. Gum ridges along both jaws for the teeth to grow from, and a longer, tapered tongue with a groove down its middle. What belongs to the upper jaw and what to the lower is kept 2 mm apart with the mouth shut, or the grid joins them. The teeth and tongue are left out of the smoothing of the jaw's weights, since the still fangs slowed the jaw's skin beside them and it folded as it opened. The decimation for the app also evens out the long thin triangles along the foot of the bust, which folded when the torso was slimmed.

The eyes, the line of the lips, the mouth, the jaw's hinge, the brow plate and the roots of the horns and spines are where they were, because the app's shape controls and expressions are placed by them (`src/dragonborn.ts`).

## Renders

- `dragonborn_turnaround.png`: front, three-quarter, profile and rear, in clay (Blender Workbench with cavity shading).
- `dragonborn_face.png`: the head close up, front, three-quarter and profile.

## Test STL

The STL is the bust on a plain round plinth, at about 1:12 (36.6 x 38.7 x 51.1 mm), 2.32 million triangles. The latest build (17 Nov 2026) has no edge used by other than two triangles, but **2 pairs of triangles cross** where a scale groove falls on the sharp back corner of the right shoulder, at the flat side cut. The scales are laid out at random from the mesh's vertices, so any change to the sculpt moves them, and this corner catches one now and then; the build of 16 Nov had none. It concerns only this test STL: the app's print merges the bust into one solid with Manifold, and its export check passes.

The independent Trimesh check (`tools/check-stl.py`) was last run on the build before it (watertight, consistently wound, a true volume, one body, 19.0 cm³) and has not been run again on this one.

Not checked: slicing and printing. Printing is on hold until a better printer. The horn tips and spine points are thin at this scale (about 0.4 mm and 0.2 mm across), so they would need thickening before a real print.

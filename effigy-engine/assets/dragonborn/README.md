# Dragonborn sculpt (milestone 1)

A fixed, neutral, closed-mouth Dragonborn bust, made to see whether the Dragonborn reads convincingly in plain clay before the app is built around it. The app does not load it yet: that is milestone 2 of the Dragonborn plan.

**Source:** `tools/sculpt_dragonborn.py`. Every form is written down there as numbers (a signed distance field for the head and neck, the scales cut as relief), so this folder holds only its renders. The chest and shoulders come from the human bust the app already ships (`public/models/head.bin`, from Blender Studio's CC0 Human Base Meshes; see `public/models/README.md`). Everything else is original to this project.

**Rebuild** (Blender 5.2.3, about a minute; the first run also spends a minute or two working out the chest's field, then keeps it in the output folder):

```
blender -b --factory-startup --python tools/sculpt_dragonborn.py -- assets/dragonborn --renders
```

This writes `dragonborn.blend` (open it in Blender to look around or sculpt by hand), `dragonborn_test.stl`, and the two renders. The `.blend`, the STL and the cached chest field are large and regenerated, so git ignores them.

## Renders

- `dragonborn_turnaround.png`: front, three-quarter, profile and rear, in clay (Blender Workbench with cavity shading).
- `dragonborn_face.png`: the head close up, front, three-quarter and profile.

## Test STL

The STL is the bust on a plain round plinth, at about 1:12 (36.5 x 42.4 x 51.1 mm), 2.25 million triangles. The latest build passed:

- the script's own check: no edge used by other than two triangles, no triangles passing through each other (each pair the bounding test reports is tested exactly);
- the independent Trimesh check (`tools/check-stl.py`): watertight, consistently wound, a true volume, one body (18.9 cm³).

Not checked: slicing and printing. Printing is on hold until a better printer. The horn tips and spine points are thin at this scale (about 0.4 mm and 0.2 mm across), so they would need thickening before a real print.

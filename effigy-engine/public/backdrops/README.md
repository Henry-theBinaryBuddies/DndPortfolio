# Token backdrops

Background images for the PNG token (the picture behind the painted bust, inside the round rim). Codex places them
here; the app does not use them yet (the token draws a plain dark glow, see `src/token.ts`), so this folder is where
a backdrop picker will read them from.

What works best:

- **Square**, at least **1024 x 1024 px** (the largest token size), PNG or JPG. Anything else is cropped to the
  middle square.
- **Dark and quiet in the middle**, where the head and shoulders go: the bust has to stand out against it. Detail
  and light toward the edges (a stone wall, a forest, a dungeon, fog, embers) reads well; a busy middle does not.
- The rim covers the outer ~7% of the width, and the corners outside the circle are cut away (transparent), so
  nothing important should sit near the edge or in the corners.
- Grim and dark in mood, matching the app (no bright or cute scenes).
- A short, lowercase file name that says what it is: `dungeon-stone.jpg`, `misty-forest.png`, `ember-glow.jpg`.
  The name is shown as the backdrop's label.
- Only images we are free to use (made for this project, or with a licence that allows it). Note the source in
  `CREDITS.md` here if it is not original.

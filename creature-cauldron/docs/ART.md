# The witch picture

The banner at the top right of the page (shown when the window is at least 1100 pixels wide) can be a painted picture. The
current one is `witch.webp` (about 400 KB). If the file is ever missing, the page shows a small drawn witch instead, so
nothing is broken without it.

## Adding it

1. Make an image (see the prompt below).
2. Save it as `frontend/public/images/witch.webp`. Create the `images` folder if it is not there.
3. Reload the page. No code change is needed. If the file is missing or cannot be read, the drawn witch appears again.

**Format:** a wide banner, about 3 to 4 times as wide as it is tall (for example 1200 by 360 pixels), with a **transparent
background** if the tool can make one (otherwise a very dark background, and the left edge fades into the page anyway). Keep it
under about 300 KB; the page shows it at roughly 17 rem wide.

## A prompt to start from

> Grim dark fantasy illustration, wide banner. A gaunt, ancient hag-witch in a torn, frayed pointed hat, long gnarled fingers
> stirring a black iron cauldron full of sickly green glowing brew. Smoke and floating embers, crows on her shoulders, deep
> shadows, green underlight on her face, painterly gothic style, muted browns and blacks with ember-orange and poison-green
> accents. Transparent background. No text, no logos, no watermark.

Tune it to taste: "horror", "plague doctor mask", "ravens", "bone charms" all push it darker. Keep "no text, no watermark".

## Licence and credit

Check the image tool's terms before publishing: some free tiers restrict commercial use or require credit. AI-generated images
may not be protected by copyright in some places. If the tool requires credit, add it to the page footer
(`frontend/src/App.tsx`, next to the SRD attribution).

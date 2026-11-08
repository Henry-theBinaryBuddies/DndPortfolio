import type { Assets } from "./assets";
import { printBounds } from "./bounds";
import { collectBust } from "./export";
import { partInfo } from "./parts";
import type { Params } from "./params";
import { finestRelief } from "./garments";
import { MIN_FEATURE, MM, TABLETOP } from "./print";
import type { Part } from "./printable";

// Tabletop size: the whole bust, its hair and shoulders included, within the one inch square of a gaming board
// (25.4 mm) on a round base of TABLETOP.base, and about TABLETOP.aim mm tall. A bust is far wider and deeper than
// it is tall (its shoulders are 70 mm across and its chest and back 45 mm deep at 80 mm tall), so scaling it
// alone gives either the height or the base but never both. So the bust is scaled as large as the base allows
// (no larger than gives the height), with the body slimmed by the Torso size slider only as far as that needs:
// the head and its hair do not slim, so once they set the size, slimming the body more would only spoil it.
// Each is measured on the real parts, hair and beard included.

export interface Tabletop {
  parts: Part[];
  flatCut: number; // mm
  scale: number; // the sculpt's size as printed, as a fraction of its own
  params: Params; // the sculpt as printed: the shoulders may have been narrowed
  height: number; // mm: the bust itself, as printed
  width: number; // mm: the widest part of the bust, as printed
  depth: number; // mm
  base: number; // mm: the height of the whole base
  notes: string[]; // what was changed to fit, and where it does not
}

interface Size {
  reach: number; // how far the bust reaches from the middle of its base, sideways or from front to back, whichever is more (mm)
  height: number; // mm, above the flat cut
}


const measure = (parts: Part[], flatCut: number): Size & { halfX: number; halfY: number; limit: string } => {
  // (below the flat cut is trimmed away in the merge: a lock that slid down the back past it does not print, but
  // where it crosses the cut it does)
  const { min, max } = printBounds(parts, flatCut, false);
  const halfX = Math.max(-min[0], max[0]);
  const halfY = Math.max(-min[1], max[1]);
  // (and which part reaches farthest: that is what sets the size)
  let limit = "the bust";
  let farthest = -Infinity;
  for (const part of parts) {
    if (part.name === "base") continue;
    const b = printBounds([part], flatCut, false);
    const reach = Math.max(-b.min[0], b.max[0], -b.min[1], b.max[1]);
    if (reach > farthest) [farthest, limit] = [reach, partInfo(part.name).label];
  }
  return { reach: Math.max(halfX, halfY), height: max[2] - flatCut, halfX, halfY, limit };
};

export function collectTabletop(p: Params, assets: Assets, gusset = true): Tabletop {
  const half = TABLETOP.base / 2;
  const notes: string[] = [];
  let params = { ...p };
  // (measured on the quick draft, without the carving, which only cuts inward, and without the gusset, which is
  // tucked under the chin: a fraction of the time. The parts that print are checked at the end.)
  const sized = (q: Params) => {
    const { parts, flatCut } = collectBust(q, assets, false, undefined, false, true);
    return measure(parts, flatCut);
  };
  const asked = params.torso;
  // The scale that gives the aimed height, or that fits the base if that is less
  const scaleFor = (size: Size) => Math.min(TABLETOP.aim / size.height, half / size.reach);
  let m = sized(params);
  if (TABLETOP.aim / m.height > scaleFor(m) * 1.002 && asked > TABLETOP.torso) {
    // The reach, not the height, sets the size: see how much the slimmest torso would allow (the head and its hair
    // do not slim, so it may be little or nothing), then slim only as far as that needs, by halving the interval
    // between a torso that fits at that scale and one that does not
    const slimmest = sized({ ...params, torso: TABLETOP.torso });
    const target = scaleFor(slimmest);
    if (target > scaleFor(m) * 1.002) {
      let [fits, wide] = [TABLETOP.torso, asked];
      let fitted = slimmest;
      for (let i = 0; i < 5; i++) {
        const middle = (fits + wide) / 2;
        const tried = sized({ ...params, torso: middle });
        if (tried.reach * target <= half) [fits, fitted] = [middle, tried];
        else wide = middle;
      }
      params = { ...params, torso: fits };
      m = fitted;
    }
  }
  const scale = scaleFor(m);
  if (params.torso < asked - 0.005) notes.push(`The torso was slimmed to ${Math.round(params.torso * 100)}% to fit the base.`);
  // The fit was measured on the draft: check it on the parts that will print, and bring them within the base if the
  // carving or the gusset turn out to reach past it
  let printScale = scale;
  let built = collectBust(params, assets, gusset, printScale);
  let fitted = measure(built.parts, built.flatCut);
  if (fitted.reach > half * 1.0005) {
    printScale *= (half / fitted.reach) * 0.998;
    built = collectBust(params, assets, gusset, printScale);
    fitted = measure(built.parts, built.flatCut);
  }
  // (never hand back a file that does not fit the square it was asked to)
  if (fitted.reach > half * 1.002) throw new Error(`The bust still reaches ${fitted.reach.toFixed(1)} mm from the middle of its base, past the ${half} mm that fits a ${TABLETOP.base} mm base`);
  if (fitted.height < TABLETOP.bustHeight[0]) notes.push(`The bust is ${fitted.height.toFixed(0)} mm tall, under the ${TABLETOP.bustHeight[0]} mm wanted: ${fitted.limit} reach ${fitted.reach.toFixed(1)} mm from the middle of the base, which sets the size.`);
  // (the clothes' relief is sized for the full-size print, and scaled down with the bust: said honestly where it comes out
  // finer than prints, rather than made larger than the sculpt has it)
  const finest = finestRelief(params);
  if (finest && finest.height * printScale < MIN_FEATURE / MM)
    notes.push(`At this size the finest relief of the clothes (${finest.what}) stands ${(finest.height * printScale).toFixed(2)} mm proud, under the ${(MIN_FEATURE / MM).toFixed(1)} mm that reliably prints: their shapes print, but that detail may be lost. The full-size print keeps it.`);
  return { parts: built.parts, flatCut: built.flatCut, scale: printScale, params, height: fitted.height, width: fitted.halfX * 2, depth: fitted.halfY * 2, base: TABLETOP.plinth, notes: [...notes, ...built.warnings] };
}

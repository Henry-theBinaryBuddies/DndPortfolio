import type { Assets } from "./assets";
import { collectBust } from "./export";
import type { Params } from "./params";
import { TABLETOP } from "./print";
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

const measure = (parts: Part[], flatCut: number): Size & { halfX: number; halfY: number } => {
  let halfX = 0;
  let halfY = 0;
  let top = -Infinity;
  for (const part of parts) {
    if (part.name === "base") continue;
    const p = part.positions;
    for (let i = 0; i < p.length; i += 3) {
      halfX = Math.max(halfX, Math.abs(p[i]));
      halfY = Math.max(halfY, Math.abs(p[i + 1]));
      top = Math.max(top, p[i + 2]);
    }
  }
  return { reach: Math.max(halfX, halfY), height: top - flatCut, halfX, halfY };
};

export function collectTabletop(p: Params, assets: Assets, gusset = true): Tabletop {
  const half = TABLETOP.base / 2;
  const notes: string[] = [];
  let params = { ...p };
  // (measured on the quick draft, without the carving, which only cuts inward, and without the gusset, which is
  // tucked under the chin: a fraction of the time. The parts that print are checked at the end.)
  const sized = (q: Params) => {
    const { parts, flatCut } = collectBust(q, assets, false, undefined, false);
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
  if (fitted.height < TABLETOP.bustHeight[0]) notes.push(`The bust is ${fitted.height.toFixed(0)} mm tall, under the ${TABLETOP.bustHeight[0]} mm wanted: the head and its hair reach ${(m.reach * printScale).toFixed(1)} mm from the middle of the base, which sets the size.`);
  return { parts: built.parts, flatCut: built.flatCut, scale: printScale, params, height: fitted.height, width: fitted.halfX * 2, depth: fitted.halfY * 2, base: TABLETOP.plinth, notes };
}

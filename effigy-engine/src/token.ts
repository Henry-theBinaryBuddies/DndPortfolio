import * as THREE from "three";
import { siteUrl } from "./site";

// The token: a picture of the painted bust for a virtual tabletop (Foundry, Roll20 and the like), round, with a
// dark metal rim, and transparent outside it so it sits on the map as a counter would. The bust is drawn over a
// dark backdrop (see main.ts), and the frame goes on here, on a plain 2D canvas.

export const RIM = 0.065; // the rim's width, as a share of the token's width

// The pictures that can stand behind the bust instead of the plain glow, listed in public/backdrops/backdrops.json
// (a page cannot list a folder): each a file there, and the label the picker shows
export interface Backdrop {
  file: string;
  label: string;
}

const BACKDROPS = siteUrl("backdrops/");

// The list, or none if it cannot be read (then only the plain glow is offered)
export async function loadBackdrops(): Promise<Backdrop[]> {
  try {
    const response = await fetch(`${BACKDROPS}backdrops.json`);
    if (!response.ok) return [];
    const list = (await response.json()) as Backdrop[];
    return list.filter((b) => typeof b.file === "string" && typeof b.label === "string");
  } catch {
    return [];
  }
}

// A backdrop's picture, loaded once
const pictures = new Map<string, Promise<HTMLImageElement>>();
export function backdropPicture(file: string): Promise<HTMLImageElement> {
  let picture = pictures.get(file);
  if (!picture) {
    const image = new Image();
    image.src = `${BACKDROPS}${encodeURIComponent(file)}`;
    picture = image.decode().then(() => image);
    // (one that fails to load is tried afresh next time)
    picture.catch(() => pictures.delete(file));
    pictures.set(file, picture);
  }
  return picture;
}

// How much of the token's width shows the picture: the round inside the rim (and a little under it). A backdrop is
// drawn just this wide, so the whole of it is seen across the round (drawn across the whole square, its edges were
// lost under the rim and in the cut-away corners); a square as wide as a round still covers all of it.
export const PICTURE = 1 - 0.008 - 2 * RIM + 0.6 * RIM;

// The backdrop behind the bust: a picture (its middle square, as wide as the round it shows through), or a dim glow
// in the middle falling off to near black at the rim
export function tokenBackdrop(size: number, picture?: HTMLImageElement): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  if (picture) {
    const side = Math.min(picture.naturalWidth, picture.naturalHeight);
    const shown = size * PICTURE;
    g.fillStyle = "#080605";
    g.fillRect(0, 0, size, size);
    g.drawImage(picture, (picture.naturalWidth - side) / 2, (picture.naturalHeight - side) / 2, side, side, (size - shown) / 2, (size - shown) / 2, shown, shown);
  } else {
    const glow = g.createRadialGradient(size * 0.5, size * 0.42, 0, size * 0.5, size * 0.5, size * 0.6);
    glow.addColorStop(0, "#3a302a");
    glow.addColorStop(0.55, "#1c1714");
    glow.addColorStop(1, "#080605");
    g.fillStyle = glow;
    g.fillRect(0, 0, size, size);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// The picture (square, `size` across) cut to a circle inside a rim
export function frameToken(picture: CanvasImageSource, size: number): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d")!;
  const c = size / 2;
  const outer = c - Math.max(1, size * 0.004);
  const rim = size * RIM;
  const inner = outer - rim;

  // The picture, inside the rim (reaching a little under it, so no gap shows at its edge)
  g.save();
  g.beginPath();
  g.arc(c, c, inner + rim * 0.3, 0, Math.PI * 2);
  g.clip();
  g.drawImage(picture, 0, 0, size, size);
  // a shadow cast inward by the rim
  const shadow = g.createRadialGradient(c, c, inner * 0.82, c, c, inner + rim * 0.3);
  shadow.addColorStop(0, "rgba(0, 0, 0, 0)");
  shadow.addColorStop(1, "rgba(0, 0, 0, 0.65)");
  g.fillStyle = shadow;
  g.fillRect(0, 0, size, size);
  g.restore();

  // The rim: dark iron, lit from the top left, with a bevel along each edge
  const ring = (radius: number, width: number, style: string | CanvasGradient) => {
    g.beginPath();
    g.arc(c, c, radius, 0, Math.PI * 2);
    g.lineWidth = width;
    g.strokeStyle = style;
    g.stroke();
  };
  const metal = g.createLinearGradient(c - outer, c - outer, c + outer, c + outer);
  metal.addColorStop(0, "#6a6058");
  metal.addColorStop(0.35, "#3a332e");
  metal.addColorStop(0.65, "#221d1a");
  metal.addColorStop(1, "#0e0b0a");
  ring(inner + rim / 2, rim, metal);
  // a groove down the middle of the rim, and a fine highlight on its outer and inner bevels
  ring(inner + rim / 2, Math.max(1, rim * 0.12), "rgba(0, 0, 0, 0.55)");
  const bevel = g.createLinearGradient(c - outer, c - outer, c + outer, c + outer);
  bevel.addColorStop(0, "rgba(220, 200, 175, 0.55)");
  bevel.addColorStop(0.5, "rgba(220, 200, 175, 0.08)");
  bevel.addColorStop(1, "rgba(220, 200, 175, 0)");
  ring(outer - rim * 0.08, Math.max(1, rim * 0.1), bevel);
  ring(inner + rim * 0.08, Math.max(1, rim * 0.08), bevel);
  // a dark line at each edge, so the rim reads against any map
  ring(outer, Math.max(1, size * 0.004), "#050404");
  ring(inner, Math.max(1, size * 0.003), "#050404");
  return canvas;
}

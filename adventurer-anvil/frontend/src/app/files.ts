// Character files on the user's own computer: downloading one, reading one they chose, and the small portrait
// copy saved with each character's summary.
import type { CharacterDocument } from "../core";

/** "Ilvaren Ashveil" → "ilvaren-ashveil.anvil.json"; letters and digits only, so it is a safe name everywhere. */
export function fileNameFor(name: string): string {
  const slug = name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${slug || "character"}.anvil.json`;
}

/** Saves the character to the user's downloads, laid out to be readable. */
export function downloadCharacter(doc: CharacterDocument): void {
  const blob = new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileNameFor(doc.name);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** A small JPEG copy of a picture, for lists (a portrait is up to 256 px; this is 64). */
export async function thumbnail(dataUrl: string, size = 64): Promise<string> {
  const img = new Image();
  img.src = dataUrl;
  await img.decode();
  const scale = Math.min(1, size / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(img.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * scale));
  canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.8);
}

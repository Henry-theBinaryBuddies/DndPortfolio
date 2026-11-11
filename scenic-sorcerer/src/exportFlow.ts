// The Export dialog: makes the picture and the virtual tabletop files, and hands them to the browser to save.

import type { Library } from "./assets";
import {
  clampPixelsPerCell,
  foundryScene,
  imageSize,
  maxPixelsPerCell,
  safeFileBase,
  universalVtt,
} from "./exporters";
import { levelDoc } from "./levels";
import type { LightCache } from "./lighting";
import type { MapDoc } from "./model";
import { renderExport } from "./render";

interface Deps {
  doc: () => MapDoc;
  library: Library;
  lightCache: LightCache;
}

type PictureKind = "png" | "jpeg" | "webp";
const QUALITY = 0.92;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

export function setupExport({ doc, library, lightCache }: Deps): void {
  const dialog = el<HTMLDialogElement>("export-dialog");
  const levelRow = el("export-level-row");
  const levelSelect = el<HTMLSelectElement>("export-level");
  const ppcInput = el<HTMLInputElement>("export-ppc");
  const sizeNote = el("export-size");
  const gridBox = el<HTMLInputElement>("export-grid");
  const gmBox = el<HTMLInputElement>("export-gm");
  const lightingBox = el<HTMLInputElement>("export-lighting");
  const formatSelect = el<HTMLSelectElement>("export-format");
  const status = el("export-status");
  const hexNote = el("export-hex-note");
  const buttons = ["btn-export-image", "btn-export-uvtt", "btn-export-foundry"].map((id) => el<HTMLButtonElement>(id));
  let wanted = 0; // pixels per cell the user asked for; 0 until they choose

  function chosenLevel(): MapDoc {
    const d = doc();
    return levelDoc(d, Math.min(Number(levelSelect.value) || 0, d.levels.length - 1));
  }

  function chosenPpc(): number {
    return clampPixelsPerCell(doc(), Number(ppcInput.value));
  }

  /** The file name for the chosen level: the map's name, and the level's too when there are several. */
  function baseName(): string {
    const d = doc();
    const level = d.levels[Number(levelSelect.value) || 0];
    return safeFileBase(d.levels.length > 1 ? `${d.name} - ${level.name}` : d.name);
  }

  function refresh(): void {
    const d = doc();
    const previous = levelSelect.value;
    levelSelect.replaceChildren(...d.levels.map((l, i) => new Option(l.name, String(i))).reverse());
    levelSelect.value = previous !== "" && Number(previous) < d.levels.length ? previous : String(d.level);
    levelRow.hidden = d.levels.length < 2;
    const max = maxPixelsPerCell(d);
    ppcInput.max = String(max);
    if (!wanted) wanted = d.grid.cellPx;
    ppcInput.value = String(clampPixelsPerCell(d, wanted));
    const ppc = chosenPpc();
    const size = imageSize(d, ppc);
    const clamped = wanted > max ? ` The most this map allows is ${max} pixels per cell.` : "";
    sizeNote.textContent = `The picture will be ${size.width} × ${size.height} pixels.${clamped}`;
    hexNote.hidden = d.grid.type === "square";
  }

  function busy(message: string): void {
    status.textContent = message;
    for (const b of buttons) b.disabled = true;
  }

  function idle(message: string): void {
    status.textContent = message;
    for (const b of buttons) b.disabled = false;
  }

  /** Draw the chosen level at the chosen size. */
  async function paint(opts: { grid: boolean; gm: boolean; lighting: boolean }): Promise<HTMLCanvasElement> {
    const level = chosenLevel();
    const ppc = chosenPpc();
    await library.preload(level.stamps.map((s) => s.assetId));
    const size = imageSize(level, ppc);
    const canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("This browser could not make a picture this big. Try fewer pixels per cell.");
    renderExport(ctx, level, { scale: ppc / level.grid.cellPx, ...opts }, (id, tint) => library.image(id, tint), lightCache);
    return canvas;
  }

  function toBlob(canvas: HTMLCanvasElement, kind: PictureKind): Promise<Blob> {
    return new Promise((resolve, reject) => {
      canvas.toBlob(
        (blob) => (blob ? resolve(blob) : reject(new Error("This browser could not save a picture this big. Try fewer pixels per cell."))),
        `image/${kind}`,
        QUALITY,
      );
    });
  }

  function toBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(",")[1] ?? "");
      reader.onerror = () => reject(new Error("The picture could not be read back."));
      reader.readAsDataURL(blob);
    });
  }

  function download(data: Blob | string, name: string): void {
    const blob = typeof data === "string" ? new Blob([data], { type: "application/json" }) : data;
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = name;
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }

  async function run(label: string, job: () => Promise<string>): Promise<void> {
    busy(`Making ${label}…`);
    // Let the message show before the browser gets busy drawing.
    await new Promise((resolve) => setTimeout(resolve, 50));
    try {
      idle(await job());
    } catch (error) {
      idle(error instanceof Error ? error.message : "That did not work.");
    }
  }

  el("btn-export").addEventListener("click", () => {
    refresh();
    status.textContent = "";
    dialog.showModal();
  });
  levelSelect.addEventListener("change", refresh);
  ppcInput.addEventListener("input", () => {
    wanted = Number(ppcInput.value) || wanted;
    const d = doc();
    const size = imageSize(d, chosenPpc());
    sizeNote.textContent = `The picture will be ${size.width} × ${size.height} pixels.`;
  });
  ppcInput.addEventListener("change", refresh);

  el("btn-export-image").addEventListener("click", () =>
    run("your picture", async () => {
      const kind = formatSelect.value as PictureKind;
      const canvas = await paint({ grid: gridBox.checked, gm: gmBox.checked, lighting: lightingBox.checked });
      const extension = kind === "jpeg" ? "jpg" : kind;
      download(await toBlob(canvas, kind), `${baseName()}.${extension}`);
      return `Saved ${baseName()}.${extension}.`;
    }),
  );

  el("btn-export-uvtt").addEventListener("click", () =>
    run("the Universal VTT file", async () => {
      const level = chosenLevel();
      const ppc = chosenPpc();
      const picture = await toBlob(await paint({ grid: false, gm: false, lighting: false }), "png");
      download(JSON.stringify(universalVtt(level, ppc, await toBase64(picture))), `${baseName()}.dd2vtt`);
      return `Saved ${baseName()}.dd2vtt.`;
    }),
  );

  el("btn-export-foundry").addEventListener("click", () =>
    run("the Foundry scene", async () => {
      const level = chosenLevel();
      const ppc = chosenPpc();
      const imageName = `${baseName()}.png`;
      const picture = await toBlob(await paint({ grid: false, gm: false, lighting: false }), "png");
      download(picture, imageName);
      download(JSON.stringify(foundryScene(level, ppc, imageName, baseName()), null, 2), `${baseName()}.foundry-scene.json`);
      return `Saved ${imageName} and ${baseName()}.foundry-scene.json. Upload the picture to Foundry, import the scene, then point its background at your picture.`;
    }),
  );
}

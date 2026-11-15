// The stamp library: pictures the user has imported, kept in this browser (IndexedDB),
// plus the decoded and tinted images the renderer draws.

import { LIMITS, type Asset } from "./model";
import { assetName } from "./objects";
import { STAIRS_PRESETS, drawStairs } from "./stairs";
import { floorFill } from "./textures";

const DB_NAME = "scenic-sorcerer";
const STORE = "assets";
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

export type Drawable = HTMLImageElement | HTMLCanvasElement;

const FAVOURITES_KEY = "scenic-sorcerer-favourite-stamps";

interface ManifestEntry {
  id: string;
  name: string;
  group: string;
  file: string;
  width: number;
  height: number;
  ppc: number;
}

/** Where to load a stamp's picture from: the bundled file, or the copy kept in the browser. */
export function assetSource(asset: Asset): string {
  return asset.url ?? asset.dataUrl;
}

/** Turn the bundled stamps' manifest into library entries. Entries that do not look right are skipped. */
export function builtinAssets(manifest: unknown, baseUrl: string, favourites: Set<string>): Asset[] {
  if (!Array.isArray(manifest)) return [];
  const assets: Asset[] = [];
  for (const item of manifest as Partial<ManifestEntry>[]) {
    if (!item || typeof item.id !== "string" || typeof item.name !== "string" || typeof item.file !== "string") continue;
    if (!/^[a-z0-9-]+\.webp$/.test(item.file) || !(item.width! > 0) || !(item.height! > 0) || !(item.ppc! > 0)) continue;
    assets.push({
      id: item.id,
      name: item.name,
      dataUrl: "",
      url: new URL(item.file, baseUrl).href,
      width: item.width!,
      height: item.height!,
      favourite: favourites.has(item.id),
      builtin: true,
      group: typeof item.group === "string" ? item.group : undefined,
      ppc: item.ppc,
    });
  }
  return assets;
}

const STAIRS_PPC = 100;

/** The ready-made stairs, each with a small picture of itself for the list. Needs a browser to draw the pictures. */
export function stairsAssets(favourites: Set<string>): Asset[] {
  return STAIRS_PRESETS.map((p) => {
    const width = p.widthCells * STAIRS_PPC;
    const height = p.lengthCells * STAIRS_PPC;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d")!;
    ctx.translate(width / 2, height / 2);
    drawStairs(ctx, p.spec, width, height, STAIRS_PPC, floorFill(ctx, p.spec.material, STAIRS_PPC));
    return {
      id: p.id,
      name: p.name,
      dataUrl: canvas.toDataURL("image/png"),
      width,
      height,
      favourite: favourites.has(p.id),
      builtin: true,
      group: "Stairs",
      ppc: STAIRS_PPC,
      stairs: { ...p.spec },
    };
  });
}

function readFavourites(): Set<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(FAVOURITES_KEY) ?? "[]");
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function writeFavourites(ids: string[]): void {
  try {
    localStorage.setItem(FAVOURITES_KEY, JSON.stringify(ids));
  } catch {
    // The favourites just will not be remembered.
  }
}

export class Library {
  /** The pictures the user imported. */
  assets: Asset[] = [];
  /** The stamps that come with the site. */
  builtin: Asset[] = [];
  /** False when the browser would not give us storage; the library then lasts only until the tab closes. */
  persistent = true;
  private db: IDBDatabase | null = null;
  private images = new Map<string, HTMLImageElement | "loading" | "broken">();
  private tinted = new Map<string, HTMLCanvasElement>();

  /** Called when the list of pictures changes ("list") or a picture finishes decoding ("image"). */
  constructor(private onChange: (what: "list" | "image") => void) {}

  async load(): Promise<void> {
    try {
      this.db = await openDb();
      this.assets = await request<Asset[]>(this.store("readonly").getAll());
    } catch {
      this.persistent = false;
    }
    this.onChange("list");
    await this.loadBuiltin();
  }

  /** Every stamp on offer: the bundled ones, then the user's own. */
  get all(): Asset[] {
    return [...this.builtin, ...this.assets];
  }

  private async loadBuiltin(): Promise<void> {
    const favourites = readFavourites();
    try {
      this.builtin = stairsAssets(favourites);
    } catch {
      this.builtin = []; // the stairs just are not offered
    }
    this.onChange("list");
    try {
      const base = new URL("stamps/", document.baseURI).href;
      const response = await fetch(new URL("manifest.json", base));
      if (!response.ok) return;
      this.builtin = [...this.builtin, ...builtinAssets(await response.json(), base, favourites)];
    } catch {
      return; // the site still works with only the user's own pictures
    }
    this.onChange("list");
  }

  get(id: string): Asset | undefined {
    return this.assets.find((a) => a.id === id) ?? this.builtin.find((a) => a.id === id);
  }

  /** Add pictures, skipping any already in the library. Returns the ones now present, new or not. */
  async add(incoming: Asset[]): Promise<Asset[]> {
    const present: Asset[] = [];
    for (const asset of incoming) {
      const existing = this.get(asset.id);
      if (existing) {
        present.push(existing);
        continue;
      }
      this.assets.push(asset);
      present.push(asset);
      await this.write((store) => store.put(asset));
    }
    this.onChange("list");
    return present;
  }

  async remove(id: string): Promise<void> {
    if (this.builtin.some((a) => a.id === id)) return; // the bundled stamps stay
    this.assets = this.assets.filter((a) => a.id !== id);
    this.images.delete(id);
    await this.write((store) => store.delete(id));
    this.onChange("list");
  }

  async setFavourite(id: string, favourite: boolean): Promise<void> {
    const asset = this.get(id);
    if (!asset) return;
    asset.favourite = favourite;
    if (asset.builtin) writeFavourites(this.builtin.filter((a) => a.favourite).map((a) => a.id));
    else await this.write((store) => store.put(asset));
    this.onChange("list");
  }

  /** Read picture files into library entries. Returns what was added and why anything was skipped. */
  async importFiles(files: File[]): Promise<{ added: Asset[]; problems: string[] }> {
    const ready: Asset[] = [];
    const problems: string[] = [];
    for (const file of files) {
      try {
        ready.push(await fileToAsset(file));
      } catch (error) {
        problems.push(`${file.name}: ${error instanceof Error ? error.message : "could not be read"}`);
      }
    }
    return { added: await this.add(ready), problems };
  }

  /** Wait until these pictures are decoded, so a picture of the map does not draw them as empty boxes. */
  async preload(ids: string[]): Promise<void> {
    await Promise.all([...new Set(ids)].map((id) => this.decode(id)));
  }

  private decode(id: string): Promise<void> {
    if (this.images.get(id) instanceof HTMLImageElement) return Promise.resolve();
    const asset = this.get(id);
    if (!asset) return Promise.resolve();
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        this.images.set(id, img);
        resolve();
      };
      img.onerror = () => resolve(); // a broken picture is drawn as an empty box, as on screen
      img.src = assetSource(asset);
    });
  }

  /** The picture to draw for a stamp, or null while it is loading or if it is missing. */
  image(assetId: string, tint: string | null): Drawable | null {
    const base = this.baseImage(assetId);
    if (!base || !tint) return base;
    const key = `${assetId}:${tint}`;
    let canvas = this.tinted.get(key);
    if (!canvas) {
      canvas = tintImage(base, tint);
      this.tinted.set(key, canvas);
    }
    return canvas;
  }

  private baseImage(assetId: string): HTMLImageElement | null {
    const cached = this.images.get(assetId);
    if (cached instanceof HTMLImageElement) return cached;
    if (cached) return null;
    const asset = this.get(assetId);
    if (!asset) return null;
    this.images.set(assetId, "loading");
    const img = new Image();
    img.onload = () => {
      this.images.set(assetId, img);
      this.onChange("image");
    };
    img.onerror = () => this.images.set(assetId, "broken");
    img.src = assetSource(asset);
    return null;
  }

  private store(mode: IDBTransactionMode): IDBObjectStore {
    return this.db!.transaction(STORE, mode).objectStore(STORE);
  }

  private async write(action: (store: IDBObjectStore) => IDBRequest): Promise<void> {
    if (!this.db) return;
    try {
      await request(action(this.store("readwrite")));
    } catch {
      this.persistent = false; // most likely out of space; keep working from memory
    }
  }
}

async function fileToAsset(file: File): Promise<Asset> {
  if (!IMAGE_TYPES.test(file.type)) throw new Error("not a PNG, JPG, WebP, GIF or SVG picture");
  if (file.size > LIMITS.maxAssetBytes) throw new Error("larger than 8 MB");
  const dataUrl = await readDataUrl(file);
  const img = await decode(dataUrl);
  return {
    id: await hash(dataUrl),
    name: assetName(file.name),
    dataUrl,
    width: img.naturalWidth || 256, // an SVG may not state a size
    height: img.naturalHeight || 256,
    favourite: false,
  };
}

function readDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("could not be read"));
    reader.readAsDataURL(file);
  });
}

function decode(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("is not a picture this browser can show"));
    img.src = dataUrl;
  });
}

/** The same picture always gets the same id, so importing it twice does not duplicate it. */
async function hash(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Colour a picture by multiplying it with the tint, keeping its transparent areas transparent. */
function tintImage(img: HTMLImageElement, tint: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth || 256;
  canvas.height = img.naturalHeight || 256;
  const c = canvas.getContext("2d")!;
  c.drawImage(img, 0, 0, canvas.width, canvas.height);
  c.globalCompositeOperation = "multiply";
  c.fillStyle = tint;
  c.fillRect(0, 0, canvas.width, canvas.height);
  c.globalCompositeOperation = "destination-in";
  c.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const open = indexedDB.open(DB_NAME, 1);
    open.onupgradeneeded = () => open.result.createObjectStore(STORE, { keyPath: "id" });
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

// The stamp library: pictures the user has imported, kept in this browser (IndexedDB),
// plus the decoded and tinted images the renderer draws.

import { LIMITS, type Asset } from "./model";
import { assetName } from "./objects";

const DB_NAME = "scenic-sorcerer";
const STORE = "assets";
const IMAGE_TYPES = /^image\/(png|jpeg|webp|gif|svg\+xml)$/;

export type Drawable = HTMLImageElement | HTMLCanvasElement;

export class Library {
  assets: Asset[] = [];
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
  }

  get(id: string): Asset | undefined {
    return this.assets.find((a) => a.id === id);
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
    this.assets = this.assets.filter((a) => a.id !== id);
    this.images.delete(id);
    await this.write((store) => store.delete(id));
    this.onChange("list");
  }

  async setFavourite(id: string, favourite: boolean): Promise<void> {
    const asset = this.get(id);
    if (!asset) return;
    asset.favourite = favourite;
    await this.write((store) => store.put(asset));
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
    img.src = asset.dataUrl;
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

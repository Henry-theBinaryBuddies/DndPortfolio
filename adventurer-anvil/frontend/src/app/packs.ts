// Loads the built-in content packs when the app starts, through the core's pack reader.
import { readPack, type IndexedPack, type PackFile, type SystemModule } from "../core";

/** Built-in packs, in load order (a pack's requirements come before it). Paths are relative to the page. */
export const BUILT_IN_PACKS = ["packs/srd-5.1.pack.json"];

export type LoadedPack = IndexedPack & { file: PackFile };

export async function loadBuiltInPacks(system: SystemModule, fetcher: typeof fetch = fetch): Promise<LoadedPack[]> {
  const loaded: LoadedPack[] = [];
  for (const path of BUILT_IN_PACKS) {
    const response = await fetcher(new URL(path, document.baseURI));
    if (!response.ok) throw new Error(`Couldn't load ${path} (${response.status}).`);
    const result = readPack(await response.json(), system, loaded);
    if (!result.ok) throw new Error(`${path} didn't pass its check:\n${result.errors.join("\n")}`);
    loaded.push(result.pack);
  }
  return loaded;
}

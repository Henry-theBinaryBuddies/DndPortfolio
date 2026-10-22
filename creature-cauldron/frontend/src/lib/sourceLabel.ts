import type { Monster, Source } from "../types/monster";

/** Every source a monster can have, in the order the Source filter lists them. */
export const SOURCES: readonly Source[] = ["srd", "a5e", "curated", "ai", "reskin"];

/** What the Source filter calls each source. */
export const SOURCE_NAMES: Record<Source, string> = {
  srd: "SRD 5.1",
  a5e: "A5E",
  curated: "Curated samples",
  ai: "Generated",
  reskin: "Reskin",
};

/** A short label for monsters that did not come from the SRD or the curated set, or null for those that did. */
export function sourceLabel(monster: Pick<Monster, "source" | "validated">): string | null {
  if (monster.source === "a5e") return "A5E";
  if (monster.source !== "ai" && monster.source !== "reskin") return null;
  const kind = monster.source === "ai" ? "Generated" : "Reskin";
  return monster.validated ? kind : `${kind}, unvalidated`;
}

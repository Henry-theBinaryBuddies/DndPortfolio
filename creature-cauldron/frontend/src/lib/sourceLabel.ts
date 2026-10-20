import type { Monster } from "../types/monster";

/** A short label for monsters that did not come from the SRD or the curated set, or null for those that did. */
export function sourceLabel(monster: Pick<Monster, "source" | "validated">): string | null {
  if (monster.source !== "ai" && monster.source !== "reskin") return null;
  const kind = monster.source === "ai" ? "Generated" : "Reskin";
  return monster.validated ? kind : `${kind}, unvalidated`;
}

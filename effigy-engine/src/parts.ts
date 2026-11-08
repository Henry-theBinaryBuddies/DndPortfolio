// What each named part of a bust is, in one place (audit 19): the material it is painted with, what the fit and the
// print's messages call it, the role it plays when a bust is fitted to its base and when clothing is fitted to it,
// and anything the print does to it. The builders name their meshes (see builder.ts and dragonborn.ts); paint.ts,
// fit.ts, export.ts and the print's messages read this table rather than each keeping its own list of names.
//
// (Whether pieces print as one solid is not here: a name can be both, as a humanoid's horn is a solid of its own and a
// Dragonborn's horn is a painted piece of its one surface. That belongs to the mesh: userData.joined, see export.ts.)

export type MaterialKind = "skin" | "eye" | "hair" | "horn" | "teeth" | "mouth" | "scales" | "dragonEye" | "cloth" | "leather" | "cloak" | "metal" | "clay";

// body: the sculpt's own surface, which clothing is fitted to (see bodySurface.ts); feature: built into or onto the
// face (eyes, teeth, brows); outgrowth: horns, tusks and spines, which reach out and count in the fit; hair: hair and
// beards, which keep clear of clothing; garment: clothing and armour over the body (see garments.ts); support:
// print-only help (the throat gusset); base: the pedestal
export type PartRole = "body" | "feature" | "outgrowth" | "hair" | "garment" | "support" | "base";

export interface PartInfo {
  material: MaterialKind;
  label: string; // as the fit's notes name it ("the horns reach 12.5 mm from the middle of the base")
  role: PartRole;
  printGrowth?: number; // printed this much larger than sculpted, about its own centre (eyeballs, so they join the head)
}

const PARTS: Record<string, PartInfo> = {
  head: { material: "skin", label: "the head and shoulders", role: "body" },
  scales: { material: "scales", label: "the head and shoulders", role: "body" },
  eye: { material: "eye", label: "the eyes", role: "feature", printGrowth: 1.07 },
  dragonEye: { material: "dragonEye", label: "the eyes", role: "body" },
  horn: { material: "horn", label: "the horns", role: "outgrowth" },
  tusk: { material: "teeth", label: "the tusks", role: "outgrowth" },
  teeth: { material: "teeth", label: "the teeth", role: "feature" },
  dragonTeeth: { material: "teeth", label: "the teeth", role: "feature" },
  dragonMouth: { material: "mouth", label: "the mouth", role: "feature" },
  mouthFill: { material: "mouth", label: "the mouth", role: "feature" },
  brows: { material: "hair", label: "the brows", role: "feature" },
  hair: { material: "hair", label: "the hair", role: "hair" },
  curtain: { material: "hair", label: "the hair", role: "hair" },
  locks: { material: "hair", label: "the dreadlocks", role: "hair" },
  beard: { material: "hair", label: "the beard", role: "hair" },
  tunic: { material: "cloth", label: "the tunic", role: "garment" },
  cuirass: { material: "metal", label: "the breastplate", role: "garment" },
  pauldron: { material: "metal", label: "the pauldrons", role: "garment" },
  jerkin: { material: "leather", label: "the jerkin", role: "garment" },
  spaulder: { material: "leather", label: "the spaulders", role: "garment" },
  gorget: { material: "metal", label: "the gorget", role: "garment" },
  mail: { material: "metal", label: "the mail shirt", role: "garment" },
  cloak: { material: "cloak", label: "the cloak", role: "garment" },
  clasp: { material: "metal", label: "the cloak's clasps", role: "garment" },
  gusset: { material: "clay", label: "the throat gusset", role: "support" },
  base: { material: "clay", label: "the base", role: "base" },
};

const UNKNOWN: PartInfo = { material: "clay", label: "the bust", role: "feature" };

export function partInfo(name: string): PartInfo {
  return PARTS[name] ?? UNKNOWN;
}

// Every part's name, for tests that check each builder's names are known here
export const PART_NAMES = Object.keys(PARTS);

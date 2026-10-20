import { DAMAGE_TYPES } from "./options";

// Damage resistance, immunity and vulnerability lines. Most are a plain list of types, but the SRD also prints lines such
// as "bludgeoning, piercing, and slashing from nonmagical weapons that aren't silvered". A monster keeps the exact
// printed wording in `damage_text` when that happens (its type lists still hold the types, for searching). These helpers
// turn that wording into what each export needs.

const TYPES: ReadonlySet<string> = new Set(DAMAGE_TYPES);

/** The damage types named in a phrase: "bludgeoning, piercing, and slashing" gives three. */
export function typesIn(phrase: string): string[] {
  return (phrase.match(/[a-z]+/g) ?? []).filter((word) => TYPES.has(word));
}

/** Splits one printed part into its types and its qualifier: "piercing from magic weapons" gives [["piercing"], "from magic weapons"]. */
export function splitQualified(part: string): { types: string[]; qualifier: string | null } {
  const at = part.indexOf(" from ");
  if (at === -1) return { types: typesIn(part), qualifier: null };
  return { types: typesIn(part.slice(0, at)), qualifier: part.slice(at + 1) };
}

export type DamageKind = "resist" | "immune" | "vulnerable";

/**
 * The 5etools entries for a damage line. A plain line is a list of type names. A qualified part becomes an object such
 * as { immune: [types], note: "from nonmagical weapons", cond: true }, and a part with no types becomes { special }.
 */
export function fiveToolsDamageEntries(kind: DamageKind, types: readonly string[], text: string | null | undefined): unknown[] {
  if (!text) return [...types];
  return text.split("; ").map((part) => {
    if (TYPES.has(part)) return part;
    const { types: found, qualifier } = splitQualified(part);
    if (found.length === 0 || qualifier === null) return { special: part };
    return { [kind]: found, note: qualifier, cond: true };
  });
}

/** What Foundry can model: which kinds of weapon get past the trait ("mgc", "sil", "ada"), and any wording it cannot. */
export function foundryDamageTrait(text: string | null | undefined): { bypasses: string[]; custom: string } {
  if (!text) return { bypasses: [], custom: "" };
  const bypasses = new Set<string>();
  const custom: string[] = [];
  for (const part of text.split("; ")) {
    if (TYPES.has(part)) continue;
    const { qualifier } = splitQualified(part);
    const expressible = qualifier !== null && /nonmagical/.test(qualifier) && !/spells|good creatures/.test(qualifier);
    if (!expressible) {
      custom.push(part);
      continue;
    }
    bypasses.add("mgc");
    if (/silvered/.test(qualifier)) bypasses.add("sil");
    if (/adamantine/.test(qualifier)) bypasses.add("ada");
  }
  return { bypasses: [...bypasses], custom: custom.join("; ") };
}

import { CR_LADDER, type FilterState, type XpRange } from "./filters";
import type { GenerateRequest } from "./generatorApi";
import { FEATURE_LABELS, label } from "./options";
import { crLabelsInBand } from "./party";

// Turns what the user has chosen on screen into a generator request, and into a plain-English summary.
// Pure functions: no React, no network.

export interface BuiltRequest {
  /** The request, or null when the choices cannot match any monster (then `problem` says why). */
  request: GenerateRequest | null;
  problem: string | null;
}

/**
 * The filters plus the difficulty pick, combined into one request. Difficulty becomes a challenge-rating
 * range, which is intersected with any CR filter the user also set.
 */
export function buildGenerateRequest(filters: FilterState, band: XpRange | null): BuiltRequest {
  let crMin = filters.crMin;
  let crMax = filters.crMax;

  if (band) {
    const values = crLabelsInBand(band).map((l) => CR_LADDER.find((c) => c.label === l)!.value);
    if (values.length === 0) {
      return { request: null, problem: "No challenge rating fits that difficulty for your party." };
    }
    const low = Math.min(...values);
    const high = Math.max(...values);
    crMin = crMin === null ? low : Math.max(crMin, low);
    crMax = crMax === null ? high : Math.min(crMax, high);
  }

  if (crMin !== null && crMax !== null && crMin > crMax) {
    return { request: null, problem: "The challenge rating filter and the difficulty pick don't overlap." };
  }

  return {
    problem: null,
    request: {
      crMin,
      crMax,
      types: [...filters.types],
      sizes: [...filters.sizes],
      environments: [...filters.environments],
      roles: [...filters.roles],
      damageThemes: [...filters.damageThemes],
      features: [...filters.features],
    },
  };
}

function joinWith(items: string[], word: string): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ${word} ${items[items.length - 1]}`;
}

function crLabel(value: number): string {
  return CR_LADDER.find((c) => c.value === value)?.label ?? String(value);
}

/** "Undead, Large, CR 3 to 4, swamp or underdark, fire damage, flying and spellcasting". */
export function describeRequest(request: GenerateRequest): string {
  const parts: string[] = [request.types.length > 0 ? joinWith(request.types.map(label), "or") : "Any monster"];
  if (request.sizes.length > 0) parts.push(joinWith(request.sizes.map(label), "or"));

  const { crMin, crMax } = request;
  if (crMin !== null && crMax !== null) {
    parts.push(crMin === crMax ? `CR ${crLabel(crMin)}` : `CR ${crLabel(crMin)} to ${crLabel(crMax)}`);
  } else if (crMin !== null) {
    parts.push(`CR ${crLabel(crMin)} or higher`);
  } else if (crMax !== null) {
    parts.push(`CR up to ${crLabel(crMax)}`);
  }

  if (request.environments.length > 0) parts.push(joinWith(request.environments, "or"));
  if (request.roles.length > 0) parts.push(joinWith(request.roles, "or"));
  if (request.damageThemes.length > 0) parts.push(`${joinWith(request.damageThemes, "or")} damage`);
  if (request.features.length > 0) {
    parts.push(joinWith(request.features.map((f) => FEATURE_LABELS[f].toLowerCase()), "and"));
  }
  return parts.join(", ");
}

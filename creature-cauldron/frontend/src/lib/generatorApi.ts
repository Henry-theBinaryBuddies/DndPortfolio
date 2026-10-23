import type { Monster } from "../types/monster";
import type { CreatureType, DamageTheme, Environment, Feature, Role, Size } from "./options";

// The contract between the page and a monster generator. The real generator will be the Python server
// (not built yet); until then the page uses the offline version below, and a demo version for trying the
// buttons out. The page only ever talks to this interface, so swapping in the real one changes nothing else.

/** What the user asked for: only structured choices, never free text. */
export interface GenerateRequest {
  /** Inclusive challenge rating bounds (already combined with the difficulty pick). Null means no bound. */
  crMin: number | null;
  crMax: number | null;
  types: CreatureType[];
  sizes: Size[];
  environments: Environment[];
  roles: Role[];
  damageThemes: DamageTheme[];
  features: Feature[];
  /** Ids of generated monsters the page already has, so a monster the server hands back from its cache is always a new one. */
  excludeIds?: string[];
}

export interface ReskinRequest {
  /** The whole monster, so the request stands alone (it may be a generated one the server has never seen). */
  base: Monster;
  /** Remix: a new damage theme, or "surprise" to let the server pick. */
  theme?: DamageTheme | "surprise" | null;
  /** With a theme: change the damage only, leaving the monster's resistances and immunities as they were. */
  damageOnly?: boolean;
  /** Remix: the key of a signature move (see remixMoves.ts), or "surprise". */
  move?: string | null;
  /** About one challenge rating stronger, worked out by the server. */
  levelUp?: boolean;
  /** A new name, description and ability names, with every number as it was. Stands alone: never combined with the rest. */
  reflavor?: boolean;
  /** Polymorph: the id of a creature to borrow features from. Needs `borrow` or `forgeChooses`; may also level up. */
  donorId?: string;
  /** Polymorph: the keys of the donor's features to take (see `graftOptions`). */
  borrow?: string[];
  /** Polymorph: let the forge pick which features to borrow. */
  forgeChooses?: boolean;
  /** Polymorph: give the hybrid legendary actions (borrowed from the donor if it has them, else built from its own attacks). */
  legendary?: boolean;
}

export type BorrowKind = "movement" | "sense" | "trait" | "attack" | "damage";

/** One thing a donor could lend a base: a key to send back, what kind of thing it is, and its name for the visitor. */
export interface BorrowOption {
  key: string;
  kind: BorrowKind;
  label: string;
}

export type GraftOptionsResult = { ok: true; options: BorrowOption[] } | { ok: false; reason: GeneratorFailure; message: string };

/** Why a request did not produce a monster. */
export type GeneratorFailure = "offline" | "resting" | "rate-limited" | "invalid" | "error";

export type GeneratorResult =
  | { ok: true; monster: Monster; notes: string[] }
  | { ok: false; reason: GeneratorFailure; message: string };

/** What a server says about itself: ready, out of daily allowance, or not answering. */
export type ForgeStatus = "ok" | "resting" | "offline";

export interface Generator {
  /** "offline" means no server is configured, so the buttons explain themselves instead of trying. */
  readonly mode: "offline" | "demo" | "live";
  generate(request: GenerateRequest): Promise<GeneratorResult>;
  reskin(request: ReskinRequest): Promise<GeneratorResult>;
  /** What the donor could lend the base. Free: the server makes no AI call to answer it. */
  graftOptions(baseId: string, donorId: string): Promise<GraftOptionsResult>;
  /** Only a live generator can ask a server how it is. The others leave this out. */
  status?(): Promise<ForgeStatus>;
}

export const OFFLINE_MESSAGE = "Generator offline: the library still works.";
/** A server address IS configured but it did not answer: a different situation from having no server at all. */
export const UNREACHABLE_MESSAGE = "Can't reach the generator server just now. The library still works.";
export const RESTING_MESSAGE = "The forge is resting, back tomorrow. The library still works.";

/** The generator used when no server exists. It never makes a network call. */
export const offlineGenerator: Generator = {
  mode: "offline",
  generate: () => Promise.resolve({ ok: false, reason: "offline", message: OFFLINE_MESSAGE }),
  reskin: () => Promise.resolve({ ok: false, reason: "offline", message: OFFLINE_MESSAGE }),
  graftOptions: () => Promise.resolve({ ok: false, reason: "offline", message: OFFLINE_MESSAGE }),
};

/** The message to show for a failure, in the app's own words. */
export function failureMessage(reason: GeneratorFailure, message: string): string {
  switch (reason) {
    case "offline":
      return message || OFFLINE_MESSAGE;
    case "resting":
      return RESTING_MESSAGE;
    case "rate-limited":
      return message || "Slow down a little: try again in a minute.";
    case "invalid":
      return message || "That request couldn't be made. Try different filters.";
    case "error":
      return message || "Something went wrong. Try again in a moment.";
  }
}

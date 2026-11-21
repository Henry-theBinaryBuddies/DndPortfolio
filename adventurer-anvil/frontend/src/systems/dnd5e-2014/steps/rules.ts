// The Rules step: the optional rules this character uses, each a switch with a default (so the step is always done).
// Later a campaign may set them. Turning a rule off deletes nothing: the choices it used stop counting, and Review
// lists them as unused.
//
//   rules.multiclassing   "on" | "off"              levels in more than one class (default on)
//   rules.feats           "off" | "on"              feats in place of Ability Score Improvements, and entries that need feats
//   rules.hit-points      "average" | "rolled"      hit points after 1st level
//   rules.encumbrance     "standard" | "variant"    carrying limits
//   rules.origin          "standard" | "custom"     move the race's ability score increases to other scores
import type { Option } from "../../../core";
import type { Context } from "../engine/context";

export const RULES_STEP = { id: "rules", label: "Rules" };

export interface Rules {
  multiclassing: boolean;
  feats: boolean;
  hitPoints: "average" | "rolled";
  encumbrance: "standard" | "variant";
  origin: "standard" | "custom";
}

export const DEFAULT_RULES: Rules = { multiclassing: true, feats: false, hitPoints: "average", encumbrance: "standard", origin: "standard" };

export const RULE_KEYS = {
  multiclassing: "rules.multiclassing",
  feats: "rules.feats",
  hitPoints: "rules.hit-points",
  encumbrance: "rules.encumbrance",
  origin: "rules.origin",
} as const;

const on: Option[] = [{ value: "on", name: "On" }, { value: "off", name: "Off" }];
const off: Option[] = [{ value: "off", name: "Off" }, { value: "on", name: "On" }];

const SWITCHES: { rule: keyof Rules; label: string; hint: string; options: Option[]; read: (v: string) => unknown; write: (r: Rules) => string }[] = [
  {
    rule: "multiclassing", label: "Multiclassing", options: on,
    hint: "Levels in more than one class, for characters who meet each class's scores.",
    read: (v) => v === "on", write: (r) => (r.multiclassing ? "on" : "off"),
  },
  {
    rule: "feats", label: "Feats", options: off,
    hint: "Take a feat in place of an Ability Score Improvement, and use races and options that need feats (a Variant Human from your own pack, say).",
    read: (v) => v === "on", write: (r) => (r.feats ? "on" : "off"),
  },
  {
    rule: "hitPoints", label: "Hit points after 1st level", options: [{ value: "average", name: "Average" }, { value: "rolled", name: "Rolled" }],
    hint: "Take each hit die's fixed average, or roll it. Every roll is kept in the roll log.",
    read: (v) => v, write: (r) => r.hitPoints,
  },
  {
    rule: "encumbrance", label: "Encumbrance", options: [{ value: "standard", name: "Standard" }, { value: "variant", name: "Variant" }],
    hint: "Standard: carry up to Strength × 15 lb. Variant: slower over Strength × 5 lb, and slower still over Strength × 10 lb.",
    read: (v) => v, write: (r) => r.encumbrance,
  },
  {
    rule: "origin", label: "Ability increases from your race", options: [{ value: "standard", name: "As written" }, { value: "custom", name: "Move them" }],
    hint: "Move your race's ability score increases to other scores, each to a different one (a custom origin).",
    read: (v) => v, write: (r) => r.origin,
  },
];

/** Opens the switches and returns the rules in use (the default for any not set, or set to something unknown). */
export function rulesStep(ctx: Context): Rules {
  ctx.steps.push(RULES_STEP);
  const rules: Rules = { ...DEFAULT_RULES };
  for (const s of SWITCHES) {
    const key = RULE_KEYS[s.rule];
    const stored = ctx.doc.choices[key];
    const fallback = s.write(DEFAULT_RULES);
    ctx.open.push({
      spec: { key, step: RULES_STEP.id, label: s.label, hint: s.hint, kind: "pick-one", presentation: "segmented", required: false, options: s.options, defaultValue: fallback },
      picks: typeof stored === "string" ? [stored] : [],
      answered: true,
    });
    if (stored === undefined) continue;
    if (typeof stored === "string" && s.options.some((o) => o.value === stored)) {
      (rules as unknown as Record<string, unknown>)[s.rule] = s.read(stored);
    } else {
      ctx.issues.push({ id: `rule:${key}`, severity: "error", step: RULES_STEP.id, key, overridable: false, message: `${s.label}: not one of the choices, so the default is used.` });
    }
  }
  ctx.rules = rules;
  return rules;
}

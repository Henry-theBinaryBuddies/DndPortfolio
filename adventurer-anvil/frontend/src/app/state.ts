// The character being built, held in memory and saved by the builder as it changes. Every change goes through
// the core's functions, which return a new document.
import { addOverride, addRolls, clearChoices, NAME_KEY, newCharacterDocument, removeOverride, setChoice, setName, type CharacterDocument, type ChoiceKey, type ChoiceValue, type RollRecord, type SystemModule } from "../core";
import type { LoadedPack } from "./packs";

export type Action =
  | { type: "set"; key: ChoiceKey; value: ChoiceValue }
  /** Several choices at once, as one change (levelling up). */
  | { type: "set-many"; choices: Record<ChoiceKey, ChoiceValue> }
  | { type: "clear"; keys: ChoiceKey[] }
  | { type: "rolls"; rolls: RollRecord[] }
  | { type: "allow"; issueId: string; note: string }
  | { type: "disallow"; issueId: string }
  /** The whole file, e.g. the copy another tab saved. */
  | { type: "replace"; doc: CharacterDocument };

export function reducer(doc: CharacterDocument, action: Action): CharacterDocument {
  const now = new Date().toISOString();
  switch (action.type) {
    case "set":
      // The name lives in the file's own field, not among the choices.
      if (action.key === NAME_KEY) return setName(doc, typeof action.value === "string" ? action.value : "", now);
      return setChoice(doc, action.key, action.value, now);
    case "set-many":
      return withChoices(doc, action.choices, now);
    case "clear":
      return clearChoices(doc, action.keys, now);
    case "rolls":
      return addRolls(doc, action.rolls, now);
    case "allow":
      return addOverride(doc, action.issueId, action.note, now);
    case "disallow":
      return removeOverride(doc, action.issueId, now);
    case "replace":
      return action.doc;
  }
}

/** The document with these choices set. */
export function withChoices(doc: CharacterDocument, choices: Record<ChoiceKey, ChoiceValue>, now: string): CharacterDocument {
  return Object.entries(choices).reduce((d, [key, value]) => setChoice(d, key, value, now), doc);
}

export function freshCharacter(system: SystemModule, packs: LoadedPack[]): CharacterDocument {
  return newCharacterDocument({
    id: crypto.randomUUID(),
    system: { id: system.id, version: system.version },
    packs: packs.map((p) => ({ id: p.id, version: p.version })),
    now: new Date().toISOString(),
    choices: system.initialChoices(),
  });
}

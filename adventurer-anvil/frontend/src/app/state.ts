// The character being built, held in memory (saving arrives in Milestone 1, step 8). Every change goes through
// the core's functions, which return a new document.
import { addOverride, addRolls, clearChoices, NAME_KEY, newCharacterDocument, removeOverride, setChoice, setName, type CharacterDocument, type ChoiceKey, type ChoiceValue, type RollRecord, type SystemModule } from "../core";
import type { LoadedPack } from "./packs";

export type Action =
  | { type: "set"; key: ChoiceKey; value: ChoiceValue }
  | { type: "clear"; keys: ChoiceKey[] }
  | { type: "rolls"; rolls: RollRecord[] }
  | { type: "allow"; issueId: string; note: string }
  | { type: "disallow"; issueId: string };

export function reducer(doc: CharacterDocument, action: Action): CharacterDocument {
  const now = new Date().toISOString();
  switch (action.type) {
    case "set":
      // The name lives in the file's own field, not among the choices.
      if (action.key === NAME_KEY) return setName(doc, typeof action.value === "string" ? action.value : "", now);
      return setChoice(doc, action.key, action.value, now);
    case "clear":
      return clearChoices(doc, action.keys, now);
    case "rolls":
      return addRolls(doc, action.rolls, now);
    case "allow":
      return addOverride(doc, action.issueId, action.note, now);
    case "disallow":
      return removeOverride(doc, action.issueId, now);
  }
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

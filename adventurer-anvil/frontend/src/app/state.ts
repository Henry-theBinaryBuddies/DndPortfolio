// The character being built, held in memory (saving arrives in Milestone 1, step 8). Every change goes through
// the core's functions, which return a new document.
import { clearChoices, newCharacterDocument, setChoice, type CharacterDocument, type ChoiceKey, type ChoiceValue, type SystemModule } from "../core";
import type { LoadedPack } from "./packs";

export type Action =
  | { type: "set"; key: ChoiceKey; value: ChoiceValue }
  | { type: "clear"; keys: ChoiceKey[] };

export function reducer(doc: CharacterDocument, action: Action): CharacterDocument {
  const now = new Date().toISOString();
  switch (action.type) {
    case "set":
      return setChoice(doc, action.key, action.value, now);
    case "clear":
      return clearChoices(doc, action.keys, now);
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

// Several levels (floors) in one map.
//
// The editor works on one level at a time, and the map's own lists (rooms, doors, stamps...) hold that level.
// The other levels are kept in `levels`, each with its content; the entry for the level being edited has
// `content: null`. Switching levels swaps the lists. So everything else in the editor never needs to know about levels.

import { LIMITS, type LevelContent, type MapDoc } from "./model";

export function emptyContent(): LevelContent {
  return { rooms: [], openings: [], strokes: [], stamps: [], labels: [], markers: [], lights: [] };
}

/** What is on the level being edited. */
export function contentOf(doc: MapDoc): LevelContent {
  const { rooms, openings, strokes, stamps, labels, markers, lights } = doc;
  return { rooms, openings, strokes, stamps, labels, markers, lights };
}

/** The map as seen on any one level, whether or not it is the one being edited. */
export function levelDoc(doc: MapDoc, index: number): MapDoc {
  const content = index === doc.level ? null : doc.levels[index]?.content;
  return content ? { ...doc, ...content } : doc;
}

/** Start editing another level. */
export function switchLevel(doc: MapDoc, index: number): MapDoc {
  if (index === doc.level || index < 0 || index >= doc.levels.length) return doc;
  const target = doc.levels[index].content;
  if (!target) return doc;
  const levels = doc.levels.map((l, i) => (i === doc.level ? { ...l, content: contentOf(doc) } : i === index ? { ...l, content: null } : l));
  return { ...doc, ...target, levels, level: index };
}

/** Add an empty level above the others and start editing it. Null when there are already too many. */
export function addLevel(doc: MapDoc, id: string, name: string): MapDoc | null {
  if (doc.levels.length >= LIMITS.maxLevels) return null;
  const levels = [...doc.levels, { id, name: name.slice(0, LIMITS.maxLevelName), content: emptyContent() }];
  return switchLevel({ ...doc, levels }, levels.length - 1);
}

/** Delete a level and everything on it. A map always keeps at least one. */
export function removeLevel(doc: MapDoc, index: number): MapDoc {
  if (doc.levels.length <= 1 || index < 0 || index >= doc.levels.length) return doc;
  const editing = index === doc.level ? switchLevel(doc, index > 0 ? index - 1 : 1) : doc;
  const levels = editing.levels.filter((_, i) => i !== index);
  return { ...editing, levels, level: editing.level > index ? editing.level - 1 : editing.level };
}

export function renameLevel(doc: MapDoc, index: number, name: string): MapDoc {
  const clean = name.trim().slice(0, LIMITS.maxLevelName);
  const level = doc.levels[index];
  if (!level || !clean || clean === level.name) return doc;
  return { ...doc, levels: doc.levels.map((l, i) => (i === index ? { ...l, name: clean } : l)) };
}

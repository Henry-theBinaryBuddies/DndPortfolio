// Saves the character as it changes: half a second after the last change, and at once when leaving it (the
// Characters button, or closing the tab). A new character isn't saved until something is chosen or named, so
// opening the app doesn't fill the list with blanks. If another tab saves the same character, saving pauses until
// the user picks which copy to keep.
import { useCallback, useEffect, useRef, useState } from "react";
import { readCharacter, type CharacterDocument, type ContentIndex, type SystemModule } from "../core";
import { thumbnail } from "./files";
import { StorageFullError, type CharacterStore } from "./store";

export type SaveStatus =
  | { kind: "blank" }
  | { kind: "saving" }
  | { kind: "saved"; at: Date }
  | { kind: "full" }
  | { kind: "failed"; message: string };

/** Set while another tab has saved (or deleted) this character since this tab last did. */
export type Elsewhere = null | "changed" | "deleted";

const DELAY = 500;

export function useAutosave(args: {
  doc: CharacterDocument;
  store: CharacterStore;
  system: SystemModule;
  content: ContentIndex;
  /** True for a character opened from storage or a file: it is saved from the first change, or at once. */
  startSaved: boolean;
  onReplace: (doc: CharacterDocument) => void;
}) {
  const { doc, store, system, content, startSaved, onReplace } = args;
  const [status, setStatus] = useState<SaveStatus>(startSaved ? { kind: "saved", at: new Date(doc.updatedAt) } : { kind: "blank" });
  const [elsewhere, setElsewhere] = useState<Elsewhere>(null);

  const latest = useRef(doc);
  latest.current = doc;
  const initial = useRef<CharacterDocument | null>(doc);
  const lastSaved = useRef<CharacterDocument | null>(startSaved ? doc : null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const thumbs = useRef(new Map<string, string>());
  const paused = useRef(false);
  paused.current = elsewhere !== null;

  const needsSaving = (d: CharacterDocument) => d !== lastSaved.current && (lastSaved.current !== null || d !== initial.current);

  /** `quick` skips making a new portrait copy (so the write happens before the page closes). */
  const save = useCallback(async (quick = false) => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const d = latest.current;
    if (paused.current || !needsSaving(d)) return;
    const blurb = system.describe(d, content);
    let picture: string | undefined;
    if (blurb.picture) {
      picture = thumbs.current.get(blurb.picture);
      if (!picture && !quick) {
        try {
          picture = await thumbnail(blurb.picture);
          thumbs.current.set(blurb.picture, picture);
        } catch { /* listed without a picture */ }
      }
    }
    try {
      await store.save(d, picture ? { text: blurb.text, picture } : { text: blurb.text });
      lastSaved.current = d;
      if (latest.current === d) setStatus({ kind: "saved", at: new Date() });
    } catch (e) {
      setStatus(e instanceof StorageFullError ? { kind: "full" } : { kind: "failed", message: e instanceof Error ? e.message : String(e) });
    }
  }, [store, system, content]);

  // After each change: wait for a pause, then save.
  useEffect(() => {
    if (paused.current || !needsSaving(doc)) return;
    setStatus({ kind: "saving" });
    timer.current = setTimeout(() => void save(), DELAY);
    return () => clearTimeout(timer.current);
  }, [doc, save]);

  // Closing or hiding the tab: write now.
  useEffect(() => {
    const now = () => { if (timer.current !== undefined) void save(true); };
    const hidden = () => { if (document.visibilityState === "hidden") now(); };
    window.addEventListener("pagehide", now);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      window.removeEventListener("pagehide", now);
      document.removeEventListener("visibilitychange", hidden);
    };
  }, [save]);

  // Another tab saved or deleted this character.
  useEffect(() => store.watch((id) => {
    if (id !== latest.current.id || lastSaved.current === null) return;
    clearTimeout(timer.current);
    timer.current = undefined;
    void store.load(id).then((data) => setElsewhere(data === undefined ? "deleted" : "changed"));
  }), [store]);

  /** Saves any change still waiting, at once: before leaving the character. */
  const flush = useCallback(() => save(), [save]);

  /** Takes the copy the other tab saved. */
  const reload = useCallback(async () => {
    const data = await store.load(latest.current.id);
    const opened = data === undefined ? undefined : readCharacter(data, system, content.packs());
    if (!opened?.ok) {
      setStatus({ kind: "failed", message: "the other tab's copy couldn't be read" });
      return;
    }
    lastSaved.current = opened.doc;
    setElsewhere(null);
    setStatus({ kind: "saved", at: new Date(opened.doc.updatedAt) });
    onReplace(opened.doc);
  }, [store, system, content, onReplace]);

  /** Keeps this tab's copy, saving over the other one. */
  const keepMine = useCallback(() => {
    paused.current = false;
    lastSaved.current = null;
    initial.current = null; // so even an untouched character is saved
    setElsewhere(null);
    void save();
  }, [save]);

  return { status, elsewhere, flush, reload, keepMine };
}

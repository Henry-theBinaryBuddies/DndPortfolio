// "My characters": the saved characters, newest first, each to open, level up (for systems with levels), download or
// delete; a new one; or a file to open. Opening a file checks it (readCharacterText) and saves it here before the
// builder opens it.
import { useEffect, useRef, useState } from "react";
import { readCharacter, readCharacterText, type CharacterDocument, type ContentIndex, type SystemModule } from "../core";
import type { Opening } from "./Builder";
import { downloadCharacter } from "./files";
import { withChoices } from "./state";
import { StorageFullError, type CharacterStore, type CharacterSummary } from "./store";

const when = (iso: string) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "unknown");
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("") || "?";
const nameOf = (s: { name: string }) => s.name || "Unnamed character";

/** A file that has the same id as a saved character, waiting for the user to say which to keep. */
interface Clash {
  incoming: CharacterDocument;
  notes: string[];
  saved: CharacterSummary;
}

export function Characters({ store, system, content, onOpen, onNew, focusHeading }: {
  store: CharacterStore;
  system: SystemModule;
  content: ContentIndex;
  onOpen: (opening: Opening) => void;
  onNew: () => void;
  focusHeading: boolean;
}) {
  const [list, setList] = useState<CharacterSummary[] | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [clash, setClash] = useState<Clash | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => { if (focusHeading) heading.current?.focus(); }, []);

  const refresh = () => store.list().then(setList);
  useEffect(() => {
    void refresh();
    return store.watch(() => void refresh());
  }, [store]);

  const fail = (e: unknown) => setMessage(e instanceof StorageFullError ? "There's no room left in this browser's storage. Delete a character you've downloaded, then try again." : `Something went wrong: ${e instanceof Error ? e.message : String(e)}`);

  const open = async (id: string) => {
    setMessage(null);
    const result = readCharacter(await store.load(id), system, content.packs());
    if (!result.ok) return setMessage(`That character couldn't be opened. ${result.error}`);
    onOpen({ doc: result.doc, saved: true, notes: result.notes });
  };

  /** Takes the next level, saves it, and opens the step where its choices are made. */
  const levelUp = async (summary: CharacterSummary) => {
    setMessage(null);
    const result = readCharacter(await store.load(summary.id), system, content.packs());
    if (!result.ok) return setMessage(`That character couldn't be opened. ${result.error}`);
    const next = system.levelUp?.(result.doc, content);
    if (!next) return;
    if (!next.ok) return setMessage(`${nameOf(summary)} can't level up yet. ${next.reason}`);
    const doc = withChoices(result.doc, next.choices, new Date().toISOString());
    try {
      await store.save(doc, system.describe(doc, content));
      onOpen({ doc, saved: true, notes: result.notes, step: next.step });
    } catch (e) {
      fail(e);
    }
  };

  const download = async (id: string) => {
    const result = readCharacter(await store.load(id), system, content.packs());
    if (!result.ok) return setMessage(`That character couldn't be read. ${result.error}`);
    downloadCharacter(result.doc);
  };

  const remove = async (id: string) => {
    await store.remove(id);
    setConfirming(null);
    await refresh();
    heading.current?.focus();
  };

  /** Saves the opened file (as it is, or as a copy) and opens it. */
  const keep = async (doc: CharacterDocument, notes: string[]) => {
    try {
      await store.save(doc, system.describe(doc, content));
      onOpen({ doc, saved: true, notes });
    } catch (e) {
      fail(e);
    }
  };

  const chooseFile = async (file: File | undefined) => {
    if (fileInput.current) fileInput.current.value = ""; // so the same file can be chosen again
    if (!file) return;
    setMessage(null);
    const result = readCharacterText(await file.text(), system, content.packs());
    if (!result.ok) return setMessage(`“${file.name}” couldn't be opened. ${result.error}`);
    const saved = list?.find((s) => s.id === result.doc.id);
    if (saved) return setClash({ incoming: result.doc, notes: result.notes, saved });
    await keep(result.doc, result.notes);
  };

  const keepBoth = (c: Clash) => {
    const now = new Date().toISOString();
    void keep({ ...c.incoming, id: crypto.randomUUID(), name: `${nameOf(c.incoming)} (copy)`, updatedAt: now }, c.notes);
  };

  return (
    <div className="app">
      <a className="skip" href="#main">Skip to your characters</a>
      <header className="top">
        <span className="brand">Adventurer Anvil</span>
      </header>
      <main className="page characters" id="main">
        <h1 tabIndex={-1} ref={heading}>My characters</h1>
        <p className="dim" style={{ marginTop: 4 }}>Saved in this browser. Download a file to keep a character safe or move it to another device.</p>
        <div className="toolbar">
          <button type="button" className="button primary" onClick={onNew}>New character</button>
          <button type="button" className="button" onClick={() => fileInput.current?.click()}>Open a file…</button>
          <input ref={fileInput} type="file" accept=".json,application/json" hidden aria-label="Character file" onChange={(e) => void chooseFile(e.target.files?.[0])} />
        </div>
        {message && <p className="issue error" role="alert">{message}</p>}

        {clash && (
          <section className="notice banner" aria-labelledby="clash-title" role="alertdialog">
            <h2 id="clash-title">{nameOf(clash.incoming)} is already saved here</h2>
            <p>The saved one was edited {when(clash.saved.updatedAt)}; the file's was edited {when(clash.incoming.updatedAt)}.</p>
            <p className="banner-actions">
              <button type="button" className="button small primary" onClick={() => { void keep(clash.incoming, clash.notes); setClash(null); }}>Replace the saved one</button>
              <button type="button" className="button small" onClick={() => { keepBoth(clash); setClash(null); }}>Keep both</button>
              <button type="button" className="button small" onClick={() => setClash(null)}>Cancel</button>
            </p>
          </section>
        )}

        {list === null ? (
          <p className="dim" role="status">Loading…</p>
        ) : list.length === 0 ? (
          <p className="notice" style={{ marginTop: 16 }}>No saved characters yet.</p>
        ) : (
          <ul className="character-list" aria-label="Saved characters">
            {list.map((c) => (
              <li key={c.id}>
                {c.picture ? <img src={c.picture} alt="" className="avatar" /> : <span className="avatar" aria-hidden="true">{initials(c.name)}</span>}
                <span className="who-line">
                  <span className="character-name">{nameOf(c)}</span>
                  <span className="dim">{[c.text, `edited ${when(c.updatedAt)}`].filter(Boolean).join(" · ")}</span>
                </span>
                {confirming === c.id ? (
                  <span className="confirm" role="group" aria-label={`Delete ${nameOf(c)}?`}>
                    <span>Delete {nameOf(c)}? This can't be undone. Download a copy first if you might want it.</span>
                    <span className="banner-actions">
                      <button type="button" className="button small danger" onClick={() => void remove(c.id)} autoFocus>Delete</button>
                      <button type="button" className="button small" onClick={() => setConfirming(null)}>Cancel</button>
                    </span>
                  </span>
                ) : (
                  <span className="row-actions">
                    <button type="button" className="button small primary" onClick={() => void open(c.id)}>Open<span className="sr-only"> {nameOf(c)}</span></button>
                    {system.levelUp && <button type="button" className="button small" onClick={() => void levelUp(c)}>Level up<span className="sr-only"> {nameOf(c)}</span></button>}
                    <button type="button" className="button small" onClick={() => void download(c.id)}>Download<span className="sr-only"> {nameOf(c)}</span></button>
                    <button type="button" className="button small" onClick={() => setConfirming(c.id)}>Delete<span className="sr-only"> {nameOf(c)}</span></button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}

// The app shell: loads the built-in packs for the rules module, then shows the saved characters, or goes straight
// to a new one when there are none. It asks the core what to show and never calculates anything itself.
import { useEffect, useMemo, useState } from "react";
import { createContentIndex } from "../core";
import { dnd5e2014 } from "../systems/dnd5e-2014";
import { Builder, type Opening } from "./Builder";
import { Characters } from "./Characters";
import { loadBuiltInPacks, type LoadedPack } from "./packs";
import { freshCharacter } from "./state";
import { LocalStore, MemoryStorage, type CharacterStore } from "./store";
import "./theme.css";

const SYSTEM = dnd5e2014;

/** The browser's storage, or (if the browser refuses it) a stand-in that lasts until the tab closes. */
function browserStore(): CharacterStore {
  try {
    const storage = window.localStorage;
    storage.getItem("anvil:characters");
    return new LocalStore(storage, window);
  } catch {
    return new LocalStore(new MemoryStorage());
  }
}

type Screen = { kind: "starting" } | { kind: "list" } | { kind: "build"; opening: Opening };

export function App() {
  const [packs, setPacks] = useState<LoadedPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [screen, setScreenNow] = useState<Screen>({ kind: "starting" });
  // After the first screen, each change of screen moves focus to its heading (for screen readers).
  const [moved, setMoved] = useState(false);
  const setScreen = (next: Screen) => { if (screen.kind !== "starting") setMoved(true); setScreenNow(next); };
  const store = useMemo(browserStore, []);
  const content = useMemo(() => createContentIndex(packs ?? []), [packs]);

  useEffect(() => {
    loadBuiltInPacks(SYSTEM).then(setPacks, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  const fresh = (p: LoadedPack[]): Screen => ({ kind: "build", opening: { doc: freshCharacter(SYSTEM, p), saved: false, notes: [] } });

  useEffect(() => {
    if (!packs || screen.kind !== "starting") return;
    void store.list().then((list) => setScreen(list.length ? { kind: "list" } : fresh(packs)));
  }, [packs, screen.kind, store]);

  if (error) {
    return (
      <main className="page" style={{ maxWidth: 640 }}>
        <h1>Adventurer Anvil couldn't start</h1>
        <p style={{ marginTop: 10 }}>The built-in content didn't load. Try reloading the page.</p>
        <pre className="notice" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{error}</pre>
      </main>
    );
  }
  if (!packs || screen.kind === "starting") {
    return <main className="page"><p className="dim" role="status">Loading content…</p></main>;
  }
  if (screen.kind === "list") {
    return (
      <Characters
        store={store}
        system={SYSTEM}
        content={content}
        onOpen={(opening) => setScreen({ kind: "build", opening })}
        onNew={() => setScreen(fresh(packs))}
        focusHeading={moved}
      />
    );
  }
  return (
    <Builder
      key={screen.opening.doc.id}
      system={SYSTEM}
      packs={packs}
      content={content}
      store={store}
      opening={screen.opening}
      onLeave={() => setScreen({ kind: "list" })}
      focusHeading={moved}
    />
  );
}

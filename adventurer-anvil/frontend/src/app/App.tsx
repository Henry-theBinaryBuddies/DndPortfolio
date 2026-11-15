// The app shell: loads the built-in packs for the rules module, then shows the builder. It asks the core what to
// show and never calculates anything itself.
import { useEffect, useState } from "react";
import { dnd5e2014 } from "../systems/dnd5e-2014";
import { Builder } from "./Builder";
import { loadBuiltInPacks, type LoadedPack } from "./packs";
import "./theme.css";

const SYSTEM = dnd5e2014;

export function App() {
  const [packs, setPacks] = useState<LoadedPack[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadBuiltInPacks(SYSTEM).then(setPacks, (e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  if (error) {
    return (
      <main className="page" style={{ maxWidth: 640 }}>
        <h1>Adventurer Anvil couldn't start</h1>
        <p style={{ marginTop: 10 }}>The built-in content didn't load. Try reloading the page.</p>
        <pre className="notice" style={{ marginTop: 12, whiteSpace: "pre-wrap" }}>{error}</pre>
      </main>
    );
  }
  if (!packs) {
    return <main className="page"><p className="dim" role="status">Loading content…</p></main>;
  }
  return <Builder system={SYSTEM} packs={packs} />;
}

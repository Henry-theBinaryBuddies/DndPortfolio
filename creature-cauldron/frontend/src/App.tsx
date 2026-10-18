import { useEffect, useState } from "react";
import StatBlock from "./components/StatBlock";
import { loadMonsters } from "./lib/loadMonsters";
import type { Monster } from "./types/monster";

export default function App() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [error, setError] = useState<string | null>(null);
  // State remembers a value between renders. Changing it re-draws the page.
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    loadMonsters()
      .then(setMonsters)
      .catch((e: Error) => setError(e.message));
  }, []);

  // Until the user picks one, show the first monster in the library.
  const selected = monsters.find((m) => m.id === selectedId) ?? monsters[0];

  return (
    <main className="page">
      <header className="no-print">
        <h1>Creature Cauldron</h1>
        <p className="tagline">Brew a monster for your table.</p>
      </header>

      {error && <p className="error no-print">{error}</p>}

      <div className="layout">
        <section className="no-print">
          <h2>Library ({monsters.length})</h2>
          <ul className="monster-list">
            {monsters.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  className={m.id === selected?.id ? "monster-button selected" : "monster-button"}
                  aria-pressed={m.id === selected?.id}
                  onClick={() => setSelectedId(m.id)}
                >
                  <strong>{m.name}</strong>
                  <span>
                    {m.size} {m.type} · CR {m.challenge.cr}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {selected && (
          <section className="detail">
            <button type="button" className="print-button no-print" onClick={() => window.print()}>
              Print stat block
            </button>
            <StatBlock monster={selected} />
          </section>
        )}
      </div>
    </main>
  );
}

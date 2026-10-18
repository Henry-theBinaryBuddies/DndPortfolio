import { useEffect, useState } from "react";
import { loadMonsters } from "./lib/loadMonsters";
import type { Monster } from "./types/monster";

export default function App() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadMonsters()
      .then(setMonsters)
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <main className="page">
      <header>
        <h1>Creature Cauldron</h1>
        <p className="tagline">Brew a monster for your table.</p>
      </header>

      {error && <p className="error">{error}</p>}

      <section>
        <h2>Library ({monsters.length})</h2>
        <ul className="monster-list">
          {monsters.map((m) => (
            <li key={m.id}>
              <strong>{m.name}</strong>
              <span>
                {m.size} {m.type} · CR {m.challenge.cr}
              </span>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}

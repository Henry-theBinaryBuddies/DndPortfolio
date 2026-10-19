import { useEffect, useMemo, useState } from "react";
import FilterPanel from "./components/FilterPanel";
import PartyPanel from "./components/PartyPanel";
import ResultsList from "./components/ResultsList";
import StatBlock from "./components/StatBlock";
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filterMonsters,
  sortMonsters,
  type FilterState,
  type SortDirection,
  type SortKey,
} from "./lib/filters";
import { loadMonsters } from "./lib/loadMonsters";
import { soloBand, type Difficulty } from "./lib/party";
import { PARTY_STORAGE_KEY, parseParty } from "./lib/storage";
import { usePersistentState } from "./lib/usePersistentState";
import type { Monster } from "./types/monster";

export default function App() {
  const [monsters, setMonsters] = useState<Monster[]>([]);
  const [error, setError] = useState<string | null>(null);
  // State remembers a value between renders. Changing it re-draws the page.
  const [filters, setFilters] = useState<FilterState>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // The party is remembered between visits; the difficulty pick is not.
  const [party, setParty] = usePersistentState(PARTY_STORAGE_KEY, parseParty);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);

  useEffect(() => {
    loadMonsters()
      .then(setMonsters)
      .catch((e: Error) => setError(e.message));
  }, []);

  // The visible list is derived from state on every render, never stored.
  // useMemo skips the work when none of its inputs changed; it matters once the library is large.
  const band = useMemo(() => (difficulty === null ? null : soloBand(party, difficulty)), [party, difficulty]);
  const visible = useMemo(
    () => sortMonsters(filterMonsters(monsters, filters, band), sortKey, sortDirection),
    [monsters, filters, band, sortKey, sortDirection],
  );

  // Show the picked monster if it is still in the results, otherwise the first result.
  const selected = visible.find((m) => m.id === selectedId) ?? visible[0];

  return (
    <main className="page">
      <header className="no-print">
        <h1>Creature Cauldron</h1>
        <p className="tagline">Brew a monster for your table.</p>
      </header>

      {error && <p className="error no-print">{error}</p>}

      <div className="layout">
        <div className="filters-area no-print">
          <PartyPanel
            party={party}
            difficulty={difficulty}
            band={band}
            onPartyChange={setParty}
            onDifficultyChange={setDifficulty}
          />
          <FilterPanel
            filters={filters}
            activeCount={countActiveFilters(filters)}
            onChange={setFilters}
            onClear={() => setFilters(EMPTY_FILTERS)}
          />
        </div>

        <div className="results-area no-print">
          <ResultsList
            monsters={visible}
            totalCount={monsters.length}
            selectedId={selected?.id}
            sortKey={sortKey}
            sortDirection={sortDirection}
            onSelect={setSelectedId}
            onSortKeyChange={setSortKey}
            onSortDirectionChange={setSortDirection}
          />
        </div>

        <section className="detail-area">
          {selected ? (
            <>
              <button type="button" className="print-button no-print" onClick={() => window.print()}>
                Print stat block
              </button>
              <StatBlock monster={selected} />
            </>
          ) : (
            <p className="empty-state no-print">Nothing to show yet.</p>
          )}
        </section>
      </div>
    </main>
  );
}

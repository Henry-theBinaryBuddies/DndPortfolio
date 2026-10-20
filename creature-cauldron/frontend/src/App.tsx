import { useEffect, useMemo, useState } from "react";
import FilterPanel from "./components/FilterPanel";
import PartyPanel from "./components/PartyPanel";
import ResultsList from "./components/ResultsList";
import StatBlock from "./components/StatBlock";
import { countAvailableFavorites, onlyFavorites } from "./lib/favorites";
import {
  EMPTY_FILTERS,
  countActiveFilters,
  filterMonsters,
  sortMonsters,
  toggle,
  type FilterState,
  type SortDirection,
  type SortKey,
} from "./lib/filters";
import { loadMonsters } from "./lib/loadMonsters";
import { soloBand, type Difficulty } from "./lib/party";
import { FAVORITES_STORAGE_KEY, PARTY_STORAGE_KEY, parseFavorites, parseParty } from "./lib/storage";
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
  // Favorites are a remembered list of monster ids. Whether to show only favorites is a view choice, so it is not saved.
  const [favorites, setFavorites] = usePersistentState(FAVORITES_STORAGE_KEY, parseFavorites);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // monsters.length === 0 can't tell "still loading" from "loaded but empty", so track loading explicitly.
  const [libraryReady, setLibraryReady] = useState(false);

  useEffect(() => {
    loadMonsters()
      .then((list) => {
        // Both updates happen in one go, so the page redraws once with both changes.
        setMonsters(list);
        setLibraryReady(true);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  // The visible list is derived from state on every render, never stored.
  // useMemo skips the work when none of its inputs changed; it matters once the library is large.
  const band = useMemo(() => (difficulty === null ? null : soloBand(party, difficulty)), [party, difficulty]);
  const visible = useMemo(
    () => sortMonsters(filterMonsters(monsters, filters, band), sortKey, sortDirection),
    [monsters, filters, band, sortKey, sortDirection],
  );

  // Small, cheap values are simply computed each render (no useMemo needed).
  const favoriteSet = new Set(favorites);
  const favoriteCount = countAvailableFavorites(monsters, favoriteSet);
  const shown = favoritesOnly ? onlyFavorites(visible, favoriteSet) : visible;

  // Show the picked monster if it is still in the results, otherwise the first result.
  const selected = shown.find((m) => m.id === selectedId) ?? shown[0];
  const selectedIsFavorite = selected !== undefined && favoriteSet.has(selected.id);

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
            monsters={shown}
            totalCount={monsters.length}
            selectedId={selected?.id}
            sortKey={sortKey}
            sortDirection={sortDirection}
            favorites={favoriteSet}
            favoriteCount={favoriteCount}
            favoritesOnly={favoritesOnly}
            libraryReady={libraryReady}
            onSelect={setSelectedId}
            onSortKeyChange={setSortKey}
            onSortDirectionChange={setSortDirection}
            onFavoritesOnlyChange={setFavoritesOnly}
          />
        </div>

        <section className="detail-area">
          {selected ? (
            <>
              <div className="detail-actions no-print">
                <button type="button" className="print-button no-print" onClick={() => window.print()}>
                  Print stat block
                </button>
                {/* The label stays "Favorite"; aria-pressed tells screen readers whether it is on. */}
                <button
                  type="button"
                  className="action-button"
                  aria-pressed={selectedIsFavorite}
                  onClick={() => setFavorites(toggle(favorites, selected.id))}
                >
                  <span aria-hidden="true">{selectedIsFavorite ? "★" : "☆"}</span> Favorite
                </button>
              </div>
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

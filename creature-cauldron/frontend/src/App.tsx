import { useEffect, useMemo, useState } from "react";
import EncounterPanel from "./components/EncounterPanel";
import FilterPanel from "./components/FilterPanel";
import PartyPanel from "./components/PartyPanel";
import ResultsList from "./components/ResultsList";
import SavedEncounters from "./components/SavedEncounters";
import StatBlock from "./components/StatBlock";
import {
  MAX_COUNT,
  MAX_ENTRIES,
  addMonster,
  canAddMonster,
  countOf,
  removeMonster,
  setCount,
  summarizeEncounter,
} from "./lib/encounter";
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
import {
  ENCOUNTER_STORAGE_KEY,
  FAVORITES_STORAGE_KEY,
  PARTY_STORAGE_KEY,
  SAVED_ENCOUNTERS_STORAGE_KEY,
  parseEntries,
  parseFavorites,
  parseParty,
  parseSavedEncounters,
} from "./lib/storage";
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
  // The working encounter and the saved ones are remembered too. Both hold ids and counts, plus a
  // remembered display name that is used only if the library loses that monster. XP and ratings
  // are worked out fresh from the library on every render.
  const [entries, setEntries] = usePersistentState(ENCOUNTER_STORAGE_KEY, parseEntries);
  const [savedEncounters, setSavedEncounters] = usePersistentState(
    SAVED_ENCOUNTERS_STORAGE_KEY,
    parseSavedEncounters,
  );
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

  // Also derived each render: the rating changes the moment the party or the rows change.
  const summary = summarizeEncounter(entries, monsters, party);
  const inEncounter = selected ? countOf(entries, selected.id) : 0;
  const canAdd = selected ? canAddMonster(entries, selected.id) : false;
  const addNote = !canAdd
    ? inEncounter >= MAX_COUNT
      ? `Already ${MAX_COUNT} of this monster`
      : `Encounter is full (${MAX_ENTRIES} different monsters)`
    : inEncounter > 0
      ? `${inEncounter} in encounter`
      : "";

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
          <EncounterPanel
            entries={entries}
            summary={summary}
            party={party}
            libraryReady={libraryReady}
            onCountChange={(id, count) => setEntries(setCount(entries, id, count))}
            onRemove={(id) => setEntries(removeMonster(entries, id))}
            onClear={() => setEntries([])}
          />
          <SavedEncounters
            saved={savedEncounters}
            entries={entries}
            onSavedChange={setSavedEncounters}
            onLoad={setEntries}
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
                {/* aria-disabled, not disabled: a button that is pressed and then disables itself would lose
                    keyboard focus. Pressing it when full does nothing, because addMonster refuses. */}
                <button
                  type="button"
                  className="action-button"
                  aria-disabled={!canAdd}
                  aria-describedby={addNote ? "add-note" : undefined}
                  onClick={() => setEntries(addMonster(entries, selected))}
                >
                  Add to encounter
                </button>
                {/* Always on the page (empty when idle), so a screen reader announces changes to its text. */}
                <span id="add-note" role="status" className="detail-note">
                  {addNote}
                </span>
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

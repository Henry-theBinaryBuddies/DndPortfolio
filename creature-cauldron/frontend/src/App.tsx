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
  deleteSaved,
  isDirty,
  loadSaved,
  removeMonster,
  saveWorking,
  setCount,
  startNewEncounter,
  summarizeEncounter,
  toggleSavedFavorite,
  toggleWorkingFavorite,
  type EncounterState,
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
  parseFavorites,
  parseParty,
  parseSavedEncounters,
  parseWorkingEncounter,
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
  // A monster opened by clicking its name in the encounter. It is shown even if the filters hide it,
  // and is forgotten as soon as the user picks from the list or changes the list.
  const [viewedId, setViewedId] = useState<string | null>(null);
  const leaveViewed =
    <T,>(setter: (value: T) => void) =>
    (value: T) => {
      setViewedId(null);
      setter(value);
    };
  // The party is remembered between visits; the difficulty pick is not.
  const [party, setParty] = usePersistentState(PARTY_STORAGE_KEY, parseParty);
  const [difficulty, setDifficulty] = useState<Difficulty | null>(null);
  // Favorites are a remembered list of monster ids. Whether to show only favorites is a view choice, so it is not saved.
  const [favorites, setFavorites] = usePersistentState(FAVORITES_STORAGE_KEY, parseFavorites);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  // The encounter on the card ("working") and the saved ones are remembered too. They hold ids and
  // counts, plus a remembered display name that is used only if the library loses that monster.
  // XP and ratings are worked out fresh from the library on every render.
  const [working, setWorking] = usePersistentState(ENCOUNTER_STORAGE_KEY, parseWorkingEncounter);
  const [saved, setSaved] = usePersistentState(SAVED_ENCOUNTERS_STORAGE_KEY, parseSavedEncounters);
  const entries = working.entries;
  // Saving, deleting and starring change both pieces together, so the lib functions take and return both.
  const apply = (next: EncounterState) => {
    setSaved(next.saved);
    setWorking(next.working);
  };
  const encounterState: EncounterState = { saved, working };
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

  // Show the monster opened from the encounter if there is one, otherwise the picked monster if it
  // is still in the results, otherwise the first result.
  const viewed = viewedId === null ? undefined : monsters.find((m) => m.id === viewedId);
  const selected = viewed ?? shown.find((m) => m.id === selectedId) ?? shown[0];
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
            onDifficultyChange={leaveViewed(setDifficulty)}
          />
          <EncounterPanel
            working={working}
            saved={saved}
            summary={summary}
            party={party}
            libraryReady={libraryReady}
            onNameChange={(name) => setWorking({ ...working, name })}
            onToggleFavorite={() => apply(toggleWorkingFavorite(encounterState))}
            onSave={() => apply(saveWorking(encounterState))}
            onNew={() => apply(startNewEncounter(encounterState))}
            onCountChange={(id, count) => setWorking({ ...working, entries: setCount(entries, id, count) })}
            onRemove={(id) => setWorking({ ...working, entries: removeMonster(entries, id) })}
            onView={setViewedId}
          />
          <SavedEncounters
            saved={saved}
            loadedId={working.id}
            dirty={isDirty(saved, working)}
            onLoad={(id) => apply(loadSaved(encounterState, id))}
            onDelete={(id) => apply(deleteSaved(encounterState, id))}
            onToggleFavorite={(id) => apply(toggleSavedFavorite(encounterState, id))}
          />
          <FilterPanel
            filters={filters}
            activeCount={countActiveFilters(filters)}
            onChange={leaveViewed(setFilters)}
            onClear={() => leaveViewed(setFilters)(EMPTY_FILTERS)}
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
            onSelect={leaveViewed(setSelectedId)}
            onSortKeyChange={leaveViewed(setSortKey)}
            onSortDirectionChange={leaveViewed(setSortDirection)}
            onFavoritesOnlyChange={leaveViewed(setFavoritesOnly)}
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
                  onClick={() => setWorking({ ...working, entries: addMonster(entries, selected) })}
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

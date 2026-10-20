import { useEffect, useMemo, useState } from "react";
import EncounterPanel from "./components/EncounterPanel";
import FilterBar from "./components/FilterBar";
import PartyPanel from "./components/PartyPanel";
import ResultsList from "./components/ResultsList";
import SavedEncounters from "./components/SavedEncounters";
import StatBlockDialog from "./components/StatBlockDialog";
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
  // Which monster's stat block is open in the pop-out, if any. Opening one is always an explicit
  // click (on the list or on a name in the encounter), so there is no "selected" fallback.
  const [openId, setOpenId] = useState<string | null>(null);
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

  // The monster in the pop-out. If its id is no longer in the library, the pop-out simply stays closed.
  const opened = openId === null ? null : (monsters.find((m) => m.id === openId) ?? null);
  const openedIsFavorite = opened !== null && favoriteSet.has(opened.id);

  // Also derived each render: the rating changes the moment the party or the rows change.
  const summary = summarizeEncounter(entries, monsters, party);
  const inEncounter = opened ? countOf(entries, opened.id) : 0;
  const canAdd = opened ? canAddMonster(entries, opened.id) : false;
  const addNote = !canAdd
    ? inEncounter >= MAX_COUNT
      ? `Already ${MAX_COUNT} of this monster`
      : `Encounter is full (${MAX_ENTRIES} different monsters)`
    : inEncounter > 0
      ? `${inEncounter} in encounter`
      : "";

  return (
    <>
      <main className="app no-print">
        <header className="topbar">
          <h1>Creature Cauldron</h1>
          <PartyPanel
            party={party}
            difficulty={difficulty}
            band={band}
            onPartyChange={setParty}
            onDifficultyChange={setDifficulty}
          />
        </header>

        {error && <p className="error">{error}</p>}

        <FilterBar
          filters={filters}
          activeCount={countActiveFilters(filters)}
          onChange={setFilters}
          onClear={() => setFilters(EMPTY_FILTERS)}
        />

        <div className="board">
          <ResultsList
            monsters={shown}
            totalCount={monsters.length}
            sortKey={sortKey}
            sortDirection={sortDirection}
            favorites={favoriteSet}
            favoriteCount={favoriteCount}
            favoritesOnly={favoritesOnly}
            libraryReady={libraryReady}
            onOpen={setOpenId}
            onSortKeyChange={setSortKey}
            onSortDirectionChange={setSortDirection}
            onFavoritesOnlyChange={setFavoritesOnly}
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
            onView={setOpenId}
          />
          <SavedEncounters
            saved={saved}
            loadedId={working.id}
            dirty={isDirty(saved, working)}
            onLoad={(id) => apply(loadSaved(encounterState, id))}
            onDelete={(id) => apply(deleteSaved(encounterState, id))}
            onToggleFavorite={(id) => apply(toggleSavedFavorite(encounterState, id))}
          />
        </div>
      </main>

      <StatBlockDialog
        monster={opened}
        isFavorite={openedIsFavorite}
        canAdd={canAdd}
        addNote={addNote}
        onClose={() => setOpenId(null)}
        onToggleFavorite={() => {
          if (opened) setFavorites(toggle(favorites, opened.id));
        }}
        onAdd={() => {
          if (opened) setWorking({ ...working, entries: addMonster(entries, opened) });
        }}
      />
    </>
  );
}

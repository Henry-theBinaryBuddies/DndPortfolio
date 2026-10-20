import { useEffect, useMemo, useState } from "react";
import EncounterPanel from "./components/EncounterPanel";
import FilterBar from "./components/FilterBar";
import GenerateBar from "./components/GenerateBar";
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
import { createGenerator } from "./lib/demoGenerator";
import { SHARED_LIBRARY_NOTE, fetchSharedLibrary, mergeLibrary } from "./lib/sharedLibrary";
import { GENERATED_STORAGE_KEY, MAX_GENERATED, looksLikeMonster, parseGenerated } from "./lib/generatedStore";
import { buildGenerateRequest, describeRequest, fewResultsPrompt } from "./lib/generateRequest";
import { failureMessage, type ForgeStatus, type GeneratorResult, type ReskinRequest } from "./lib/generatorApi";
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
import { SRD_ATTRIBUTION } from "./lib/attribution";
import { usePersistentState } from "./lib/usePersistentState";
import type { Monster } from "./types/monster";

// The server address is fixed when the page is built (VITE_API_URL), never taken from the page address.
const API_URL = import.meta.env.VITE_API_URL as string | undefined;

// The most generated-monster ids sent with a request (the server accepts this many).
const MAX_EXCLUDED = 500;

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
  // Monsters the generator made are remembered in this browser (until the server's shared cache exists)
  // and join the library, so they filter, sort, favorite and go into encounters like any other.
  const [generated, setGenerated] = usePersistentState(GENERATED_STORAGE_KEY, parseGenerated);
  const [generating, setGenerating] = useState(false);
  const [generateMessage, setGenerateMessage] = useState("");
  // Monsters other visitors' requests made, fetched from the server on load. Not saved in this browser.
  const [shared, setShared] = useState<Monster[]>([]);
  const [libraryNote, setLibraryNote] = useState("");
  const [forgeStatus, setForgeStatus] = useState<ForgeStatus>("ok");
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

  // The curated library plus anything generated. Everything below works from this one list.
  const library = useMemo(() => mergeLibrary(monsters, shared, generated), [monsters, shared, generated]);
  // Which generator to use: the demo one (?generator=demo), the live one if a server was configured, else the offline one.
  const generator = useMemo(() => createGenerator(window.location.search, monsters, API_URL), [monsters]);

  // With a live generator, ask the server once for the shared library and for how it is doing. A server that does not
  // answer is not an error: the built-in monsters still work, and a small note says so.
  useEffect(() => {
    if (generator.mode !== "live" || !API_URL) return;
    let cancelled = false;
    fetchSharedLibrary(API_URL).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setShared(result.monsters);
        setLibraryNote("");
      } else {
        setLibraryNote(SHARED_LIBRARY_NOTE);
      }
    });
    generator.status?.().then((status) => {
      if (!cancelled) setForgeStatus(status);
    });
    return () => {
      cancelled = true;
    };
  }, [generator]);

  // The visible list is derived from state on every render, never stored.
  // useMemo skips the work when none of its inputs changed; it matters once the library is large.
  const band = useMemo(() => (difficulty === null ? null : soloBand(party, difficulty)), [party, difficulty]);
  const visible = useMemo(
    () => sortMonsters(filterMonsters(library, filters, band), sortKey, sortDirection),
    [library, filters, band, sortKey, sortDirection],
  );

  // Small, cheap values are simply computed each render (no useMemo needed).
  const favoriteSet = new Set(favorites);
  const favoriteCount = countAvailableFavorites(library, favoriteSet);
  const shown = favoritesOnly ? onlyFavorites(visible, favoriteSet) : visible;

  // The monster in the pop-out. If its id is no longer in the library, the pop-out simply stays closed.
  const opened = openId === null ? null : (library.find((m) => m.id === openId) ?? null);
  const openedIsFavorite = opened !== null && favoriteSet.has(opened.id);

  // Also derived each render: the rating changes the moment the party or the rows change.
  const summary = summarizeEncounter(entries, library, party);

  // What the Generate button would ask for, from the filters and the difficulty pick.
  const built = buildGenerateRequest(filters, band);

  // Turns a generator's answer into a stored, opened monster, or into a message when it failed.
  // Returns null on success, or the message to show.
  const accept = (result: GeneratorResult): string | null => {
    if (!result.ok) {
      if (result.reason === "resting") setForgeStatus("resting");
      return failureMessage(result.reason, result.message);
    }
    // The answer is untrusted (a server will send it), so it is checked before it can reach the stat block.
    if (!looksLikeMonster(result.monster)) return "The generator sent back something that couldn't be shown.";
    const monster = result.monster;
    setGenerated([monster, ...generated.filter((g) => g.id !== monster.id)].slice(0, MAX_GENERATED));
    setOpenId(monster.id);
    setGenerateMessage(`Added ${monster.name} to your library. ${result.notes.join(" ")}`.trim());
    return null;
  };

  const runGenerate = async () => {
    if (generating || built.request === null) return;
    setGenerating(true);
    setGenerateMessage("");
    // Tell the server which generated monsters this page already has, so a cached answer is always new to it.
    const excludeIds = [...generated, ...shared].map((m) => m.id).slice(0, MAX_EXCLUDED);
    const failure = accept(await generator.generate({ ...built.request, excludeIds }));
    setGenerating(false);
    if (failure) setGenerateMessage(failure);
  };

  const runReskin = async (request: ReskinRequest): Promise<string | null> => {
    if (generating) return "Another request is still running.";
    setGenerating(true);
    const failure = accept(await generator.reskin(request));
    setGenerating(false);
    return failure;
  };
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
            totalCount={library.length}
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
            generateBar={
              <GenerateBar
                prompt={libraryReady ? fewResultsPrompt(visible.length) : null}
                summary={built.request ? describeRequest(built.request) : null}
                problem={built.problem}
                mode={generator.mode}
                resting={forgeStatus === "resting"}
                note={libraryNote}
                busy={generating}
                message={generateMessage}
                hasResult={generated.length > 0}
                onGenerate={runGenerate}
              />
            }
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

        {/* The SRD's required credit. It must be quoted exactly as Wizards of the Coast gives it. */}
        <footer className="attribution">{SRD_ATTRIBUTION}</footer>
      </main>

      <StatBlockDialog
        monster={opened}
        isFavorite={openedIsFavorite}
        canAdd={canAdd}
        addNote={addNote}
        generatorMode={generator.mode}
        resting={forgeStatus === "resting"}
        onReskin={runReskin}
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

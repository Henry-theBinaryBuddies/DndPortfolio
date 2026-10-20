import type { SortDirection, SortKey } from "../lib/filters";
import type { Monster } from "../types/monster";

interface ResultsListProps {
  monsters: Monster[];
  totalCount: number;
  sortKey: SortKey;
  sortDirection: SortDirection;
  favorites: ReadonlySet<string>;
  /** How many favorites the library actually has (stored ids can be stale). */
  favoriteCount: number;
  favoritesOnly: boolean;
  /** False until the library has finished loading, so "no results" isn't shown too early. */
  libraryReady: boolean;
  /** Open this monster's stat block. */
  onOpen: (id: string) => void;
  onSortKeyChange: (key: SortKey) => void;
  onSortDirectionChange: (direction: SortDirection) => void;
  onFavoritesOnlyChange: (value: boolean) => void;
}

/** What to say when the list is empty, depending on why it is empty. */
function emptyMessage(libraryReady: boolean, favoritesOnly: boolean, favoriteCount: number): string {
  if (!libraryReady) return "The monster library has not loaded.";
  if (favoritesOnly && favoriteCount === 0) {
    return "No favorites yet. Untick Favorites only, open a monster and press Favorite.";
  }
  if (favoritesOnly) return "None of your favorites match these filters.";
  return "No monsters match these filters. Try removing one.";
}

export default function ResultsList({
  monsters,
  totalCount,
  sortKey,
  sortDirection,
  favorites,
  favoriteCount,
  favoritesOnly,
  libraryReady,
  onOpen,
  onSortKeyChange,
  onSortDirectionChange,
  onFavoritesOnlyChange,
}: ResultsListProps) {
  return (
    <section className="panel results" aria-label="Results">
      {/* tabIndex={-1} and data-focus-fallback: where focus goes if the opener of a stat block disappears. */}
      <h2 tabIndex={-1} data-focus-fallback>
        Results{" "}
        <span className="result-count">
          {monsters.length === totalCount ? totalCount : `${monsters.length} of ${totalCount}`}
        </span>
      </h2>

      <div className="results-controls">
        <label>
          Sort by{" "}
          <select value={sortKey} onChange={(e) => onSortKeyChange(e.target.value as SortKey)}>
            <option value="name">Name</option>
            <option value="cr">CR</option>
            <option value="type">Type</option>
          </select>
        </label>
        <button
          type="button"
          className="link-button"
          aria-label={sortDirection === "asc" ? "Ascending, switch to descending" : "Descending, switch to ascending"}
          onClick={() => onSortDirectionChange(sortDirection === "asc" ? "desc" : "asc")}
        >
          {sortDirection === "asc" ? "↑ Asc" : "↓ Desc"}
        </button>
        <label>
          <input
            type="checkbox"
            checked={favoritesOnly}
            onChange={(e) => onFavoritesOnlyChange(e.target.checked)}
          />{" "}
          Favorites only ({favoriteCount})
        </label>
      </div>

      {monsters.length === 0 ? (
        <p className="empty-state">{emptyMessage(libraryReady, favoritesOnly, favoriteCount)}</p>
      ) : (
        <ul className="monster-list">
          {monsters.map((m) => (
            <li key={m.id}>
              <button type="button" className="monster-button" aria-haspopup="dialog" onClick={() => onOpen(m.id)}>
                {/* The star is plain text inside <strong> on purpose: the CSS rule for
                    ".monster-button span" would restyle a span as small grey text. */}
                <strong>
                  {favorites.has(m.id) ? "★ " : ""}
                  {m.name}
                </strong>
                <span>
                  {m.size} {m.type} · CR {m.challenge.cr}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

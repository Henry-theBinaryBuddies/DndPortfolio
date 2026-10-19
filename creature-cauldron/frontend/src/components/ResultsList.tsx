import type { SortDirection, SortKey } from "../lib/filters";
import type { Monster } from "../types/monster";

interface ResultsListProps {
  monsters: Monster[];
  totalCount: number;
  selectedId: string | undefined;
  sortKey: SortKey;
  sortDirection: SortDirection;
  onSelect: (id: string) => void;
  onSortKeyChange: (key: SortKey) => void;
  onSortDirectionChange: (direction: SortDirection) => void;
}

export default function ResultsList({
  monsters,
  totalCount,
  selectedId,
  sortKey,
  sortDirection,
  onSelect,
  onSortKeyChange,
  onSortDirectionChange,
}: ResultsListProps) {
  return (
    <section className="results" aria-label="Results">
      <h2>
        Results <span className="result-count">{monsters.length === totalCount ? totalCount : `${monsters.length} of ${totalCount}`}</span>
      </h2>

      <div className="sort-controls">
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
      </div>

      {monsters.length === 0 ? (
        <p className="empty-state">No monsters match these filters. Try removing one.</p>
      ) : (
        <ul className="monster-list">
          {monsters.map((m) => (
            <li key={m.id}>
              <button
                type="button"
                className={m.id === selectedId ? "monster-button selected" : "monster-button"}
                aria-pressed={m.id === selectedId}
                onClick={() => onSelect(m.id)}
              >
                <strong>{m.name}</strong>
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

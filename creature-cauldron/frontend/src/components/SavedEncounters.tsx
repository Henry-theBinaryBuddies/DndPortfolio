import { useEffect, useRef } from "react";
import { orderForList, totalMonsters, type SavedEncounter } from "../lib/encounter";

interface SavedEncountersProps {
  saved: SavedEncounter[];
  /** The saved encounter currently on the encounter card, if any. */
  loadedId: string | null;
  /** True when the card has unsaved changes that loading would throw away. */
  dirty: boolean;
  onLoad: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleFavorite: (id: string) => void;
}

// This panel only loads, stars and deletes. Naming and saving happen on the encounter card.
export default function SavedEncounters({
  saved,
  loadedId,
  dirty,
  onLoad,
  onDelete,
  onToggleFavorite,
}: SavedEncountersProps) {
  const summaryRef = useRef<HTMLElement>(null);

  // Un-starring moves a row down the list, and a browser drops keyboard focus from a button whose
  // row was moved. So remember which star was pressed and focus it again once the list has re-drawn.
  const refocusId = useRef<string | null>(null);
  useEffect(() => {
    if (refocusId.current !== null) {
      document.getElementById(`saved-star-${refocusId.current}`)?.focus();
      refocusId.current = null;
    }
  }, [saved]);

  const handleLoad = (item: SavedEncounter) => {
    if (dirty && !window.confirm(`Replace the unsaved changes on the encounter card with "${item.name}"?`)) return;
    onLoad(item.id);
  };

  const handleDelete = (item: SavedEncounter) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    onDelete(item.id);
    // The row is gone, so send focus somewhere that still exists.
    summaryRef.current?.focus();
  };

  return (
    <section className="party-panel saved-encounters" aria-label="Saved encounters">
      {/* <details> is the browser's own collapsible section; closed unless `open` is set. */}
      <details>
        <summary ref={summaryRef}>Saved encounters ({saved.length})</summary>

        {saved.length === 0 ? (
          <p className="empty-state">Nothing saved yet. Build an encounter and press Save on its card.</p>
        ) : (
          <ul className="saved-list">
            {orderForList(saved).map((item) => {
              const count = totalMonsters(item.entries);
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    id={`saved-star-${item.id}`}
                    className="star-button"
                    aria-pressed={item.favorite}
                    aria-label={`Favorite ${item.name}`}
                    onClick={() => {
                      refocusId.current = item.id;
                      onToggleFavorite(item.id);
                    }}
                  >
                    <span aria-hidden="true">{item.favorite ? "★" : "☆"}</span>
                  </button>
                  <span className="saved-name">
                    <strong>{item.name}</strong>
                    <span className="encounter-meta">
                      {count} {count === 1 ? "monster" : "monsters"}
                      {item.id === loadedId ? ", on the card" : ""}
                    </span>
                  </span>
                  <span className="saved-actions">
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Load ${item.name}`}
                      onClick={() => handleLoad(item)}
                    >
                      Load
                    </button>
                    <button
                      type="button"
                      className="link-button"
                      aria-label={`Delete ${item.name}`}
                      onClick={() => handleDelete(item)}
                    >
                      Delete
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </details>
    </section>
  );
}

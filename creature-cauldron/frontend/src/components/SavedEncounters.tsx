import { useRef, useState, type FormEvent } from "react";
import {
  MAX_NAME_LENGTH,
  MAX_SAVED,
  canSave,
  defaultEncounterName,
  deleteSaved,
  hasSavedName,
  resolveSaveName,
  saveEncounter,
  totalMonsters,
  type EncounterEntry,
  type SavedEncounter,
} from "../lib/encounter";

interface SavedEncountersProps {
  saved: SavedEncounter[];
  /** The working encounter, which Save stores and Load replaces. */
  entries: EncounterEntry[];
  onSavedChange: (saved: SavedEncounter[]) => void;
  onLoad: (entries: EncounterEntry[]) => void;
}

export default function SavedEncounters({ saved, entries, onSavedChange, onLoad }: SavedEncountersProps) {
  // The text in the name box only matters to this form, so it is local state here
  // rather than App state (the same reason PartyPanel keeps `individual` to itself).
  const [nameDraft, setNameDraft] = useState("");
  const [status, setStatus] = useState("");
  const summaryRef = useRef<HTMLElement>(null);

  const replacing = hasSavedName(saved, nameDraft);
  const savable = canSave(saved, nameDraft, entries);
  const listFull = saved.length >= MAX_SAVED && !replacing;

  const handleSubmit = (event: FormEvent) => {
    // Without this the browser would reload the page when the form is submitted.
    event.preventDefault();
    if (!savable) return;
    const name = resolveSaveName(saved, nameDraft);
    onSavedChange(saveEncounter(saved, nameDraft, entries));
    setStatus(`${replacing ? "Replaced" : "Saved as"} "${name}".`);
    setNameDraft("");
  };

  const handleLoad = (item: SavedEncounter) => {
    if (entries.length > 0 && !window.confirm(`Replace the current encounter with "${item.name}"?`)) return;
    // Copies, so editing the working encounter can never change the saved one.
    onLoad(item.entries.map((entry) => ({ ...entry })));
    setNameDraft(item.name);
    setStatus(`Loaded "${item.name}".`);
  };

  const handleDelete = (item: SavedEncounter) => {
    if (!window.confirm(`Delete "${item.name}"?`)) return;
    onSavedChange(deleteSaved(saved, item.name));
    setStatus(`Deleted "${item.name}".`);
    summaryRef.current?.focus();
  };

  return (
    <section className="party-panel saved-encounters" aria-label="Saved encounters">
      {/* <details> is the browser's own collapsible section; closed unless `open` is set. */}
      <details>
        <summary ref={summaryRef}>Saved encounters ({saved.length})</summary>

        <form className="saved-form" onSubmit={handleSubmit}>
          <label htmlFor="saved-name">Name</label>
          <input
            id="saved-name"
            type="text"
            maxLength={MAX_NAME_LENGTH}
            placeholder={defaultEncounterName(saved)}
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
          />
          <button type="submit" className="action-button" disabled={!savable}>
            {replacing ? "Replace saved" : "Save"}
          </button>
        </form>

        {listFull && <p className="detail-note">Saved list is full ({MAX_SAVED}). Delete one, or reuse a name.</p>}
        <p className="detail-note" aria-live="polite">
          {status}
        </p>

        {saved.length > 0 && (
          <ul className="saved-list">
            {saved.map((item) => {
              const count = totalMonsters(item.entries);
              return (
                <li key={item.name}>
                  <span className="saved-name">
                    <strong>{item.name}</strong>
                    <span className="encounter-meta">
                      {count} {count === 1 ? "monster" : "monsters"}
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

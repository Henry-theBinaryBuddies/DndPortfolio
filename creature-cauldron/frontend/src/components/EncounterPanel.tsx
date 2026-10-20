import { useRef } from "react";
import {
  MAX_COUNT,
  MAX_NAME_LENGTH,
  MAX_SAVED,
  MIN_COUNT,
  canSave,
  defaultEncounterName,
  describeRating,
  isDirty,
  linkedSave,
  nameConflict,
  type EncounterEntry,
  type EncounterSummary,
  type SavedEncounter,
  type WorkingEncounter,
} from "../lib/encounter";
import { describeParty, type Party } from "../lib/party";

interface EncounterPanelProps {
  working: WorkingEncounter;
  saved: SavedEncounter[];
  summary: EncounterSummary;
  party: Party;
  libraryReady: boolean;
  onNameChange: (name: string) => void;
  onToggleFavorite: () => void;
  onSave: () => void;
  onNew: () => void;
  onCountChange: (monsterId: string, count: number) => void;
  onRemove: (monsterId: string) => void;
  /** Open this monster's stat block. */
  onView: (monsterId: string) => void;
}

/** "x2", "x2.5": the multiplier without a trailing ".0". */
const formatMultiplier = (multiplier: number) => `x${multiplier}`;

/** What to say about the encounter's saved state, or "" when there is nothing to say. */
function statusText(saved: SavedEncounter[], working: WorkingEncounter): string {
  const rows: EncounterEntry[] = working.entries;
  const linked = linkedSave(saved, working);
  if (nameConflict(saved, working)) return "A saved encounter already has that name.";
  if (!linked && rows.length > 0 && saved.length >= MAX_SAVED) {
    return `Saved list is full (${MAX_SAVED}). Delete one first.`;
  }
  if (!linked) return rows.length > 0 ? "Not saved yet" : "";
  // The name is included so a screen reader hears a change when another encounter is loaded.
  return isDirty(saved, working) ? `Unsaved changes to "${linked.name}"` : `Saved as "${linked.name}"`;
}

export default function EncounterPanel({
  working,
  saved,
  summary,
  party,
  libraryReady,
  onNameChange,
  onToggleFavorite,
  onSave,
  onNew,
  onCountChange,
  onRemove,
  onView,
}: EncounterPanelProps) {
  // A ref holds a pointer to a real element on the page. With tabIndex={-1} the heading
  // can be focused from code, so after a row disappears keyboard and screen-reader users
  // land somewhere sensible instead of back at the top of the page.
  const headingRef = useRef<HTMLHeadingElement>(null);

  const entries = working.entries;
  const savable = canSave(saved, working);
  const dirty = isDirty(saved, working);
  const hasAnything = working.id !== null || entries.length > 0 || working.name !== "";

  // The count is part of the text so that every Add, + and - changes it, and a screen reader announces each change.
  const ratingText =
    summary.rating === null
      ? ""
      : `${summary.monsterCount} ${summary.monsterCount === 1 ? "monster" : "monsters"}: ${describeRating(summary.rating)} for ${describeParty(party)}`;

  const handleNew = () => {
    if (dirty && !window.confirm("Discard the unsaved changes on this encounter?")) return;
    onNew();
    headingRef.current?.focus();
  };

  return (
    <section className="party-panel encounter-panel" aria-label="Encounter">
      <h2 ref={headingRef} tabIndex={-1}>
        Encounter
      </h2>

      <div className="encounter-header">
        <button
          type="button"
          className="star-button"
          aria-pressed={working.favorite}
          aria-label="Favorite this encounter"
          onClick={onToggleFavorite}
        >
          <span aria-hidden="true">{working.favorite ? "★" : "☆"}</span>
        </button>
        <input
          className="encounter-name-input"
          type="text"
          aria-label="Encounter name"
          maxLength={MAX_NAME_LENGTH}
          placeholder={linkedSave(saved, working)?.name ?? defaultEncounterName(saved)}
          value={working.name}
          onChange={(e) => onNameChange(e.target.value)}
        />
        {/* aria-disabled, not disabled: the button stays focusable, so keyboard and screen-reader users
            can still reach it and hear the status line (aria-describedby) saying why it can't save.
            Pressing it then does nothing. */}
        <button
          type="button"
          className="action-button"
          aria-disabled={!savable}
          aria-describedby="encounter-status"
          onClick={() => {
            if (savable) onSave();
          }}
        >
          Save
        </button>
      </div>
      <p id="encounter-status" className="detail-note" role="status">
        {statusText(saved, working)}
      </p>

      {!libraryReady ? (
        <p className="empty-state">Monster library not loaded.</p>
      ) : entries.length === 0 ? (
        <p className="empty-state">Add a monster from its stat block, or load a saved encounter.</p>
      ) : (
        <ul className="encounter-list">
          {summary.lines.map(({ entry, monster, xp }) => {
            const name = monster?.name ?? entry.name ?? "Unknown monster";
            return (
              <li key={entry.monsterId} className="encounter-row">
                <div className="encounter-name">
                  {monster ? (
                    <button
                      type="button"
                      className="monster-link"
                      title="Show stat block"
                      onClick={() => onView(monster.id)}
                    >
                      {name}
                    </button>
                  ) : (
                    <strong>{name}</strong>
                  )}
                  {monster && xp !== null ? (
                    <span className="encounter-meta">
                      CR {monster.challenge.cr}, {xp.toLocaleString("en-US")} XP each
                    </span>
                  ) : (
                    <span className="encounter-meta unavailable">Unavailable monster (not counted)</span>
                  )}
                </div>
                <div className="encounter-controls">
                  {xp !== null && (
                    <>
                      {/* aria-disabled, not disabled: pressing + or - can bring the count to its limit, and a
                          button that disables itself while it has focus loses keyboard focus. Pressing at
                          the limit does nothing, because setCount clamps. */}
                      <button
                        type="button"
                        className="count-button"
                        aria-label={`Decrease count of ${name}`}
                        aria-disabled={entry.count <= MIN_COUNT}
                        onClick={() => onCountChange(entry.monsterId, entry.count - 1)}
                      >
                        −
                      </button>
                      <span className="count">{entry.count}</span>
                      <button
                        type="button"
                        className="count-button"
                        aria-label={`Increase count of ${name}`}
                        aria-disabled={entry.count >= MAX_COUNT}
                        onClick={() => onCountChange(entry.monsterId, entry.count + 1)}
                      >
                        +
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    className="link-button"
                    aria-label={`Remove ${name} from encounter`}
                    onClick={() => {
                      onRemove(entry.monsterId);
                      headingRef.current?.focus();
                    }}
                  >
                    Remove
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Always on the page (empty when idle): a live region only announces changes to an element that already exists. */}
      <p className={`encounter-rating rating-${summary.rating ?? "none"}`} aria-live="polite">
        {ratingText}
      </p>

      {summary.monsterCount > 0 && summary.multiplier !== null && (
        <dl className="encounter-totals">
          <div>
            <dt>Total XP</dt>
            <dd>{summary.totalXp.toLocaleString("en-US")}</dd>
          </div>
          <div>
            <dt>Multiplier</dt>
            <dd>
              {formatMultiplier(summary.multiplier)} ({summary.monsterCount}{" "}
              {summary.monsterCount === 1 ? "monster" : "monsters"}, party of {summary.partySize}
              {summary.partyShift ? `: one step ${summary.partyShift}` : ""})
            </dd>
          </div>
          <div>
            <dt>Adjusted XP</dt>
            <dd>{summary.adjustedXp.toLocaleString("en-US")}</dd>
          </div>
        </dl>
      )}

      {hasAnything && (
        <button type="button" className="link-button" onClick={handleNew}>
          New encounter
        </button>
      )}
    </section>
  );
}

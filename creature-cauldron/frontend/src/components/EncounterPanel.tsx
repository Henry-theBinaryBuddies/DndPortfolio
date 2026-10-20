import { useRef } from "react";
import { MAX_COUNT, MIN_COUNT, describeRating, type EncounterEntry, type EncounterSummary } from "../lib/encounter";
import { describeParty, type Party } from "../lib/party";

interface EncounterPanelProps {
  entries: EncounterEntry[];
  summary: EncounterSummary;
  party: Party;
  libraryReady: boolean;
  onCountChange: (monsterId: string, count: number) => void;
  onRemove: (monsterId: string) => void;
  onClear: () => void;
}

/** "x2", "x2.5": the multiplier without a trailing ".0". */
const formatMultiplier = (multiplier: number) => `x${multiplier}`;

export default function EncounterPanel({
  entries,
  summary,
  party,
  libraryReady,
  onCountChange,
  onRemove,
  onClear,
}: EncounterPanelProps) {
  // A ref holds a pointer to a real element on the page. With tabIndex={-1} the heading
  // can be focused from code, so after a row disappears keyboard and screen-reader users
  // land somewhere sensible instead of back at the top of the page.
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The count is part of the text so that every Add, + and - changes it, and a screen reader announces each change.
  const ratingText =
    summary.rating === null
      ? ""
      : `${summary.monsterCount} ${summary.monsterCount === 1 ? "monster" : "monsters"}: ${describeRating(summary.rating)} for ${describeParty(party)}`;

  return (
    <section className="party-panel encounter-panel" aria-label="Encounter">
      <h2 ref={headingRef} tabIndex={-1}>
        Encounter
      </h2>

      {!libraryReady ? (
        <p className="empty-state">Monster library not loaded.</p>
      ) : entries.length === 0 ? (
        <p className="empty-state">Select a monster and press Add to encounter.</p>
      ) : (
        <ul className="encounter-list">
          {summary.lines.map(({ entry, monster, xp }) => {
            const name = monster?.name ?? entry.name ?? "Unknown monster";
            return (
              <li key={entry.monsterId} className="encounter-row">
                <div className="encounter-name">
                  <strong>{name}</strong>
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
                      {/* aria-disabled, not disabled: a button that is pressed and then disables itself would
                          lose keyboard focus. Pressing it at its limit does nothing, because setCount clamps. */}
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

      {entries.length > 0 && (
        <button
          type="button"
          className="link-button"
          onClick={() => {
            if (window.confirm("Clear the whole encounter?")) {
              onClear();
              headingRef.current?.focus();
            }
          }}
        >
          Clear encounter
        </button>
      )}
    </section>
  );
}

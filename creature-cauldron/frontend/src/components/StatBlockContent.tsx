import type { Generator, ReskinRequest } from "../lib/generatorApi";
import { sourceLabel } from "../lib/sourceLabel";
import type { Monster } from "../types/monster";
import ExportButtons from "./ExportButtons";
import ReskinPanel from "./ReskinPanel";
import StatBlock from "./StatBlock";

export interface StatBlockContentProps {
  monster: Monster;
  isFavorite: boolean;
  canAdd: boolean;
  /** A short note about the encounter, such as "2 in encounter" or why Add is unavailable. */
  addNote: string;
  generatorMode: Generator["mode"];
  /** True when the server says its daily allowance is used up. */
  resting: boolean;
  /** Makes a reskin of the open monster. Resolves to null on success, or to a message when it failed. */
  onReskin: (request: ReskinRequest) => Promise<string | null>;
  onClose: () => void;
  onToggleFavorite: () => void;
  onAdd: () => void;
}

// Everything shown for an open monster: the buttons, any notes, and the stat block itself. It sits inside the pop-out on
// narrow screens and in the detail panel beside the list on wide ones; the two share this one piece.
export default function StatBlockContent({
  monster,
  isFavorite,
  canAdd,
  addNote,
  generatorMode,
  resting,
  onReskin,
  onClose,
  onToggleFavorite,
  onAdd,
}: StatBlockContentProps) {
  return (
    <div className="dialog-body">
      <div className="dialog-header no-print">
        <button type="button" className="print-button" onClick={() => window.print()}>
          Print
        </button>
        {/* The label stays "Favorite"; aria-pressed tells screen readers whether it is on. */}
        <button type="button" className="action-button" aria-pressed={isFavorite} onClick={onToggleFavorite}>
          <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span> Favorite
        </button>
        {/* aria-disabled, not disabled: a button that is pressed and then disables itself would lose
            keyboard focus. Pressing it when full does nothing, because addMonster refuses. */}
        <button
          type="button"
          className="action-button"
          aria-disabled={!canAdd}
          aria-describedby="add-note"
          onClick={() => {
            if (canAdd) onAdd();
          }}
        >
          Add to encounter
        </button>
        {/* This exists only while a monster is open. Its text at open time is read through the Add
            button's aria-describedby; later changes, such as pressing Add, are announced by role="status". */}
        <span id="add-note" role="status" className="detail-note">
          {addNote}
        </span>
        <ReskinPanel key={`reskin-${monster.id}`} monster={monster} mode={generatorMode} resting={resting} onReskin={onReskin} />
        <ExportButtons key={monster.id} monster={monster} />
        <button type="button" className="close-button" aria-label="Close stat block" onClick={onClose}>
          <span aria-hidden="true">×</span>
        </button>
      </div>
      {sourceLabel(monster) && (
        <p className="source-note no-print">
          {sourceLabel(monster)}. Its numbers have not been checked against the rules, so look it over before using it.
        </p>
      )}
      {monster.changes && monster.changes.length > 0 && (
        <section className="changes-note no-print" aria-label="What changed">
          <h3>What changed</h3>
          <ul>
            {monster.changes.map((change) => (
              <li key={change}>{change}</li>
            ))}
          </ul>
        </section>
      )}
      <StatBlock monster={monster} />
    </div>
  );
}

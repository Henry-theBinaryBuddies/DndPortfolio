import { useEffect, useRef } from "react";
import type { Generator, ReskinRequest } from "../lib/generatorApi";
import { sourceLabel } from "../lib/sourceLabel";
import type { Monster } from "../types/monster";
import ExportButtons from "./ExportButtons";
import ReskinPanel from "./ReskinPanel";
import StatBlock from "./StatBlock";

interface StatBlockDialogProps {
  /** The monster to show, or null when the pop-out is closed. */
  monster: Monster | null;
  isFavorite: boolean;
  canAdd: boolean;
  /** A short note about the encounter, such as "2 in encounter" or why Add is unavailable. */
  addNote: string;
  generatorMode: Generator["mode"];
  /** True when the server says its daily allowance is used up. */
  resting: boolean;
  /** Makes a reskin of the open monster. Resolves to null on success, or to a message when it failed. */
  onReskin: (request: ReskinRequest) => Promise<string | null>;
  /** Every monster the page knows, for choosing a polymorph donor from, and the way to ask what a donor could lend. */
  donors: Monster[];
  graftOptions: Generator["graftOptions"];
  onClose: () => void;
  onToggleFavorite: () => void;
  onAdd: () => void;
}

// The stat block opens in the browser's own <dialog> element. showModal() puts it above the
// page, dims everything behind it, keeps keyboard focus inside it, closes it on Escape, and
// returns focus to whatever opened it afterwards. All of that comes free with the element.
export default function StatBlockDialog({
  monster,
  isFavorite,
  canAdd,
  addNote,
  generatorMode,
  resting,
  onReskin,
  donors,
  graftOptions,
  onClose,
  onToggleFavorite,
  onAdd,
}: StatBlockDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  // Did the current mouse press start on the dimmed area? A drag that starts inside the stat block
  // (to select text) and ends outside must not close it.
  const pressStartedOnBackdrop = useRef(false);

  // React decides WHAT to show; this effect keeps the real dialog in step with it.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (monster && !dialog.open) dialog.showModal();
    if (!monster && dialog.open) dialog.close();
  }, [monster]);

  return (
    <dialog
      ref={dialogRef}
      className="statblock-dialog"
      aria-label={monster ? `${monster.name} stat block` : "Stat block"}
      // The dialog fires "close" however it was closed (Escape, the X, or close() above).
      onClose={() => {
        // The browser gives focus back to whatever opened the pop-out. If that button is gone (for
        // example a favorite that was un-starred while "Favorites only" is on), use the results heading.
        if (!document.activeElement || document.activeElement === document.body) {
          document.querySelector<HTMLElement>("[data-focus-fallback]")?.focus();
        }
        onClose();
      }}
      // A press or click on the dimmed area outside the box lands on the dialog element itself.
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget && pressStartedOnBackdrop.current) onClose();
      }}
    >
      {monster && (
        <div className="dialog-body">
          <div className="dialog-header no-print">
            <button type="button" className="print-button" onClick={() => window.print()}>
              Print
            </button>
            {/* The label stays "Favorite"; aria-pressed tells screen readers whether it is on. */}
            <button
              type="button"
              className="action-button star-only"
              aria-pressed={isFavorite}
              aria-label="Favorite"
              title="Favorite"
              onClick={onToggleFavorite}
            >
              <span aria-hidden="true">{isFavorite ? "★" : "☆"}</span>
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
            <ReskinPanel
              key={`reskin-${monster.id}`}
              monster={monster}
              mode={generatorMode}
              resting={resting}
              donors={donors}
              graftOptions={graftOptions}
              onReskin={onReskin}
            />
            <ExportButtons key={monster.id} monster={monster} />
            <button type="button" className="close-button" aria-label="Close stat block" onClick={onClose}>
              <span aria-hidden="true">×</span>
            </button>
          </div>
          {monster.source === "a5e" ? (
            <p className="source-note no-print">
              A5E (Advanced 5th Edition, Monstrous Menagerie). Its numbers and challenge rating follow A5E, not the 2014 rules.
            </p>
          ) : (
            sourceLabel(monster) && (
              <p className="source-note no-print">
                {sourceLabel(monster)}. Its numbers have not been checked against the rules, so look it over before using it.
              </p>
            )
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
      )}
    </dialog>
  );
}

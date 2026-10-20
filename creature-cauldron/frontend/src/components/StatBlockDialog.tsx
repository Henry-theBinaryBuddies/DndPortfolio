import { useEffect, useRef } from "react";
import type { Monster } from "../types/monster";
import StatBlockContent, { type StatBlockContentProps } from "./StatBlockContent";

interface StatBlockDialogProps extends Omit<StatBlockContentProps, "monster"> {
  /** The monster to show, or null when the pop-out is closed. */
  monster: Monster | null;
}

// On narrow screens the stat block opens in the browser's own <dialog> element. showModal() puts it above the
// page, dims everything behind it, keeps keyboard focus inside it, closes it on Escape, and
// returns focus to whatever opened it afterwards. All of that comes free with the element.
// (On wide screens the stat block sits beside the list instead; see DetailPanel.)
export default function StatBlockDialog({ monster, onClose, ...content }: StatBlockDialogProps) {
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
      {monster && <StatBlockContent monster={monster} onClose={onClose} {...content} />}
    </dialog>
  );
}

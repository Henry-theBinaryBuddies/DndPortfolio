import { useEffect, useId, useRef, useState, type ReactNode } from "react";

interface DropMenuProps {
  /** What the button says. */
  label: ReactNode;
  /** What a screen reader says for the button, when the label alone is not enough (an icon, for example). */
  ariaLabel?: string;
  buttonClassName?: string;
  /** Which edge of the button the panel lines up with. Use "right" near the right-hand end of a row. */
  align?: "left" | "right";
  panelClassName?: string;
  /** Keep the panel's contents alive while it is closed, so what was typed or chosen in it is still there on reopening. */
  keepMounted?: boolean;
  /** The contents. A function receives `close`, for items that should shut the panel when they are used. */
  children: ReactNode | ((close: () => void) => ReactNode);
}

// A button that opens a small panel over the page, under it. The panel closes when you press Escape, click anywhere else, or
// move keyboard focus out of it. Used for the export list, the Foundry help and the reskin options.
export default function DropMenu({
  label,
  ariaLabel,
  buttonClassName = "action-button",
  align = "left",
  panelClassName = "",
  keepMounted = false,
  children,
}: DropMenuProps) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const outside = (target: EventTarget | null) => !root.current?.contains(target as Node);
    const onPointerDown = (event: PointerEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    const onFocusIn = (event: FocusEvent) => {
      if (outside(event.target)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      button.current?.focus(); // put keyboard focus back on the button that opened it
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("focusin", onFocusIn);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const close = () => setOpen(false);
  const content = typeof children === "function" ? children(close) : children;

  return (
    <div className="dropmenu" ref={root}>
      <button
        type="button"
        ref={button}
        className={buttonClassName}
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={ariaLabel}
        onClick={() => setOpen(!open)}
      >
        {label}
      </button>
      {(open || keepMounted) && (
        <div id={panelId} hidden={!open} className={`dropmenu__panel dropmenu__panel--${align} ${panelClassName}`} role="group" aria-label={ariaLabel}>
          {content}
        </div>
      )}
    </div>
  );
}

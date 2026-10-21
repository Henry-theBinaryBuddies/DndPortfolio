import { useEffect, useId, useRef, useState, type ReactNode } from "react";

const OPENED_EVENT = "dropmenu-opened";

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
  /** Whether a click, or tabbing, outside the panel closes it. Turn it off for a panel with a form in it, so a slightly missed
   *  click does not close it; it then closes with its button or the Escape key. */
  closeOnOutside?: boolean;
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
  closeOnOutside = true,
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
      event.preventDefault(); // otherwise the stat block's dialog treats this Escape as its own close request too
      setOpen(false);
      button.current?.focus(); // put keyboard focus back on the button that opened it
    };
    if (closeOnOutside) {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("focusin", onFocusIn);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("focusin", onFocusIn);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, closeOnOutside]);

  // Only one panel is open at a time: opening this one closes any other (including the ones that do not close on an outside click).
  useEffect(() => {
    const onOtherOpened = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== panelId) setOpen(false);
    };
    window.addEventListener(OPENED_EVENT, onOtherOpened);
    return () => window.removeEventListener(OPENED_EVENT, onOtherOpened);
  }, [panelId]);

  const toggle = () => {
    if (!open) window.dispatchEvent(new CustomEvent(OPENED_EVENT, { detail: panelId }));
    setOpen(!open);
  };
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
        onClick={toggle}
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

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { bubbleLayout } from "../lib/bubbles";
import { Cauldron } from "./Illustrations";

const BUBBLES = bubbleLayout(20);
const POP_MS = 700;

// While a monster is being made, a cauldron sits at the bottom of the screen and bubbles rise past everything. When the
// answer arrives the bubbles pop and the picture fades. It is a "popover", which the browser draws above everything,
// including the open stat block, and it never takes a click, a touch or a keystroke.
export default function BrewingOverlay({ active }: { active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  const [popping, setPopping] = useState(false);

  useEffect(() => {
    if (active) {
      setShown(true);
      setPopping(false);
      return;
    }
    if (!shown) return;
    setPopping(true);
    const done = window.setTimeout(() => {
      setShown(false);
      setPopping(false);
    }, POP_MS);
    return () => window.clearTimeout(done);
  }, [active, shown]);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof element.showPopover !== "function") return;
    if (shown && !element.matches(":popover-open")) element.showPopover();
    if (!shown && element.matches(":popover-open")) element.hidePopover();
  }, [shown]);

  return (
    <div ref={ref} popover="manual" className={`brew-overlay ${popping ? "is-popping" : ""}`} aria-hidden="true">
      {BUBBLES.map((b, i) => (
        <span
          key={i}
          className="brew-bubble"
          style={{ left: `${b.left}%`, width: `${b.size}rem`, height: `${b.size}rem`, animationDelay: `${b.delay}s`, animationDuration: `${b.duration}s` } as CSSProperties}
        />
      ))}
      <div className="brew-overlay__pot">
        <Cauldron />
        <p>Brewing…</p>
      </div>
    </div>
  );
}

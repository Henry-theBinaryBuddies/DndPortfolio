import type { CSSProperties } from "react";
import { bubbleLayout } from "../lib/bubbles";

const EMBERS = bubbleLayout(18);

/** The filter that roughens the edge of a paper panel (see styles.css, "smolder-edge"). Hidden; it only defines the effect. */
export function SmolderFilter() {
  return (
    <svg width="0" height="0" aria-hidden="true" focusable="false" style={{ position: "absolute" }}>
      <filter id="smolder-edge" x="-4%" y="-4%" width="108%" height="108%">
        <feTurbulence type="fractalNoise" baseFrequency="0.03 0.045" numOctaves="4" seed="7" result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale="13" xChannelSelector="R" yChannelSelector="G" />
      </filter>
    </svg>
  );
}

/** Small sparks that drift up the page behind everything. Decorative: no clicks, hidden from screen readers. */
export default function Embers() {
  return (
    <div className="ember-field" aria-hidden="true">
      {EMBERS.map((e, i) => (
        <span
          key={i}
          className="ember"
          style={
            {
              left: `${e.left}%`,
              width: `${e.size * 0.22}rem`,
              height: `${e.size * 0.22}rem`,
              animationDelay: `${e.delay * 2}s`,
              animationDuration: `${e.duration * 2.8}s`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

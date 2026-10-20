// Small hand-drawn SVG pictures that give the page its theme. They are decorative (hidden from screen readers) and take
// their colours from the theme tokens in styles.css, so they follow light and dark. Their motion is plain CSS and is switched
// off for visitors whose device asks for reduced motion.

/** A cauldron with a glowing brew and a few bubbles. `bubbling` makes the bubbles rise and the brew pulse. */
export function Cauldron({
  className = "",
  bubbling = true,
  place,
}: {
  className?: string;
  bubbling?: boolean;
  /** Where to put it when it is drawn inside another picture. */
  place?: { x: number; y: number; width: number; height: number };
}) {
  return (
    <svg className={`cauldron ${bubbling ? "is-bubbling" : ""} ${className}`} viewBox="0 0 120 100" aria-hidden="true" focusable="false" {...place}>
      <ellipse className="cauldron__glow" cx="60" cy="40" rx="44" ry="14" />
      {/* legs and handles sit behind the pot */}
      <path className="cauldron__iron" d="M30 84 L22 98 L36 92 Z M90 84 L98 98 L84 92 Z" />
      <path className="cauldron__iron" d="M16 46 Q4 46 6 58 Q8 66 18 62" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path className="cauldron__iron" d="M104 46 Q116 46 114 58 Q112 66 102 62" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
      <path className="cauldron__iron" d="M16 42 Q12 90 60 92 Q108 90 104 42 Z" />
      <ellipse className="cauldron__rim" cx="60" cy="42" rx="46" ry="10" />
      <ellipse className="cauldron__brew" cx="60" cy="43" rx="40" ry="6.5" />
      <path className="cauldron__shine" d="M26 56 Q27 76 40 84" fill="none" strokeWidth="3" strokeLinecap="round" />
      <circle className="bubble b1" cx="48" cy="38" r="4" />
      <circle className="bubble b2" cx="64" cy="36" r="5" />
      <circle className="bubble b3" cx="76" cy="39" r="3" />
      <circle className="bubble b4" cx="56" cy="40" r="2.5" />
    </svg>
  );
}

/** A witch in profile, stirring a cauldron under a crescent moon. The banner for the top of the page. */
export function WitchScene({ className = "" }: { className?: string }) {
  return (
    <svg className={`witch-scene ${className}`} viewBox="0 0 330 150" aria-hidden="true" focusable="false">
      {/* sky */}
      <path className="witch__moon" d="M292 14 A20 20 0 1 0 306 46 A15 15 0 1 1 292 14 Z" />
      <circle className="witch__star" cx="258" cy="22" r="1.6" />
      <circle className="witch__star" cx="320" cy="68" r="1.4" />
      <circle className="witch__star" cx="240" cy="52" r="1.2" />
      <circle className="witch__star" cx="150" cy="14" r="1.4" />
      {/* the witch */}
      <g className="witch__figure">
        <path d="M60 148 Q64 104 80 82 L112 82 Q126 106 130 148 Z" /> {/* cloak */}
        <path d="M82 70 Q58 88 70 118 Q76 100 88 90 Z" /> {/* hair */}
        <circle cx="96" cy="68" r="12" /> {/* head */}
        <path d="M106 66 L120 72 L107 74 Z" /> {/* nose */}
        <ellipse cx="94" cy="58" rx="36" ry="7" /> {/* hat brim */}
        <path d="M70 56 Q84 40 90 20 Q92 8 108 2 Q98 14 104 30 Q108 44 118 56 Z" /> {/* hat */}
        <path className="witch__band" d="M74 54 L116 54 L114 49 L77 49 Z" />
        <path className="witch__stick" d="M112 90 L206 70" fill="none" strokeWidth="4" strokeLinecap="round" />
        <circle cx="118" cy="89" r="5" /> {/* hand */}
      </g>
      <Cauldron className="witch__cauldron" place={{ x: 188, y: 40, width: 130, height: 108 }} />
    </svg>
  );
}

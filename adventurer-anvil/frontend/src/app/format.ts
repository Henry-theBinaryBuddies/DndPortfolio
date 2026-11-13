// Turning derived values into text. The system's summary layout says which format a value uses.
import type { BreakdownLine, Derived } from "../core";

export function formatValue(value: Derived["value"] | undefined, format?: "signed" | "feet"): string {
  if (value === undefined) return "–";
  if (typeof value !== "number") return String(value);
  if (format === "signed") return value >= 0 ? `+${value}` : `−${-value}`;
  if (format === "feet") return `${value} ft`;
  return String(value);
}

/** "Base 14 + Elf 2"; a negative line after the first reads "− Label 1". */
export function breakdownText(lines: BreakdownLine[]): string {
  return lines
    .map((line, i) => {
      const n = line.amount;
      if (i === 0) return `${line.label} ${typeof n === "number" && n < 0 ? `−${-n}` : n}`;
      return typeof n === "number" && n < 0 ? `− ${line.label} ${-n}` : `+ ${line.label} ${n}`;
    })
    .join(" ");
}

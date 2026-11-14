// Turning derived values into text. The system's summary layout says which format a value uses.
import type { BreakdownLine, Derived, ValueFormat } from "../core";

/** "14 gp 5 sp" from copper pieces (gold, silver and copper only, as prices are written). */
export function coinsText(cp: number): string {
  const sign = cp < 0 ? "−" : "";
  let left = Math.abs(Math.round(cp));
  const parts: string[] = [];
  for (const [unit, size] of [["gp", 100], ["sp", 10], ["cp", 1]] as const) {
    const n = Math.floor(left / size);
    left -= n * size;
    if (n) parts.push(`${n} ${unit}`);
  }
  return sign + (parts.join(" ") || "0 gp");
}

export function formatValue(value: Derived["value"] | undefined, format?: ValueFormat): string {
  if (value === undefined) return "–";
  if (typeof value !== "number") return String(value);
  if (format === "signed") return value >= 0 ? `+${value}` : `−${-value}`;
  if (format === "feet") return `${value} ft`;
  if (format === "coins") return coinsText(value);
  if (format === "pounds") return `${value} lb`;
  return String(value);
}

/**
 * "Base 14 + Elf 2"; a negative line after the first reads "− Label 1". With a unit format ("coins", "pounds",
 * "feet"), each amount is shown in it: "Rolled 120 gp − Spent 15 gp".
 */
export function breakdownText(lines: BreakdownLine[], format?: ValueFormat): string {
  const unit = format && format !== "signed" ? format : undefined;
  const show = (n: number) => (unit ? formatValue(n, unit) : String(n));
  return lines
    .map((line, i) => {
      const n = line.amount;
      if (typeof n !== "number") return `${i === 0 ? "" : "+ "}${line.label} ${n}`;
      if (i === 0) return `${line.label} ${n < 0 ? `−${show(-n)}` : show(n)}`;
      return n < 0 ? `− ${line.label} ${show(-n)}` : `+ ${line.label} ${show(n)}`;
    })
    .join(" ");
}

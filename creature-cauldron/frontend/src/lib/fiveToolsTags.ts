// 5etools inline tags for plain stat block prose. Kept in its own file so the spellcasting parser and
// the main builder can both use it without importing each other.

/** Turns plain stat block prose into 5etools tagged text: "DC 13", "+5 to hit", and "(2d6 + 3)". */
export function tagProse(text: string): string {
  return text
    .replace(/\bDC (\d+)\b/g, "{@dc $1}")
    .replace(/([+-])(\d+) to hit\b/g, (_match, sign: string, n: string) => `{@hit ${sign === "-" ? "-" : ""}${n}} to hit`)
    .replace(/\((\d+d\d+(?: [+-] \d+)?)\)/g, "({@damage $1})");
}

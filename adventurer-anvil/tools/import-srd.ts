// Imports SRD 5.1 from the pinned community files in data/srd-5.1/raw/ into frontend/public/packs/srd-5.1.pack.json,
// checks the result with the app's own pack reader, and writes data/srd-5.1/IMPORT-REPORT.md.
// Run from adventurer-anvil/frontend: npm run import:srd
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readPack } from "../frontend/src/core";
import { dnd5e2014 } from "../frontend/src/systems/dnd5e-2014";
import { buildSrdPack, type BuildResult } from "./srd/build";
import type { RawSrd } from "./srd/raw";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RAW = join(ROOT, "data/srd-5.1/raw");
const read = (file: string) => JSON.parse(readFileSync(join(RAW, file), "utf8"));

const raw: RawSrd = {
  races: read("5e-SRD-Races.json"),
  subraces: read("5e-SRD-Subraces.json"),
  traits: read("5e-SRD-Traits.json"),
  languages: read("5e-SRD-Languages.json"),
  classes: read("5e-SRD-Classes.json"),
  subclasses: read("5e-SRD-Subclasses.json"),
  features: read("5e-SRD-Features.json"),
  levels: read("5e-SRD-Levels.json"),
  proficiencies: read("5e-SRD-Proficiencies.json"),
  backgrounds: read("5e-SRD-Backgrounds.json"),
  equipment: read("5e-SRD-Equipment.json"),
};

const result = buildSrdPack(raw);
const checked = readPack(JSON.parse(JSON.stringify(result.pack)), dnd5e2014, []);
if (!checked.ok) {
  console.error("The imported pack does not pass the app's own check:\n" + checked.errors.join("\n"));
  process.exit(1);
}

writeFileSync(join(ROOT, "frontend/public/packs/srd-5.1.pack.json"), JSON.stringify(result.pack, null, 2) + "\n");
writeFileSync(join(ROOT, "data/srd-5.1/IMPORT-REPORT.md"), report(result));
const c = result.pack.collections;
console.log(
  `Imported ${c.races.length} races, ${c.subraces.length} subraces, ${c.classes.length} classes, ${c.subclasses.length} subclasses, ` +
    `${c.backgrounds.length} background, ${c.items.length} items, ${c.languages.length} languages; ${result.corrections.length} corrections.`,
);

function report({ pack, traits, features, corrections }: BuildResult): string {
  const c = pack.collections;
  const by = (how: string) => traits.filter((t) => t.how === how);
  const fby = (how: string) => features.filter((f) => f.how === how);
  const frows = (list: typeof features) => list.map((f) => `| ${f.className} | ${f.level} | ${f.name} | ${f.note ?? ""} |`).join("\n");
  const level1 = (how: string) => fby(how).filter((f) => f.level === 1);
  const rows = (list: typeof traits) => list.map((t) => `| ${t.name} | ${t.note ?? ""} |`).join("\n");
  return `# SRD 5.1 import report

Written by \`tools/import-srd.ts\` (\`npm run import:srd\`); do not edit by hand. Pack version ${pack.version}.

Imported: **${c.races.length} races** (${c.races.map((r) => r.name).join(", ")}), **${c.subraces.length} subraces**
(${c.subraces.map((r) => r.name).join(", ")}), **${c.classes.length} classes** (${c.classes.map((r) => r.name).join(", ")}),
**${c.subclasses.length} subclasses** (${c.subclasses.map((r) => r.name).join(", ")}), **${c.backgrounds.length} background**
(${c.backgrounds.map((r) => r.name).join(", ")}: its skills, languages, feature, characteristics and equipment),
**${c.items.length} items** (every mundane item: weapons, armour, gear, tools, mounts and vehicles; magic items come later) and
**${c.languages.length} languages**. Every class and background has its starting equipment.
The pack passes the app's own check (\`readPack\`). Feats and spells join as each gets its pack format.

SRD 5.1 has no starting-wealth table (the rules text, checked at the same commit, starts its Equipment section with
coins), so no class carries \`startingWealth\`: with starting gold, the player enters the gold their DM gives them. A
private pack can add the dice.

## How the ${traits.length} racial traits were brought in

### Calculated (${by("calculated").length})

| Trait | Note |
|---|---|
${rows(by("calculated"))}

### Calculated, with the text kept (${by("calculated, with text").length})

| Trait | Note |
|---|---|
${rows(by("calculated, with text"))}

### Kept as text for now (${by("text for now").length})

| Trait | Becomes calculated when |
|---|---|
${rows(by("text for now"))}

### Described: nothing to calculate (${by("text").length})

${by("text").map((t) => t.name).join(", ")}.

### Folded into another trait (${by("folded in").length})

| Trait | Note |
|---|---|
${rows(by("folded in"))}

## How the ${features.length} class and subclass features were brought in

Every feature from level 1 to 20 is in the pack. The level-1 ones that need calculating are typed; the rest are kept
as their SRD text until the step that uses them (levelling up, spells).

### Calculated (${fby("calculated").length + fby("calculated, with text").length})

| Class | Level | Feature | Note |
|---|---|---|---|
${frows([...fby("calculated"), ...fby("calculated, with text")])}

### Choices (${fby("choice").length}; ${fby("choice").filter((f) => f.level === 1).length} at level 1)

| Class | Level | Feature | Note |
|---|---|---|---|
${frows(fby("choice"))}

### Level 1, described: nothing to calculate (${level1("text").length})

${level1("text").map((f) => `${f.name} (${f.className})`).join(", ")}.

### Kept as text for now (${fby("text for now").length})

${fby("text for now").length} features, of which ${level1("text for now").length} at level 1 (${level1("text for now").map((f) => f.name).join(", ")}): spellcasting
arrives with the Spells step, and features above level 1 are typed when levelling up arrives.

## Corrections (${corrections.length})

Each is in \`data/srd-5.1/corrections.ts\`, with its reason.

${corrections.map((x) => `- **${x.trait}**: ${x.reason}`).join("\n")}

## Not in SRD 5.1, so not shipped

Variant Human, and every subrace beyond the four above: these belong in private packs. The community files also carry no
name lists or random height and weight tables, so the Details step's suggestions for these races will come from private packs.
`;
}

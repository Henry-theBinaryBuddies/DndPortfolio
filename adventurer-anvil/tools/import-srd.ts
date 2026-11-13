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
console.log(`Imported ${c.races.length} races, ${c.subraces.length} subraces, ${c.languages.length} languages; ${result.corrections.length} corrections.`);

function report({ pack, traits, corrections }: BuildResult): string {
  const c = pack.collections;
  const by = (how: string) => traits.filter((t) => t.how === how);
  const rows = (list: typeof traits) => list.map((t) => `| ${t.name} | ${t.note ?? ""} |`).join("\n");
  return `# SRD 5.1 import report

Written by \`tools/import-srd.ts\` (\`npm run import:srd\`); do not edit by hand. Pack version ${pack.version}.

Imported: **${c.races.length} races** (${c.races.map((r) => r.name).join(", ")}), **${c.subraces.length} subraces**
(${c.subraces.map((r) => r.name).join(", ")}) and **${c.languages.length} languages**. The pack passes the app's own check (\`readPack\`).
Classes, backgrounds, feats, spells and items join as each gets its pack format.

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

## Corrections (${corrections.length})

Each is in \`data/srd-5.1/corrections.ts\`, with its reason.

${corrections.map((x) => `- **${x.trait}**: ${x.reason}`).join("\n")}

## Not in SRD 5.1, so not shipped

Variant Human, and every subrace beyond the four above: these belong in private packs. The community files also carry no
name lists or random height and weight tables, so the Details step's suggestions for these races will come from private packs.
`;
}

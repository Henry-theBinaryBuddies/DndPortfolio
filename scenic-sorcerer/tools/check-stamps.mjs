// Checks the bundled stamps: every manifest entry has its picture, no stray pictures, unique ids, and the credit is present.
// Run with: npm run check:stamps
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../public/stamps/", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("manifest.json", dir), "utf8"));
const files = new Set(readdirSync(dir).filter((f) => f.endsWith(".webp")));
const problems = [];
for (const m of manifest) if (!files.has(m.file)) problems.push(`missing picture: ${m.file}`);
for (const f of files) if (!manifest.some((m) => m.file === f)) problems.push(`stray picture: ${f}`);
if (new Set(manifest.map((m) => m.id)).size !== manifest.length) problems.push("duplicate ids");
if (!readFileSync(new URL("CREDITS.txt", dir), "utf8").includes("Tom Cartos")) problems.push("CREDITS.txt does not credit Tom Cartos");
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
console.log(`${manifest.length} bundled stamps ok`);

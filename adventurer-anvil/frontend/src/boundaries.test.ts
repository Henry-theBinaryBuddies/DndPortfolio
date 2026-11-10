// Checks the layering rule from docs/ARCHITECTURE.md on every test run:
// - core/ imports nothing from app/ or systems/, and no React
// - systems/ imports nothing from app/
// - core/ mentions no game words
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));

// Words that belong to a game, not to the core. Add to this list as new systems arrive.
const GAME_WORDS: RegExp[] = [
  /\bstrength\b/i, /\bdexterity\b/i, /\bconstitution\b/i, /\bintelligence\b/i, /\bwisdom\b/i, /\bcharisma\b/i,
  /\bspell/i, /\bcantrip/i, /\bd20\b/i, /\bhit points?\b/i, /\barmou?r class\b/i, /\bproficien/i,
  /\bdungeon/i, /\bwizard/i, /\belf\b/i, /\bd&d\b/i,
];

type Layer = "app" | "core" | "systems" | "other";

function layerOf(srcRelativePath: string): Layer {
  const top = srcRelativePath.split(/[\\/]/)[0];
  return top === "app" || top === "core" || top === "systems" ? top : "other";
}

function importsIn(source: string): string[] {
  const found: string[] = [];
  const pattern = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|import\s+['"]([^'"]+)['"]/g;
  for (const m of source.matchAll(pattern)) found.push(m[1] ?? m[2] ?? m[3]);
  return found;
}

/** The rule's breaches in one file. `file` is relative to src/. Exported for its own tests below. */
export function breaches(file: string, source: string): string[] {
  const layer = layerOf(file);
  const out: string[] = [];
  for (const spec of importsIn(source)) {
    if (spec.startsWith(".")) {
      const target = layerOf(relative(SRC, resolve(SRC, dirname(file), spec)));
      if (layer === "core" && (target === "app" || target === "systems")) out.push(`${file}: core imports ${target} (${spec})`);
      if (layer === "systems" && target === "app") out.push(`${file}: a system imports the app shell (${spec})`);
    } else if (layer === "core" && (spec === "react" || spec.startsWith("react-") || spec.startsWith("react/"))) {
      out.push(`${file}: core imports React (${spec})`);
    }
  }
  if (layer === "core") {
    for (const word of GAME_WORDS) {
      const hit = source.match(word);
      if (hit) out.push(`${file}: core mentions the game word "${hit[0]}"`);
    }
  }
  return out;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.(ts|tsx)$/.test(entry.name) ? [full] : [];
  });
}

describe("layering rule", () => {
  it("holds across src/", () => {
    const all = sourceFiles(SRC).flatMap((full) =>
      breaches(relative(SRC, full).split(sep).join("/"), readFileSync(full, "utf8")),
    );
    expect(all).toEqual([]);
  });

  // The checker's own tests: each breach it must catch, and what it must allow.
  it("catches core importing a system, the app shell or React", () => {
    expect(breaches("core/a.ts", `import { x } from "../systems/dnd5e-2014";`)).toHaveLength(1);
    expect(breaches("core/a.ts", `import { App } from "../app/App";`)).toHaveLength(1);
    expect(breaches("core/a.ts", `import { useState } from "react";`)).toHaveLength(1);
    expect(breaches("core/deep/a.ts", `const m = await import("../../app/App");`)).toHaveLength(1);
  });

  it("catches a system importing the app shell", () => {
    expect(breaches("systems/dnd5e-2014/a.ts", `import { App } from "../../app/App";`)).toHaveLength(1);
  });

  it("catches game words in the core", () => {
    expect(breaches("core/a.ts", `// adds the Strength modifier`)).toHaveLength(1);
    expect(breaches("core/a.ts", `const slots = spellSlots;`)).toHaveLength(1);
  });

  it("allows what the rule permits", () => {
    expect(breaches("systems/dnd5e-2014/a.ts", `import { x } from "../../core";\n// Strength, spells, d20`)).toEqual([]);
    expect(breaches("app/A.tsx", `import { x } from "../core";\nimport { y } from "../systems/dnd5e-2014";`)).toEqual([]);
    expect(breaches("core/a.ts", `import { x } from "./choices";\n// a character is a document of choices`)).toEqual([]);
  });
});

// The 2014 D&D 5e system module: every rule of that game lives here and nowhere else.
// It may use the core, never the app shell (src/boundaries.test.ts checks this).
export * from "./vocabulary";
export * from "./packFormat";
export { describe, dnd5e2014, evaluate } from "./module";

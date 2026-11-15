// The core: characters as documents of choices, build steps, derived values, validation and overrides,
// with no knowledge of any particular game. It must not import React, the app shell or any system module
// (src/boundaries.test.ts checks this). See docs/ARCHITECTURE.md.
export * from "./character";
export * from "./choices";
export * from "./content";
export * from "./dice";
export * from "./evaluation";
export * from "./pack";
export * from "./system";

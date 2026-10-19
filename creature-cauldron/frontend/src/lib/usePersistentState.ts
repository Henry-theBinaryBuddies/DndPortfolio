import { useEffect, useState } from "react";
import { readStoredJson, writeStoredJson } from "./storage";

/**
 * Like useState, but the value is saved to localStorage under `key` and read
 * back on the next visit. `parse` turns whatever was stored (an unknown value)
 * into a valid T, so bad data can never reach the app.
 *
 * A function whose name starts with "use" and that calls other hooks is a
 * custom hook: it lets components share stateful logic.
 */
export function usePersistentState<T>(key: string, parse: (stored: unknown) => T): [T, (next: T) => void] {
  // Passing a function to useState runs it once, on the first render only.
  const [value, setValue] = useState<T>(() => parse(readStoredJson(key)));

  // An effect runs after the render whenever its dependencies change.
  useEffect(() => {
    writeStoredJson(key, value);
  }, [key, value]);

  return [value, setValue];
}

import { useEffect, useState } from "react";
import { applyTheme, browserStorage, loadChoice, resolveTheme, saveChoice, type ThemeChoice } from "../lib/theme";

const DARK_QUERY = "(prefers-color-scheme: dark)";

// A light / dark switch. Until it is flipped the page follows the device (and keeps following it if the device changes);
// flipping it makes the choice stick, and it is remembered for the next visit.
export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => loadChoice(browserStorage()));
  const [deviceIsDark, setDeviceIsDark] = useState(() => window.matchMedia(DARK_QUERY).matches);

  useEffect(() => {
    const query = window.matchMedia(DARK_QUERY);
    const follow = () => setDeviceIsDark(query.matches);
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, []);

  const dark = resolveTheme(choice, deviceIsDark) === "dark";

  useEffect(() => {
    applyTheme(choice);
  }, [choice, deviceIsDark]);

  function flip() {
    const next: ThemeChoice = dark ? "light" : "dark";
    saveChoice(browserStorage(), next);
    setChoice(next);
  }

  return (
    <button type="button" role="switch" aria-checked={dark} aria-label="Dark mode" className="theme-switch" onClick={flip}>
      <span className="theme-switch__label" aria-hidden="true">
        Light
      </span>
      <span className="theme-switch__track" aria-hidden="true">
        <span className="theme-switch__thumb" />
      </span>
      <span className="theme-switch__label" aria-hidden="true">
        Dark
      </span>
    </button>
  );
}

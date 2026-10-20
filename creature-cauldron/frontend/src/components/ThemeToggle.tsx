import { useEffect, useState } from "react";
import { applyTheme, browserStorage, loadChoice, nextChoice, saveChoice, type ThemeChoice } from "../lib/theme";

const LABELS: Record<ThemeChoice, string> = { auto: "Auto", light: "Light", dark: "Dark" };
const ICONS: Record<ThemeChoice, string> = { auto: "◐", light: "☀", dark: "☾" };

// One button that cycles Auto, Light, Dark. Auto follows the device and keeps following it if the device switches.
export default function ThemeToggle() {
  const [choice, setChoice] = useState<ThemeChoice>(() => loadChoice(browserStorage()));

  useEffect(() => {
    applyTheme(choice);
    if (choice !== "auto") return;
    const query = window.matchMedia("(prefers-color-scheme: dark)");
    const follow = () => applyTheme("auto");
    query.addEventListener("change", follow);
    return () => query.removeEventListener("change", follow);
  }, [choice]);

  function press() {
    const next = nextChoice(choice);
    saveChoice(browserStorage(), next);
    setChoice(next);
  }

  return (
    <button type="button" className="theme-toggle action-button" onClick={press} title={`Colour theme: ${LABELS[choice]}. Press to change.`}>
      <span aria-hidden="true">{ICONS[choice]}</span> Theme: {LABELS[choice]}
    </button>
  );
}

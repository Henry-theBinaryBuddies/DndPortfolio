import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import { applyTheme, browserStorage, loadChoice } from "./lib/theme";

// Set the theme before the first render, so the page never flashes the wrong colours.
applyTheme(loadChoice(browserStorage()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

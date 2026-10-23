import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
// Fonts are bundled with the site (self-hosted), so visitors' browsers never contact an outside font server.
import "@fontsource/alegreya/400.css";
import "@fontsource/alegreya/400-italic.css";
import "@fontsource/alegreya/700.css";
import "@fontsource/cinzel/600.css";
import "@fontsource/cinzel/700.css";
import "@fontsource/cinzel-decorative/700.css";
import "@fontsource/medievalsharp/400.css";
import "@fontsource/pirata-one/400.css";
import "./styles.css";
import { applyTheme, browserStorage, loadChoice } from "./lib/theme";

// Set the theme before the first render, so the page never flashes the wrong colours.
applyTheme(loadChoice(browserStorage()));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

import { EYE_COLORS, HAIR_COLORS, HORN_COLORS, SKIN_TONES, TEETH_COLORS, type Paint, type Swatch } from "./paint";

// The Paint section of the panel: a row of swatches for each colour, with a picker for any other colour, the
// glow of the eyes and the grime; and the token, the painted bust saved as a picture for a virtual tabletop.
// It calls onPaint with a fresh Paint on every change, and `set` shows a paint chosen elsewhere (a race's).

type ColorKey = "skin" | "eyes" | "hair" | "horns" | "teeth";

export const TOKEN_SIZES = [256, 512, 1024] as const;
// "whole": the head with all its horns, hair and ears inside the round; "close": a larger face, horns may be cropped
export type TokenFraming = "whole" | "close";

export function mountPaint(initial: Paint, onPaint: (paint: Paint) => void, onToken?: (size: number, framing: TokenFraming, say: (text: string) => void) => Promise<void>): { section: HTMLElement; tokenSection: HTMLElement | null; set: (paint: Paint) => void } {
  let paint = { ...initial };
  const rows = new Map<ColorKey, { entries: { swatch: Swatch; button: HTMLButtonElement }[]; picker: HTMLInputElement }>();
  const glowBox = document.createElement("input");
  const grimeInput = document.createElement("input");
  const grimeOut = document.createElement("output");

  const sync = () => {
    for (const [key, { entries, picker }] of rows) {
      for (const { swatch, button } of entries) button.setAttribute("aria-pressed", String(swatch.value === paint[key]));
      picker.value = paint[key];
    }
    glowBox.checked = paint.eyeGlow;
    grimeInput.value = String(paint.grime);
    grimeOut.textContent = paint.grime.toFixed(2);
  };
  const change = (next: Partial<Paint>) => {
    paint = { ...paint, ...next };
    sync();
    onPaint({ ...paint });
  };

  const section = document.createElement("section");
  section.innerHTML = "<h2>Paint</h2>";
  const addRow = (label: string, key: ColorKey, list: Swatch[]) => {
    const row = document.createElement("div");
    row.className = "row swatches";
    const name = document.createElement("span");
    name.textContent = label;
    const holder = document.createElement("div");
    const entries: { swatch: Swatch; button: HTMLButtonElement }[] = [];
    for (const swatch of list) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "swatch";
      button.title = swatch.name;
      button.setAttribute("aria-label", `${label}: ${swatch.name}`);
      button.style.background = swatch.value;
      button.addEventListener("click", () => change({ [key]: swatch.value }));
      holder.append(button);
      entries.push({ swatch, button });
    }
    // Any other colour
    const picker = document.createElement("input");
    picker.type = "color";
    picker.className = "swatch picker";
    picker.title = `Another ${label.toLowerCase()} colour`;
    picker.setAttribute("aria-label", `${label}: another colour`);
    picker.addEventListener("input", () => change({ [key]: picker.value }));
    holder.append(picker);
    rows.set(key, { entries, picker });
    row.append(name, holder);
    section.append(row);
  };
  addRow("Skin", "skin", SKIN_TONES);
  addRow("Eyes", "eyes", EYE_COLORS);
  const glowRow = document.createElement("label");
  glowRow.className = "option indented";
  glowBox.type = "checkbox";
  glowBox.id = "paint-glow";
  glowBox.addEventListener("change", () => change({ eyeGlow: glowBox.checked }));
  glowRow.append(glowBox, " Glowing eyes");
  section.append(glowRow);
  addRow("Hair", "hair", HAIR_COLORS);
  addRow("Horns", "horns", HORN_COLORS);
  addRow("Teeth", "teeth", TEETH_COLORS);

  const grimeRow = document.createElement("label");
  grimeRow.className = "row";
  const grimeName = document.createElement("span");
  grimeName.textContent = "Grime";
  grimeInput.type = "range";
  grimeInput.min = "0";
  grimeInput.max = "1";
  grimeInput.step = "0.01";
  grimeInput.addEventListener("input", () => change({ grime: parseFloat(grimeInput.value) }));
  grimeRow.append(grimeName, grimeInput, grimeOut);
  section.append(grimeRow);

  // The token: the painted head and shoulders in a round frame with a rim, transparent outside it
  let tokenSection: HTMLElement | null = null;
  if (onToken) {
    tokenSection = document.createElement("section");
    tokenSection.innerHTML = "<h2>Token</h2>";
    const sizeRow = document.createElement("label");
    sizeRow.className = "row select";
    sizeRow.innerHTML = "<span>Size</span>";
    const sizeSelect = document.createElement("select");
    sizeSelect.id = "token-size";
    for (const size of TOKEN_SIZES) {
      const option = document.createElement("option");
      option.value = String(size);
      option.textContent = `${size} px`;
      sizeSelect.append(option);
    }
    sizeSelect.value = "512";
    sizeRow.append(sizeSelect);
    const framingRow = document.createElement("label");
    framingRow.className = "row select";
    framingRow.innerHTML = "<span>Framing</span>";
    const framingSelect = document.createElement("select");
    framingSelect.id = "token-framing";
    for (const [value, text] of [["whole", "Whole head and horns"], ["close", "Close portrait (may crop horns)"]] as const) {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      framingSelect.append(option);
    }
    framingRow.append(framingSelect);
    const button = document.createElement("button");
    button.type = "button";
    button.id = "export-token";
    button.textContent = "Save token PNG";
    button.title = "The painted head and shoulders in a round frame with a dark rim, transparent outside it, for Foundry, Roll20 and other virtual tabletops";
    const status = document.createElement("p");
    status.className = "status";
    status.id = "token-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Saves the bust as it is painted, turned a little toward three-quarter view, as a round token: the whole head with its horns inside the rim, or a closer portrait that may crop wide horns.";
    const say = (text: string) => (status.textContent = text);
    button.addEventListener("click", () => {
      button.disabled = true;
      let started: Promise<void>;
      try {
        started = onToken(Number(sizeSelect.value), framingSelect.value as TokenFraming, say);
      } catch (error) {
        started = Promise.reject(error);
      }
      started.catch((error: unknown) => say(`Token failed: ${error instanceof Error ? error.message : String(error)}`)).finally(() => (button.disabled = false));
    });
    tokenSection.append(sizeRow, framingRow, button, status);
  }

  sync();
  return {
    section,
    tokenSection,
    set(next: Paint) {
      paint = { ...next };
      sync();
    },
  };
}

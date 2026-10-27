import {
  CLOTH_COLORS,
  EYE_COLORS,
  NUMERIC_DEFS,
  SKIN_TONES,
  defaultParams,
  randomParams,
  type NumericKey,
  type Params,
  type Swatch,
} from "./params";

type Colorkey = "skin" | "cloth" | "eyes";

// Builds the slider panel and calls onChange with a fresh Params copy on every edit.
export function mountPanel(panel: HTMLElement, initial: Params, onChange: (p: Params) => void): void {
  let params = { ...initial };
  const sliders = new Map<NumericKey, { input: HTMLInputElement; out: HTMLElement }>();
  const swatchRows = new Map<Colorkey, { swatch: Swatch; button: HTMLButtonElement }[]>();

  const emit = () => onChange({ ...params });

  const syncUI = () => {
    for (const [key, { input, out }] of sliders) {
      input.value = String(params[key]);
      out.textContent = params[key].toFixed(2);
    }
    for (const [key, entries] of swatchRows) {
      for (const { swatch, button } of entries) {
        button.setAttribute("aria-pressed", String(swatch.value === params[key]));
      }
    }
  };

  const groups = [...new Set(NUMERIC_DEFS.map((d) => d.group))];
  for (const group of groups) {
    const section = document.createElement("section");
    section.innerHTML = `<h2>${group}</h2>`;
    for (const def of NUMERIC_DEFS.filter((d) => d.group === group)) {
      const row = document.createElement("label");
      row.className = "row";
      const name = document.createElement("span");
      name.textContent = def.label;
      const input = document.createElement("input");
      input.type = "range";
      input.min = String(def.min);
      input.max = String(def.max);
      input.step = String(def.step);
      const out = document.createElement("output");
      input.addEventListener("input", () => {
        params[def.key] = parseFloat(input.value);
        out.textContent = params[def.key].toFixed(2);
        emit();
      });
      row.append(name, input, out);
      section.append(row);
      sliders.set(def.key, { input, out });
    }
    panel.append(section);
  }

  const colorSection = document.createElement("section");
  colorSection.innerHTML = "<h2>Colors</h2>";
  const addSwatches = (label: string, key: Colorkey, list: Swatch[]) => {
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
      button.addEventListener("click", () => {
        params[key] = swatch.value;
        syncUI();
        emit();
      });
      holder.append(button);
      entries.push({ swatch, button });
    }
    swatchRows.set(key, entries);
    row.append(name, holder);
    colorSection.append(row);
  };
  addSwatches("Skin", "skin", SKIN_TONES);
  addSwatches("Cloth", "cloth", CLOTH_COLORS);
  addSwatches("Eyes", "eyes", EYE_COLORS);
  panel.append(colorSection);

  const actions = document.createElement("div");
  actions.className = "actions";
  const randomize = document.createElement("button");
  randomize.type = "button";
  randomize.textContent = "Randomize";
  randomize.addEventListener("click", () => {
    params = randomParams();
    syncUI();
    emit();
  });
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";
  reset.addEventListener("click", () => {
    params = defaultParams();
    syncUI();
    emit();
  });
  actions.append(randomize, reset);
  panel.append(actions);

  syncUI();
}

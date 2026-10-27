import {
  BODIES,
  CLOTH_COLORS,
  EYE_COLORS,
  EYE_STYLES,
  HAIR_COLORS,
  BEARD_STYLES,
  HAIR_STYLES,
  HORN_STYLES,
  NUMERIC_DEFS,
  PRESETS,
  RACES,
  RACE_INFO,
  SKIN_TONES,
  applyPreset,
  applyRace,
  switchRace,
  defaultParams,
  randomParams,
  type Body,
  type EyeStyle,
  type BeardStyle,
  type HairStyle,
  type HornStyle,
  type NumericKey,
  type Params,
  type Race,
  type Swatch,
} from "./params";

type ColorKey = "skin" | "cloth" | "eyes" | "hairColor";

// Builds the control panel and calls onChange with a fresh Params copy on every edit.
export function mountPanel(panel: HTMLElement, initial: Params, onChange: (p: Params) => void): void {
  let params = { ...initial };
  const sliders = new Map<NumericKey, { input: HTMLInputElement; out: HTMLElement; row: HTMLElement }>();
  const swatchRows = new Map<ColorKey, { swatch: Swatch; button: HTMLButtonElement }[]>();
  const raceSelect = document.createElement("select");
  const presetSelect = document.createElement("select");
  const hornSelect = document.createElement("select");
  const hairSelect = document.createElement("select");
  const beardSelect = document.createElement("select");
  const eyeButtons = new Map<EyeStyle, HTMLButtonElement>();
  const bodyButtons = new Map<Body, HTMLButtonElement>();

  const emit = () => onChange({ ...params });

  const syncUI = () => {
    raceSelect.value = params.race;
    for (const [style, button] of eyeButtons) button.setAttribute("aria-pressed", String(style === params.eyeStyle));
    for (const [body, button] of bodyButtons) button.setAttribute("aria-pressed", String(body === params.body));
    hornSelect.value = params.hornStyle;
    hairSelect.value = params.hairStyle;
    beardSelect.value = params.beardStyle;
    for (const [key, { input, out, row }] of sliders) {
      input.value = String(params[key]);
      out.textContent = params[key].toFixed(2);
      // Tusks belong to half-orcs; the other races have no tusk control
      if (key === "tusks") row.style.display = params.race === "half-orc" ? "" : "none";
    }
    for (const [key, entries] of swatchRows) {
      for (const { swatch, button } of entries) {
        button.setAttribute("aria-pressed", String(swatch.value === params[key]));
      }
    }
  };

  const update = (next: Params) => {
    params = next;
    syncUI();
    emit();
  };

  // Character section: build, race, archetype preset and eye style
  const character = document.createElement("section");
  character.innerHTML = "<h2>Character</h2>";

  // Build type: a three-way toggle that reshapes the whole bust (jaw, brow, neck, shoulders, chest)
  const bodyRow = document.createElement("div");
  bodyRow.className = "row select";
  bodyRow.innerHTML = "<span>Build</span>";
  const bodyGroup = document.createElement("div");
  bodyGroup.className = "segmented";
  for (const body of BODIES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = body[0].toUpperCase() + body.slice(1);
    button.addEventListener("click", () => {
      params.body = body;
      syncUI();
      emit();
    });
    bodyGroup.append(button);
    bodyButtons.set(body, button);
  }
  bodyRow.append(bodyGroup);

  const raceRow = document.createElement("label");
  raceRow.className = "row select";
  raceRow.innerHTML = "<span>Race</span>";
  for (const race of RACES) {
    const option = document.createElement("option");
    option.value = race;
    option.textContent = RACE_INFO[race].label;
    raceSelect.append(option);
  }
  raceSelect.addEventListener("change", () => update(switchRace(params, raceSelect.value as Race)));
  // Switching race keeps every edit; this applies the race's suggested sliders, skin, hair and horns
  const raceDefaults = document.createElement("button");
  raceDefaults.type = "button";
  raceDefaults.className = "inline";
  raceDefaults.textContent = "Race defaults";
  raceDefaults.title = "Reset the sliders, skin, hair and horns to this race's defaults";
  raceDefaults.addEventListener("click", () => update(applyRace(params, params.race)));
  raceRow.append(raceSelect);
  // On its own row, so the race picker keeps its full width
  const raceDefaultsRow = document.createElement("div");
  raceDefaultsRow.className = "row select";
  raceDefaultsRow.append(document.createElement("span"), raceDefaults);

  const presetRow = document.createElement("label");
  presetRow.className = "row select";
  presetRow.innerHTML = "<span>Archetype</span>";
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = "Choose a preset";
  presetSelect.append(blank);
  for (const preset of PRESETS) {
    const option = document.createElement("option");
    option.value = preset.name;
    option.textContent = preset.name;
    presetSelect.append(option);
  }
  presetSelect.addEventListener("change", () => {
    const preset = PRESETS.find((entry) => entry.name === presetSelect.value);
    presetSelect.value = "";
    if (preset) update(applyPreset(params, preset));
  });
  presetRow.append(presetSelect);

  // Eye style: one solid colour (glowing) or a realistic eye with sclera, iris, pupil and cornea
  const eyeRow = document.createElement("div");
  eyeRow.className = "row select";
  eyeRow.innerHTML = "<span>Eyes</span>";
  const eyeGroup = document.createElement("div");
  eyeGroup.className = "segmented";
  for (const style of EYE_STYLES) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = style === "glow" ? "Solid colour" : "Realistic";
    button.addEventListener("click", () => {
      params.eyeStyle = style;
      syncUI();
      emit();
    });
    eyeGroup.append(button);
    eyeButtons.set(style, button);
  }
  eyeRow.append(eyeGroup);

  // Hair and horn styles
  const styleRow = (label: string, select: HTMLSelectElement, names: readonly string[], apply: (value: string) => void) => {
    const row = document.createElement("label");
    row.className = "row select";
    row.innerHTML = `<span>${label}</span>`;
    for (const name of names) {
      const option = document.createElement("option");
      option.value = name;
      option.textContent = name[0].toUpperCase() + name.slice(1);
      select.append(option);
    }
    select.addEventListener("change", () => {
      apply(select.value);
      emit();
    });
    row.append(select);
    return row;
  };
  const hairRow = styleRow("Hair", hairSelect, HAIR_STYLES, (value) => (params.hairStyle = value as HairStyle));
  const beardRow = styleRow("Beard", beardSelect, BEARD_STYLES, (value) => (params.beardStyle = value as BeardStyle));
  const hornRow = styleRow("Horns", hornSelect, HORN_STYLES, (value) => (params.hornStyle = value as HornStyle));

  character.append(bodyRow, raceRow, raceDefaultsRow, presetRow, eyeRow, hairRow, beardRow, hornRow);
  panel.append(character);

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
      sliders.set(def.key, { input, out, row });
    }
    panel.append(section);
  }

  const colorSection = document.createElement("section");
  colorSection.innerHTML = "<h2>Colors</h2>";
  const addSwatches = (label: string, key: ColorKey, list: Swatch[]) => {
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
  addSwatches("Hair", "hairColor", HAIR_COLORS);
  addSwatches("Cloth", "cloth", CLOTH_COLORS);
  addSwatches("Eyes", "eyes", EYE_COLORS);
  panel.append(colorSection);

  const actions = document.createElement("div");
  actions.className = "actions";
  const randomize = document.createElement("button");
  randomize.type = "button";
  randomize.textContent = "Randomize";
  randomize.addEventListener("click", () => update(randomParams()));
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";
  reset.addEventListener("click", () => update(defaultParams()));
  actions.append(randomize, reset);
  panel.append(actions);

  syncUI();
}

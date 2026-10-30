import {
  BODIES,
  BEARD_STYLES,
  HAIR_STYLES,
  HORN_STYLES,
  NUMERIC_DEFS,
  RACES,
  RACE_INFO,
  applyRace,
  switchRace,
  defaultParams,
  randomParams,
  type Body,
  type BeardStyle,
  type HairStyle,
  type HornStyle,
  type NumericKey,
  type Params,
  type Race,
} from "./params";

// Builds the control panel and calls onChange with a fresh Params copy on every edit.
export function mountPanel(panel: HTMLElement, initial: Params, onChange: (p: Params) => void, onExport?: (p: Params, say: (text: string) => void, partial: boolean, gusset: boolean) => Promise<void>): void {
  let params = { ...initial };
  const sliders = new Map<NumericKey, { input: HTMLInputElement; out: HTMLElement; row: HTMLElement }>();
  const raceSelect = document.createElement("select");
  const hornSelect = document.createElement("select");
  const hairSelect = document.createElement("select");
  const beardSelect = document.createElement("select");
  const bodyButtons = new Map<Body, HTMLButtonElement>();

  const emit = () => onChange({ ...params });

  const syncUI = () => {
    raceSelect.value = params.race;
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
  };

  const update = (next: Params) => {
    params = next;
    syncUI();
    emit();
  };

  // Character section: build, race, and the hair, beard and horn styles
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
  // Switching race keeps every edit; this applies the race's suggested sliders, hair, beard and horns
  const raceDefaults = document.createElement("button");
  raceDefaults.type = "button";
  raceDefaults.className = "inline";
  raceDefaults.textContent = "Race defaults";
  raceDefaults.title = "Reset the sliders, hair, beard and horns to this race's defaults";
  raceDefaults.addEventListener("click", () => update(applyRace(params, params.race)));
  raceRow.append(raceSelect);
  // On its own row, so the race picker keeps its full width
  const raceDefaultsRow = document.createElement("div");
  raceDefaultsRow.className = "row select";
  raceDefaultsRow.append(document.createElement("span"), raceDefaults);

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

  character.append(bodyRow, raceRow, raceDefaultsRow, hairRow, beardRow, hornRow);
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

  // Export: the bust as an STL, merged into one solid for printing (it takes a few seconds)
  if (onExport) {
    const exportSection = document.createElement("section");
    exportSection.innerHTML = "<h2>Print</h2>";
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.id = "export-stl";
    exportButton.textContent = "Export STL";
    const diagnosticButton = document.createElement("button");
    diagnosticButton.type = "button";
    diagnosticButton.id = "export-partial";
    diagnosticButton.textContent = "Diagnostic export (partial)";
    diagnosticButton.title = "Keeps whatever can be merged, even if a part is missing: for finding out what is wrong, never for printing";
    const gussetLabel = document.createElement("label");
    gussetLabel.className = "option";
    gussetLabel.title = "A wedge under the chin, sloping back to the neck at 45 degrees, so the chin needs no supports. It makes the throat heavier; leave it off to print the chin with the slicer's supports instead";
    const gussetBox = document.createElement("input");
    gussetBox.type = "checkbox";
    gussetBox.id = "export-gusset";
    gussetLabel.append(gussetBox, " Throat gusset (no chin supports)");
    const status = document.createElement("p");
    status.className = "status";
    status.id = "export-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Merges the bust, with its base, into one solid: about 75-90 mm tall on a 24 mm base, sized for a 0.2 mm nozzle. Refuses, rather than save a file with something missing.";
    const run = (partial: boolean) => {
      exportButton.disabled = true;
      diagnosticButton.disabled = true;
      // (whatever goes wrong, the buttons come back)
      let started: Promise<void>;
      try {
        started = onExport({ ...params }, (text) => (status.textContent = text), partial, gussetBox.checked);
      } catch (error) {
        started = Promise.reject(error);
      }
      started
        .catch((error: unknown) => (status.textContent = `Export failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => {
          exportButton.disabled = false;
          diagnosticButton.disabled = false;
        });
    };
    exportButton.addEventListener("click", () => run(false));
    diagnosticButton.addEventListener("click", () => run(true));
    exportSection.append(exportButton, diagnosticButton, gussetLabel, status);
    panel.append(exportSection);
  }

  syncUI();
}

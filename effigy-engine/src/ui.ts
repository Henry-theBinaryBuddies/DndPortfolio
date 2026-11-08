import {
  BODIES,
  BEARD_STYLES,
  HAIR_STYLES,
  HORN_STYLES,
  NUMERIC_DEFS,
  CLOAKS,
  OUTFITS,
  RACES,
  RACE_INFO,
  applyRace,
  switchRace,
  defaultParams,
  randomParams,
  randomDragonborn,
  type Body,
  type BeardStyle,
  type HairStyle,
  type HornStyle,
  type NumericDef,
  type NumericKey,
  type Cloak,
  type Outfit,
  type Params,
  type Race,
} from "./params";

// A section's heading, with a button that puts the section back as it was, if it has one
export function heading(title: string, reset?: { title: string; onClick: () => void }): HTMLElement {
  const h = document.createElement("h2");
  h.textContent = title;
  if (reset) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reset";
    button.textContent = "Reset";
    button.title = reset.title;
    button.setAttribute("aria-label", `Reset ${title.toLowerCase()}: ${reset.title.toLowerCase()}`);
    button.addEventListener("click", reset.onClick);
    h.append(button);
  }
  return h;
}

// Builds the control panel and calls onChange with a fresh Params copy on every edit: the sculpt's controls into
// `shape`, the print's into `output`. `set` shows settings chosen elsewhere (undo, a character file) and rebuilds.
export function mountPanel(shape: HTMLElement, output: HTMLElement, initial: Params, onChange: (p: Params) => void, onExport?: (p: Params, say: (text: string) => void, partial: boolean, gusset: boolean, tabletop: boolean) => Promise<void>, onPreview?: (p: Params, say: (text: string) => void, gusset: boolean, tabletop: boolean, current: () => boolean) => Promise<void>): { set: (p: Params) => void } {
  let params = { ...initial };
  const sliders = new Map<NumericKey, { input: HTMLInputElement; out: HTMLElement; row: HTMLElement; def: NumericDef }>();
  const raceSelect = document.createElement("select");
  const hornSelect = document.createElement("select");
  const hairSelect = document.createElement("select");
  const beardSelect = document.createElement("select");
  const outfitSelect = document.createElement("select");
  const cloakSelect = document.createElement("select");
  const bodyButtons = new Map<Body, HTMLButtonElement>();
  // What only a humanoid has (a Dragonborn is a sculpt of its own: see dragonborn.ts), hidden while it is shown
  const humanoidOnly: HTMLElement[] = [];
  const familyNote = document.createElement("p");

  // (any edit goes back from the print preview to the sculpt: see main.ts)
  // (`edited`: false only for going back from the preview to the same sculpt, which leaves what was measured true)
  let leavePreview = (_edited: boolean) => {};
  const emit = (edited = true) => {
    leavePreview(edited);
    onChange({ ...params });
  };

  const syncUI = () => {
    raceSelect.value = params.family === "dragonborn" ? "dragonborn" : params.race;
    for (const element of humanoidOnly) element.hidden = params.family !== "humanoid";
    for (const { section, defs } of sections) section.hidden = !defs.some((d) => d.families.includes(params.family));
    familyNote.hidden = params.family === "humanoid";
    for (const [body, button] of bodyButtons) button.setAttribute("aria-pressed", String(body === params.body));
    hornSelect.value = params.hornStyle;
    hairSelect.value = params.hairStyle;
    beardSelect.value = params.beardStyle;
    outfitSelect.value = params.outfit;
    cloakSelect.value = params.cloak;
    for (const [key, { input, out, row, def }] of sliders) {
      input.value = String(params[key]);
      out.textContent = params[key].toFixed(2);
      row.hidden = !def.families.includes(params.family);
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
  character.append(heading("Character"));

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
  // (the Dragonborn is in the same list, though it is a family of its own: choosing it keeps the humanoid's race and
  // settings, for when a race is chosen again)
  const dragonOption = document.createElement("option");
  dragonOption.value = "dragonborn";
  dragonOption.textContent = "Dragonborn";
  raceSelect.append(dragonOption);
  raceSelect.addEventListener("change", () => {
    if (raceSelect.value === "dragonborn") update({ ...params, family: "dragonborn" });
    else update({ ...switchRace(params, raceSelect.value as Race), family: "humanoid" });
  });
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
  // (either family wears clothes: see garments.ts)
  const outfitRow = styleRow("Outfit", outfitSelect, OUTFITS, (value) => (params.outfit = value as Outfit));
  const cloakRow = styleRow("Cloak", cloakSelect, CLOAKS, (value) => (params.cloak = value as Cloak));

  familyNote.className = "status";
  familyNote.id = "family-note";
  familyNote.textContent = "The Dragonborn is a sculpt of its own, with its own shape controls below. The humanoid's settings are kept for when you choose a race again.";
  character.append(bodyRow, raceRow, familyNote, raceDefaultsRow, hairRow, beardRow, hornRow, outfitRow, cloakRow);
  humanoidOnly.push(bodyRow, raceDefaultsRow, hairRow, beardRow, hornRow);
  shape.append(character);

  // (a section shows when any of its sliders shapes the family on show)
  const sections: { section: HTMLElement; defs: NumericDef[] }[] = [];
  const groups = [...new Set(NUMERIC_DEFS.map((d) => d.group))];
  for (const group of groups) {
    const section = document.createElement("section");
    const defs = NUMERIC_DEFS.filter((d) => d.group === group);
    // (back to where the race starts these sliders; the rest are left as they are)
    section.append(
      heading(group, {
        title: "Back to this race's starting values",
        onClick: () => {
          const start = applyRace(params, params.race);
          const next = { ...params };
          for (const d of defs) next[d.key] = start[d.key];
          update(next);
        },
      }),
    );
    for (const def of defs) {
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
      sliders.set(def.key, { input, out, row, def });
    }
    shape.append(section);
    sections.push({ section, defs });
  }

  const actions = document.createElement("div");
  actions.className = "actions";
  const randomize = document.createElement("button");
  randomize.type = "button";
  randomize.textContent = "Randomize";
  // (within the family on show: a Dragonborn stays a Dragonborn)
  // (the outfit and the cloak are kept: they are what the character wears, not who it is)
  randomize.addEventListener("click", () => update({ ...(params.family === "dragonborn" ? randomDragonborn(params) : randomParams()), outfit: params.outfit, cloak: params.cloak }));
  const reset = document.createElement("button");
  reset.type = "button";
  reset.textContent = "Reset";
  reset.addEventListener("click", () => update(defaultParams()));
  actions.append(randomize, reset);
  shape.append(actions);

  // Export: the bust as an STL, merged into one solid for printing (it takes a few seconds)
  if (onExport) {
    const exportSection = document.createElement("section");
    exportSection.append(heading("Print"));
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
    gussetLabel.title = "A wedge under the chin, sloping back to the neck at 45 degrees, so the chin needs no supports. It makes the throat heavier; untick it to print the chin with the slicer's supports instead";
    const gussetBox = document.createElement("input");
    gussetBox.type = "checkbox";
    gussetBox.id = "export-gusset";
    gussetBox.checked = true;
    gussetLabel.append(gussetBox, " Throat gusset (no chin supports)");
    const tabletopLabel = document.createElement("label");
    tabletopLabel.className = "option";
    tabletopLabel.title = "Fit the whole bust, hair, shoulders, clothes and cloak included, inside a one inch (25.4 mm) square on a 25 mm base, the bust as near 50 mm tall as that allows, on an 18 mm stand. The torso is slimmed as far as it takes. Whatever is widest sets the size: a bare bust usually comes out 40-45 mm tall, armour or a cloak make it smaller (about 30 mm in armour and a cowl). Preview print shows the size it will be. Untick it for the full-size print, a 75-90 mm bust and about 120 mm tall in all";
    const tabletopBox = document.createElement("input");
    tabletopBox.type = "checkbox";
    tabletopBox.id = "export-tabletop";
    tabletopBox.checked = true;
    tabletopLabel.append(tabletopBox, " Tabletop size (fits a 1 inch base; Preview print shows how tall)");
    const status = document.createElement("p");
    status.className = "status";
    status.id = "export-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Merges the bust, with its base, into one solid. Tabletop size fits it inside a one inch square on a 25 mm base, on an 18 mm stand: the torso is slimmed to fit, and whatever is widest sets the size (a bare bust usually 40-45 mm tall, smaller in armour or a cloak; Preview print says how tall). Unticked it is the full size: a 75-90 mm bust, about 120 mm in all. Preview print shows it as it will print first. Sized for a 0.2 mm nozzle. Refuses, rather than save a file with something missing. Not yet proven on a print: the mail's rings, the cloak, and relief finer than about 1 mm.";
    // The print preview: the bust as the export will make it, in place of the sculpt, until the sculpt is edited
    const previewButton = document.createElement("button");
    previewButton.type = "button";
    previewButton.id = "export-preview";
    previewButton.textContent = "Preview print";
    previewButton.title = "Shows the bust as it will print (at tabletop size: slimmed, scaled and on its small base, over the one inch square) and its size, before you save it";
    let previewing = false;
    // What the status says belongs to the settings it was measured on. Each edit starts a new generation: a report
    // from before it is taken down, and what an operation started before it says later is labelled as such, so it
    // is never read as a measure of the bust now shown.
    let generation = 0;
    let reported = false; // the status is about a preview or an export, not the opening note
    const sayFor = (started: number) => (text: string) => {
      status.textContent = started === generation ? text : `For the earlier settings: ${text}`;
      reported = true;
    };
    const invalidate = () => {
      generation++;
      if (reported) status.textContent = "The settings have changed since this was measured: preview or export again to measure them.";
    };
    leavePreview = (edited) => {
      previewing = false;
      previewButton.textContent = "Preview print";
      if (edited) invalidate();
    };
    const busy = (on: boolean) => {
      for (const button of [exportButton, diagnosticButton, previewButton]) button.disabled = on;
    };
    const preview = () => {
      if (!onPreview) return;
      busy(true);
      const at = generation;
      const say = sayFor(at);
      let started: Promise<void>;
      try {
        // (`current`: whether the settings are still the ones it was asked for, so an outdated print is never shown)
        started = onPreview({ ...params }, say, gussetBox.checked, tabletopBox.checked, () => at === generation);
      } catch (error) {
        started = Promise.reject(error);
      }
      started
        .then(() => {
          // (edited while it was being made: it shows the bust as it was, so go back to the sculpt as it is)
          if (at !== generation) {
            onChange({ ...params });
            return;
          }
          previewing = true;
          previewButton.textContent = "Back to sculpt";
        })
        .catch((error: unknown) => say(`Preview failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => busy(false));
    };
    previewButton.addEventListener("click", () => {
      if (!previewing) preview();
      else emit(false);
    });
    // (a changed print option changes what was measured, and shows the new print if it is being previewed)
    for (const box of [gussetBox, tabletopBox])
      box.addEventListener("change", () => {
        invalidate();
        if (previewing) preview();
      });
    const run = (partial: boolean) => {
      busy(true);
      const say = sayFor(generation);
      // (whatever goes wrong, the buttons come back)
      let started: Promise<void>;
      try {
        started = onExport({ ...params }, say, partial, gussetBox.checked, tabletopBox.checked);
      } catch (error) {
        started = Promise.reject(error);
      }
      started
        .catch((error: unknown) => say(`Export failed: ${error instanceof Error ? error.message : String(error)}`))
        .finally(() => busy(false));
    };
    exportButton.addEventListener("click", () => run(false));
    diagnosticButton.addEventListener("click", () => run(true));
    exportSection.append(previewButton, exportButton, diagnosticButton, gussetLabel, tabletopLabel, status);
    output.append(exportSection);
  }

  syncUI();
  return { set: (p: Params) => update({ ...p }) };
}

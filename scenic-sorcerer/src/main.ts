import "./style.css";
import { Library } from "./assets";
import { cellAt, mapSize, snap } from "./grid";
import { History } from "./history";
import {
  FLOORS,
  LAYERS,
  LIMITS,
  WALL_RATIO,
  clampInt,
  newId,
  newMap,
  type Asset,
  type FloorId,
  type GridType,
  type LayerId,
  type MapDoc,
  type Opening,
  type Point,
  type SnapMode,
  type Stamp,
  type Stroke,
} from "./model";
import {
  addStamps,
  addStroke,
  filterAssets,
  itemKind,
  makeStamp,
  moveItem,
  removeById,
  reorder,
  resizeStamp,
  stampAt,
  stampLongest,
  stampSnap,
  strokeAt,
  updateStamp,
  usedAssetIds,
  type ItemKind,
} from "./objects";
import { render } from "./render";
import {
  addOpening,
  addRoom,
  distance,
  isValidOutline,
  nearestWall,
  openingAt,
  openingOnWall,
  rectPoints,
  roomAt,
  setRoomFloor,
  setRoomWalls,
  walledRooms,
} from "./rooms";
import { fileName, loadAutosave, parseFile, saveAutosave, serialize } from "./storage";
import { fit, mapToScreen, pan, screenToMap, zoomAt, type View } from "./view";

type Tool = "select" | "room" | "polygon" | "door" | "window" | "brush" | "stamp";

const SNAP_KEY = "scenic-sorcerer.snap";
const AUTOSAVE_DELAY_MS = 400;
const CLICK_SLOP_PX = 4; // screen pixels the pointer may move and still count as a click
const CLOSE_SHAPE_PX = 12; // how near the first corner a click must be to finish a shape room
const MAX_SHOWN_ASSETS = 150;

const HINTS: Record<Tool, string> = {
  select: "Click something to select it. Drag it to move it. Drag empty space to move around.",
  room: "Drag to draw a room. Hold Space and drag to move around.",
  polygon: "Click each corner of the room. Click the first corner again, or press Enter, to finish.",
  door: "Click a wall to add a door.",
  window: "Click a wall to add a window.",
  brush: "Drag to paint the ground. Hold Space and drag to move around.",
  stamp: "Pick a stamp on the right, then click the map to place it.",
};

/** The layer each tool draws on, and the layer each kind of thing lives on. */
const TOOL_LAYER: Record<Exclude<Tool, "select">, LayerId> = {
  room: "floors",
  polygon: "floors",
  door: "walls",
  window: "walls",
  brush: "paint",
  stamp: "objects",
};
const KIND_LAYER: Record<ItemKind, LayerId> = { room: "floors", opening: "walls", stroke: "paint", stamp: "objects" };
const KIND_NAME: Record<ItemKind, string> = { room: "room", opening: "door", stroke: "paint", stamp: "stamp" };

const canvas = el<HTMLCanvasElement>("canvas");
const stage = el<HTMLDivElement>("stage");
const ctx = canvas.getContext("2d")!;
const nameInput = el<HTMLInputElement>("map-name");
const colsInput = el<HTMLInputElement>("cols");
const rowsInput = el<HTMLInputElement>("rows");
const fileInput = el<HTMLInputElement>("file-input");
const assetInput = el<HTMLInputElement>("asset-input");
const undoButton = el<HTMLButtonElement>("btn-undo");
const redoButton = el<HTMLButtonElement>("btn-redo");
const saveStatus = el("save-status");
const zoomLabel = el("zoom-label");
const cursorCell = el("cursor-cell");
const hint = el("hint");
const message = el("message");
const dropHint = el("drop-hint");
const toolGroup = el("tools");
const gridTypeGroup = el("grid-type");
const snapGroup = el("snap-mode");
const floorGroup = el("floors");
const floorSection = el("floor-section");
const floorTitle = el("floor-title");
const wallsRow = el("walls-row");
const wallsInput = el<HTMLInputElement>("walls");
const brushSection = el("brush-section");
const brushSizeInput = el<HTMLInputElement>("brush-size");
const brushOpacityInput = el<HTMLInputElement>("brush-opacity");
const librarySection = el("library-section");
const assetSearch = el<HTMLInputElement>("asset-search");
const assetFavourites = el<HTMLInputElement>("asset-favourites");
const assetGrid = el("asset-grid");
const assetNote = el("asset-note");
const assetActions = el("asset-actions");
const favouriteButton = el<HTMLButtonElement>("btn-favourite");
const stampSection = el("stamp-section");
const stampTitle = el("stamp-title");
const stampSizeInput = el<HTMLInputElement>("stamp-size");
const stampRotationInput = el<HTMLInputElement>("stamp-rotation");
const stampShadowInput = el<HTMLInputElement>("stamp-shadow");
const stampScatterInput = el<HTMLInputElement>("stamp-scatter");
const scatterRow = el("scatter-row");
const stampExtras = el("stamp-extras");
const stampTintInput = el<HTMLInputElement>("stamp-tint");
const selectionSection = el("selection-section");
const selectionTitle = el("selection-title");
const orderRow = el("order-row");
const layersBody = el("layers").querySelector("tbody")!;

type Drag =
  | { kind: "pan" }
  | { kind: "room"; start: Point }
  | { kind: "move"; id: string; item: ItemKind; startScreen: Point; startMap: Point; base: MapDoc; moved: boolean }
  | { kind: "brush"; stroke: Stroke }
  | { kind: "scatter"; base: MapDoc; asset: Asset; placed: Stamp[]; last: Point };

const history = new History<MapDoc>(loadAutosave(localStorage) ?? newMap());
const library = new Library((what) => {
  if (what === "list") renderLibrary();
  draw();
});
let view: View = { x: 0, y: 0, scale: 1 };
let snapMode: SnapMode = readSnapMode();
let tool: Tool = "select";
let selectedId: string | null = null;
let cursor: Point | null = null; // screen position over the canvas
let drag: Drag | null = null;
let liveDoc: MapDoc | null = null; // the map mid-drag, before it becomes an undo step
let shape: Point[] = []; // corners of the shape room being drawn
let spaceDown = false;
let drawQueued = false;
let autosaveTimer: number | undefined;
let messageTimer: number | undefined;

// Settings for the next thing drawn.
let floor: FloorId = "stone";
let walls = true;
let paintTexture: FloorId = "grass";
let brushSize = 1; // cells
let brushOpacity = 1;
let assetId: string | null = null;
let stampSize = 1; // longest side, in cells
let stampRotation = 0; // degrees
let stampShadow = true;
let scatter = false;

for (const f of FLOORS) {
  const button = document.createElement("button");
  button.type = "button";
  button.setAttribute("role", "radio");
  button.dataset.value = f.id;
  const chip = document.createElement("i");
  chip.style.background = f.color;
  button.append(chip, f.label);
  floorGroup.append(button);
}

for (const row of [...LAYERS, { id: "grid", label: "Grid lines" }] as const) {
  const tr = document.createElement("tr");
  const name = document.createElement("td");
  name.textContent = row.label;
  tr.append(name);
  for (const field of ["visible", "locked"] as const) {
    const td = document.createElement("td");
    if (row.id !== "grid" || field === "visible") {
      const box = document.createElement("input");
      box.type = "checkbox";
      box.dataset.layer = row.id;
      box.dataset.field = field;
      box.setAttribute("aria-label", `${field === "visible" ? "Show" : "Lock"} ${row.label}`);
      td.append(box);
    }
    tr.append(td);
  }
  layersBody.append(tr);
}

// ---- document changes -------------------------------------------------

/** The map as it should be shown: the saved state, or the in-progress drag. */
function doc(): MapDoc {
  return liveDoc ?? history.present;
}

/** Record a new version of the map as one undo step. */
function commit(next: MapDoc): void {
  const before = history.present;
  liveDoc = null;
  history.push(next);
  afterChange(before);
}

function afterChange(before: MapDoc): void {
  const now = history.present;
  const a = mapSize(before.grid);
  const b = mapSize(now.grid);
  if (a.width !== b.width || a.height !== b.height) fitView();
  const kind = itemKind(now, selectedId);
  if (!kind || !layerOpen(KIND_LAYER[kind])) selectedId = null;
  syncControls();
  scheduleAutosave();
  draw();
}

function undo(): void {
  if (!history.canUndo) return;
  const before = history.present;
  cancelDrawing();
  history.undo();
  afterChange(before);
}

function redo(): void {
  if (!history.canRedo) return;
  const before = history.present;
  cancelDrawing();
  history.redo();
  afterChange(before);
}

function scheduleAutosave(): void {
  saveStatus.textContent = "Saving…";
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(flushAutosave, AUTOSAVE_DELAY_MS);
}

function flushAutosave(): void {
  if (autosaveTimer === undefined) return;
  window.clearTimeout(autosaveTimer);
  autosaveTimer = undefined;
  const ok = saveAutosave(localStorage, history.present);
  saveStatus.textContent = ok ? "Saved in this browser" : "Could not autosave. Use Save to keep your map.";
}

// Closing or reloading the tab right after a change must not lose it.
window.addEventListener("pagehide", flushAutosave);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") flushAutosave();
});

function deleteSelected(): void {
  if (selectedId) commit(removeById(history.present, selectedId));
}

function layerOpen(layer: LayerId): boolean {
  const state = history.present.layers[layer];
  return state.visible && !state.locked;
}

/** True when the current tool may draw. Otherwise says why not. */
function canDraw(): boolean {
  if (tool === "select") return true;
  const layer = TOOL_LAYER[tool];
  if (layerOpen(layer)) return true;
  const label = LAYERS.find((l) => l.id === layer)!.label;
  const state = history.present.layers[layer];
  showMessage(`The ${label} layer is ${state.visible ? "locked" : "hidden"}. Change it under Layers to draw here.`);
  return false;
}

function selectedStamp(): Stamp | undefined {
  return history.present.stamps.find((s) => s.id === selectedId);
}

// ---- controls ---------------------------------------------------------

function syncControls(): void {
  const d = history.present;
  if (document.activeElement !== nameInput) nameInput.value = d.name;
  colsInput.value = String(d.grid.cols);
  rowsInput.value = String(d.grid.rows);
  setChoice(gridTypeGroup, d.grid.type);
  setChoice(snapGroup, snapMode);
  setChoice(toolGroup, tool);
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
  document.title = `${d.name} · Scenic Sorcerer`;
  hint.textContent = HINTS[tool];
  canvas.classList.toggle("drawing", tool !== "select");

  const kind = itemKind(d, selectedId);
  const room = d.rooms.find((r) => r.id === selectedId);
  const opening = d.openings.find((o) => o.id === selectedId);
  const stamp = selectedStamp();

  const drawingRooms = tool === "room" || tool === "polygon";
  floorSection.hidden = !(drawingRooms || room || tool === "brush");
  floorTitle.textContent = tool === "brush" ? "Texture" : room ? "Floor of this room" : "Floor for new rooms";
  setChoice(floorGroup, tool === "brush" ? paintTexture : room ? room.floor : floor);
  wallsRow.hidden = tool === "brush";
  wallsInput.checked = room ? room.walls : walls;

  brushSection.hidden = tool !== "brush";
  brushSizeInput.value = String(brushSize);
  brushOpacityInput.value = String(Math.round(brushOpacity * 100));

  librarySection.hidden = tool !== "stamp";
  stampSection.hidden = !(tool === "stamp" || stamp);
  stampTitle.textContent = stamp ? "Selected stamp" : "New stamps";
  stampSizeInput.value = String(stamp ? stampLongest(stamp) / d.grid.cellPx : stampSize);
  stampRotationInput.value = String(stamp ? Math.round((stamp.rotation * 180) / Math.PI) : stampRotation);
  stampShadowInput.checked = stamp ? stamp.shadow : stampShadow;
  stampScatterInput.checked = scatter;
  scatterRow.hidden = Boolean(stamp);
  stampExtras.hidden = !stamp;
  stampTintInput.value = stamp?.tint ?? "#ffffff";
  syncOutputs();

  selectionSection.hidden = !kind;
  selectionTitle.textContent = kind === "opening" ? `Selected ${opening!.kind}` : kind ? `Selected ${KIND_NAME[kind]}` : "";
  orderRow.hidden = kind === "opening";

  for (const box of layersBody.querySelectorAll("input")) {
    const layer = box.dataset.layer!;
    if (layer === "grid") box.checked = d.showGrid;
    else box.checked = d.layers[layer as LayerId][box.dataset.field as "visible" | "locked"];
  }
}

/** The small read-outs beside the sliders. */
function syncOutputs(): void {
  const cells = (value: string) => `${Number(value)} ${Number(value) === 1 ? "cell" : "cells"}`;
  el("brush-size-out").textContent = cells(brushSizeInput.value);
  el("brush-opacity-out").textContent = `${brushOpacityInput.value}%`;
  el("stamp-size-out").textContent = cells(Number(stampSizeInput.value).toFixed(2));
  el("stamp-rotation-out").textContent = `${stampRotationInput.value}°`;
}

function setChoice(group: HTMLElement, value: string): void {
  for (const button of group.querySelectorAll("button")) {
    button.setAttribute("aria-checked", String(button.dataset.value === value));
  }
}

function onChoice(group: HTMLElement, handler: (value: string) => void): void {
  group.addEventListener("click", (event) => {
    const button = (event.target as HTMLElement).closest("button");
    if (button?.dataset.value) handler(button.dataset.value);
  });
}

function setTool(next: Tool): void {
  cancelDrawing();
  tool = next;
  if (tool !== "select") selectedId = null;
  syncControls();
  draw();
}

/** Abandon a half-drawn room or a drag without changing the map. */
function cancelDrawing(): void {
  shape = [];
  drag = null;
  liveDoc = null;
  canvas.classList.remove("panning");
}

onChoice(toolGroup, (value) => setTool(value as Tool));

onChoice(gridTypeGroup, (value) => {
  const d = history.present;
  if (value !== d.grid.type) commit({ ...d, grid: { ...d.grid, type: value as GridType } });
});

onChoice(snapGroup, (value) => {
  snapMode = value as SnapMode;
  try {
    localStorage.setItem(SNAP_KEY, snapMode);
  } catch {
    // The choice still applies for this visit.
  }
  syncControls();
  draw();
});

onChoice(floorGroup, (value) => {
  const d = history.present;
  if (tool === "brush") {
    paintTexture = value as FloorId;
    syncControls();
  } else if (d.rooms.some((r) => r.id === selectedId)) {
    commit(setRoomFloor(d, selectedId!, value as FloorId));
  } else {
    floor = value as FloorId;
    syncControls();
  }
});

wallsInput.addEventListener("change", () => {
  const d = history.present;
  if (d.rooms.some((r) => r.id === selectedId)) {
    commit(setRoomWalls(d, selectedId!, wallsInput.checked));
  } else {
    walls = wallsInput.checked;
  }
});

/** A slider reports every step while it is dragged (done = false) and once when it is let go (done = true). */
function onSlide(input: HTMLInputElement, handler: (value: number, done: boolean) => void): void {
  input.addEventListener("input", () => {
    handler(Number(input.value), false);
    syncOutputs();
  });
  input.addEventListener("change", () => handler(Number(input.value), true));
}

onSlide(brushSizeInput, (value) => (brushSize = value));
onSlide(brushOpacityInput, (value) => (brushOpacity = value / 100));

/** Change the selected stamp: shown at once while a slider moves, and one undo step when it is let go. */
function editSelectedStamp(change: (stamp: Stamp) => Stamp, done: boolean): void {
  const next = updateStamp(history.present, selectedId!, change);
  if (done) {
    commit(next);
  } else {
    liveDoc = next;
    draw();
  }
}

onSlide(stampSizeInput, (value, done) => {
  if (selectedStamp()) editSelectedStamp((s) => resizeStamp(s, value * history.present.grid.cellPx), done);
  else stampSize = value;
});

onSlide(stampRotationInput, (value, done) => {
  if (selectedStamp()) editSelectedStamp((s) => ({ ...s, rotation: (value * Math.PI) / 180 }), done);
  else stampRotation = value;
});

stampShadowInput.addEventListener("change", () => {
  if (selectedStamp()) editSelectedStamp((s) => ({ ...s, shadow: stampShadowInput.checked }), true);
  else stampShadow = stampShadowInput.checked;
});

stampScatterInput.addEventListener("change", () => (scatter = stampScatterInput.checked));

stampTintInput.addEventListener("input", () => {
  if (selectedStamp()) editSelectedStamp((s) => ({ ...s, tint: stampTintInput.value }), false);
});
stampTintInput.addEventListener("change", () => {
  if (selectedStamp()) editSelectedStamp((s) => ({ ...s, tint: stampTintInput.value }), true);
});
el("btn-clear-tint").addEventListener("click", () => {
  if (selectedStamp()) editSelectedStamp((s) => ({ ...s, tint: null }), true);
});
el("btn-flip").addEventListener("click", () => {
  if (selectedStamp()) editSelectedStamp((s) => ({ ...s, flip: !s.flip }), true);
});
el("btn-front").addEventListener("click", () => selectedId && commit(reorder(history.present, selectedId, "front")));
el("btn-back").addEventListener("click", () => selectedId && commit(reorder(history.present, selectedId, "back")));

layersBody.addEventListener("change", (event) => {
  const box = event.target as HTMLInputElement;
  const d = history.present;
  if (box.dataset.layer === "grid") {
    commit({ ...d, showGrid: box.checked });
  } else {
    const layer = box.dataset.layer as LayerId;
    commit({ ...d, layers: { ...d.layers, [layer]: { ...d.layers[layer], [box.dataset.field!]: box.checked } } });
  }
});

function onSizeChange(input: HTMLInputElement, key: "cols" | "rows"): void {
  input.addEventListener("change", () => {
    const d = history.present;
    const value = clampInt(Number(input.value), LIMITS.minCells, LIMITS.maxCells);
    if (value === d.grid[key]) syncControls();
    else commit({ ...d, grid: { ...d.grid, [key]: value } });
  });
}
onSizeChange(colsInput, "cols");
onSizeChange(rowsInput, "rows");

nameInput.addEventListener("change", () => {
  const name = nameInput.value.trim().slice(0, LIMITS.maxNameLength) || "Untitled map";
  nameInput.value = name;
  if (name !== history.present.name) commit({ ...history.present, name });
});

el("btn-new").addEventListener("click", () => {
  cancelDrawing();
  commit(newMap());
});
el("btn-undo").addEventListener("click", undo);
el("btn-redo").addEventListener("click", redo);
el("btn-save").addEventListener("click", saveToFile);
el("btn-open").addEventListener("click", () => fileInput.click());
el("btn-delete").addEventListener("click", deleteSelected);
el("btn-fit").addEventListener("click", () => {
  fitView();
  draw();
});
el("btn-zoom-in").addEventListener("click", () => zoomFromCentre(1.25));
el("btn-zoom-out").addEventListener("click", () => zoomFromCentre(0.8));

// ---- stamp library ----------------------------------------------------

function renderLibrary(): void {
  const matches = filterAssets(library.assets, assetSearch.value, assetFavourites.checked);
  if (assetId && !library.get(assetId)) assetId = null;
  assetGrid.replaceChildren(
    ...matches.slice(0, MAX_SHOWN_ASSETS).map((asset) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "option");
      button.setAttribute("aria-selected", String(asset.id === assetId));
      button.dataset.id = asset.id;
      button.title = asset.name;
      button.classList.toggle("favourite", asset.favourite);
      const img = document.createElement("img");
      img.src = asset.dataUrl;
      img.alt = "";
      img.loading = "lazy";
      const label = document.createElement("span");
      label.textContent = asset.name;
      button.append(img, label);
      return button;
    }),
  );

  let note = "";
  if (library.assets.length === 0) {
    note = "No stamps yet. Add pictures from your computer, or drag them onto the map. PNG pictures with a see-through background work best.";
  } else if (matches.length === 0) {
    note = "No stamps match.";
  } else if (matches.length > MAX_SHOWN_ASSETS) {
    note = `Showing the first ${MAX_SHOWN_ASSETS} of ${matches.length}. Search to narrow it down.`;
  }
  if (!library.persistent) note += " This browser is not letting the site keep pictures, so they will be gone when you close the tab.";
  assetNote.textContent = note.trim();

  const chosen = assetId ? library.get(assetId) : undefined;
  assetActions.hidden = !chosen;
  favouriteButton.textContent = chosen?.favourite ? "Unfavourite" : "★ Favourite";
}

assetGrid.addEventListener("click", (event) => {
  const button = (event.target as HTMLElement).closest("button");
  if (!button?.dataset.id) return;
  assetId = button.dataset.id;
  renderLibrary();
  draw();
});
assetSearch.addEventListener("input", renderLibrary);
assetFavourites.addEventListener("change", renderLibrary);
el("btn-import").addEventListener("click", () => assetInput.click());
favouriteButton.addEventListener("click", () => {
  const asset = assetId ? library.get(assetId) : undefined;
  if (asset) void library.setFavourite(asset.id, !asset.favourite);
});
el("btn-remove-asset").addEventListener("click", () => {
  if (assetId) void library.remove(assetId);
});

assetInput.addEventListener("change", () => {
  const files = [...(assetInput.files ?? [])];
  assetInput.value = "";
  void importPictures(files);
});

async function importPictures(files: File[]): Promise<void> {
  if (files.length === 0) return;
  const { added, problems } = await library.importFiles(files);
  if (added.length > 0) {
    assetId = added[0].id;
    if (tool !== "stamp") setTool("stamp");
    renderLibrary();
  }
  if (problems.length > 0) {
    showMessage(problems.length === 1 ? problems[0] : `${problems[0]} (and ${problems.length - 1} more could not be added)`);
  }
}

// Dragging files onto the window: pictures join the stamps, a saved map opens.
window.addEventListener("dragover", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dropHint.hidden = false;
});
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) dropHint.hidden = true;
});
window.addEventListener("drop", (event) => {
  if (!event.dataTransfer?.types.includes("Files")) return;
  event.preventDefault();
  dropHint.hidden = true;
  const files = [...event.dataTransfer.files];
  const map = files.find((f) => f.name.toLowerCase().endsWith(".json"));
  if (map) void openMapFile(map);
  else void importPictures(files);
});

// ---- files ------------------------------------------------------------

function saveToFile(): void {
  const d = history.present;
  // Pack the pictures the map uses into the file, so it opens on another computer.
  const pictures = [...usedAssetIds(d)].map((id) => library.get(id)).filter((a): a is Asset => Boolean(a));
  const url = URL.createObjectURL(new Blob([serialize(d, pictures)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(d);
  link.click();
  URL.revokeObjectURL(url);
}

fileInput.addEventListener("change", () => {
  const file = fileInput.files?.[0];
  fileInput.value = ""; // so choosing the same file again still fires
  if (file) void openMapFile(file);
});

async function openMapFile(file: File): Promise<void> {
  try {
    const opened = parseFile(await file.text());
    await library.add(opened.assets);
    cancelDrawing();
    commit(opened.doc);
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "This file could not be opened.");
  }
}

function showMessage(text: string): void {
  message.textContent = text;
  message.hidden = false;
  window.clearTimeout(messageTimer);
  messageTimer = window.setTimeout(() => (message.hidden = true), 5000);
}

// ---- view -------------------------------------------------------------

function stageSize() {
  return { width: stage.clientWidth, height: stage.clientHeight };
}

function fitView(): void {
  view = fit(mapSize(history.present.grid), stageSize());
}

function zoomFromCentre(factor: number): void {
  const size = stageSize();
  view = zoomAt(view, { x: size.width / 2, y: size.height / 2 }, factor);
  draw();
}

function eventPoint(event: MouseEvent): Point {
  const rect = canvas.getBoundingClientRect();
  return { x: event.clientX - rect.left, y: event.clientY - rect.top };
}

/** Where a screen point lands on the map, snapped to the grid. */
function snapped(screen: Point): Point {
  return snap(history.present.grid, screenToMap(view, screen), snapMode);
}

/** How close (map pixels) the pointer must be to a wall to grab it. */
function wallReach(): number {
  return (history.present.grid.cellPx * WALL_RATIO) / 2 + 8 / view.scale;
}

/** The door or window a click at this screen point would place, or null away from walls. */
function openingUnder(screen: Point, kind: "door" | "window"): Opening | null {
  const d = history.present;
  const hit = nearestWall(walledRooms(d.rooms), screenToMap(view, screen), d.grid.cellPx * 0.5);
  return hit ? openingOnWall(d.grid, hit, kind, snapMode, newId()) : null;
}

/** The stamp a click at this screen point would place, or null when no stamp is picked. */
function stampUnder(screen: Point): Stamp | null {
  const asset = assetId ? library.get(assetId) : undefined;
  if (!asset) return null;
  const grid = history.present.grid;
  const mapPoint = screenToMap(view, screen);
  const centre = scatter ? mapPoint : stampSnap(grid, mapPoint, snapMode);
  return makeStamp(newId(), asset, centre, stampSize * grid.cellPx, (stampRotation * Math.PI) / 180, stampShadow);
}

/** One stamp of a scatter: near the point, with its own size and turn. */
function scatteredStamp(asset: Asset, p: Point): Stamp {
  const longest = stampSize * history.present.grid.cellPx;
  const jitter = () => (Math.random() - 0.5) * longest * 0.4;
  const centre = { x: p.x + jitter(), y: p.y + jitter() };
  return makeStamp(newId(), asset, centre, longest * (0.8 + Math.random() * 0.4), Math.random() * Math.PI * 2, stampShadow);
}

/** The topmost selectable thing under a map point, skipping hidden and locked layers. */
function pick(p: Point): { id: string; kind: ItemKind } | null {
  const d = history.present;
  if (layerOpen("objects")) {
    const stamp = stampAt(d.stamps, p);
    if (stamp) return { id: stamp.id, kind: "stamp" };
  }
  if (layerOpen("walls")) {
    const opening = openingAt(d.openings, p, wallReach());
    if (opening) return { id: opening.id, kind: "opening" };
  }
  if (layerOpen("paint")) {
    const stroke = strokeAt(d.strokes, p, 4 / view.scale);
    if (stroke) return { id: stroke.id, kind: "stroke" };
  }
  if (layerOpen("floors")) {
    const room = roomAt(d.rooms, p, wallReach());
    if (room) return { id: room.id, kind: "room" };
  }
  return null;
}

// ---- pointer ----------------------------------------------------------

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  canvas.focus();
  canvas.setPointerCapture(event.pointerId);
  const screen = eventPoint(event);
  const mapPoint = screenToMap(view, screen);
  cursor = screen;
  const d = history.present;

  if (event.button === 1 || spaceDown) {
    startPan();
  } else if (tool === "select") {
    const hit = pick(mapPoint);
    selectedId = hit?.id ?? null;
    if (hit && hit.kind !== "opening") {
      drag = { kind: "move", id: hit.id, item: hit.kind, startScreen: screen, startMap: mapPoint, base: d, moved: false };
    } else if (!hit) {
      startPan();
    }
    syncControls();
  } else if (!canDraw()) {
    // The message has been shown.
  } else if (tool === "room") {
    drag = { kind: "room", start: snapped(screen) };
  } else if (tool === "polygon") {
    addShapeCorner(screen);
  } else if (tool === "brush") {
    const stroke: Stroke = {
      id: newId(),
      texture: paintTexture,
      size: brushSize * d.grid.cellPx,
      opacity: brushOpacity,
      points: [mapPoint],
    };
    drag = { kind: "brush", stroke };
  } else if (tool === "stamp") {
    const asset = assetId ? library.get(assetId) : undefined;
    if (!asset) {
      showMessage("Pick a stamp on the right first. Use “Add pictures…” if you have none yet.");
    } else if (scatter) {
      drag = { kind: "scatter", base: d, asset, placed: [scatteredStamp(asset, mapPoint)], last: mapPoint };
      liveDoc = addStamps(d, drag.placed);
    } else {
      commit(addStamps(d, [stampUnder(screen)!]));
    }
  } else {
    const opening = openingUnder(screen, tool);
    if (opening) commit(addOpening(d, opening));
  }
  draw();
});

function startPan(): void {
  drag = { kind: "pan" };
  canvas.classList.add("panning");
}

function addShapeCorner(screen: Point): void {
  if (shape.length >= 3) {
    const first = mapToScreen(view, shape[0]);
    if (Math.hypot(first.x - screen.x, first.y - screen.y) <= CLOSE_SHAPE_PX) {
      finishShape();
      return;
    }
  }
  const p = snapped(screen);
  const last = shape[shape.length - 1];
  if (last && last.x === p.x && last.y === p.y) return;
  if (shape.length < LIMITS.maxRoomPoints) shape = [...shape, p];
}

function finishShape(): void {
  const points = shape;
  shape = [];
  if (isValidOutline(points)) commit(addRoom(history.present, { id: newId(), points, floor, walls }));
  else draw();
}

canvas.addEventListener("pointermove", (event) => {
  const screen = eventPoint(event);
  const mapPoint = screenToMap(view, screen);
  cursor = screen;
  if (drag?.kind === "pan") {
    view = pan(view, event.movementX, event.movementY);
  } else if (drag?.kind === "move") {
    const far = Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) > CLICK_SLOP_PX;
    if (far) drag.moved = true;
    if (drag.moved) {
      // Move by the difference between snapped positions, so things on the grid stay on the grid.
      const grid = drag.base.grid;
      const place = (p: Point): Point =>
        drag!.kind !== "move" || drag!.item === "stroke" ? p : drag!.item === "stamp" ? stampSnap(grid, p, snapMode) : snap(grid, p, snapMode);
      const from = place(drag.startMap);
      const to = place(mapPoint);
      liveDoc = moveItem(drag.base, drag.id, to.x - from.x, to.y - from.y);
    }
  } else if (drag?.kind === "brush") {
    const points = drag.stroke.points;
    const gap = Math.max(1.5, drag.stroke.size * 0.04);
    if (distance(points[points.length - 1], mapPoint) >= gap && points.length < LIMITS.maxStrokePoints) {
      drag.stroke = { ...drag.stroke, points: [...points, mapPoint] };
    }
  } else if (drag?.kind === "scatter") {
    const spacing = stampSize * drag.base.grid.cellPx * 0.7;
    if (distance(drag.last, mapPoint) >= spacing && drag.base.stamps.length + drag.placed.length < LIMITS.maxStamps) {
      drag.placed = [...drag.placed, scatteredStamp(drag.asset, mapPoint)];
      drag.last = mapPoint;
      liveDoc = addStamps(drag.base, drag.placed);
    }
  }
  draw();
});

function endDrag(event: PointerEvent): void {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const finished = drag;
  const released = event.type === "pointerup";
  drag = null;
  canvas.classList.remove("panning");
  const live = liveDoc;
  liveDoc = null;
  if (finished?.kind === "room" && released) {
    const points = rectPoints(finished.start, snapped(eventPoint(event)));
    if (points) commit(addRoom(history.present, { id: newId(), points, floor, walls }));
  } else if (finished?.kind === "move" && released) {
    if (live && live !== finished.base) commit(live);
  } else if (finished?.kind === "brush" && released) {
    commit(addStroke(history.present, finished.stroke));
  } else if (finished?.kind === "scatter" && released) {
    commit(addStamps(finished.base, finished.placed));
  }
  draw();
}
canvas.addEventListener("pointerup", endDrag);
canvas.addEventListener("pointercancel", endDrag);

canvas.addEventListener("pointerleave", () => {
  cursor = null;
  draw();
});

canvas.addEventListener(
  "wheel",
  (event) => {
    event.preventDefault();
    view = zoomAt(view, eventPoint(event), Math.exp(-event.deltaY * 0.0015));
    draw();
  },
  { passive: false },
);

// ---- keyboard ---------------------------------------------------------

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  r: "room",
  p: "polygon",
  d: "door",
  w: "window",
  b: "brush",
  s: "stamp",
};

window.addEventListener("keydown", (event) => {
  const target = event.target;
  const typing = target instanceof HTMLInputElement && ["text", "number", "search"].includes(target.type);
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  if (mod && key === "s") {
    event.preventDefault();
    saveToFile();
  } else if (mod && key === "o") {
    event.preventDefault();
    fileInput.click();
  } else if (typing) {
    return; // leave Ctrl+Z, Delete and friends to the text box
  } else if (mod && key === "z" && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
    event.preventDefault();
    redo();
  } else if (mod || event.altKey) {
    return;
  } else if (key === "0") {
    fitView();
    draw();
  } else if (key === " " && (target === canvas || target === document.body)) {
    event.preventDefault();
    spaceDown = true;
  } else if (key === "escape") {
    const wasDrawing = shape.length > 0 || drag !== null;
    cancelDrawing();
    if (!wasDrawing) selectedId = null;
    syncControls();
    draw();
  } else if (key === "enter" && shape.length > 0) {
    finishShape();
  } else if (key === "backspace" && shape.length > 0) {
    shape = shape.slice(0, -1);
    draw();
  } else if (key === "delete" || key === "backspace") {
    deleteSelected();
  } else if (TOOL_KEYS[key] && !(target instanceof HTMLInputElement)) {
    setTool(TOOL_KEYS[key]);
  }
});

window.addEventListener("keyup", (event) => {
  if (event.key === " ") spaceDown = false;
});
window.addEventListener("blur", () => (spaceDown = false));

// ---- drawing ----------------------------------------------------------

function draw(): void {
  if (drawQueued) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    const size = stageSize();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(size.width * dpr);
    const h = Math.round(size.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const d = doc();
    const mapPoint = cursor ? screenToMap(view, cursor) : null;
    const cell = mapPoint ? cellAt(d.grid, mapPoint) : null;
    const aiming = cursor !== null && drag?.kind !== "pan" && !spaceDown;

    let draft: Point[] | null = null;
    if (drag?.kind === "room" && cursor) {
      const end = snapped(cursor);
      draft = rectPoints(drag.start, end) ?? [drag.start, end];
    } else if (shape.length > 0) {
      draft = cursor ? [...shape, snapped(cursor)] : shape;
    }

    const drawsRooms = tool === "room" || tool === "polygon";
    render(ctx, size.width, size.height, dpr, {
      doc: d,
      view,
      snapPoint: aiming && drawsRooms && snapMode !== "off" ? snapped(cursor!) : null,
      selectedId,
      draft,
      ghost: aiming && (tool === "door" || tool === "window") ? openingUnder(cursor!, tool) : null,
      draftStroke: drag?.kind === "brush" ? drag.stroke : null,
      ghostStamp: aiming && tool === "stamp" && !drag ? stampUnder(cursor!) : null,
      brushRing: aiming && tool === "brush" && mapPoint ? { ...mapPoint, radius: (brushSize * d.grid.cellPx) / 2 } : null,
      image: (id, tint) => library.image(id, tint),
    });
    zoomLabel.textContent = `${Math.round(view.scale * 100)}%`;
    cursorCell.textContent = cell ? `Column ${cell.col + 1}, row ${cell.row + 1}` : " ";
  });
}

new ResizeObserver(() => draw()).observe(stage);

// ---- helpers ----------------------------------------------------------

function el<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

function readSnapMode(): SnapMode {
  try {
    const saved = localStorage.getItem(SNAP_KEY);
    if (saved === "cell" || saved === "half" || saved === "off") return saved;
  } catch {
    // Fall through to the default.
  }
  return "cell";
}

fitView();
syncControls();
renderLibrary();
saveStatus.textContent = "Saved in this browser";
draw();
void library.load();

import "./style.css";
import { cellAt, mapSize, snap, type Point } from "./grid";
import { History } from "./history";
import { LIMITS, clampInt, newMap, type GridType, type MapDoc, type SnapMode } from "./model";
import { render } from "./render";
import { fileName, loadAutosave, parse, saveAutosave, serialize } from "./storage";
import { fit, pan, screenToMap, zoomAt, type View } from "./view";

const SNAP_KEY = "scenic-sorcerer.snap";
const AUTOSAVE_DELAY_MS = 400;

const canvas = el<HTMLCanvasElement>("canvas");
const stage = el<HTMLDivElement>("stage");
const ctx = canvas.getContext("2d")!;
const nameInput = el<HTMLInputElement>("map-name");
const colsInput = el<HTMLInputElement>("cols");
const rowsInput = el<HTMLInputElement>("rows");
const fileInput = el<HTMLInputElement>("file-input");
const undoButton = el<HTMLButtonElement>("btn-undo");
const redoButton = el<HTMLButtonElement>("btn-redo");
const saveStatus = el<HTMLSpanElement>("save-status");
const zoomLabel = el<HTMLSpanElement>("zoom-label");
const cursorCell = el<HTMLSpanElement>("cursor-cell");
const message = el<HTMLParagraphElement>("message");
const gridTypeGroup = el<HTMLDivElement>("grid-type");
const snapGroup = el<HTMLDivElement>("snap-mode");

const history = new History<MapDoc>(loadAutosave(localStorage) ?? newMap());
let view: View = { x: 0, y: 0, scale: 1 };
let snapMode: SnapMode = readSnapMode();
let cursor: Point | null = null; // screen position over the canvas
let panning = false;
let drawQueued = false;
let autosaveTimer: number | undefined;
let messageTimer: number | undefined;

// ---- document changes -------------------------------------------------

function doc(): MapDoc {
  return history.present;
}

/** Record a new version of the map as one undo step. */
function commit(next: MapDoc): void {
  const before = doc();
  history.push(next);
  afterChange(before);
}

function afterChange(before: MapDoc): void {
  const a = mapSize(before.grid);
  const b = mapSize(doc().grid);
  if (a.width !== b.width || a.height !== b.height) fitView();
  syncControls();
  scheduleAutosave();
  draw();
}

function undo(): void {
  if (!history.canUndo) return;
  const before = doc();
  history.undo();
  afterChange(before);
}

function redo(): void {
  if (!history.canRedo) return;
  const before = doc();
  history.redo();
  afterChange(before);
}

function scheduleAutosave(): void {
  saveStatus.textContent = "Saving…";
  window.clearTimeout(autosaveTimer);
  autosaveTimer = window.setTimeout(() => {
    const ok = saveAutosave(localStorage, doc());
    saveStatus.textContent = ok ? "Saved in this browser" : "Could not autosave. Use Save to keep your map.";
  }, AUTOSAVE_DELAY_MS);
}

// ---- controls ---------------------------------------------------------

function syncControls(): void {
  const d = doc();
  if (document.activeElement !== nameInput) nameInput.value = d.name;
  colsInput.value = String(d.grid.cols);
  rowsInput.value = String(d.grid.rows);
  setChoice(gridTypeGroup, d.grid.type);
  setChoice(snapGroup, snapMode);
  undoButton.disabled = !history.canUndo;
  redoButton.disabled = !history.canRedo;
  document.title = `${d.name} · Scenic Sorcerer`;
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

onChoice(gridTypeGroup, (value) => {
  if (value !== doc().grid.type) commit({ ...doc(), grid: { ...doc().grid, type: value as GridType } });
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

function onSizeChange(input: HTMLInputElement, key: "cols" | "rows"): void {
  input.addEventListener("change", () => {
    const value = clampInt(Number(input.value), LIMITS.minCells, LIMITS.maxCells);
    if (value === doc().grid[key]) syncControls();
    else commit({ ...doc(), grid: { ...doc().grid, [key]: value } });
  });
}
onSizeChange(colsInput, "cols");
onSizeChange(rowsInput, "rows");

nameInput.addEventListener("change", () => {
  const name = nameInput.value.trim().slice(0, LIMITS.maxNameLength) || "Untitled map";
  nameInput.value = name;
  if (name !== doc().name) commit({ ...doc(), name });
});

el("btn-new").addEventListener("click", () => commit(newMap()));
el("btn-undo").addEventListener("click", undo);
el("btn-redo").addEventListener("click", redo);
el("btn-save").addEventListener("click", saveToFile);
el("btn-open").addEventListener("click", () => fileInput.click());
el("btn-fit").addEventListener("click", () => {
  fitView();
  draw();
});
el("btn-zoom-in").addEventListener("click", () => zoomFromCentre(1.25));
el("btn-zoom-out").addEventListener("click", () => zoomFromCentre(0.8));

// ---- files ------------------------------------------------------------

function saveToFile(): void {
  const url = URL.createObjectURL(new Blob([serialize(doc())], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(doc());
  link.click();
  URL.revokeObjectURL(url);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = ""; // so choosing the same file again still fires
  if (!file) return;
  try {
    commit(parse(await file.text()));
  } catch (error) {
    showMessage(error instanceof Error ? error.message : "This file could not be opened.");
  }
});

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
  view = fit(mapSize(doc().grid), stageSize());
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

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  canvas.setPointerCapture(event.pointerId);
  panning = true;
  canvas.classList.add("panning");
  draw();
});

canvas.addEventListener("pointermove", (event) => {
  if (panning) view = pan(view, event.movementX, event.movementY);
  cursor = eventPoint(event);
  draw();
});

function endPan(event: PointerEvent): void {
  if (!panning) return;
  panning = false;
  canvas.classList.remove("panning");
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  draw();
}
canvas.addEventListener("pointerup", endPan);
canvas.addEventListener("pointercancel", endPan);

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

window.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement;
  const key = event.key.toLowerCase();
  const mod = event.ctrlKey || event.metaKey;
  if (mod && key === "s") {
    event.preventDefault();
    saveToFile();
  } else if (mod && key === "o") {
    event.preventDefault();
    fileInput.click();
  } else if (typing) {
    return; // leave Ctrl+Z and friends to the text box
  } else if (mod && key === "z" && !event.shiftKey) {
    event.preventDefault();
    undo();
  } else if (mod && (key === "y" || (key === "z" && event.shiftKey))) {
    event.preventDefault();
    redo();
  } else if (!mod && key === "0") {
    fitView();
    draw();
  }
});

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
    const grid = doc().grid;
    const mapPoint = cursor ? screenToMap(view, cursor) : null;
    const cell = mapPoint ? cellAt(grid, mapPoint) : null;
    const showSnap = mapPoint !== null && cell !== null && !panning && snapMode !== "off";
    render(ctx, size.width, size.height, dpr, {
      doc: doc(),
      view,
      snapPoint: showSnap ? snap(grid, mapPoint, snapMode) : null,
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
saveStatus.textContent = "Saved in this browser";
draw();

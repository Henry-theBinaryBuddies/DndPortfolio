import "./style.css";
import { cellAt, mapSize, snap } from "./grid";
import { History } from "./history";
import {
  FLOORS,
  LIMITS,
  WALL_RATIO,
  clampInt,
  newId,
  newMap,
  type FloorId,
  type GridType,
  type MapDoc,
  type Opening,
  type Point,
  type SnapMode,
} from "./model";
import { render } from "./render";
import {
  addOpening,
  addRoom,
  isValidOutline,
  moveRoom,
  nearestWall,
  openingAt,
  openingOnWall,
  rectPoints,
  removeItem,
  roomAt,
  setRoomFloor,
  setRoomWalls,
  walledRooms,
} from "./rooms";
import { fileName, loadAutosave, parse, saveAutosave, serialize } from "./storage";
import { fit, mapToScreen, pan, screenToMap, zoomAt, type View } from "./view";

type Tool = "select" | "room" | "polygon" | "door" | "window";

const SNAP_KEY = "scenic-sorcerer.snap";
const AUTOSAVE_DELAY_MS = 400;
const CLICK_SLOP_PX = 4; // screen pixels the pointer may move and still count as a click
const CLOSE_SHAPE_PX = 12; // how near the first corner a click must be to finish a shape room

const HINTS: Record<Tool, string> = {
  select: "Click a room, door or window to select it. Drag a room to move it. Drag empty space to move around.",
  room: "Drag to draw a room. Hold Space and drag to move around.",
  polygon: "Click each corner of the room. Click the first corner again, or press Enter, to finish.",
  door: "Click a wall to add a door.",
  window: "Click a wall to add a window.",
};

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
const hint = el<HTMLSpanElement>("hint");
const message = el<HTMLParagraphElement>("message");
const toolGroup = el("tools");
const gridTypeGroup = el("grid-type");
const snapGroup = el("snap-mode");
const floorGroup = el("floors");
const floorSection = el("floor-section");
const floorTitle = el("floor-title");
const wallsInput = el<HTMLInputElement>("walls");
const selectionSection = el("selection-section");
const selectionTitle = el("selection-title");

type Drag =
  | { kind: "pan" }
  | { kind: "room"; start: Point }
  | { kind: "move"; roomId: string; startScreen: Point; startMap: Point; base: MapDoc; moved: boolean };

const history = new History<MapDoc>(loadAutosave(localStorage) ?? newMap());
let view: View = { x: 0, y: 0, scale: 1 };
let snapMode: SnapMode = readSnapMode();
let tool: Tool = "select";
let floor: FloorId = "stone"; // floor for new rooms
let walls = true; // whether new rooms get walls
let selectedId: string | null = null;
let cursor: Point | null = null; // screen position over the canvas
let drag: Drag | null = null;
let liveDoc: MapDoc | null = null; // the map mid-drag, before it becomes an undo step
let shape: Point[] = []; // corners of the shape room being drawn
let spaceDown = false;
let drawQueued = false;
let autosaveTimer: number | undefined;
let messageTimer: number | undefined;

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
  if (selectedId && !now.rooms.some((r) => r.id === selectedId) && !now.openings.some((o) => o.id === selectedId)) {
    selectedId = null;
  }
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
  if (selectedId) commit(removeItem(history.present, selectedId));
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

  const room = d.rooms.find((r) => r.id === selectedId);
  const opening = d.openings.find((o) => o.id === selectedId);
  const drawingRooms = tool === "room" || tool === "polygon";
  floorSection.hidden = !(drawingRooms || room);
  floorTitle.textContent = room ? "Floor of this room" : "Floor for new rooms";
  setChoice(floorGroup, room ? room.floor : floor);
  wallsInput.checked = room ? room.walls : walls;
  selectionSection.hidden = !(room || opening);
  selectionTitle.textContent = room ? "Selected room" : opening?.kind === "door" ? "Selected door" : "Selected window";
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
  if (d.rooms.some((r) => r.id === selectedId)) {
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

// ---- files ------------------------------------------------------------

function saveToFile(): void {
  const url = URL.createObjectURL(new Blob([serialize(history.present)], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName(history.present);
  link.click();
  URL.revokeObjectURL(url);
}

fileInput.addEventListener("change", async () => {
  const file = fileInput.files?.[0];
  fileInput.value = ""; // so choosing the same file again still fires
  if (!file) return;
  try {
    const opened = parse(await file.text());
    cancelDrawing();
    commit(opened);
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

// ---- pointer ----------------------------------------------------------

canvas.addEventListener("pointerdown", (event) => {
  if (event.button !== 0 && event.button !== 1) return;
  event.preventDefault();
  canvas.focus();
  canvas.setPointerCapture(event.pointerId);
  const screen = eventPoint(event);
  cursor = screen;
  const d = history.present;

  if (event.button === 1 || spaceDown) {
    startPan();
  } else if (tool === "select") {
    const mapPoint = screenToMap(view, screen);
    const opening = openingAt(d.openings, mapPoint, wallReach());
    const room = opening ? null : roomAt(d.rooms, mapPoint, wallReach());
    selectedId = opening?.id ?? room?.id ?? null;
    if (room) drag = { kind: "move", roomId: room.id, startScreen: screen, startMap: mapPoint, base: d, moved: false };
    else if (!opening) startPan();
    syncControls();
  } else if (tool === "room") {
    drag = { kind: "room", start: snapped(screen) };
  } else if (tool === "polygon") {
    addShapeCorner(screen);
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
  cursor = screen;
  if (drag?.kind === "pan") {
    view = pan(view, event.movementX, event.movementY);
  } else if (drag?.kind === "move") {
    const far = Math.hypot(screen.x - drag.startScreen.x, screen.y - drag.startScreen.y) > CLICK_SLOP_PX;
    if (far) drag.moved = true;
    if (drag.moved) {
      // Move by the difference between snapped positions so a room on the grid stays on the grid.
      const grid = drag.base.grid;
      const from = snap(grid, drag.startMap, snapMode);
      const to = snap(grid, screenToMap(view, screen), snapMode);
      liveDoc = moveRoom(drag.base, drag.roomId, to.x - from.x, to.y - from.y);
    }
  }
  draw();
});

function endDrag(event: PointerEvent): void {
  if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  const finished = drag;
  drag = null;
  canvas.classList.remove("panning");
  if (finished?.kind === "room" && event.type === "pointerup") {
    const points = rectPoints(finished.start, snapped(eventPoint(event)));
    if (points) commit(addRoom(history.present, { id: newId(), points, floor, walls }));
  } else if (finished?.kind === "move") {
    const moved = liveDoc;
    liveDoc = null;
    if (moved && moved !== finished.base && event.type === "pointerup") commit(moved);
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

const TOOL_KEYS: Record<string, Tool> = { v: "select", r: "room", p: "polygon", d: "door", w: "window" };

window.addEventListener("keydown", (event) => {
  const typing = event.target instanceof HTMLInputElement && event.target.type !== "checkbox";
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
  } else if (key === " " && !(event.target instanceof HTMLButtonElement)) {
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
  } else if (TOOL_KEYS[key]) {
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
    const panning = drag?.kind === "pan";
    const aiming = cursor !== null && !panning && !spaceDown;

    let draft: Point[] | null = null;
    if (drag?.kind === "room" && cursor) {
      const end = snapped(cursor);
      draft = rectPoints(drag.start, end) ?? [drag.start, end];
    } else if (shape.length > 0) {
      draft = cursor ? [...shape, snapped(cursor)] : shape;
    }

    const drawsRooms = tool === "room" || tool === "polygon";
    const placesOpenings = tool === "door" || tool === "window";
    render(ctx, size.width, size.height, dpr, {
      doc: d,
      view,
      snapPoint: aiming && drawsRooms && snapMode !== "off" ? snapped(cursor!) : null,
      selectedId,
      draft,
      ghost: aiming && placesOpenings ? openingUnder(cursor!, tool as "door" | "window") : null,
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

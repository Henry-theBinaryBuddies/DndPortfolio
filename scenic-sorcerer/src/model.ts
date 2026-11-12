// The map document: everything that is saved, loaded and undone.

export type GridType = "square" | "hex-flat" | "hex-pointy";
export type SnapMode = "cell" | "half" | "off";

export interface Point {
  x: number;
  y: number;
}

export interface Grid {
  type: GridType;
  cols: number;
  rows: number;
  /** Distance in map pixels between the centres of two neighbouring cells. */
  cellPx: number;
}

export const FLOORS = [
  { id: "stone", label: "Stone", color: "#8d8a84" },
  { id: "wood", label: "Wood", color: "#9a6b3f" },
  { id: "dirt", label: "Dirt", color: "#8a6b4a" },
  { id: "grass", label: "Grass", color: "#6f9a4d" },
  { id: "water", label: "Water", color: "#5b9bc4" },
  { id: "snow", label: "Snow", color: "#e4ecf1" },
  { id: "ice", label: "Ice", color: "#a6d6e6" },
  { id: "moss", label: "Mossy", color: "#6e8559" },
  { id: "rock", label: "Rocky", color: "#7a7064" },
  { id: "forest", label: "Forest", color: "#46603a" },
  { id: "magic", label: "Magical", color: "#5a3f94" },
  { id: "lava", label: "Lava", color: "#c4400f" },
  { id: "metal", label: "Metal", color: "#7f8c96" },
  { id: "plain", label: "Plain", color: "#e2d6ba" },
] as const;
export type FloorId = (typeof FLOORS)[number]["id"];

/** A box in map pixels. */
export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * A room is a closed outline in map pixels. With walls on, every edge of the outline is a wall.
 * A circle or oval room also remembers the box it was drawn in, and its points are made from that box.
 */
export interface Room {
  id: string;
  points: Point[];
  ellipse?: Rect;
  floor: FloorId;
  /** False for an open area such as a pond or a patch of grass: floor only, no outline, no doors. */
  walls: boolean;
}

export type OpeningKind = "door" | "window";

/** A door or window: a stretch of wall from a to b, in map pixels. */
export interface Opening {
  id: string;
  kind: OpeningKind;
  a: Point;
  b: Point;
}

/** One drag of the texture brush: a line of the given width painted with a texture. */
export interface Stroke {
  id: string;
  texture: FloorId;
  /** Brush width in map pixels. */
  size: number;
  /** 0 to 1. */
  opacity: number;
  points: Point[];
}

/** A picture placed on the map. x and y are its centre; width and height are before rotation. */
export interface Stamp {
  id: string;
  assetId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** Radians, clockwise. */
  rotation: number;
  flip: boolean;
  /** A colour such as "#aa3311" to tint the picture, or null to leave it as it is. */
  tint: string | null;
  shadow: boolean;
  /** Set for stairs, which the editor draws itself instead of showing a picture. */
  stairs?: StairsSpec;
}

/** How a set of stairs looks. The arrow points to the top end: going up makes that end high, going down makes it low. */
export interface StairsSpec {
  steps: number;
  material: FloorId;
  dir: "up" | "down" | "none";
  /** "spiral" winds round a central pillar. Left out for straight stairs. */
  shape?: "spiral";
  /** Which way a spiral winds along its arrow: clockwise (the default) or counter-clockwise. */
  turn?: "cw" | "ccw";
}

/** An imported picture in the stamp library. */
export interface Asset {
  id: string;
  name: string;
  dataUrl: string;
  width: number;
  height: number;
  favourite: boolean;
  /** Bundled stamps only: where the picture is served from. They are not kept in browser storage or in saved maps. */
  url?: string;
  builtin?: boolean;
  group?: string;
  /** Pixels per grid cell in the source art, so a stamp can be placed at its natural size. */
  ppc?: number;
  /** Set for the ready-made stairs in the list; placing one makes stairs, not a picture. */
  stairs?: StairsSpec;
}

export const FONTS = [
  { id: "classic", label: "Classic", stack: 'Georgia, "Times New Roman", serif' },
  { id: "book", label: "Storybook", stack: '"Palatino Linotype", "Book Antiqua", Palatino, Georgia, serif' },
  { id: "clean", label: "Clean", stack: 'system-ui, "Segoe UI", Arial, sans-serif' },
  { id: "script", label: "Handwritten", stack: '"Segoe Script", "Brush Script MT", "Lucida Handwriting", cursive' },
  { id: "bold", label: "Bold", stack: 'Impact, "Arial Black", sans-serif' },
] as const;
export type FontId = (typeof FONTS)[number]["id"];

/** How a piece of text looks. */
export interface LabelStyle {
  font: FontId;
  /** Text height in map pixels. */
  size: number;
  color: string;
  /** A light or dark halo round the letters, so they read on any floor. */
  outline: boolean;
  italic: boolean;
  /** Extra space between letters, as a fraction of the text height. */
  spacing: number;
}

/** A piece of text on the map. x and y are its centre. */
export interface Label extends LabelStyle {
  id: string;
  text: string;
  x: number;
  y: number;
  /** Radians, clockwise. */
  rotation: number;
}

/** Ready-made looks. Sizes are in cells; the editor turns them into pixels. */
export const LABEL_PRESETS = [
  { id: "room", label: "Room name", cells: 0.45, style: { font: "book", color: "#2b2620", outline: true, italic: false, spacing: 0 } },
  { id: "region", label: "Region", cells: 1.2, style: { font: "book", color: "#3a3327", outline: true, italic: false, spacing: 0.2 } },
  { id: "sea", label: "Sea", cells: 0.8, style: { font: "classic", color: "#1d4e75", outline: true, italic: true, spacing: 0.15 } },
  { id: "note", label: "Small note", cells: 0.3, style: { font: "clean", color: "#2b2620", outline: true, italic: false, spacing: 0 } },
] as const;

/** What a GM marker means. Markers live on the GM layer, which can be hidden for players. */
export const MARKER_KINDS = [
  { id: "key", label: "Room number" },
  { id: "trap", label: "Trap" },
  { id: "secret", label: "Secret door" },
  { id: "note", label: "Note" },
] as const;
export type MarkerKind = (typeof MARKER_KINDS)[number]["id"];

export interface Marker {
  id: string;
  kind: MarkerKind;
  x: number;
  y: number;
  /** The room number, for room-number markers. 0 for the others. */
  number: number;
  /** A note for the GM, shown when the marker is selected. */
  text: string;
}

/** Layers from top to bottom. Each kind of thing lives on its own layer. */
export const LAYERS = [
  { id: "gm", label: "GM notes" },
  { id: "lights", label: "Lights" },
  { id: "labels", label: "Text" },
  { id: "objects", label: "Stamps" },
  { id: "walls", label: "Walls and doors" },
  { id: "paint", label: "Paint" },
  { id: "floors", label: "Floors" },
] as const;
export type LayerId = (typeof LAYERS)[number]["id"];

export interface LayerState {
  visible: boolean;
  locked: boolean;
}

/** A source of light. x and y are its centre; light fades out by `radius` map pixels. */
export interface Light {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
}

/** Ready-made lights. Sizes are in cells. */
export const LIGHT_PRESETS = [
  { id: "candle", label: "Candle", cells: 2, color: "#ffc680" },
  { id: "torch", label: "Torch", cells: 4, color: "#ffb454" },
  { id: "lantern", label: "Lantern", cells: 6, color: "#ffd88a" },
  { id: "magic", label: "Magic glow", cells: 5, color: "#7fb2ff" },
  { id: "daylight", label: "Daylight", cells: 9, color: "#fff3c4" },
] as const;

/** Everything on one level of the map. */
export interface LevelContent {
  rooms: Room[];
  openings: Opening[];
  strokes: Stroke[];
  stamps: Stamp[];
  labels: Label[];
  markers: Marker[];
  lights: Light[];
}

/**
 * One level. The level being edited has `content: null`, because its content is the map's own lists;
 * see levels.ts.
 */
export interface LevelInfo {
  id: string;
  name: string;
  content: LevelContent | null;
}

export interface MapDoc {
  version: 1;
  name: string;
  grid: Grid;
  rooms: Room[];
  openings: Opening[];
  strokes: Stroke[];
  stamps: Stamp[];
  labels: Label[];
  markers: Marker[];
  lights: Light[];
  /** How dark the map is where no light reaches, from 0 (not at all) to 0.95. */
  ambient: number;
  /** Every level, lowest first. */
  levels: LevelInfo[];
  /** Which of the levels the lists above belong to. */
  level: number;
  layers: Record<LayerId, LayerState>;
  showGrid: boolean;
}

export const LIMITS = {
  minCells: 1,
  maxCells: 100,
  minCellPx: 20,
  maxCellPx: 300,
  maxNameLength: 80,
  maxRooms: 5000,
  maxOpenings: 10000,
  maxRoomPoints: 500,
  maxStrokes: 5000,
  maxStrokePoints: 4000,
  maxStamps: 20000,
  maxLabels: 2000,
  maxMarkers: 2000,
  maxLabelText: 120,
  maxMarkerText: 400,
  maxLights: 500,
  maxLevels: 20,
  maxLevelName: 40,
  /** Light radius, in cells. */
  minLight: 1,
  maxLight: 15,
  /** Text height, in cells. */
  minLabel: 0.2,
  maxLabel: 5,
  /** Brush width, in cells. */
  minBrush: 0.25,
  maxBrush: 5,
  /** Longest side of a stamp, in cells. */
  minStamp: 0.25,
  maxStamp: 10,
  maxAssetBytes: 8 * 1024 * 1024,
} as const;

/** Wall thickness as a fraction of a cell. */
export const WALL_RATIO = 0.16;

export function newMap(): MapDoc {
  return {
    version: 1,
    name: "Untitled map",
    grid: { type: "square", cols: 30, rows: 20, cellPx: 70 },
    rooms: [],
    openings: [],
    strokes: [],
    stamps: [],
    labels: [],
    markers: [],
    lights: [],
    ambient: 0.7,
    levels: [{ id: "level-1", name: "Level 1", content: null }],
    level: 0,
    layers: defaultLayers(),
    showGrid: true,
  };
}

export function defaultLayers(): Record<LayerId, LayerState> {
  return {
    gm: { visible: true, locked: false },
    lights: { visible: true, locked: false },
    labels: { visible: true, locked: false },
    objects: { visible: true, locked: false },
    walls: { visible: true, locked: false },
    paint: { visible: true, locked: false },
    floors: { visible: true, locked: false },
  };
}

export function clampInt(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function newId(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

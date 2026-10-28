import Module from "manifold-3d";

// Merging the parts of a bust into one solid for printing, and writing it as a binary STL. The bust is built
// from many separate closed parts (the head, eyes, brows, hair, beard, locks, teeth, tusks, horns and the base)
// that overlap one another; a printer needs them as one solid with no overlaps inside it. manifold-3d does
// the union. It needs each part to be a closed, consistently wound surface with its vertices shared (the
// parts come with seams and poles that repeat vertices, so they are welded first), and it is not a repair
// tool: a part that is not closed is reported and left out rather than guessed at. This runs on typed arrays,
// in millimetres, so it works the same in a worker or in a test.

export interface Part {
  name: string;
  positions: Float32Array; // x, y, z in millimetres, Z up
  indices: Uint32Array; // counter-clockwise seen from outside
}

export interface PartReport {
  name: string;
  triangles: number;
  shells: number; // separate closed surfaces in the part (a tooth, a lock, a brow: each is its own solid)
  rejectedShells: number; // how many of them could not be made into a valid solid, and were left out
  accepted: boolean; // all of them could
  problem?: string; // why the first rejected one could not
}

export interface PrintReport {
  parts: PartReport[];
  status: string; // the union's status: "NoError" when it is a valid solid
  triangles: number;
  vertices: number;
  volume: number; // mm^3
  surfaceArea: number; // mm^2
  genus: number; // 0 for a solid with no holes through it
  components: { volume: number }[]; // separate solid pieces: 1 for a bust that is all one solid
  specks: number; // slivers under half a cubic millimetre left where surfaces only graze (too small to print or matter)
  voids: number; // enclosed empty pockets inside it (each counts as a piece of negative volume)
  degenerate: number; // zero-area triangles left out of the file (distinct points that coincide at float precision)
  size: [number, number, number]; // mm, along x, y, z
  min: [number, number, number];
  seconds: number;
}

export type Wasm = Awaited<ReturnType<typeof Module>>;

let loaded: Promise<Wasm> | null = null;

// The WASM module, loaded once. In a browser, pass the URL of manifold.wasm (a bundler knows where it ends up);
// in Node it finds its own.
export function loadManifold(wasmUrl?: string): Promise<Wasm> {
  if (!loaded) {
    loaded = Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((wasm) => {
      wasm.setup();
      return wasm;
    });
  }
  return loaded;
}

// Shares the vertices that sit at the same place (to a ten-thousandth of a millimetre), and drops triangles
// that have collapsed to a line or a point. Points are put in cells of that size; two copies of one vertex
// differ only by rounding noise, which could put them either side of a cell's edge, so a point close to an edge
// also looks in the cell beyond it.
export function weld(positions: Float32Array, indices: Uint32Array, tolerance = 1e-4): { positions: Float32Array; indices: Uint32Array; collapsed: number } {
  const first = new Map<string, number>();
  const remap = new Uint32Array(positions.length / 3);
  const kept: number[] = [];
  const edge = 0.1; // how close to a cell's edge (as a share of the cell) counts as near it
  for (let i = 0; i < positions.length / 3; i++) {
    // The cell, and for each axis the cell beyond the nearer edge if the point is close to it
    const options: number[][] = [];
    for (let k = 0; k < 3; k++) {
      const scaled = positions[i * 3 + k] / tolerance;
      const cell = Math.floor(scaled);
      const within = scaled - cell;
      options.push(within < edge ? [cell, cell - 1] : within > 1 - edge ? [cell, cell + 1] : [cell]);
    }
    let at: number | undefined;
    for (const x of options[0]) {
      for (const y of options[1]) {
        for (const z of options[2]) {
          const found = first.get(`${x},${y},${z}`);
          if (found !== undefined) at = found;
        }
      }
    }
    if (at === undefined) {
      at = kept.length / 3;
      first.set(`${options[0][0]},${options[1][0]},${options[2][0]}`, at);
      kept.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
    }
    remap[i] = at;
  }
  const triangles: number[] = [];
  let collapsed = 0;
  for (let t = 0; t < indices.length; t += 3) {
    const a = remap[indices[t]];
    const b = remap[indices[t + 1]];
    const c = remap[indices[t + 2]];
    if (a === b || b === c || a === c) collapsed++;
    else triangles.push(a, b, c);
  }
  return { positions: Float32Array.from(kept), indices: Uint32Array.from(triangles), collapsed };
}

// Splits a mesh into its separate closed surfaces: the triangles that are joined through shared vertices. A
// part such as the teeth or a head of dreadlocks is many solids that overlap one another; handed to a union
// as one mesh they would be a single self-intersecting surface, not merged, so each must be its own solid.
export function splitShells(positions: Float32Array, indices: Uint32Array): { positions: Float32Array; indices: Uint32Array }[] {
  const count = positions.length / 3;
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (v: number) => {
    while (parent[v] !== v) {
      parent[v] = parent[parent[v]];
      v = parent[v];
    }
    return v;
  };
  for (let t = 0; t < indices.length; t += 3) {
    const a = find(indices[t]);
    const b = find(indices[t + 1]);
    const c = find(indices[t + 2]);
    if (a !== b) parent[b] = a;
    if (find(a) !== find(c)) parent[find(c)] = find(a);
  }
  const groups = new Map<number, number[]>();
  for (let t = 0; t < indices.length; t += 3) {
    const root = find(indices[t]);
    const list = groups.get(root);
    if (list) list.push(t);
    else groups.set(root, [t]);
  }
  if (groups.size <= 1) return [{ positions, indices }];
  const shells: { positions: Float32Array; indices: Uint32Array }[] = [];
  const local = new Int32Array(count).fill(-1);
  for (const triangles of groups.values()) {
    const vertices: number[] = [];
    const shellIndices = new Uint32Array(triangles.length * 3);
    triangles.forEach((t, k) => {
      for (let e = 0; e < 3; e++) {
        const v = indices[t + e];
        if (local[v] < 0) {
          local[v] = vertices.length / 3;
          vertices.push(positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]);
        }
        shellIndices[k * 3 + e] = local[v];
      }
    });
    for (let t = 0; t < triangles.length * 3; t++) local[indices[triangles[Math.floor(t / 3)] + (t % 3)]] = -1;
    shells.push({ positions: Float32Array.from(vertices), indices: shellIndices });
  }
  return shells;
}

// A binary STL: 80 bytes of header, the triangle count, then for each triangle its normal, its three
// vertices and two spare bytes. (STL stores no units: these are millimetres, as slicers expect.)
export function writeStl(positions: ArrayLike<number>, indices: ArrayLike<number>, header = "effigy-engine"): { stl: ArrayBuffer; degenerate: number } {
  // A triangle with two corners at exactly the same place has no area; left in, a file that is welded by position
  // (as slicers do) has an edge used twice. Distinct points can coincide once stored as 32-bit floats.
  const same = (a: number, b: number) => positions[a * 3] === positions[b * 3] && positions[a * 3 + 1] === positions[b * 3 + 1] && positions[a * 3 + 2] === positions[b * 3 + 2];
  const keep: number[] = [];
  for (let t = 0; t < indices.length / 3; t++) {
    const [a, b, c] = [indices[t * 3], indices[t * 3 + 1], indices[t * 3 + 2]];
    if (!same(a, b) && !same(b, c) && !same(a, c)) keep.push(t);
  }
  const degenerate = indices.length / 3 - keep.length;
  const count = keep.length;
  const buffer = new ArrayBuffer(84 + count * 50);
  const view = new DataView(buffer);
  for (let i = 0; i < Math.min(80, header.length); i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, count, true);
  let at = 84;
  for (const t of keep) {
    const a = indices[t * 3] * 3;
    const b = indices[t * 3 + 1] * 3;
    const c = indices[t * 3 + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const length = Math.hypot(nx, ny, nz) || 1;
    nx /= length;
    ny /= length;
    nz /= length;
    for (const value of [nx, ny, nz, positions[a], positions[a + 1], positions[a + 2], positions[b], positions[b + 1], positions[b + 2], positions[c], positions[c + 1], positions[c + 2]]) {
      view.setFloat32(at, value, true);
      at += 4;
    }
    at += 2;
  }
  return { stl: buffer, degenerate };
}

// Reads a binary STL back (for checking a file independently of how it was made)
export function readStl(buffer: ArrayBuffer): { positions: Float32Array; count: number } {
  const view = new DataView(buffer);
  const count = view.getUint32(80, true);
  const positions = new Float32Array(count * 9);
  for (let t = 0; t < count; t++) {
    for (let k = 0; k < 9; k++) positions[t * 9 + k] = view.getFloat32(84 + t * 50 + 12 + k * 4, true);
  }
  return { positions, count };
}

// Unions the parts into one solid. Parts that cannot be made into a valid solid are left out and reported.
export async function mergeParts(parts: Part[], progress: (text: string) => void = () => {}, wasmUrl?: string): Promise<{ stl: ArrayBuffer; report: PrintReport }> {
  const started = Date.now();
  const wasm = await loadManifold(wasmUrl);
  const { Manifold, Mesh } = wasm;
  const solids: InstanceType<typeof Manifold>[] = [];
  const reports: PartReport[] = [];
  for (const part of parts) {
    progress(`Preparing ${part.name}`);
    const welded = weld(part.positions, part.indices);
    const shells = splitShells(welded.positions, welded.indices);
    const report: PartReport = { name: part.name, triangles: welded.indices.length / 3, shells: shells.length, rejectedShells: 0, accepted: true };
    for (const shell of shells) {
      let problem: string | undefined;
      try {
        const solid = Manifold.ofMesh(new Mesh({ numProp: 3, vertProperties: shell.positions, triVerts: shell.indices }));
        const status = solid.status();
        if (status !== "NoError" || solid.isEmpty()) problem = status === "NoError" ? "empty" : String(status);
        else if (solid.volume() <= 0) problem = "wound inside out (negative volume)";
        if (problem) solid.delete();
        else solids.push(solid);
      } catch (error) {
        problem = error instanceof Error ? error.message : String(error);
      }
      if (problem) {
        report.rejectedShells++;
        report.accepted = false;
        report.problem ??= problem;
      }
    }
    reports.push(report);
  }
  if (solids.length === 0) throw new Error("No part could be made into a solid: " + reports.map((r) => `${r.name}: ${r.problem}`).join("; "));

  progress("Merging");
  const merged = Manifold.union(solids);
  const status = String(merged.status());
  const mesh = merged.getMesh();
  const positions = new Float32Array((mesh.vertProperties.length / mesh.numProp) * 3);
  for (let v = 0; v < positions.length / 3; v++) for (let k = 0; k < 3; k++) positions[v * 3 + k] = mesh.vertProperties[v * mesh.numProp + k];
  const box = merged.boundingBox();
  const { stl, degenerate } = writeStl(positions, mesh.triVerts);
  progress("Checking");
  const pieces = merged.decompose();
  const volumes = pieces.map((piece) => piece.volume()).sort((a, b) => b - a);
  const SPECK = 0.5; // mm^3: the smallest real part, a tooth, is about 1.4
  const components = volumes.filter((volume) => volume >= SPECK).map((volume) => ({ volume }));
  const report: PrintReport = {
    parts: reports,
    status,
    triangles: mesh.triVerts.length / 3 - degenerate,
    vertices: positions.length / 3,
    volume: merged.volume(),
    surfaceArea: merged.surfaceArea(),
    genus: merged.genus(),
    components,
    specks: volumes.filter((volume) => volume > 0 && volume < SPECK).length,
    voids: volumes.filter((volume) => volume <= 0).length,
    degenerate,
    size: [box.max[0] - box.min[0], box.max[1] - box.min[1], box.max[2] - box.min[2]],
    min: [box.min[0], box.min[1], box.min[2]],
    seconds: (Date.now() - started) / 1000,
  };
  for (const piece of pieces) piece.delete();
  merged.delete();
  for (const solid of solids) solid.delete();
  return { stl, report };
}

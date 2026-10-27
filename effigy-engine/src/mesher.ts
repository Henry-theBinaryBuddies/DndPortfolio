import type { Sdf } from "./sdf";

// Surface nets: turns a distance field into a triangle mesh. The space is cut into a grid of small
// cells; every cell the surface passes through gets one vertex, and neighbouring cells are joined
// into quads. The result is smooth and, because it comes from a closed field, watertight.

export interface Bounds {
  halfX: number; // the grid spans -halfX..halfX in x, so left and right can share work (the sculpt is symmetric)
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
}

export interface MeshData {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
}

// Each of the 12 edges of a cell, as a pair of corner numbers. A corner's number encodes its
// offset: bit 0 is +x, bit 1 is +y, bit 2 is +z.
const EDGES: [number, number][] = [
  [0, 1], [2, 3], [4, 5], [6, 7],
  [0, 2], [1, 3], [4, 6], [5, 7],
  [0, 4], [1, 5], [2, 6], [3, 7],
];

export interface MeshOptions {
  cell: number;
  // Cheap bounding shapes that let us skip the expensive field away from the surface.
  // `outer` must contain the whole shape, `inner` must lie wholly inside it.
  outer: Sdf;
  inner: Sdf;
}

export function meshField(sdf: Sdf, bounds: Bounds, options: MeshOptions): MeshData {
  const { cell, outer, inner } = options;
  const half = Math.ceil(bounds.halfX / cell);
  const nx = half * 2 + 1;
  const ny = Math.ceil((bounds.maxY - bounds.minY) / cell) + 1;
  const nz = Math.ceil((bounds.maxZ - bounds.minZ) / cell) + 1;
  const field = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => i + nx * (j + ny * k);

  const margin = Math.max(0.12, cell * 3);
  const insideMargin = cell * 3;

  // Fill the right half of the grid (including the centre column), then mirror it onto the left.
  // The grid is processed in small blocks. One evaluation at a block's centre tells us whether the
  // surface can possibly pass through it; if the centre is farther from the surface than the block
  // is wide (with a safety factor, since the field is only approximately a true distance), every
  // point inside simply takes the centre's value, and the sign is all the mesher needs.
  const B = 6;
  const reach = B * cell * 0.87 * 1.7;
  for (let k0 = 0; k0 < nz; k0 += B) {
    for (let j0 = 0; j0 < ny; j0 += B) {
      for (let i0 = half; i0 < nx; i0 += B) {
        const ci = Math.min(i0 + B / 2, nx - 1);
        const cj = Math.min(j0 + B / 2, ny - 1);
        const ck = Math.min(k0 + B / 2, nz - 1);
        const centre = sdf((ci - half) * cell, bounds.minY + cj * cell, bounds.minZ + ck * cell);
        const skip = Math.abs(centre) > reach;
        const iEnd = Math.min(i0 + B, nx);
        const jEnd = Math.min(j0 + B, ny);
        const kEnd = Math.min(k0 + B, nz);
        for (let k = k0; k < kEnd; k++) {
          const z = bounds.minZ + k * cell;
          for (let j = j0; j < jEnd; j++) {
            const y = bounds.minY + j * cell;
            for (let i = i0; i < iEnd; i++) {
              let value = centre;
              if (!skip) {
                const x = (i - half) * cell;
                value = outer(x, y, z);
                if (value <= margin) {
                  const core = inner(x, y, z);
                  value = core < -insideMargin ? core : sdf(x, y, z);
                }
              }
              field[at(i, j, k)] = value;
              if (i > half) field[at(2 * half - i, j, k)] = value;
            }
          }
        }
      }
    }
  }

  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const cellVertex = new Int32Array(cx * cy * cz).fill(-1);
  const positions: number[] = [];
  const normals: number[] = [];
  const corner = new Float32Array(8);

  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let mask = 0;
        for (let c = 0; c < 8; c++) {
          const v = field[at(i + (c & 1), j + ((c >> 1) & 1), k + ((c >> 2) & 1))];
          corner[c] = v;
          if (v < 0) mask |= 1 << c;
        }
        if (mask === 0 || mask === 255) continue;

        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          count++;
        }
        const px = (i - half + sx / count) * cell;
        const py = bounds.minY + (j + sy / count) * cell;
        const pz = bounds.minZ + (k + sz / count) * cell;

        // The surface normal is the field's gradient, read off the cell's eight corners.
        const gx = corner[1] + corner[3] + corner[5] + corner[7] - corner[0] - corner[2] - corner[4] - corner[6];
        const gy = corner[2] + corner[3] + corner[6] + corner[7] - corner[0] - corner[1] - corner[4] - corner[5];
        const gz = corner[4] + corner[5] + corner[6] + corner[7] - corner[0] - corner[1] - corner[2] - corner[3];
        const glen = Math.sqrt(gx * gx + gy * gy + gz * gz) || 1;

        cellVertex[i + cx * (j + cy * k)] = positions.length / 3;
        positions.push(px, py, pz);
        normals.push(gx / glen, gy / glen, gz / glen);
      }
    }
  }

  const indices: number[] = [];
  const vertexAt = (i: number, j: number, k: number) => cellVertex[i + cx * (j + cy * k)];
  const quad = (a: number, b: number, c: number, d: number, flip: boolean) => {
    if (a < 0 || b < 0 || c < 0 || d < 0) return;
    if (flip) indices.push(a, c, b, a, d, c);
    else indices.push(a, b, c, a, c, d);
  };

  // Every grid edge the surface crosses is shared by four cells; those four vertices form one quad.
  for (let k = 1; k < cz; k++) {
    for (let j = 1; j < cy; j++) {
      for (let i = 1; i < cx; i++) {
        const v0 = field[at(i, j, k)];
        const inside = v0 < 0;
        if (i < cx && inside !== field[at(i + 1, j, k)] < 0) {
          quad(vertexAt(i, j - 1, k - 1), vertexAt(i, j, k - 1), vertexAt(i, j, k), vertexAt(i, j - 1, k), inside);
        }
        if (j < cy && inside !== field[at(i, j + 1, k)] < 0) {
          quad(vertexAt(i - 1, j, k - 1), vertexAt(i, j, k - 1), vertexAt(i, j, k), vertexAt(i - 1, j, k), !inside);
        }
        if (k < cz && inside !== field[at(i, j, k + 1)] < 0) {
          quad(vertexAt(i - 1, j - 1, k), vertexAt(i, j - 1, k), vertexAt(i, j, k), vertexAt(i - 1, j, k), inside);
        }
      }
    }
  }

  // Make sure every triangle faces the same way as the surface normal, so winding is consistent.
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t] * 3;
    const b = indices[t + 1] * 3;
    const c = indices[t + 2] * 3;
    const e1x = positions[b] - positions[a];
    const e1y = positions[b + 1] - positions[a + 1];
    const e1z = positions[b + 2] - positions[a + 2];
    const e2x = positions[c] - positions[a];
    const e2y = positions[c + 1] - positions[a + 1];
    const e2z = positions[c + 2] - positions[a + 2];
    const nx2 = e1y * e2z - e1z * e2y;
    const ny2 = e1z * e2x - e1x * e2z;
    const nz2 = e1x * e2y - e1y * e2x;
    const dot = nx2 * (normals[a] + normals[b] + normals[c]) + ny2 * (normals[a + 1] + normals[b + 1] + normals[c + 1]) + nz2 * (normals[a + 2] + normals[b + 2] + normals[c + 2]);
    if (dot < 0) {
      const tmp = indices[t + 1];
      indices[t + 1] = indices[t + 2];
      indices[t + 2] = tmp;
    }
  }

  return { positions: new Float32Array(positions), normals: new Float32Array(normals), indices: new Uint32Array(indices) };
}

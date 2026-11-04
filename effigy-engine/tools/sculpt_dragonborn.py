"""Sculpts Effigy Engine's fixed Dragonborn bust (milestone 1 of the Dragonborn plan).

    blender -b --factory-startup --python tools/sculpt_dragonborn.py -- <out_dir> [--renders] [--plain]

The script is the source: every form is written down below, so the bust can be rebuilt and changed
by editing numbers here rather than by hand-sculpting a file nobody can diff. (About a minute; the
first run also spends a minute or two on the chest's field, which is then kept in <out_dir>.)

How it is built:
  1. The head and neck are a signed distance field: smooth unions of lofted boxes (muzzle, lower jaw),
     ellipsoids (skull, brow, cheeks) and tapered tubes (horns, spines), with cuts for the sockets,
     nostrils and mouth line. Distances are in metres, Y up, the face toward +Z, the origin between
     the human eyes.
  2. The chest and shoulders are the human bust the app already ships (public/models/head.bin, CC0
     Blender Studio base meshes), cut below its neck and joined smoothly under the dragon neck, so the
     anatomy below the neck stays real. A plain round plinth sits under it for the test print.
  3. The field is sampled on a 2 mm grid (exactly only near the surface), meshed with surface nets,
     smoothed, and voxel-remeshed at 1 mm in Blender.
  4. Scales, scutes, horn ridges and slit pupils are cut into that mesh as low relief (see `scales`;
     --plain skips them).
  5. Writes <out_dir>/dragonborn.blend and dragonborn_test.stl (millimetres at STL_SCALE, checked for
     open edges and crossing triangles), and with --renders, clay views: dragonborn_turnaround.png
     (front, three-quarter, profile, rear) and dragonborn_face.png (close up).
"""

import math
import os
import struct
import sys
import time

import bmesh
import bpy
import numpy as np
from mathutils.bvhtree import BVHTree
from mathutils.geometry import intersect_ray_tri
from mathutils.kdtree import KDTree

ARGS = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
OUT_DIR = ARGS[0] if ARGS else "."
RENDERS = "--renders" in ARGS
PLAIN = "--plain" in ARGS  # skip the scales (a quicker look at the forms)
HERE = os.path.dirname(os.path.abspath(__file__))
HEAD_BIN = os.path.join(HERE, "..", "public", "models", "head.bin")
# The human bust's eye midpoint, in head.bin's coordinates
HUMAN_EYES = np.array([1.7857, 0.7659, 0.1251])

STEP = 0.002
BOUNDS = (np.array([-0.235, -0.455, -0.34]), np.array([0.235, 0.21, 0.245]))
# A plain round plinth under the bust, for the test print: centre (x, z), radius, height (metres)
PLINTH = (0.0, -0.1, 0.175, 0.04)
BUST_BOTTOM = -0.403
PLINTH_OVERLAP = 0.012
# The test STL's scale: the bust at about 1:12 (some 50 mm tall with its plinth)
STL_SCALE = 1000 / 12
started = time.time()


def log(*words):
    print("[%5.1fs]" % (time.time() - started), *words, flush=True)


# ---------------------------------------------------------------------------------------------------
# Distance primitives. Each takes points P (N x 3) and returns N distances (negative inside).


def smin(a, b, k):
    """A smooth union: the two surfaces blend over about k."""
    if k <= 0:
        return np.minimum(a, b)
    h = np.maximum(k - np.abs(a - b), 0) / k
    return np.minimum(a, b) - h * h * k * 0.25


def smax(a, b, k):
    """A smooth intersection; smax(a, -b, k) cuts b out of a."""
    return -smin(-a, -b, k)


def ellipsoid(P, c, r, turn=None):
    q = P - c
    if turn is not None:
        q = q @ turn
    q = q / r
    k0 = np.linalg.norm(q, axis=1)
    k1 = np.linalg.norm(q / r, axis=1)
    return k0 * (k0 - 1) / np.maximum(k1, 1e-9)


def segment(P, a, b, ra, rb):
    """A tube from a to b whose radius runs from ra to rb."""
    a = np.asarray(a, float)
    ba = np.asarray(b, float) - a
    pa = P - a
    h = np.clip(pa @ ba / (ba @ ba), 0, 1)
    return np.linalg.norm(pa - h[:, None] * ba, axis=1) - (ra + (rb - ra) * h)


def tube(P, points, radii):
    """A tube along a polyline, its radius given at each point."""
    d = np.full(len(P), 1e9)
    for a, b, ra, rb in zip(points, points[1:], radii, radii[1:]):
        d = np.minimum(d, segment(P, a, b, ra, rb))
    return d


def loft(P, z, half_width, top, bottom, corner, front_round, back_round):
    """A rounded box running along Z whose section (half width, top and bottom edge, corner radius)
    changes along its length; the ends are rounded off."""
    x, y, zz = P[:, 0], P[:, 1], P[:, 2]
    w = np.interp(zz, z, half_width)
    t = np.interp(zz, z, top)
    b = np.interp(zz, z, bottom)
    rr = np.minimum(np.interp(zz, z, corner), np.minimum(w, (t - b) / 2) - 1e-4)
    qx = np.abs(x) - (w - rr)
    qy = np.abs(y - (t + b) / 2) - ((t - b) / 2 - rr)
    d = np.hypot(np.maximum(qx, 0), np.maximum(qy, 0)) + np.minimum(np.maximum(qx, qy), 0) - rr
    d = smax(d, zz - z[-1], front_round)
    return smax(d, z[0] - zz, back_round)


def catmull_rom(points, samples):
    pts = [np.asarray(p, float) for p in points]
    padded = [pts[0]] + pts + [pts[-1]]
    out = []
    for i in range(samples + 1):
        u = i / samples * (len(pts) - 1)
        s = min(int(u), len(pts) - 2)
        f = u - s
        p0, p1, p2, p3 = padded[s : s + 4]
        out.append(0.5 * (2 * p1 + (p2 - p0) * f + (2 * p0 - 5 * p1 + 4 * p2 - p3) * f * f + (3 * p1 - p0 - 3 * p2 + p3) * f * f * f))
    return out


def turn(x=0.0, y=0.0, z=0.0):
    """A rotation (radians about X, then Y, then Z) as a matrix whose columns are the local axes."""
    cx, sx, cy, sy, cz, sz = math.cos(x), math.sin(x), math.cos(y), math.sin(y), math.cos(z), math.sin(z)
    rx = np.array([[1, 0, 0], [0, cx, -sx], [0, sx, cx]])
    ry = np.array([[cy, 0, sy], [0, 1, 0], [-sy, 0, cy]])
    rz = np.array([[cz, -sz, 0], [sz, cz, 0], [0, 0, 1]])
    return rz @ ry @ rx


def bounded(P, lo, hi, field):
    """Evaluates field only for the points inside a box (others get a large distance)."""
    inside = np.all((P >= lo) & (P <= hi), axis=1)
    d = np.full(len(P), 1.0)
    if inside.any():
        d[inside] = field(P[inside])
    return d


def mirrored(P):
    """The same points with x folded onto the right-hand side, for symmetric features."""
    Q = P.copy()
    Q[:, 0] = np.abs(Q[:, 0])
    return Q


# ---------------------------------------------------------------------------------------------------
# The head, in its own frame: origin between the eyes, Y up, face toward +Z. HEAD_AT places it over
# the human chest.

HEAD_AT = np.array([0.0, 0.025, 0.035])
HEAD_SCALE = 1.15
EYE = np.array([0.047, 0.004, 0.022])
EYE_RADIUS = 0.0155
EYE_TURN = turn(y=0.5)  # each eye looks this far out to its side

# The muzzle (upper jaw) and the lower jaw, as sections along Z: z, half width, top, bottom, corner
MUZZLE = dict(
    z=[-0.06, 0.0, 0.06, 0.12, 0.168],
    half_width=[0.064, 0.056, 0.048, 0.04, 0.034],
    top=[0.03, 0.016, 0.005, -0.001, -0.006],
    bottom=[-0.07, -0.069, -0.067, -0.065, -0.064],
    corner=[0.03, 0.026, 0.022, 0.022, 0.024],
)
JAW = dict(
    z=[-0.085, -0.03, 0.03, 0.09, 0.126],
    half_width=[0.062, 0.052, 0.04, 0.03, 0.023],
    top=[-0.058, -0.06, -0.059, -0.056, -0.055],  # inside the muzzle, so the two jaws are one solid
    bottom=[-0.136, -0.123, -0.108, -0.096, -0.088],
    corner=[0.034, 0.03, 0.024, 0.019, 0.015],
)
HORN = catmull_rom(
    [(0.042, 0.065, -0.065), (0.07, 0.105, -0.11), (0.1, 0.112, -0.17), (0.123, 0.076, -0.216), (0.133, 0.02, -0.216), (0.133, -0.02, -0.182), (0.127, -0.03, -0.142)],
    48,
)
HORN_RADII = [0.028 * (1 - 0.86 * (i / 48) ** 1.1) for i in range(49)]
# Cheek and brow spines: root, tip, root radius
SPINES = [
    ((0.07, -0.035, -0.07), (0.118, -0.026, -0.1), 0.012),
    ((0.072, -0.074, -0.084), (0.113, -0.084, -0.118), 0.011),
    ((0.058, 0.026, -0.035), (0.097, 0.04, -0.062), 0.009),
]
# Brow plates: an angry slant down toward the nose, overhanging the eye
BROW_TURN = turn(z=0.32, y=0.35)
NOSTRIL_TURN = turn(z=0.55, y=0.25)


def head(P):
    """The dragon's head (without the neck), in the head frame."""
    Q = mirrored(P)
    # The skull: a crown, and a sloping plate behind it down into the nape (no round back of the head)
    d = ellipsoid(P, (0, 0.028, -0.07), (0.066, 0.062, 0.075))
    d = smin(d, ellipsoid(P, (0, -0.02, -0.1), (0.058, 0.07, 0.05), turn(x=-0.5)), 0.03)
    d = smin(d, ellipsoid(P, (0, 0.04, -0.012), (0.062, 0.036, 0.056)), 0.03)
    d = smin(d, loft(P, MUZZLE["z"], MUZZLE["half_width"], MUZZLE["top"], MUZZLE["bottom"], MUZZLE["corner"], 0.03, 0.02), 0.03)
    # The lower jaw, narrower than the muzzle so the upper lip overhangs it
    d = smin(d, loft(P, JAW["z"], JAW["half_width"], JAW["top"], JAW["bottom"], JAW["corner"], 0.03, 0.02), 0.004)
    # Cheek plates and the jaw muscles behind them
    d = smin(d, ellipsoid(Q, (0.064, -0.05, -0.045), (0.024, 0.038, 0.052)), 0.022)
    d = smin(d, segment(Q, (0.044, -0.024, 0.03), (0.064, -0.028, -0.05), 0.008, 0.011), 0.02)
    # The heavy brow plate over each eye
    d = smin(d, ellipsoid(Q, (0.043, 0.026, 0.018), (0.03, 0.011, 0.032), BROW_TURN), 0.014)
    # The ridge down the top of the muzzle, and the nostrils with a raised rim
    d = smin(d, segment(P, (0, 0.035, 0.03), (0, -0.014, 0.15), 0.01, 0.008), 0.015)
    d = smin(d, ellipsoid(P, (0, -0.018, 0.152), (0.03, 0.019, 0.019)), 0.012)
    d = smin(d, ellipsoid(Q, (0.019, -0.008, 0.152), (0.009, 0.006, 0.014), NOSTRIL_TURN), 0.008)
    d = smax(d, -ellipsoid(Q, (0.021, -0.004, 0.156), (0.0075, 0.0045, 0.0105), NOSTRIL_TURN), 0.003)
    # Sockets cut under the brow, then the eyeballs set deep in them
    d = smax(d, -ellipsoid(Q, EYE, (0.021, 0.0115, 0.018), EYE_TURN), 0.004)
    d = smin(d, np.linalg.norm(Q - (EYE - EYE_TURN[:, 2] * 0.0085), axis=1) - EYE_RADIUS, 0.002)
    # The mouth line: a shallow groove along the lip, cut only into the outer few millimetres
    lip = np.interp(P[:, 2], LIP_Z, LIP_Y)
    groove = np.maximum(np.abs(P[:, 1] - lip) - 0.0016, -d - 0.0035)
    groove = np.maximum(groove, np.maximum(P[:, 2] - 0.18, LIP_Z[0] - P[:, 2]))
    return smax(d, -groove, 0.0015)


def outgrowths(P):
    """Horns, cheek spines and the crest, in the head frame. They are joined after the neck, with a
    blend narrower than the box each is evaluated in (a wider blend would show the box's edges)."""
    Q = mirrored(P)
    d = bounded(Q, (0.0, -0.08, -0.27), (0.18, 0.15, -0.03), lambda R: tube(R, HORN, HORN_RADII))
    for root, tip, radius in SPINES:
        d = np.minimum(d, bounded(Q, np.minimum(root, tip) - 0.03, np.maximum(root, tip) + 0.03, lambda R: spine(R, root, tip, radius, SPINE_FLAT)))
    for root, tip, radius in CREST:
        d = np.minimum(d, bounded(P, np.minimum(root, tip) - 0.03, np.maximum(root, tip) + 0.03, lambda R: spine(R, root, tip, radius, CREST_FLAT)))
    return d


SPINE_FLAT = np.array([1.0, 1.8, 1.0])  # cheek spines are flattened plates, thinner top to bottom
CREST_FLAT = np.array([2.2, 1.0, 1.0])  # crest spines are thin from side to side
# The crest: a row of short spines over the crown and down the back of the neck (root, tip, radius)
CREST = [
    ((0, 0.084, -0.045), (0, 0.105, -0.072), 0.011),
    ((0, 0.084, -0.08), (0, 0.104, -0.113), 0.012),
    ((0, 0.068, -0.113), (0, 0.08, -0.15), 0.012),
    ((0, 0.042, -0.138), (0, 0.046, -0.176), 0.011),
    ((0, -0.04, -0.141), (0, -0.048, -0.18), 0.012),
    ((0, -0.1, -0.155), (0, -0.11, -0.192), 0.012),
    ((0, -0.16, -0.165), (0, -0.172, -0.2), 0.011),
]
# The mouth line, along the muzzle (z, y), rising a little at the back to the corner of the mouth
LIP_Z = [-0.062, -0.03, 0.06, 0.15, 0.18]
LIP_Y = [-0.06, -0.067, -0.068, -0.066, -0.066]


def spine(P, root, tip, radius, flat):
    k = flat.max()
    return segment(P * flat, np.array(root) * flat, np.array(tip) * flat, radius * k, 0.002) / k


def neck(P):
    """The neck, leaning forward from the chest up under the back of the skull, and the throat under the
    jaw. In the chest's frame (it is not scaled with the head)."""
    S = P * (1, 1, 1 / 1.15)
    d = tube(S, [(0, -0.26, -0.09 / 1.15), (0, -0.15, -0.088 / 1.15), (0, -0.02, -0.065 / 1.15)], [0.09, 0.08, 0.064])
    return smin(d, segment(P, (0, -0.09, 0.04), (0, -0.21, -0.03), 0.052, 0.07), 0.045)


def dragon(P):
    H = (P - HEAD_AT) / HEAD_SCALE
    d = smin(head(H) * HEAD_SCALE, neck(P), 0.035)
    return smin(d, outgrowths(H) * HEAD_SCALE, 0.01)


# ---------------------------------------------------------------------------------------------------
# The human chest, as a distance field from the shipped bust


def human_bust():
    data = open(HEAD_BIN, "rb").read()
    n, t = struct.unpack("<II", data[:8])
    verts = np.frombuffer(data, "<f4", n * 3, 8).reshape(-1, 3).astype(float) - HUMAN_EYES
    tris = np.frombuffer(data, "<u4", t * 3, 8 + n * 12).reshape(-1, 3)
    return BVHTree.FromPolygons([tuple(v) for v in verts], [tuple(int(i) for i in f) for f in tris])


CHEST_SCALE = np.array([1.08, 1.0, 1.05])  # a broader, deeper chest than the human's
NECK_CUT = -0.13


def chest(P, tree):
    d = np.full(len(P), 1.0)
    low = P[:, 1] < NECK_CUT + 0.04
    for i in np.nonzero(low)[0]:
        q = P[i] / CHEST_SCALE
        location, normal, _, distance = tree.find_nearest(q)
        if location is None:
            continue
        outside = (q - np.array(location)) @ np.array(normal) > 0
        d[i] = distance if outside else -distance
    # Nothing below the top of the plinth (some faces of the human bust's base cap face inward, which
    # would hang needles under it; the plinth fills this part)
    d = np.maximum(d, BUST_BOTTOM + PLINTH_OVERLAP - 0.003 - P[:, 1])
    return smax(d, P[:, 1] - NECK_CUT, 0.01)


def plinth(origin, shape):
    """The plinth's field on the grid: a cylinder from the base of the bust down, its top edge rounded."""
    x0, z0, radius, height = PLINTH
    axes = [origin[a] + STEP * np.arange(shape[a]) for a in range(3)]
    x, y, z = np.meshgrid(*axes, indexing="ij", sparse=True)
    across = np.sqrt((x - x0) ** 2 + (z - z0) ** 2) - radius
    # The plinth reaches 12 mm up into the bust: the chest's underside is not quite flat, and a shallower
    # overlap left a thin hidden pocket between the two
    centre = BUST_BOTTOM + PLINTH_OVERLAP - height / 2
    up = np.abs(y - centre) - height / 2
    rr = 0.006
    qx, qy = across + rr, up + rr
    return (np.sqrt(np.maximum(qx, 0) ** 2 + np.maximum(qy, 0) ** 2) + np.minimum(np.maximum(qx, qy), 0) - rr).astype(np.float32)


# ---------------------------------------------------------------------------------------------------
# Sampling and meshing


def sample(field):
    """The field on the fine grid: exact within a band around the surface, from a coarse grid elsewhere
    (where only its sign matters)."""
    lo, hi = BOUNDS
    shape = np.ceil((hi - lo) / STEP).astype(int) + 1
    coarse_step = 4
    cshape = (shape - 1) // coarse_step + 2
    axes = [lo[a] + STEP * coarse_step * np.arange(cshape[a]) for a in range(3)]
    grid = np.stack(np.meshgrid(*axes, indexing="ij"), -1).reshape(-1, 3)
    C = np.concatenate([field(grid[i : i + 200000]) for i in range(0, len(grid), 200000)]).reshape(cshape)
    near = np.abs(C) < 0.024
    grown = near.copy()
    for axis in range(3):
        for shift in (1, -1):
            grown |= np.roll(near, shift, axis)
    idx = [np.arange(shape[a]) // coarse_step for a in range(3)]
    # Away from the band the coarse field is interpolated (not just repeated), so a smooth union with
    # another field there blends smoothly instead of in steps
    F = C.astype(np.float32)
    for axis in range(3):
        i = np.arange(shape[axis])
        lo_i, frac = i // coarse_step, (i % coarse_step) / coarse_step
        hi_i = np.minimum(lo_i + 1, C.shape[axis] - 1)
        frac = frac.reshape([-1 if a == axis else 1 for a in range(3)]).astype(np.float32)
        F = np.take(F, lo_i, axis) * (1 - frac) + np.take(F, hi_i, axis) * frac
    points = np.argwhere(grown[np.ix_(*idx)])
    for i in range(0, len(points), 250000):
        chunk = points[i : i + 250000]
        F[tuple(chunk.T)] = field(lo + STEP * chunk)
    log("sampled", len(points), "points near the surface")
    return F, lo


def sample_chest():
    """The chest's field, kept between runs (it never changes and the nearest-point search is slow)."""
    key = repr((6, BOUNDS[0].tolist(), STEP, NECK_CUT, CHEST_SCALE.tolist(), BUST_BOTTOM, PLINTH_OVERLAP, os.path.getmtime(HEAD_BIN)))
    cache = os.path.join(OUT_DIR, "chest_field.npy")
    if os.path.exists(cache) and open(cache + ".key").read() == key:
        return np.load(cache)
    tree = human_bust()
    F, _ = sample(lambda P: chest(P, tree))
    # The nearest face's normal can point the wrong way where the human bust has sharp edges or
    # overlapping faces, which leaves stray points (and thin needles) on the wrong side. A point whose
    # sign disagrees with the mean of its six neighbours, by more than a smooth surface could, takes that
    # mean; everywhere else the field is left exactly as it was (so smooth slopes do not terrace).
    for _ in range(3):
        mean = sum(np.roll(F, shift, axis) for axis in range(3) for shift in (1, -1)) / 6
        wrong = (np.sign(F) != np.sign(mean)) & (np.abs(F - mean) > STEP)
        F[wrong] = mean[wrong]
    np.save(cache, F)
    open(cache + ".key", "w").write(key)
    return F


def surface_nets(F, origin, h):
    nx, ny, nz = F.shape
    inside = F < 0
    corners = [(i, j, k) for i in (0, 1) for j in (0, 1) for k in (0, 1)]
    any_in = np.zeros((nx - 1, ny - 1, nz - 1), bool)
    all_in = np.ones_like(any_in)
    for i, j, k in corners:
        c = inside[i : nx - 1 + i, j : ny - 1 + j, k : nz - 1 + k]
        any_in |= c
        all_in &= c
    cells = np.argwhere(any_in & ~all_in)
    index = np.full(any_in.shape, -1, np.int64)
    index[tuple(cells.T)] = np.arange(len(cells))
    total = np.zeros((len(cells), 3))
    count = np.zeros(len(cells))
    for a in corners:
        for axis in range(3):
            if a[axis]:
                continue
            b = list(a)
            b[axis] = 1
            f0 = F[cells[:, 0] + a[0], cells[:, 1] + a[1], cells[:, 2] + a[2]]
            f1 = F[cells[:, 0] + b[0], cells[:, 1] + b[1], cells[:, 2] + b[2]]
            m = (f0 < 0) != (f1 < 0)
            t = f0[m] / (f0[m] - f1[m])
            p = cells[m] + np.array(a)
            p = p.astype(float)
            p[:, axis] += t
            total[m] += p
            count[m] += 1
    verts = origin + h * total / count[:, None]
    quads = []
    for axis in range(3):
        u, v = (axis + 1) % 3, (axis + 2) % 3
        lo_sl = [slice(1, -1)] * 3
        hi_sl = [slice(1, -1)] * 3
        lo_sl[axis] = slice(0, -1)
        hi_sl[axis] = slice(1, None)
        crossing = inside[tuple(lo_sl)] != inside[tuple(hi_sl)]
        e = np.argwhere(crossing)
        e[:, u] += 1
        e[:, v] += 1

        def cell(du, dv):
            c = e.copy()
            c[:, u] -= du
            c[:, v] -= dv
            return index[c[:, 0], c[:, 1], c[:, 2]]

        q = np.stack([cell(1, 1), cell(0, 1), cell(0, 0), cell(1, 0)], 1)
        flip = ~inside[e[:, 0], e[:, 1], e[:, 2]]
        q[flip] = q[flip][:, ::-1]
        quads.append(q)
    return verts, np.concatenate(quads)


def build_mesh(verts, quads):
    # Y-up, face +Z (the app's axes) to Blender's Z-up, face -Y
    co = np.stack([verts[:, 0], -verts[:, 2], verts[:, 1]], 1)
    mesh = bpy.data.meshes.new("dragonborn")
    mesh.from_pydata([tuple(p) for p in co], [], [tuple(int(i) for i in q) for q in quads])
    bm = bmesh.new()
    bm.from_mesh(mesh)
    # Keep the largest connected piece (stray specks come from the coarse field far from the surface)
    seen = set()
    pieces = []
    for v in bm.verts:
        if v.index in seen:
            continue
        stack, piece = [v], []
        seen.add(v.index)
        while stack:
            u = stack.pop()
            piece.append(u)
            for e in u.link_edges:
                w = e.other_vert(u)
                if w.index not in seen:
                    seen.add(w.index)
                    stack.append(w)
        pieces.append(piece)
    pieces.sort(key=len)
    bmesh.ops.delete(bm, geom=[v for piece in pieces[:-1] for v in piece], context="VERTS")
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    bm.to_mesh(mesh)
    bm.free()
    obj = bpy.data.objects.new("Dragonborn", mesh)
    bpy.context.scene.collection.objects.link(obj)
    smooth = obj.modifiers.new("smooth", "LAPLACIANSMOOTH")
    smooth.iterations = 2
    smooth.lambda_factor = 0.4
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=smooth.name)
    obj.data.shade_smooth()
    log("mesh:", len(obj.data.vertices), "vertices,", len(pieces) - 1, "specks dropped")
    return obj


# ---------------------------------------------------------------------------------------------------
# Scales, scutes and horn ridges, cut into the meshed surface as low relief. Everything here is in the
# chest's frame (Y up, face +Z); the mesh is converted back to Blender's axes at the end.


def smoothstep(e0, e1, x):
    t = np.clip((x - e0) / (e1 - e0), 0, 1)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def head_frame(P):
    return (P - HEAD_AT) / HEAD_SCALE


def scale_size(P):
    """How far apart the scales are: small on the muzzle, larger over the head, neck and chest."""
    y = P[:, 1]
    s = lerp(0.02, 0.015, smoothstep(-0.27, -0.17, y))
    headness = smoothstep(-0.11, -0.05, y)
    s = lerp(s, 0.011, headness)
    return lerp(s, 0.007, smoothstep(0.0, 0.08, head_frame(P)[:, 2]) * headness)


def tailward(P, N):
    """The way the scales point (their free edge): back along the head, down the neck and chest,
    flattened onto the surface."""
    headness = smoothstep(-0.11, -0.05, P[:, 1])[:, None]
    flow = lerp(np.array([0.0, -1.0, -0.15]), np.array([0.0, -0.35, -1.0]), headness)
    flow = flow - N * np.sum(flow * N, axis=1)[:, None]
    return flow / np.maximum(np.linalg.norm(flow, axis=1), 1e-9)[:, None]


def scatter(points, spacing, rng):
    """Sites spread over the surface roughly `spacing` apart (greedy, in shuffled batches)."""
    order = rng.permutation(len(points))
    sites = np.zeros((0, 3))
    site_spacing = np.zeros(0)
    for start in range(0, len(order), 4000):
        batch = order[start : start + 4000]
        if len(sites):
            tree = KDTree(len(sites))
            for i, p in enumerate(sites):
                tree.insert(p, i)
            tree.balance()
            keep = [b for b in batch if tree.find(points[b])[2] > 0.9 * spacing[b]]
        else:
            keep = list(batch)
        chosen = []
        for b in keep:
            if chosen:
                gaps = np.linalg.norm(points[chosen] - points[b], axis=1)
                if np.any(gaps < 0.9 * spacing[b]):
                    continue
            chosen.append(b)
        sites = np.concatenate([sites, points[chosen]])
        site_spacing = np.concatenate([site_spacing, spacing[chosen]])
    return sites, site_spacing


def horn_ridges(P):
    """Rings around each horn (deeper toward the root, closer together toward the tip) and a weight that
    is 1 on the horns and spines, where the skin scales stop."""
    H = mirrored(head_frame(P))
    horn = np.array(HORN)
    radii = np.array(HORN_RADII)
    lengths = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(horn, axis=0), axis=1))])
    phase = np.concatenate([[0], np.cumsum(np.diff(lengths) / (0.42 * radii[1:]))])
    ridge = np.zeros(len(P))
    on_horn = np.zeros(len(P))
    box = np.all((H > horn.min(0) - 0.04) & (H < horn.max(0) + 0.04), axis=1)
    idx = np.nonzero(box)[0]
    for start in range(0, len(idx), 100000):
        part = idx[start : start + 100000]
        gaps = np.linalg.norm(H[part, None, :] - horn[None, :, :], axis=2)
        nearest = np.argmin(gaps, axis=1)
        clearance = gaps[np.arange(len(part)), nearest] - radii[nearest]
        weight = smoothstep(0.006, 0.002, clearance) * smoothstep(0.03, 0.12, nearest / (len(horn) - 1))
        f = phase[nearest] % 1
        ring = 0.1 * (1 - f) - 0.16 * (1 - smoothstep(0.0, 0.12, f))
        ridge[part] = ring * radii[nearest] * HEAD_SCALE * weight
        on_horn[part] = smoothstep(0.006, 0.001, clearance)
    for root, tip, radius in SPINES:
        root, tip = np.array(root), np.array(tip)
        axis = tip - root
        h = np.clip((H - root) @ axis / (axis @ axis), 0, 1)
        clearance = np.linalg.norm(H - root - h[:, None] * axis, axis=1) - lerp(radius, 0.0012, h)
        on_horn = np.maximum(on_horn, smoothstep(0.005, 0.001, clearance) * smoothstep(0.15, 0.4, h))
    return ridge, on_horn


def remesh(obj):
    """Remeshes the bust at 1 mm, ready for the scales. A voxel remesh also guarantees a clean closed
    solid where two surfaces came within a grid step of each other."""
    obj.data.remesh_voxel_size = 0.001
    obj.data.remesh_voxel_adaptivity = 0
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.voxel_remesh()
    obj.data.shade_smooth()


def scales(obj):
    """Cuts the scales into the remeshed bust."""
    mesh = obj.data
    n = len(mesh.vertices)
    co = np.zeros(n * 3)
    mesh.vertices.foreach_get("co", co)
    no = np.zeros(n * 3)
    mesh.vertex_normals.foreach_get("vector", no)
    co, no = co.reshape(-1, 3), no.reshape(-1, 3)
    # Blender (Z up, face -Y) to the chest's frame (Y up, face +Z)
    P = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)
    N = np.stack([no[:, 0], no[:, 2], -no[:, 1]], 1)

    rng = np.random.default_rng(7)
    size = scale_size(P)
    candidates = rng.choice(n, min(n, 150000), replace=False)
    sites, site_size = scatter(P[candidates], size[candidates], rng)
    log("scales:", len(sites))
    tree = KDTree(len(sites))
    for i, p in enumerate(sites):
        tree.insert(p, i)
    tree.balance()
    d1 = np.zeros(n)
    d2 = np.zeros(n)
    owner = np.zeros(n, int)
    for i, p in enumerate(P):
        (_, a, da), (_, _, db) = tree.find_n(p, 2)
        d1[i], d2[i], owner[i] = da, db, a
    s = site_size[owner]
    edge = (d2 - d1) / 2
    groove = 1 - smoothstep(0.0, 0.08 * s, edge)
    # Each scale rises toward its free edge, so it seems to lie over the next one, and is slightly domed
    along = np.sum((P - sites[owner]) * tailward(P, N), axis=1) / s
    plate = 0.13 * s * np.clip(along + 0.5, 0, 1.1) + 0.03 * s * np.clip(1 - (d1 / (0.7 * s)) ** 2, 0, 1)
    skin = lerp(plate, -0.05 * s, groove)

    # Scutes: chevron bands down the front of the throat, each overlapping the one below
    x, y = np.abs(P[:, 0]), P[:, 1]
    front = smoothstep(0.1, 0.45, N[:, 2]) * smoothstep(0.047, 0.036, x) * smoothstep(-0.3, -0.26, y) * smoothstep(-0.07, -0.1, y)
    band = (y - 0.3 * x) / 0.014
    f = band - np.floor(band)
    scute = lerp(0.0014 * (1 - f), -0.0007, 1 - smoothstep(0.0, 0.07, f))
    skin = lerp(skin, scute, front)

    ridge, on_horn = horn_ridges(P)
    H = mirrored(head_frame(P))
    eye = smoothstep(EYE_RADIUS + 0.002, EYE_RADIUS + 0.007, np.linalg.norm(H - EYE, axis=1))
    # On the eyeball: a ring round the iris and a slit pupil, pressed in
    local = (H - (EYE - EYE_TURN[:, 2] * 0.0085)) @ EYE_TURN
    across = np.hypot(local[:, 0], local[:, 1])
    looking = (local[:, 2] > 0) * (1 - eye)
    iris = 1 - smoothstep(0.0003, 0.0008, np.abs(across - 0.0105))
    slit = smoothstep(0.0012, 0.0006, np.abs(local[:, 0]) / np.sqrt(np.clip(1 - (local[:, 1] / 0.0095) ** 2, 0.01, 1)))
    slit *= local[:, 1] ** 2 < 0.0095**2
    pressed = -HEAD_SCALE * (0.0004 * iris + 0.0007 * slit) * looking
    # Nothing on the flat cuts of the bust (its base and the sides of the chest)
    cut = smoothstep(BUST_BOTTOM + PLINTH_OVERLAP + 0.008, BUST_BOTTOM + PLINTH_OVERLAP + 0.016, y)
    cut *= 1 - smoothstep(0.8, 0.88, np.abs(N[:, 0])) * smoothstep(0.12, 0.05, np.abs(N[:, 2])) * smoothstep(0.14, 0.16, x)
    # Nor inside the mouth line, where the two lips' scales would press into each other
    Hf = head_frame(P)
    lip = np.interp(Hf[:, 2], LIP_Z, LIP_Y)
    cut *= 1 - smoothstep(0.009, 0.004, np.abs(Hf[:, 1] - lip)) * (Hf[:, 2] > LIP_Z[0] - 0.01)
    lift = (skin * (1 - on_horn) * eye + ridge + pressed) * cut
    P = P + N * lift[:, None]
    co = np.stack([P[:, 0], -P[:, 2], P[:, 1]], 1)
    mesh.vertices.foreach_set("co", co.ravel())
    mesh.update()
    log("scales cut:", n, "vertices")


# ---------------------------------------------------------------------------------------------------
# Clay renders


def turnaround(obj, path, views=(("front", 0), ("three-quarter", 35), ("profile", 90), ("rear", 180)), target=(0.0, 0.0, -0.1), distance=2.6):
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    shading = scene.display.shading
    shading.light = "STUDIO"
    shading.color_type = "SINGLE"
    shading.single_color = (0.6, 0.58, 0.55)
    shading.show_cavity = True
    shading.cavity_type = "BOTH"
    world = bpy.data.worlds.new("clay") if scene.world is None else scene.world
    scene.world = world
    world.color = (0.86, 0.84, 0.81)
    scene.render.resolution_x = 700
    scene.render.resolution_y = 900
    scene.render.film_transparent = False
    cam = scene.camera
    if cam is None:
        cam = bpy.data.objects.new("cam", bpy.data.cameras.new("cam"))
        cam.data.lens = 120
        scene.collection.objects.link(cam)
        scene.camera = cam
    target = np.array(target)  # Blender axes
    shots = []
    for name, yaw in views:
        a = math.radians(yaw)
        eye = target + distance * np.array([-math.sin(a), -math.cos(a), 0.12])
        cam.location = tuple(eye)
        look = target - eye
        cam.rotation_euler = (math.atan2(math.hypot(look[0], look[1]), -look[2]), 0, math.atan2(look[1], look[0]) - math.pi / 2)
        file = os.path.join(OUT_DIR, f"_shot_{name}.png")
        scene.render.filepath = file
        bpy.ops.render.render(write_still=True)
        image = bpy.data.images.load(file)
        pixels = np.array(image.pixels[:]).reshape(image.size[1], image.size[0], 4)
        shots.append(pixels)
        bpy.data.images.remove(image)
        os.remove(file)
    sheet = np.concatenate(shots, axis=1)
    out = bpy.data.images.new("turnaround", sheet.shape[1], sheet.shape[0])
    out.pixels = sheet.ravel()
    out.filepath_raw = path
    out.file_format = "PNG"
    out.save()
    log("turnaround:", path)


def edge_through(fa, fb):
    corners = [v.co for v in fb.verts]
    for p, q in ((fa.verts[i].co, fa.verts[(i + 1) % 3].co) for i in range(3)):
        d = q - p
        if d.length == 0:
            continue
        hit = intersect_ray_tri(*corners, d.normalized(), p, True)
        if hit is not None and (hit - p).length <= d.length:
            return True
    return False


def export_stl(obj, path):
    """Writes the bust as a binary STL in millimetres at STL_SCALE, Z up, and checks it: every edge
    shared by exactly two triangles, and no triangles crossing each other."""
    mesh = obj.data
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    open_edges = sum(1 for e in bm.edges if len(e.link_faces) != 2)
    bm.verts.ensure_lookup_table()
    tree = BVHTree.FromBMesh(bm)
    tris = [[v.index for v in f.verts] for f in bm.faces]
    # The tree's overlap test is coarse (it also reports triangles that only come close), so each pair it
    # reports is checked exactly: does an edge of one pass through the other?
    bm.faces.ensure_lookup_table()
    near = [(a, b) for a, b in tree.overlap(tree) if a < b and not set(tris[a]) & set(tris[b])]
    crossing = [(a, b) for a, b in near if edge_through(bm.faces[a], bm.faces[b]) or edge_through(bm.faces[b], bm.faces[a])]
    co = np.array([v.co for v in bm.verts]) * STL_SCALE
    co[:, 2] -= co[:, 2].min()
    tris = np.array(tris)
    a, b, c = co[tris[:, 0]], co[tris[:, 1]], co[tris[:, 2]]
    normals = np.cross(b - a, c - a)
    normals /= np.maximum(np.linalg.norm(normals, axis=1), 1e-12)[:, None]
    record = np.zeros(len(tris), dtype=[("n", "<f4", 3), ("v", "<f4", 9), ("attr", "<u2")])
    record["n"] = normals
    record["v"] = np.concatenate([a, b, c], axis=1)
    with open(path, "wb") as handle:
        handle.write(b"Effigy Engine dragonborn test bust".ljust(80, b" "))
        handle.write(struct.pack("<I", len(tris)))
        handle.write(record.tobytes())
    size = co.max(0) - co.min(0)
    log("STL: %d triangles, %.1f x %.1f x %.1f mm, open or shared-by-more edges: %d, crossing triangle pairs: %d" % (len(tris), size[0], size[1], size[2], open_edges, len(crossing)))
    bm.free()


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    F, origin = sample(dragon)
    F = smin(F, sample_chest(), 0.03)
    F = np.minimum(F, plinth(origin, F.shape))
    verts, quads = surface_nets(F, origin, STEP)
    log("surface nets:", len(verts), "vertices,", len(quads), "quads")
    obj = build_mesh(verts, quads)
    remesh(obj)
    if not PLAIN:
        scales(obj)
    if RENDERS:
        turnaround(obj, os.path.join(OUT_DIR, "dragonborn_turnaround.png"))
        turnaround(obj, os.path.join(OUT_DIR, "dragonborn_face.png"), (("front", 0), ("three-quarter", 35), ("profile", 90)), (0.0, -0.08, 0.02), 1.15)
    export_stl(obj, os.path.join(OUT_DIR, "dragonborn_test.stl"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "dragonborn.blend"))
    log("done")


main()

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

import json
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
# --app <dir>: write the model the app loads (dragonborn.bin and dragonborn.json) into <dir>, usually public/models,
# instead of the test print: no plinth (the app stands the bust on its own pedestal), and lighter
APP_DIR = ARGS[ARGS.index("--app") + 1] if "--app" in ARGS else None
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
    z=[-0.06, 0.0, 0.045, 0.09, 0.133],  # (1.5 cm shorter than first sculpted: it reads better, and fits a tabletop base)
    half_width=[0.068, 0.06, 0.051, 0.042, 0.036],
    top=[0.03, 0.018, 0.009, 0.004, 0.0],
    bottom=[-0.072, -0.072, -0.071, -0.069, -0.068],
    corner=[0.03, 0.027, 0.024, 0.024, 0.026],
)
JAW = dict(
    z=[-0.085, -0.03, 0.027, 0.068, 0.092],
    half_width=[0.064, 0.054, 0.04, 0.028, 0.02],
    top=[-0.06, -0.062, -0.061, -0.06, -0.06],  # inside the muzzle, so the two jaws are one solid
    bottom=[-0.136, -0.12, -0.103, -0.09, -0.083],
    corner=[0.034, 0.03, 0.022, 0.016, 0.012],
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
    # (the frill: a smaller one behind the cheek and one under the jaw's corner)
    ((0.074, -0.012, -0.085), (0.113, 0.0, -0.116), 0.009),
    ((0.066, -0.1, -0.062), (0.098, -0.118, -0.088), 0.0085),
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
    d = smin(d, ellipsoid(Q, (0.068, -0.052, -0.045), (0.028, 0.04, 0.055)), 0.024)
    d = smin(d, segment(Q, (0.046, -0.024, 0.03), (0.068, -0.03, -0.05), 0.009, 0.013), 0.02)
    # The heavy brow plate over each eye
    d = smin(d, ellipsoid(Q, (0.043, 0.026, 0.018), (0.03, 0.011, 0.032), BROW_TURN), 0.014)
    # The ridge down the top of the muzzle, and the nostrils with a raised rim
    d = smin(d, segment(P, (0, 0.035, 0.03), (0, 0.002, 0.117), 0.01, 0.008), 0.015)
    d = smin(d, ellipsoid(P, (0, -0.012, 0.117), (0.027, 0.023, 0.021)), 0.012)
    d = smin(d, ellipsoid(Q, (0.021, -0.002, 0.117), (0.01, 0.007, 0.015), NOSTRIL_TURN), 0.008)
    d = smax(d, -ellipsoid(Q, (0.023, 0.0, 0.123), (0.0085, 0.005, 0.011), NOSTRIL_TURN), 0.003)
    # Sockets cut under the brow, then the eyeballs set deep in them
    d = smax(d, -ellipsoid(Q, EYE, (0.021, 0.0115, 0.018), EYE_TURN), 0.004)
    d = smin(d, np.linalg.norm(Q - (EYE - EYE_TURN[:, 2] * 0.0085), axis=1) - EYE_RADIUS, 0.002)
    # The mouth line: a shallow groove along the lip, cut only into the outer few millimetres
    lip = np.interp(P[:, 2], LIP_Z, LIP_Y)
    groove = np.maximum(np.abs(P[:, 1] - lip) - 0.0016, -d - 0.0035)
    groove = np.maximum(groove, np.maximum(P[:, 2] - 0.15, LIP_Z[0] - P[:, 2]))
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
LIP_Z = [-0.062, -0.03, 0.045, 0.117, 0.15]
LIP_Y = [-0.06, -0.068, -0.07, -0.068, -0.068]


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
    # Large plates over the crown, the brows and the cheeks; small scales down the muzzle
    H = mirrored(head_frame(P))
    near = lambda c, r: np.exp(-np.sum(((H - np.array(c)) / np.array(r)) ** 2, axis=1))
    s = lerp(s, 0.016, smoothstep(0.03, 0.075, H[:, 1]) * headness)
    s = lerp(s, 0.014, near((0.045, 0.028, 0.015), (0.03, 0.016, 0.035)))
    s = lerp(s, 0.014, near((0.062, -0.045, -0.035), (0.03, 0.035, 0.045)))
    muzzle = smoothstep(0.04, 0.09, H[:, 2]) * (1 - near((0.045, 0.028, 0.015), (0.03, 0.016, 0.035)))
    return lerp(s, 0.0065, muzzle * headness)


def tailward(P, N):
    """The way the scales point (their free edge): back along the head, down the neck and chest,
    flattened onto the surface."""
    headness = smoothstep(-0.11, -0.05, P[:, 1])[:, None]
    flow = lerp(np.array([0.0, -1.0, -0.15]), np.array([0.0, -0.35, -1.0]), headness)
    flow = flow - N * np.sum(flow * N, axis=1)[:, None]
    return flow / np.maximum(np.linalg.norm(flow, axis=1), 1e-9)[:, None]


# Scales lie in rows: each is longer along the way it points (its flow, see tailward) than across it, by this
# much. Distances between scales are measured that way, so the cells come out as staggered, overlapping rows
# rather than round cobbles.
ROW_STRETCH = 1.45


def row_distance(delta, flow):
    """Distance measured in rows: lengths along the flow count for less (delta, flow: N x 3)."""
    along = np.sum(delta * flow, axis=-1)
    return np.sqrt(np.maximum(np.sum(delta * delta, axis=-1) - along * along, 0) + (along / ROW_STRETCH) ** 2)


def scatter(points, spacing, flow, rng):
    """Sites spread over the surface roughly `spacing` apart across their rows (greedy, in shuffled batches)."""
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
            keep = []
            for b in batch:
                near = tree.find_range(points[b], 0.9 * spacing[b] * ROW_STRETCH)
                if not near or np.all(row_distance(np.array([c for c, _, _ in near]) - points[b], flow[b]) > 0.9 * spacing[b]):
                    keep.append(b)
        else:
            keep = list(batch)
        chosen = []
        for b in keep:
            if chosen and np.any(row_distance(points[chosen] - points[b], flow[b]) < 0.9 * spacing[b]):
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
    # (the spines and the crest's thin blades too: scales cut into a blade crossed through it)
    for points, list_, flat in ((H, SPINES, SPINE_FLAT), (head_frame(P), CREST, CREST_FLAT)):
        for root, tip, radius in list_:
            root, tip = np.array(root, float), np.array(tip, float)
            axis = tip - root
            h = np.clip((points - root) @ axis / (axis @ axis), 0, 1)
            clearance = spine(points, root, tip, radius, flat)
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
    flow = tailward(P, N)
    sites, site_size = scatter(P[candidates], size[candidates], flow[candidates], rng)
    log("scales:", len(sites))
    tree = KDTree(len(sites))
    for i, p in enumerate(sites):
        tree.insert(p, i)
    tree.balance()
    # The nearest two scales in rows, from the eight nearest as the crow flies
    near = np.zeros((n, 8), int)
    for i, p in enumerate(P):
        found = tree.find_n(p, 8)
        near[i, : len(found)] = [j for _, j, _ in found]
    gaps = row_distance(sites[near] - P[:, None, :], flow[:, None, :])
    order = np.argsort(gaps, axis=1)
    pick = np.arange(n)
    owner = near[pick, order[:, 0]]
    d1, d2 = gaps[pick, order[:, 0]], gaps[pick, order[:, 1]]
    s = site_size[owner]
    edge = (d2 - d1) / 2
    # A hierarchy, as a sculptor would carve them: the large plates of the crown, brows, cheeks, neck and chest are
    # cut boldly and stand proud of each other; the small scales of the muzzle and face are cut finer and lie
    # flatter, so they read as texture under the big forms instead of all competing at once
    bold = smoothstep(0.007, 0.015, s)
    groove = 1 - smoothstep(0.0, lerp(0.06, 0.085, bold) * s, edge)
    # Each scale rises toward its free edge, so it seems to lie over the next one, and is slightly domed
    along = np.sum((P - sites[owner]) * flow, axis=1) / (s * ROW_STRETCH)
    plate = lerp(0.06, 0.18, bold) * s * np.clip(along + 0.5, 0, 1.1) + lerp(0.015, 0.03, bold) * s * np.clip(1 - (d1 / (0.7 * s)) ** 2, 0, 1)
    skin = lerp(plate, -lerp(0.025, 0.055, bold) * s, groove)

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

    # For the paint, from the same cells the scales were cut from (so the colour and the carving agree): a tone for
    # each scale, its own slight shade, and how pale the underside is, the throat's scutes and under the jaw, as on a
    # reptile's belly. Kept as a colour on the mesh, which the decimation for the app carries over (see export_app).
    tone = rng.random(len(sites))[owner]
    under_jaw = smoothstep(-0.3, -0.75, N[:, 1]) * smoothstep(0.07, 0.04, np.abs(Hf[:, 0])) * smoothstep(-0.05, -0.09, Hf[:, 1]) * smoothstep(-0.1, -0.04, Hf[:, 2])
    throat = smoothstep(0.0, 0.4, N[:, 2]) * smoothstep(0.06, 0.035, x) * smoothstep(-0.32, -0.26, y) * smoothstep(-0.03, -0.09, y)
    belly = np.maximum(np.maximum(front, throat), under_jaw) * (1 - on_horn) * eye
    data = mesh.color_attributes.new("paint", "FLOAT_COLOR", "POINT")
    data.data.foreach_set("color", np.stack([tone, belly, np.zeros(n), np.ones(n)], 1).ravel())
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


# ---------------------------------------------------------------------------------------------------
# The model the app loads (with --app): the bust decimated to a fifth of its triangles, which still holds the
# scales at the size the app shows it, in the app's head units, with what its paint needs to tell the parts apart.
#
# dragonborn.bin (little-endian): uint32 vertexCount, uint32 triangleCount, then float32 x,y,z per vertex,
# float32 shade per vertex (how far it lies in a hollow, -1..1: the grooves between scales), float32 along per
# vertex (0 at the root of a horn or spine, 1 at its tip), uint8 part per vertex (0 scales, 1 horn, 2 cheek spine,
# 3 crest, 4 eye: what the shape controls move), uint8 tone and uint8 belly per vertex (0..255: each scale's own
# shade, and how pale the underside is, for the paint), uint32 a,b,c per triangle, and a uint8 region per triangle
# (0 scales, 1 horn, spine or crest, 2 eye: what the paint colours).
# dragonborn.json: what the app needs to know about it (see src/dragonborn.ts).

APP_RATIO = 0.2
APP_UNITS = 5  # the app's head units are metres x 5 with the same origin and axes (see src/headMesh.ts)
MODEL_VERSION = 3


def outgrowth_regions(P):
    """Which region each point (chest frame) is in: 1 on the horns, cheek spines and crest, 2 on the eyeballs, 0
    elsewhere; which part (see the file format above); and how far along its horn or spine it is."""
    H = head_frame(P)
    Q = mirrored(H)
    region = np.zeros(len(P), np.uint8)
    part = np.zeros(len(P), np.uint8)
    along = np.zeros(len(P))
    horn = np.array(HORN)
    radii = np.array(HORN_RADII)
    idx = np.nonzero(np.all((Q > horn.min(0) - 0.04) & (Q < horn.max(0) + 0.04), axis=1))[0]
    for start in range(0, len(idx), 100000):
        part = idx[start : start + 100000]
        gaps = np.linalg.norm(Q[part, None, :] - horn[None, :, :], axis=2)
        nearest = np.argmin(gaps, axis=1)
        on = gaps[np.arange(len(part)), nearest] - radii[nearest] < 0.003
        region[part[on]] = 1
        # (how far along, continuously: projected onto the horn's path either side of its nearest point, not that
        # point's number, whose steps made the shape controls change in jumps from one ring to the next)
        best = nearest.astype(float)
        best_gap = np.full(len(part), np.inf)
        for step in (-1, 0):
            a0 = np.clip(nearest + step, 0, len(horn) - 2)
            seg = horn[a0 + 1] - horn[a0]
            t = np.clip(np.sum((Q[part] - horn[a0]) * seg, axis=1) / np.sum(seg * seg, axis=1), 0, 1)
            gap = np.linalg.norm(Q[part] - (horn[a0] + t[:, None] * seg), axis=1)
            closer = gap < best_gap
            best[closer], best_gap[closer] = (a0 + t)[closer], gap[closer]
        along[part[on]] = best[on] / (len(horn) - 1)
    part = np.where(region == 1, 1, 0).astype(np.uint8)
    for points, list_, flat, kind in ((Q, SPINES, SPINE_FLAT, 2), (H, CREST, CREST_FLAT, 3)):
        for root, tip, radius in list_:
            root, tip = np.array(root, float), np.array(tip, float)
            on = spine(points, root, tip, radius, flat) < 0.002
            axis = tip - root
            region[on] = 1
            part[on] = kind
            along[on] = np.clip((points[on] - root) @ axis / (axis @ axis), 0, 1)
    centre = EYE - EYE_TURN[:, 2] * 0.0085
    eye = np.linalg.norm(Q - centre, axis=1) < EYE_RADIUS + 0.0007
    region[eye] = 2
    part[eye] = 4
    return region, part, along


def to_units(point, side=1):
    """A point in the head frame (right side), mirrored to `side`, in the app's head units."""
    return (HEAD_AT + HEAD_SCALE * np.array(point, float) * np.array([side, 1, 1])) * APP_UNITS


def export_app(obj, out_dir):
    decimate = obj.modifiers.new("decimate", "DECIMATE")
    decimate.ratio = APP_RATIO
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_apply(modifier=decimate.name)
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=list(bm.faces))
    bm.to_mesh(obj.data)
    bm.free()
    mesh = obj.data
    n = len(mesh.vertices)
    co = np.zeros(n * 3)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    tris = np.zeros(len(mesh.polygons) * 3, np.int64)
    mesh.polygons.foreach_get("vertices", tris)
    tris = tris.reshape(-1, 3)
    no = np.zeros(n * 3)
    mesh.vertex_normals.foreach_get("vector", no)
    P = np.stack([co[:, 0], co[:, 2], -co[:, 1]], 1)
    N = no.reshape(-1, 3)
    N = np.stack([N[:, 0], N[:, 2], -N[:, 1]], 1)
    # (the paint's tone and belly, carried over the decimation: see scales)
    paint = np.zeros(n * 4)
    mesh.color_attributes["paint"].data.foreach_get("color", paint)
    paint = paint.reshape(-1, 4)

    # How far each vertex lies in a hollow: the offset to the mean of its neighbours, along its normal, for the
    # length of its edges (positive in the grooves between scales)
    edges = np.concatenate([tris[:, [0, 1]], tris[:, [1, 2]], tris[:, [2, 0]]])
    total = np.zeros((n, 3))
    count = np.zeros(n)
    length = np.zeros(n)
    for a, b in ((edges[:, 0], edges[:, 1]), (edges[:, 1], edges[:, 0])):
        np.add.at(total, a, P[b])
        np.add.at(count, a, 1)
        np.add.at(length, a, np.linalg.norm(P[b] - P[a], axis=1))
    count = np.maximum(count, 1)
    hollow = np.sum((total / count[:, None] - P) * N, axis=1) / np.maximum(length / count, 1e-9)
    shade = np.clip(hollow / np.percentile(np.abs(hollow), 98), -1, 1)

    region, part, along = outgrowth_regions(P)
    # A triangle is in a region when at least two of its corners are
    votes = region[tris]
    tri_region = np.zeros(len(tris), np.uint8)
    for r in (1, 2):
        tri_region[(votes == r).sum(1) >= 2] = r

    positions = (P * APP_UNITS).astype("<f4")
    with open(os.path.join(out_dir, "dragonborn.bin"), "wb") as handle:
        handle.write(struct.pack("<II", n, len(tris)))
        handle.write(positions.tobytes())
        handle.write(shade.astype("<f4").tobytes())
        handle.write(along.astype("<f4").tobytes())
        handle.write(part.tobytes())
        handle.write(np.round(np.clip(paint[:, 0], 0, 1) * 255).astype(np.uint8).tobytes())
        handle.write(np.round(np.clip(paint[:, 1], 0, 1) * 255).astype(np.uint8).tobytes())
        handle.write(tris.astype("<u4").tobytes())
        handle.write(tri_region.tobytes())
    centre = EYE - EYE_TURN[:, 2] * 0.0085
    eyes = []
    for side in (1, -1):
        c = HEAD_AT + HEAD_SCALE * centre * np.array([side, 1, 1])
        look = EYE_TURN[:, 2] * np.array([side, 1, 1])
        eyes.append({"centre": (c * APP_UNITS).round(5).tolist(), "look": look.round(5).tolist(), "radius": round(EYE_RADIUS * HEAD_SCALE * APP_UNITS, 5)})
    manifest = {
        "name": "dragonborn",
        "version": MODEL_VERSION,
        "source": "tools/sculpt_dragonborn.py",
        "units": "head units (metres x 5): origin between the human bust's eyes, y up, the face toward +z",
        "vertices": n,
        "triangles": len(tris),
        "eyes": eyes,
        # the lowest point of the lower jaw, for framing the face
        "chin": round(float(HEAD_AT[1] + HEAD_SCALE * min(JAW["bottom"])) * APP_UNITS, 5),
        # The head's own frame, which the shape controls work in: head = (point / units - headAt) / headScale
        "frame": {"headAt": (HEAD_AT * APP_UNITS).round(5).tolist(), "headScale": HEAD_SCALE, "units": APP_UNITS},
        # Where each horn, cheek spine and crest spine starts and which way it grows (in head units), for scaling and
        # turning them about their roots
        "outgrowths": [
            {"part": kind, "root": (to_units(root, side)).round(5).tolist(), "tip": (to_units(tip, side)).round(5).tolist()}
            for kind, list_ in ((1, [(HORN[0], HORN[-1], 0)]), (2, SPINES), (3, CREST))
            for root, tip, _ in list_
            for side in ((1, -1) if kind != 3 else (1,))
        ],
    }
    with open(os.path.join(out_dir, "dragonborn.json"), "w") as handle:
        json.dump(manifest, handle, indent=2)
        handle.write("\n")
    log("app model: %d vertices, %d triangles (%d horn, %d eye)" % (n, len(tris), (tri_region == 1).sum(), (tri_region == 2).sum()))


def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    os.makedirs(OUT_DIR, exist_ok=True)
    F, origin = sample(dragon)
    F = smin(F, sample_chest(), 0.03)
    if not APP_DIR:
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
    if APP_DIR:
        export_app(obj, APP_DIR)
        log("done")
        return
    export_stl(obj, os.path.join(OUT_DIR, "dragonborn_test.stl"))
    bpy.ops.wm.save_as_mainfile(filepath=os.path.join(OUT_DIR, "dragonborn.blend"))
    log("done")


main()

"""Generates the horn and tusk assets used by Effigy Engine.

    python tools/export_horns.py public/models/horns

Each asset is a tapered, ridged shape swept along a curve, normalised to a length of 1 with its base
at the origin and growing along +Y. Horns curve toward +X (the right-hand side of the head) and back
toward -Z; the app mirrors them for the left. The shapes are original to this project (public domain).

File format (little-endian): uint32 vertexCount, uint32 triangleCount, float32 xyz per vertex,
float32 t per vertex (0 at the base, 1 at the tip, used for colouring), uint32 abc per triangle.
"""

import math
import struct
import sys

SIDES = 20
RINGS = 70


def catmull_rom(points, samples):
    """A smooth path through the given points (uniform Catmull-Rom), as `samples` + 1 positions."""
    padded = [points[0]] + points + [points[-1]]
    segments = len(points) - 1
    out = []
    for i in range(samples + 1):
        u = i / samples * segments
        seg = min(int(u), segments - 1)
        f = u - seg
        p0, p1, p2, p3 = padded[seg], padded[seg + 1], padded[seg + 2], padded[seg + 3]
        out.append(
            tuple(
                0.5
                * (
                    2 * p1[k]
                    + (-p0[k] + p2[k]) * f
                    + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * f * f
                    + (-p0[k] + 3 * p1[k] - 3 * p2[k] + p3[k]) * f * f * f
                )
                for k in range(3)
            )
        )
    return out


def sub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def add(a, b):
    return (a[0] + b[0], a[1] + b[1], a[2] + b[2])


def scale(a, s):
    return (a[0] * s, a[1] * s, a[2] * s)


def dot(a, b):
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def normalize(a):
    length = math.sqrt(dot(a, a)) or 1.0
    return scale(a, 1 / length)


def smoothstep(edge0, edge1, x):
    t = min(1.0, max(0.0, (x - edge0) / (edge1 - edge0)))
    return t * t * (3 - 2 * t)


def sweep(points, base_radius, tip_radius, taper, ridge_amp=0.0, ridge_count=0.0, spiral_amp=0.0, spiral_lobes=2, spiral_turns=0.0, flatten=1.0):
    path = catmull_rom(points, RINGS)
    # Normalise so the path is 1 long
    length = sum(math.sqrt(dot(sub(path[i + 1], path[i]), sub(path[i + 1], path[i]))) for i in range(RINGS))
    path = [scale(p, 1 / length) for p in path]
    tangents = []
    for i in range(RINGS + 1):
        a = path[max(0, i - 1)]
        b = path[min(RINGS, i + 1)]
        tangents.append(normalize(sub(b, a)))

    # Parallel-transport frames so the cross-section does not spin along the curve
    normal = normalize(cross(tangents[0], (0.0, 0.0, 1.0))) if abs(tangents[0][2]) < 0.9 else (1.0, 0.0, 0.0)
    frames = []
    for i in range(RINGS + 1):
        if i > 0:
            axis = cross(tangents[i - 1], tangents[i])
            if dot(axis, axis) > 1e-12:
                axis = normalize(axis)
                angle = math.acos(max(-1.0, min(1.0, dot(tangents[i - 1], tangents[i]))))
                c, s = math.cos(angle), math.sin(angle)
                normal = add(add(scale(normal, c), scale(cross(axis, normal), s)), scale(axis, dot(axis, normal) * (1 - c)))
        normal = normalize(sub(normal, scale(tangents[i], dot(normal, tangents[i]))))
        frames.append((normal, cross(tangents[i], normal)))

    positions, ts = [], []
    for i in range(RINGS + 1):
        t = i / RINGS
        radius = (base_radius - tip_radius) * (1 - t) ** taper + tip_radius * (1 - t) ** 0.5
        radius *= 1 - 0.85 * smoothstep(0.92, 1.0, t)
        rings = 1 + ridge_amp * math.sin(2 * math.pi * ridge_count * t) * smoothstep(0.02, 0.12, t) * (1 - smoothstep(0.85, 1.0, t))
        n, b = frames[i]
        for j in range(SIDES):
            a = 2 * math.pi * j / SIDES
            lobes = 1 + spiral_amp * math.sin(spiral_lobes * a + spiral_turns * 2 * math.pi * t) * smoothstep(0.02, 0.15, t)
            r = radius * rings * lobes
            offset = add(scale(n, math.cos(a) * r * flatten), scale(b, math.sin(a) * r))
            positions.append(add(path[i], offset))
            ts.append(t)
    # Caps: one vertex at the centre of each end
    base_centre = len(positions)
    positions.append(path[0])
    ts.append(0.0)
    tip_centre = len(positions)
    positions.append(path[-1])
    ts.append(1.0)

    triangles = []
    for i in range(RINGS):
        for j in range(SIDES):
            a = i * SIDES + j
            b = i * SIDES + (j + 1) % SIDES
            c = (i + 1) * SIDES + j
            d = (i + 1) * SIDES + (j + 1) % SIDES
            triangles += [(a, c, b), (b, c, d)]
    for j in range(SIDES):
        a, b = j, (j + 1) % SIDES
        triangles.append((base_centre, a, b))
        c, d = RINGS * SIDES + j, RINGS * SIDES + (j + 1) % SIDES
        triangles.append((tip_centre, d, c))

    # Make every triangle face outward: the signed volume of the whole mesh must be positive
    volume = 0.0
    for a, b, c in triangles:
        volume += dot(positions[a], cross(positions[b], positions[c])) / 6
    if volume < 0:
        triangles = [(a, c, b) for a, b, c in triangles]
    return positions, ts, triangles


# Each style: control points (the horn grows up +Y, curving toward +X and back toward -Z) and cross-section settings
STYLES = {
    # A heavy spiral that sweeps back, then curls down and forward around the ear
    "ram": dict(
        points=[(0, 0, 0), (0.25, 0.3, -0.05), (0.62, 0.5, -0.3), (0.88, 0.25, -0.72), (0.74, -0.2, -0.95), (0.38, -0.36, -0.72), (0.26, -0.12, -0.4)],
        base_radius=0.11, tip_radius=0.012, taper=0.8, ridge_amp=0.07, ridge_count=11, flatten=1.2,
    ),
    # A long smooth arc that sweeps back over the head
    "goat": dict(
        points=[(0, 0, 0), (0.06, 0.5, -0.02), (0.0, 1.0, -0.28), (-0.3, 1.3, -0.7)],
        base_radius=0.075, tip_radius=0.008, taper=0.9, ridge_amp=0.05, ridge_count=14, flatten=1.0,
    ),
    # Out and then up, with a blunt rounded base
    "bull": dict(
        points=[(0, 0, 0), (0.42, 0.08, 0), (0.82, 0.32, 0.02), (0.92, 0.9, 0.08)],
        base_radius=0.095, tip_radius=0.01, taper=0.85, ridge_amp=0.025, ridge_count=6, flatten=1.0,
    ),
    # Swept back with deep ridges and a slight outward flare
    "demon": dict(
        points=[(0, 0, 0), (0.12, 0.45, -0.1), (0.2, 0.85, -0.45), (0.06, 1.12, -1.0)],
        base_radius=0.1, tip_radius=0.008, taper=1.0, ridge_amp=0.12, ridge_count=10, flatten=1.15,
    ),
    # Nearly straight and tall, with spiralling ridges
    "antelope": dict(
        points=[(0, 0, 0), (0.08, 0.4, -0.02), (0.2, 0.8, -0.05), (0.18, 1.3, -0.12)],
        base_radius=0.06, tip_radius=0.006, taper=0.7, ridge_amp=0.03, ridge_count=9, spiral_amp=0.14, spiral_lobes=2, spiral_turns=5, flatten=1.0,
    ),
    # Short thick nubs
    "stubby": dict(
        points=[(0, 0, 0), (0.05, 0.3, -0.02), (0.02, 0.62, -0.08)],
        base_radius=0.16, tip_radius=0.02, taper=1.1, ridge_amp=0.04, ridge_count=4, flatten=1.0,
    ),
    # An orc's tusk: thick at the root, curving up and a little outward, ending in a blunt point
    "tusk": dict(
        points=[(0, 0, 0), (0.02, 0.5, 0.02), (0.1, 0.95, 0.0)],
        base_radius=0.2, tip_radius=0.025, taper=0.9, ridge_amp=0.03, ridge_count=3, flatten=1.0,
    ),
}


def write(path, positions, ts, triangles):
    with open(path, "wb") as handle:
        handle.write(struct.pack("<II", len(positions), len(triangles)))
        for p in positions:
            handle.write(struct.pack("<3f", *p))
        for t in ts:
            handle.write(struct.pack("<f", t))
        for tri in triangles:
            handle.write(struct.pack("<3I", *tri))


if __name__ == "__main__":
    out = sys.argv[1]
    for name, spec in STYLES.items():
        positions, ts, triangles = sweep(**spec)
        write(f"{out}/{name}.bin", positions, ts, triangles)
        print(f"{name}: {len(positions)} vertices, {len(triangles)} triangles")

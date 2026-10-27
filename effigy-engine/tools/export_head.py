"""Exports the base head used by Effigy Engine from Blender Studio's CC0 Human Base Meshes bundle.

Run with the bundle open in Blender (background mode, auto-run of embedded scripts disabled):

    blender -b human_base_meshes_bundle.blend --disable-autoexec --python tools/export_head.py -- public/models

What it does to GEO-head_sculpting_realistic:
  1. applies the multires modifier (level 1) and the object's transform, then fills out the body: cuts at the widest shoulder line and extrudes rings for the shoulders and chest below it,
  2. subdivides once more with Catmull-Clark (about 60,000 vertices), which keeps the sculpt's shape
     and gives the app enough vertices to carry sharper facial structure,
  2b. wraps those rings onto the bundle's sculpted male and female bodies (cut like a classic bust: flat
     through the deltoids, level below the chest), so the chest has real pectorals or a real bust. The
     male wrap is written to head.bin and the female wrap to feminine.bin (same vertices, other positions),
     then cut flat at each side, slanting in from the deltoid to the base,
  2c. gives feminine.bin a feminine face: the broad male-to-female change between the bundle's two body
     heads (brow, jaw, chin, cheeks), added to this head with the eyes and ears locked,
  3. turns the axes into the app's (Y up, face toward +Z),
  4. caps the open base so the bust is a closed solid, and triangulates,
  5. writes head.bin: uint32 vertexCount, uint32 triangleCount, float32 xyz per vertex, uint32 abc per triangle,
     and feminine.bin: uint32 vertexCount, float32 xyz per vertex.

The app moves the origin to the midpoint between the eyes and scales it (see src/headMesh.ts).
"""

import math
import struct
import sys

import bmesh
import bpy
from mathutils import Matrix, Vector, interpolate
from mathutils.bvhtree import BVHTree

out_dir = sys.argv[-1]
src = bpy.data.objects["GEO-head_sculpting_realistic"]

# 1. The head as it looks with the multires level applied, in world space
depsgraph = bpy.context.evaluated_depsgraph_get()
mesh = bpy.data.meshes.new_from_object(src.evaluated_get(depsgraph))
mesh.transform(src.matrix_world)

# 1b. Fill out the body. The sculpt is a neck and trapezius yoke that narrows to a small closed bottom,
# so cut it at its widest shoulder line and build the deltoids and upper chest below with a few rings
# that widen, deepen and then drop straight down (the vertical cut of a classic bust).
HEAD_CENTRE_X = 1.7857
bm = bmesh.new()
bm.from_mesh(mesh)
lowest = min(v.co.z for v in bm.verts)
cut_z = lowest + 0.075
bmesh.ops.bisect_plane(bm, geom=list(bm.verts) + list(bm.edges) + list(bm.faces), plane_co=(0, 0, cut_z), plane_no=(0, 0, 1), clear_inner=True)
ring0 = {v for e in bm.edges if e.is_boundary for v in e.verts}
centre = sum((v.co for v in ring0), Vector()) / len(ring0)
centre.x = HEAD_CENTRE_X
# Where the bust ends: this far below the eyes, under the pectorals and the bust
EYE_Z = 0.7659
BOTTOM = 0.42
# How far the feminine face's offsets are smoothed (passes over neighbouring vertices): enough to drop
# feature-sized mismatches (a nostril, a lid edge), not so much that the jaw and brow forms are lost
FACE_SMOOTHING = 60
# (drop below the cut in metres, width scale, depth scale), each relative to the cut ring. The rings only
# need to be roughly the right shape: step 2b wraps them onto a sculpted body.
PROFILE = [(0.0, 1.0, 1.0), (0.03, 1.22, 1.25), (0.06, 1.45, 1.5), (0.09, 1.58, 1.65), (0.12, 1.62, 1.72), (0.15, 1.6, 1.75), (0.18, 1.55, 1.75), (1.0, 1.55, 1.75)]
depth = cut_z - (EYE_Z - BOTTOM)


def profile(drop):
    for (d0, x0, y0), (d1, x1, y1) in zip(PROFILE, PROFILE[1:]):
        if drop <= d1:
            t = (drop - d0) / (d1 - d0)
            return (x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)
    return PROFILE[-1][1:]


RINGS = [(depth * (n + 1) / 16, *profile(depth * (n + 1) / 16)) for n in range(16)]
previous = (1.0, 1.0)
extended = set(ring0)
for index, (drop, sx, sy) in enumerate(RINGS):
    boundary = [e for e in bm.edges if e.is_boundary]
    made = bmesh.ops.extrude_edge_only(bm, edges=boundary)
    fresh = {g for g in made["geom"] if isinstance(g, bmesh.types.BMVert)}
    for v in fresh:
        rel = v.co - centre
        v.co.x = centre.x + rel.x * sx / previous[0]
        v.co.y = centre.y + rel.y * sy / previous[1] - 0.004
        v.co.z = cut_z - drop
    previous = (sx, sy)
    extended |= fresh
for _ in range(10):
    bmesh.ops.smooth_vert(bm, verts=list(extended), factor=0.5, use_axis_x=True, use_axis_y=True, use_axis_z=True)
bm.to_mesh(mesh)
bm.free()
mesh.update()

# 2. One more level of Catmull-Clark subdivision
temp = bpy.data.objects.new("subdivide", mesh)
bpy.context.scene.collection.objects.link(temp)
modifier = temp.modifiers.new("subsurf", "SUBSURF")
modifier.levels = 1
modifier.render_levels = 1
modifier.boundary_smooth = "PRESERVE_CORNERS"
bpy.context.view_layer.update()
depsgraph = bpy.context.evaluated_depsgraph_get()
mesh = bpy.data.meshes.new_from_object(temp.evaluated_get(depsgraph))

# 2b. Wrap the shoulders and chest onto a sculpted body. Each body is moved so its eyes sit on this head's
# eyes (the three heads are the same size: 64-66 mm between the eyes), its own head is cut away, and it is
# cut level a little below the bottom of the bust (so the lowest ring has surface to land on). Every vertex
# below the jaw then moves onto that body, fully from the base of the neck down. Last, the wrapped bust is
# cut flat at each side, through the deltoid and slanting in to the base.
def bust_target(name, shoulder_cut, bottom_cut):
    body = bpy.data.objects[name]
    eyes = [bpy.data.objects[f"{name}.eye.{side}"] for side in "LR"]
    eye_mid = sum((e.matrix_world @ v.co for e in eyes for v in e.data.vertices), Vector()) / sum(len(e.data.vertices) for e in eyes)
    head_mid = Vector((HEAD_CENTRE_X, -0.1251, EYE_Z))
    target = bpy.data.meshes.new_from_object(body.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    target.transform(Matrix.Translation(head_mid - eye_mid) @ body.matrix_world)
    tb = bmesh.new()
    tb.from_mesh(target)
    # Each side will be one flat cut, like a sculpted bust: through the deltoid at the top of the shoulder
    # (20 cm below the eyes) and slanting in to the bottom of the bust, so below the armpit it runs inside
    # the torso and nothing of the arm is left (a vertical cut leaves an arm stump with a notch beneath it)
    top, bottom = EYE_Z - 0.20, EYE_Z - BOTTOM
    sides = []
    for sign in (1, -1):
        point = Vector((HEAD_CENTRE_X + sign * shoulder_cut, 0, top))
        normal = Vector((sign * (top - bottom), 0, bottom_cut - shoulder_cut)).normalized()
        sides.append((point, normal))
    cuts = [((0, 0, EYE_Z - 0.12), (0, 0, 1)), ((0, 0, EYE_Z - BOTTOM - 0.03), (0, 0, -1))]
    for co, no in cuts:
        bmesh.ops.bisect_plane(tb, geom=list(tb.verts) + list(tb.edges) + list(tb.faces), plane_co=co, plane_no=no, clear_outer=True)
    # The torso is the largest connected piece; stray bits of hands or hair are dropped
    pieces = []
    seen = set()
    for v in tb.verts:
        if v.index in seen:
            continue
        stack = [v]
        piece = []
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
    bmesh.ops.delete(tb, geom=[v for piece in pieces[:-1] for v in piece], context="VERTS")
    # The arms stay on the target: below the armpits the wrap pushes each vertex straight out from the
    # centre line, so it lands on the torso before the arm. The side cuts are applied to the wrapped bust
    # itself afterwards (see cut_sides), which keeps them exactly flat.
    tree = BVHTree.FromBMesh(tb)
    tb.free()
    return tree, sides


def neck_weight(z):
    t = min(1.0, max(0.0, ((EYE_Z - 0.15) - z) / 0.07))
    return t * t * (3 - 2 * t)


def wrap(tree, co):
    # Around the neck and shoulders: the nearest point on the body. Below the armpits that bunches the
    # rings into the fold under the pectorals, so there each vertex is pushed straight out from the torso's
    # centre line instead, which keeps the rings level and evenly spaced.
    near = tree.find_nearest(co)[0]
    t = min(1.0, max(0.0, ((EYE_Z - 0.26) - co.z) / 0.05))
    if t == 0:
        return near
    origin = Vector((HEAD_CENTRE_X, centre.y, co.z))
    out = Vector((co.x - origin.x, co.y - origin.y, 0))
    hit = tree.ray_cast(origin, out.normalized(), 1.0)[0] if out.length > 1e-6 else None
    return near if hit is None else near.lerp(hit, t * t * (3 - 2 * t))


# (Measured: below the armpits the male torso's sides are 12-17 cm from the centre line and the female's
# 10-14 cm, narrowest at the front of the chest, so the planes end just inside them.)
male, male_sides = bust_target("GEO-body_male_realistic", 0.205, 0.12)
female, female_sides = bust_target("GEO-body_female_realistic", 0.19, 0.10)
feminine = []
for v in mesh.vertices:
    w = neck_weight(v.co.z)
    m = wrap(male, v.co) if w > 0 else v.co
    f = wrap(female, v.co) if w > 0 else v.co
    feminine.append(v.co.lerp(f, w))
    v.co = v.co.lerp(m, w)
# The bottom ring sits exactly on the cut, so the underside is flat
floor = EYE_Z - BOTTOM
for i, v in enumerate(mesh.vertices):
    if v.co.z < floor + 0.004:
        v.co.z = floor
        feminine[i].z = floor


# Even out the wrapped vertices a little (nearest-point snapping bunches them at creases), keeping the
# flat underside flat
def relax(positions, weights, passes):
    neighbours = [[] for _ in mesh.vertices]
    for e in mesh.edges:
        a, b = e.vertices
        neighbours[a].append(b)
        neighbours[b].append(a)
    for _ in range(passes):
        fresh = list(positions)
        for i, w in enumerate(weights):
            if w <= 0 or not neighbours[i]:
                continue
            mean = sum((positions[j] for j in neighbours[i]), Vector()) / len(neighbours[i])
            moved = positions[i].lerp(mean, 0.5 * w)
            if positions[i].z <= floor + 1e-6:
                moved.z = floor
            fresh[i] = moved
        positions[:] = fresh


weights = [neck_weight(v.co.z) for v in mesh.vertices]
masculine = [v.co.copy() for v in mesh.vertices]
relax(masculine, weights, 4)
relax(feminine, weights, 4)


# The flat side cuts: anything beyond a side plane is pressed onto it
def cut_sides(positions, sides):
    for i, co in enumerate(positions):
        for point, normal in sides:
            beyond = (co - point).dot(normal)
            if beyond > 0:
                co = co - normal * beyond
        positions[i] = co


cut_sides(masculine, male_sides)
cut_sides(feminine, female_sides)
for v, co in zip(mesh.vertices, masculine):
    v.co = co
mesh.update()


# 2c. A feminine face. The bundle's male and female bodies share one topology, so the same point on each
# head can be compared: the difference is the sculptor's own male-to-female change (a softer brow, a
# narrower jaw and smaller chin, fuller cheeks), free of every other way the heads differ. Both heads are
# moved and scaled so their eyes sit on this head's eyes; each vertex here finds its nearest point on the
# male head and takes the offset to the matching point on the female one. The offsets are then smoothed
# across the surface so only the broad forms come across, and the eyes and ears are locked so the lids
# still fit the eyeballs.
EYE_HALF = 0.03214
EYE_Y = -0.1251


def aligned_head(name):
    body = bpy.data.objects[name]
    eyes = [bpy.data.objects[f"{name}.eye.{side}"] for side in "LR"]
    centres = [sum((e.matrix_world @ v.co for v in e.data.vertices), Vector()) / len(e.data.vertices) for e in eyes]
    eye_mid = (centres[0] + centres[1]) / 2
    scale = 2 * EYE_HALF / (centres[0] - centres[1]).length
    head = bpy.data.meshes.new_from_object(body.evaluated_get(bpy.context.evaluated_depsgraph_get()))
    head.transform(Matrix.Translation(Vector((HEAD_CENTRE_X, EYE_Y, EYE_Z))) @ Matrix.Scale(scale, 4) @ Matrix.Translation(-eye_mid) @ body.matrix_world)
    return head


male_head = aligned_head("GEO-body_male_realistic")
female_head = aligned_head("GEO-body_female_realistic")
assert len(male_head.vertices) == len(female_head.vertices)
male_tree = BVHTree.FromPolygons([v.co for v in male_head.vertices], [p.vertices for p in male_head.polygons])


def smoothstep(t):
    t = min(1.0, max(0.0, t))
    return t * t * (3 - 2 * t)


def face_weight(co):
    dx = abs(co.x - HEAD_CENTRE_X)
    eye = min((co - Vector((HEAD_CENTRE_X + s * EYE_HALF, EYE_Y, EYE_Z))).length for s in (-1, 1))
    lids = smoothstep((eye - 0.013) / 0.01)
    ear = math.exp(-(((dx - 0.088) / 0.027) ** 2) - (((co.z - (EYE_Z - 0.016)) / 0.06) ** 2) - (((co.y + 0.035) / 0.048) ** 2))
    height = smoothstep((co.z - (EYE_Z - 0.15)) / 0.04)
    return lids * (1 - ear) * height


offsets = []
for v in mesh.vertices:
    if v.co.z < EYE_Z - 0.17:
        offsets.append(Vector())
        continue
    location, _, face, _ = male_tree.find_nearest(v.co)
    corners = male_head.polygons[face].vertices
    weights = interpolate.poly_3d_calc([male_head.vertices[c].co for c in corners], location)
    offsets.append(sum((female_head.vertices[c].co * w for c, w in zip(corners, weights)), Vector()) - location)
neighbours = [[] for _ in mesh.vertices]
for e in mesh.edges:
    a, b = e.vertices
    neighbours[a].append(b)
    neighbours[b].append(a)
for _ in range(FACE_SMOOTHING):
    offsets = [offsets[i].lerp(sum((offsets[j] for j in n), Vector()) / len(n), 0.5) if n else offsets[i] for i, n in enumerate(neighbours)]
for i, v in enumerate(mesh.vertices):
    feminine[i] = feminine[i] + offsets[i] * face_weight(v.co)
moved = [offsets[i].length * face_weight(v.co) for i, v in enumerate(mesh.vertices)]
print("feminine face: largest move %.1f mm, mean %.1f mm" % (1000 * max(moved), 1000 * sum(moved) / len(moved)))

# 3. Blender is Z-up with the face toward -Y; the app is Y-up with the face toward +Z.
mesh.transform(Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))))
feminine = [Vector((co.x, co.z, -co.y)) for co in feminine]

# 4. Cap the open base and triangulate
bm = bmesh.new()
bm.from_mesh(mesh)
# First a narrow inset ring (3 mm) on the underside, so the big cap does not bend the normals of the bust's
# bottom edge and shade it dark and ragged
boundary = [e for e in bm.edges if e.is_boundary]
ring = {v for e in boundary for v in e.verts}
centre_m = sum((v.co for v in ring), Vector()) / len(ring)
centre_f = sum((feminine[v.index] for v in ring), Vector()) / len(ring)
made = bmesh.ops.extrude_edge_only(bm, edges=boundary)
bm.verts.index_update()
for v in (g for g in made["geom"] if isinstance(g, bmesh.types.BMVert)):
    source = next(e.other_vert(v) for e in v.link_edges if e.other_vert(v) in ring)
    inward = Vector((centre_m.x - v.co.x, 0, centre_m.z - v.co.z))
    v.co += inward.normalized() * 0.003
    fem = feminine[source.index].copy()
    inward = Vector((centre_f.x - fem.x, 0, centre_f.z - fem.z))
    feminine.append(fem + inward.normalized() * 0.003)
    assert v.index == len(feminine) - 1
boundary = [e for e in bm.edges if e.is_boundary]
filled = bmesh.ops.holes_fill(bm, edges=boundary, sides=0)
bmesh.ops.triangulate(bm, faces=list(bm.faces))
still_open = len([e for e in bm.edges if e.is_boundary])
bm.to_mesh(mesh)
bm.free()
mesh.update()

# 5. Write the raw mesh
positions = []
for v in mesh.vertices:
    positions += [v.co.x, v.co.y, v.co.z]
indices = []
for poly in mesh.polygons:
    indices += list(poly.vertices)
with open(out_dir + "/head.bin", "wb") as handle:
    handle.write(struct.pack("<II", len(mesh.vertices), len(indices) // 3))
    handle.write(struct.pack(f"<{len(positions)}f", *positions))
    handle.write(struct.pack(f"<{len(indices)}I", *indices))
with open(out_dir + "/feminine.bin", "wb") as handle:
    handle.write(struct.pack("<I", len(feminine)))
    handle.write(struct.pack(f"<{len(feminine) * 3}f", *[c for co in feminine for c in co]))
print("exported", len(mesh.vertices), "vertices,", len(indices) // 3, "triangles, open edges:", still_open)

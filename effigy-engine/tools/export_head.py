"""Exports the base head used by Effigy Engine from Blender Studio's CC0 Human Base Meshes bundle.

Run with the bundle open in Blender (background mode, auto-run of embedded scripts disabled):

    blender -b human_base_meshes_bundle.blend --disable-autoexec --python tools/export_head.py -- public/models

What it does to GEO-head_sculpting_realistic:
  1. applies the multires modifier (level 1) and the object's transform,
  2. subdivides once more with Catmull-Clark (about 53,000 vertices), which keeps the sculpt's shape
     and gives the app enough vertices to carry sharper facial structure,
  3. turns the axes into the app's (Y up, face toward +Z),
  4. caps the open base so the bust is a closed solid, and triangulates,
  5. writes head.bin: uint32 vertexCount, uint32 triangleCount, float32 xyz per vertex, uint32 abc per triangle.

The app moves the origin to the midpoint between the eyes and scales it (see src/headMesh.ts).
"""

import struct
import sys

import bmesh
import bpy
from mathutils import Matrix

out_dir = sys.argv[-1]
src = bpy.data.objects["GEO-head_sculpting_realistic"]

# 1. The head as it looks with the multires level applied, in world space
depsgraph = bpy.context.evaluated_depsgraph_get()
mesh = bpy.data.meshes.new_from_object(src.evaluated_get(depsgraph))
mesh.transform(src.matrix_world)

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

# 3. Blender is Z-up with the face toward -Y; the app is Y-up with the face toward +Z.
mesh.transform(Matrix(((1, 0, 0, 0), (0, 0, 1, 0), (0, -1, 0, 0), (0, 0, 0, 1))))

# 4. Cap the open base and triangulate
bm = bmesh.new()
bm.from_mesh(mesh)
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
print("exported", len(mesh.vertices), "vertices,", len(indices) // 3, "triangles, open edges:", still_open)

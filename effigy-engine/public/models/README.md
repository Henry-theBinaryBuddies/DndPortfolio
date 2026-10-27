# Head model

`head.bin` is the base head the app sculpts from: 52,842 vertices, 105,680 triangles, closed (watertight).

**Source:** the realistic head (sculpting) from the **Human Base Meshes** bundle v1.4.1 by Blender Studio and community contributors, released under **CC0** (public domain): https://www.blender.org/download/demo-files/

**Changes made:** the multires modifier was applied at level 1, one level of Catmull-Clark subdivision was added (so the app has enough vertices for sharp structure), the open base was capped so the mesh is a closed solid, the axes were converted to Y-up with the face toward +Z, and it was written as the raw binary below. The shape itself is unchanged.

**Format** (little-endian): `uint32 vertexCount`, `uint32 triangleCount`, then `float32 x,y,z` per vertex, then `uint32 a,b,c` per triangle. Units are metres. The app moves the origin to the midpoint between the eyes and scales it by 5 (see `src/headMesh.ts`).

The mesh was exported with Blender 5.2.3 using `tools/export_head.py`; the app only reads the `.bin`.

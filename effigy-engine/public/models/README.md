# Head model

`head.bin` is the base head the app sculpts from: 57,799 vertices, 115,594 triangles, closed (watertight), with a masculine chest. `feminine.bin` holds the same vertices with a feminine chest and neck; the Build toggle blends the two.

**Source:** the realistic head (sculpting), and the realistic male and female bodies, from the **Human Base Meshes** bundle v1.4.1 by Blender Studio and community contributors, released under **CC0** (public domain): https://www.blender.org/download/demo-files/

**Changes made:** the multires modifier was applied at level 1, the body was filled out (the sculpt is a neck and trapezius yoke, so it was cut at its widest shoulder line and rings for the shoulders and chest were extruded below it; after subdivision those rings were wrapped onto the bundle's male body for `head.bin` and its female body for `feminine.bin`, each cut like a classic bust: level 42 cm below the eyes, and flat at each side, slanting in from the deltoid to the base), `feminine.bin` also carries a feminine face: the broad male-to-female change between the bundle's two body heads (which share one topology), added to the head with the eyes and ears left untouched, one level of Catmull-Clark subdivision was added (so the app has enough vertices for sharp structure), the open base was capped so the mesh is a closed solid, the axes were converted to Y-up with the face toward +Z, and it was written as the raw binary below. Otherwise the head and face are unchanged.

**Format** (little-endian): `uint32 vertexCount`, `uint32 triangleCount`, then `float32 x,y,z` per vertex, then `uint32 a,b,c` per triangle. `feminine.bin`: `uint32 vertexCount`, then `float32 x,y,z` per vertex. Units are metres. The app moves the origin to the midpoint between the eyes and scales it by 5 (see `src/headMesh.ts`).

The mesh was exported with Blender 5.2.3 using `tools/export_head.py`; the app only reads the `.bin`.

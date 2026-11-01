"""An independent check of an exported STL, made with Trimesh rather than with the code that wrote it.

    pip install trimesh numpy
    python tools/check-stl.py effigy-human-masculine-swept.stl [more.stl ...]

It reads each file the way a slicer does (triangles are joined only where they share the same numbers) and
reports whether it is a closed, consistently wound solid, how many separate bodies it holds, its volume and
size, and how many edges are not shared by exactly two triangles. Exit status 1 if any file fails.
"""
import sys

import numpy as np
import trimesh


def check(path: str) -> bool:
    mesh = trimesh.load(path, process=True)
    edges = np.sort(mesh.edges, axis=1)
    _, counts = np.unique(edges, axis=0, return_counts=True)
    bodies = sorted((abs(b.volume) for b in mesh.split(only_watertight=False)), reverse=True)
    extent = mesh.bounds[1] - mesh.bounds[0]
    edge_length = mesh.edges_unique_length
    print(path)
    print(f"  triangles {len(mesh.faces)}, vertices {len(mesh.vertices)}")
    print(f"  watertight {mesh.is_watertight}, consistently wound {mesh.is_winding_consistent}, a true volume {mesh.is_volume}")
    print(f"  edges shared by one triangle {int((counts == 1).sum())}, by more than two {int((counts > 2).sum())}")
    print(f"  size {extent[0]:.1f} x {extent[1]:.1f} x {extent[2]:.1f} mm, volume {mesh.volume / 1000:.1f} cm3, lowest point z = {mesh.bounds[0][2]:.3f}")
    print(f"  bodies {len(bodies)} (largest {bodies[0]:.1f} mm3" + (f"; the others, {', '.join(f'{b:.3f}' for b in bodies[1:6])} mm3, are sealed pockets or loose specks)" if len(bodies) > 1 else ")"))
    print(f"  shortest edge {edge_length.min():.5f} mm, edges under 0.01 mm: {int((edge_length < 0.01).sum())}")
    return bool(mesh.is_watertight and mesh.is_winding_consistent and mesh.is_volume and (counts == 2).all())


if __name__ == "__main__":
    if len(sys.argv) < 2:
        sys.exit(__doc__)
    results = [check(path) for path in sys.argv[1:]]
    print("PASS" if all(results) else "FAIL")
    sys.exit(0 if all(results) else 1)

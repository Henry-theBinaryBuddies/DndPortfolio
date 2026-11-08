// A growth mask can leave two triangle fans touching at just one vertex. Extruding
// that vertex makes four walls share an edge. Trim the smaller fan before closing
// the shell; valid regions pass through unchanged. No parts are discarded later.
export function trimPinchedBoundary(triangles: number[], count: number): void {
  for (let pass = 0; pass < 12; pass++) {
    const uses = new Map<number, number>();
    for (let t = 0; t < triangles.length; t += 3) for (let e = 0; e < 3; e++) {
      const a = triangles[t + e], b = triangles[t + (e + 1) % 3];
      const key = Math.min(a, b) * count + Math.max(a, b);
      uses.set(key, (uses.get(key) ?? 0) + 1);
    }
    const degree = new Uint8Array(count);
    for (const [key, use] of uses) if (use === 1) {
      degree[Math.floor(key / count)]++;
      degree[key % count]++;
    }
    const bad = new Map<number, number[]>();
    for (let v = 0; v < count; v++) if (degree[v] > 2) bad.set(v, []);
    if (!bad.size) return;
    for (let t = 0; t < triangles.length; t += 3) for (let e = 0; e < 3; e++) bad.get(triangles[t + e])?.push(t);
    const remove = new Set<number>();
    for (const [v, incident] of bad) {
      const pending = new Set(incident);
      const fans: number[][] = [];
      while (pending.size) {
        const first = pending.values().next().value!;
        pending.delete(first);
        const fan = [first];
        for (let j = 0; j < fan.length; j++) {
          const at = fan[j];
          const others = triangles.slice(at, at + 3).filter(x => x !== v);
          for (const t of pending) if (triangles.slice(t, t + 3).some(x => x !== v && others.includes(x))) {
            pending.delete(t); fan.push(t);
          }
        }
        fans.push(fan);
      }
      fans.sort((a, b) => b.length - a.length);
      for (const fan of fans.slice(1)) for (const t of fan) remove.add(t);
    }
    if (!remove.size) throw new Error("The hair/beard boundary could not be made manifold");
    let write = 0;
    for (let t = 0; t < triangles.length; t += 3) if (!remove.has(t)) {
      triangles[write++] = triangles[t]; triangles[write++] = triangles[t + 1]; triangles[write++] = triangles[t + 2];
    }
    triangles.length = write;
  }
  throw new Error("The hair/beard boundary did not converge after trimming pinches");
}

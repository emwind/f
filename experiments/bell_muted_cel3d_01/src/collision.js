// Minimal collision world: axis-aligned solid boxes and walkable ramps (stairs).
// Characters are vertical cylinders (radius r, height h) with a step-up allowance.

export class Collider {
  constructor() {
    this.boxes = [];   // {x0,x1,z0,z1,y0,y1}
    this.ramps = [];   // {x0,x1,z0,z1,axis:'x'|'z', a, b}  height a at min edge, b at max edge
  }
  box(x0, x1, z0, z1, y0, y1) {
    const b = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0, y1 };
    this.boxes.push(b);
    return b;
  }
  // ramp: along axis, height `a` at the low-coordinate edge and `b` at the high edge
  ramp(x0, x1, z0, z1, axis, a, b) {
    const r = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), axis, a, b };
    this.ramps.push(r);
    return r;
  }
  rampHeight(r, x, z) {
    const t = r.axis === 'x' ? (x - r.x0) / (r.x1 - r.x0) : (z - r.z0) / (r.z1 - r.z0);
    return r.a + (r.b - r.a) * Math.min(1, Math.max(0, t));
  }
  // Highest walkable surface at (x,z) whose top is <= maxY. Returns -Infinity if none.
  ground(x, z, maxY) {
    let best = -Infinity;
    for (const b of this.boxes) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (b.y1 <= maxY && b.y1 > best) best = b.y1;
    }
    for (const r of this.ramps) {
      if (x < r.x0 || x > r.x1 || z < r.z0 || z > r.z1) continue;
      const h = this.rampHeight(r, x, z);
      if (h <= maxY && h > best) best = h;
    }
    return best;
  }
  // Push a cylinder out of boxes that it overlaps vertically and that are too tall to step on.
  resolve(p, r, h, step) {
    const feet = p.y, head = p.y + h;
    for (let iter = 0; iter < 2; iter++) {
      for (const b of this.boxes) {
        if (b.y1 <= feet + step || b.y0 >= head) continue;
        const cx = Math.max(b.x0, Math.min(p.x, b.x1));
        const cz = Math.max(b.z0, Math.min(p.z, b.z1));
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        if (d2 > 1e-9) {
          const d = Math.sqrt(d2), push = r - d;
          p.x += (dx / d) * push; p.z += (dz / d) * push;
        } else {
          // centre inside the box: exit along the shallowest axis
          const ex = [p.x - b.x0, b.x1 - p.x, p.z - b.z0, b.z1 - p.z];
          const m = Math.min(...ex), i = ex.indexOf(m);
          if (i === 0) p.x = b.x0 - r; else if (i === 1) p.x = b.x1 + r;
          else if (i === 2) p.z = b.z0 - r; else p.z = b.z1 + r;
        }
      }
    }
  }
  // Lowest ceiling above the head (for jumping under the bridge)
  ceiling(x, z, y) {
    let best = Infinity;
    for (const b of this.boxes) {
      if (x < b.x0 || x > b.x1 || z < b.z0 || z > b.z1) continue;
      if (b.y0 >= y && b.y0 < best) best = b.y0;
    }
    return best;
  }
}

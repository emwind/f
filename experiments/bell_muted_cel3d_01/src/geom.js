import * as THREE from '../vendor/three.module.min.js';

// Deterministic RNG so the authored layout is identical every run
export function rng(seed = 1) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export const R = rng(7);
export const rr = (a, b) => a + (b - a) * R();

// Accumulates many small geometries into one non-indexed BufferGeometry with
// position / normal / color. One draw call per material.
export class Batch {
  constructor() { this.pos = []; this.nor = []; this.col = []; }
  add(geom, matrix, color = 0xffffff, { keepNormals = false } = {}) {
    let g = geom.index ? geom.toNonIndexed() : geom.clone();
    if (matrix) g.applyMatrix4(matrix);
    if (!keepNormals) g.computeVertexNormals();
    const p = g.attributes.position.array, n = g.attributes.normal.array;
    const c = new THREE.Color(color);
    const vc = g.attributes.color ? g.attributes.color.array : null;
    for (let i = 0; i < p.length; i++) { this.pos.push(p[i]); this.nor.push(n[i]); }
    for (let i = 0; i < p.length / 3; i++) {
      if (vc) this.col.push(vc[i * 3] * c.r, vc[i * 3 + 1] * c.g, vc[i * 3 + 2] * c.b);
      else this.col.push(c.r, c.g, c.b);
    }
    g.dispose();
    return this;
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nor, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
  get empty() { return this.pos.length === 0; }
}

export function mesh(geom, mat, { cast = true, receive = true } = {}) {
  const m = new THREE.Mesh(geom, mat);
  m.castShadow = cast; m.receiveShadow = receive;
  return m;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function mat4(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
  _e.set(rx, ry, rz); _q.setFromEuler(_e); _s.set(sx, sy, sz); _p.set(x, y, z);
  return _m.clone().compose(_p, _q, _s);
}

// Jitter shared corner positions consistently (keeps the mesh watertight)
function jitterGeom(g, amt, seed, chip = 0, dims = [1, 1, 1]) {
  const p = g.attributes.position;
  const rand = rng(seed);
  const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(k)) {
      const d = [(rand() - 0.5) * amt, (rand() - 0.5) * amt, (rand() - 0.5) * amt];
      // chipped corner: pull this corner noticeably inward
      if (chip > 0 && rand() < chip) { const c = Math.min(0.14, Math.min(...dims) * 0.2) * (0.4 + rand() * 0.6); d[0] -= Math.sign(p.getX(i)) * c; d[1] -= Math.sign(p.getY(i)) * c * 0.8; d[2] -= Math.sign(p.getZ(i)) * c; }
      map.set(k, d);
    }
    const d = map.get(k);
    p.setXYZ(i, p.getX(i) + d[0], p.getY(i) + d[1], p.getZ(i) + d[2]);
  }
  p.needsUpdate = true;
  return g;
}

// Box with chamfered edges and corners (convex). The chamfers catch a thin
// light/mid band in the toon ramp, which reads as worn, hand-cut stone edges.
export function chamferBox(w, h, d, c) {
  const X = w / 2, Yh = h / 2, Z = d / 2;
  const P = (sx, sy, sz, ax) => {
    // corner point inset by c along the two axes other than `ax`
    return [sx * (X - (ax === 0 ? 0 : c)), sy * (Yh - (ax === 1 ? 0 : c)), sz * (Z - (ax === 2 ? 0 : c))];
  };
  const tris = [];
  const quad = (a, b, cc, dd) => { tris.push(a, b, cc, a, cc, dd); };
  const S = [-1, 1];
  // main faces
  for (const s of S) {
    quad(P(s, -1, -1, 0), P(s, 1, -1, 0), P(s, 1, 1, 0), P(s, -1, 1, 0));
    quad(P(-1, s, -1, 1), P(1, s, -1, 1), P(1, s, 1, 1), P(-1, s, 1, 1));
    quad(P(-1, -1, s, 2), P(1, -1, s, 2), P(1, 1, s, 2), P(-1, 1, s, 2));
  }
  // edge chamfers
  for (const a of S) for (const b of S) {
    quad(P(a, b, -1, 0), P(a, b, 1, 0), P(a, b, 1, 1), P(a, b, -1, 1)); // x-y edges along z
    quad(P(a, -1, b, 0), P(a, 1, b, 0), P(a, 1, b, 2), P(a, -1, b, 2)); // x-z edges along y
    quad(P(-1, a, b, 1), P(1, a, b, 1), P(1, a, b, 2), P(-1, a, b, 2)); // y-z edges along x
  }
  // corner triangles
  for (const a of S) for (const b of S) for (const e of S) tris.push(P(a, b, e, 0), P(a, b, e, 1), P(a, b, e, 2));
  // orient every triangle outward (convex, centred on the origin)
  const pos = [];
  for (let i = 0; i < tris.length; i += 3) {
    const [A, B, C] = [tris[i], tris[i + 1], tris[i + 2]];
    const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const m = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
    if (n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0) pos.push(...A, ...C, ...B); else pos.push(...A, ...B, ...C);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

// A single hand-cut stone block: chamfered box, irregular corners, rare chips
export function stoneBlock(w, h, d, { jitter = 0.06, chip = 0.15, bevel = 0.12 } = {}) {
  const mn = Math.min(w, h, d);
  const c = Math.max(0.015, Math.min(0.09, mn * bevel));
  const g = chamferBox(w, h, d, c);
  const j = Math.min(jitter, mn * 0.14);
  return jitterGeom(g, j, (R() * 1e9) | 0, chip * 0.5, [w, h, d]);
}

// Irregular boulder
export function rockGeom(r, { flat = 0.7, detail = 1, jag = 0.22 } = {}) {
  const g = new THREE.IcosahedronGeometry(r, detail);
  const p = g.attributes.position;
  const rand = rng((R() * 1e9) | 0); const map = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(k)) map.set(k, 1 + (rand() - 0.5) * jag * 2);
    const s = map.get(k);
    p.setXYZ(i, p.getX(i) * s, p.getY(i) * s * flat, p.getZ(i) * s);
  }
  return g;
}

// Hull-friendly copy: smooth normals averaged over coincident positions
export function smoothNormalsCopy(geom) {
  const g = (geom.index ? geom.toNonIndexed() : geom.clone());
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal;
  const acc = new Map();
  const key = (i) => `${p.getX(i).toFixed(4)},${p.getY(i).toFixed(4)},${p.getZ(i).toFixed(4)}`;
  for (let i = 0; i < p.count; i++) {
    const k = key(i); const a = acc.get(k) || [0, 0, 0];
    a[0] += n.getX(i); a[1] += n.getY(i); a[2] += n.getZ(i); acc.set(k, a);
  }
  for (let i = 0; i < p.count; i++) {
    const a = acc.get(key(i)); const l = Math.hypot(a[0], a[1], a[2]) || 1;
    n.setXYZ(i, a[0] / l, a[1] / l, a[2] / l);
  }
  return g;
}

// Tube along points (roots, vines, branches) with radius taper
export function tubeGeom(points, r0, r1, radial = 6, segs = 12) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)));
  const g = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  // taper: TubeGeometry builds rings in order; scale ring radii about the curve
  const p = g.attributes.position;
  const frames = curve.computeFrenetFrames(segs, false);
  for (let s = 0; s <= segs; s++) {
    const t = s / segs, r = r0 + (r1 - r0) * t;
    const c = curve.getPointAt(t);
    for (let j = 0; j <= radial; j++) {
      const i = s * (radial + 1) + j;
      p.setXYZ(i, c.x + (p.getX(i) - c.x) * r, c.y + (p.getY(i) - c.y) * r, c.z + (p.getZ(i) - c.z) * r);
    }
  }
  void frames;
  return g;
}

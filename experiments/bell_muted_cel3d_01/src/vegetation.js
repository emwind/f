import * as THREE from '../vendor/three.module.min.js';
import { Batch, R, rr, rng, mat4, tubeGeom, rockGeom, noise3 } from './geom.js';
import { PAL } from './materials.js';

// Vegetation is accumulated into shared batches (one draw call per material)
export const VEG = {
  leaf: new Batch(),   // canopy / shrubs (spherical normals → big readable masses)
  frond: new Batch(),  // ferns, reeds, vines leaves (double sided)
  wood: new Batch(),   // trunks, branches, roots
  canopy: new Batch(), // big tree canopy (fades when the player is underneath)
};
let CANOPY = false;

const _v = new THREE.Vector3();

// A canopy clump: several overlapping squashed blobs whose normals point away
// from the clump centre, so toon bands read as one painted mass, not facets.
export function clump(cx, cy, cz, size, { color = PAL.leaf, dark = PAL.leafDark, flat = 0.62, n = 7, droop = 0.25 } = {}) {
  const blobs = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rr(-0.4, 0.4);
    const d = i === 0 ? 0 : size * rr(0.35, 0.7);
    blobs.push([cx + Math.cos(a) * d, cy + rr(-0.15, 0.25) * size - (d / size) * droop * size, cz + Math.sin(a) * d * 0.85, size * rr(0.5, 0.75) * (i === 0 ? 1.15 : 1)]);
  }
  for (const [x, y, z, r] of blobs) {
    const g = rockGeom(r, { flat, detail: r > 0.9 ? 3 : 2, jag: 0.0 });
    // lumpy silhouette: low-frequency noise displacement → leaf-mass lobes, not spheres
    {
      const p0 = g.attributes.position, seed = R() * 100;
      for (let i = 0; i < p0.count; i++) {
        const px = p0.getX(i), py = p0.getY(i), pz = p0.getZ(i);
        const l = Math.hypot(px, py / flat, pz) || 1;
        const nn = noise3(px / r * 2.2 + seed, py / r * 2.2, pz / r * 2.2) * 0.65 + noise3(px / r * 5 + seed, py / r * 5, pz / r * 5) * 0.35;
        const k = 1 + (nn - 0.5) * 0.55;
        p0.setXYZ(i, px * k, py * k, pz * k);
        void l;
      }
    }
    g.translate(x, y, z);
    const g2 = g.index ? g.toNonIndexed() : g;
    const p = g2.attributes.position;
    const nor = new Float32Array(p.count * 3), col = new Float32Array(p.count * 3);
    const cA = new THREE.Color(color), cB = new THREE.Color(dark), c = new THREE.Color();
    g2.computeVertexNormals();
    const fn = g2.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      _v.set(p.getX(i) - cx, (p.getY(i) - cy) * 1.6, p.getZ(i) - cz).normalize();
      // mostly spherical, a little of the facet normal for broken-up edges
      _v.multiplyScalar(0.78).add(new THREE.Vector3(fn.getX(i), fn.getY(i), fn.getZ(i)).multiplyScalar(0.22)).normalize();
      nor.set([_v.x, _v.y, _v.z], i * 3);
      // underside of the mass darker & cooler (painted occlusion)
      const t = THREE.MathUtils.smoothstep(p.getY(i) - cy, -size * 0.5, size * 0.35);
      c.copy(cB).lerp(cA, t);
      col.set([c.r, c.g, c.b], i * 3);
    }
    g2.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    g2.setAttribute('color', new THREE.BufferAttribute(col, 3));
    (CANOPY ? VEG.canopy : VEG.leaf).add(g2, null, 0xffffff, { keepNormals: true });
    g.dispose();
  }
}

// Shrub = low clump hugging the ground
export function shrub(x, y, z, s = 1, opts = {}) {
  const o = { color: opts.color ?? PAL.leafOlive, dark: opts.dark ?? PAL.leafDark, under: 0x2a352b };
  tier(x, y + 0.42 * s, z, 0.95 * s, 0.6 * s, { ...o, lobes: 4 });
  tier(x + 0.55 * s, y + 0.28 * s, z + 0.35 * s, 0.55 * s, 0.38 * s, { ...o, lobes: 3, rot: 1 });
}

// Branch: tapered tube along points
export function branch(points, r0, r1, color = PAL.bark) {
  VEG.wood.add(tubeGeom(points, r0, r1, 7, Math.max(6, points.length * 3)), null, color);
}

// Fern: fan of arched tapered fronds
export function fern(x, y, z, s = 1, color = PAL.leafOlive) {
  const n = 7 + ((R() * 4) | 0);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + rr(-0.3, 0.3);
    const L = s * rr(0.7, 1.05), W = s * 0.16;
    const segs = 5, g = new THREE.BufferGeometry();
    const pos = [];
    const pt = (t, side) => {
      const r = t * L, h = Math.sin(t * Math.PI * 0.85) * L * 0.42 - t * t * L * 0.12;
      const w = W * Math.sin(Math.PI * Math.min(1, t * 1.05 + 0.02)) * (1 - t * 0.5) * side;
      return [Math.cos(a) * r - Math.sin(a) * w, h, Math.sin(a) * r + Math.cos(a) * w];
    };
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const a0 = pt(t0, -1), b0 = pt(t0, 1), a1 = pt(t1, -1), b1 = pt(t1, 1);
      // slight crease along the spine
      const m0 = pt(t0, 0), m1 = pt(t1, 0); m0[1] += 0.03 * s; m1[1] += 0.03 * s;
      pos.push(...a0, ...m0, ...a1, ...m0, ...m1, ...a1, ...m0, ...b0, ...m1, ...b0, ...b1, ...m1);
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    const shade = new THREE.Color(color).multiplyScalar(rr(0.85, 1.05));
    VEG.frond.add(g, mat4(x, y, z), shade);
  }
}

// Reeds: thin tapered blades in a cluster
export function reeds(x, y, z, s = 1) {
  const n = 9 + ((R() * 6) | 0);
  for (let i = 0; i < n; i++) {
    const h = s * rr(0.8, 1.5);
    const g = new THREE.ConeGeometry(0.04 * s, h, 3, 1);
    g.translate(0, h / 2, 0);
    const c = new THREE.Color(R() < 0.3 ? PAL.dirt : PAL.leafOlive).multiplyScalar(rr(0.8, 1.05));
    VEG.frond.add(g, mat4(x + rr(-0.4, 0.4) * s, y, z + rr(-0.3, 0.3) * s, rr(-0.25, 0.25), 0, rr(-0.25, 0.25)), c);
  }
}

// Hanging vine: a few thin tubes with sparse leaf blobs
export function vine(x, y, z, len, nx = 0, nz = 1, s = 1) {
  const pts = [];
  const steps = 6;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push([x + nx * (0.08 + Math.sin(t * 5 + x) * 0.05) + rr(-0.1, 0.1) * t, y - t * len, z + nz * (0.08 + Math.sin(t * 4 + z) * 0.05) + rr(-0.1, 0.1) * t]);
  }
  VEG.wood.add(tubeGeom(pts, 0.035 * s, 0.02 * s, 4, 12), null, PAL.leafDark);
  // leaves: small flattened elongated pads hugging the wall, denser near the top
  for (let i = 0; i < steps * 2; i++) {
    const t = Math.pow(R(), 1.6) * 0.95;
    const k = Math.min(steps - 1, Math.floor(t * steps)), f = t * steps - k;
    const px = pts[k][0] + (pts[k + 1][0] - pts[k][0]) * f, py = pts[k][1] + (pts[k + 1][1] - pts[k][1]) * f, pz = pts[k][2] + (pts[k + 1][2] - pts[k][2]) * f;
    const g = rockGeom(0.13 * s * rr(0.8, 1.3), { flat: 1, detail: 1, jag: 0.15 });
    VEG.frond.add(g, mat4(px + nx * 0.06 + rr(-0.1, 0.1), py, pz + nz * 0.06, 0, 0, rr(-0.6, 0.6), 0.9, 1.7, 0.45), R() < 0.5 ? PAL.leafDark : PAL.leaf);
  }
}

// Vine curtain draped over a wall top (along x at z, facing +z by default)
export function vineCurtain(x0, x1, yTop, z, len, nz = 1, density = 1.6) {
  const n = Math.max(2, Math.round((x1 - x0) * density));
  for (let i = 0; i < n; i++) vine(x0 + (x1 - x0) * (i + R() * 0.6) / n, yTop, z, len * rr(0.45, 1), 0, nz);
  // a moss/leaf lip along the top edge so vines grow from something
  for (let x = x0; x < x1; x += rr(0.9, 1.5)) clump(x, yTop + 0.02, z - nz * 0.1, rr(0.3, 0.45), { flat: 0.35, n: 3, color: PAL.leafOlive, dark: PAL.leafDark });
}

// Roots: thick snaking tubes spreading from a trunk base across the ground
export function root(points, r0 = 0.22, r1 = 0.05) {
  VEG.wood.add(tubeGeom(points, r0, r1, 6, points.length * 4), null, PAL.root);
}

// The large tree: asymmetric leaning trunk, a few major limbs, few big canopy masses.
// Canopy TIER: a broad, flat-bottomed, scalloped leaf mass (old oak / stone-pine
// tiers) instead of a sphere. Lit dome on top, a dark sheltered underside band,
// lobed rim so the silhouette reads as foliage at gameplay scale.
export function tier(cx, cy, cz, R, H, { color = PAL.leaf, dark = PAL.leafDark, under = 0x26322a, rot = 0, lobes = 5, sq = 0.85 } = {}) {
  const g0 = new THREE.IcosahedronGeometry(1, 3);
  const g = g0.index ? g0.toNonIndexed() : g0;
  const p = g.attributes.position;
  const ph = R * 3.7 + cx, cA = new THREE.Color(color), cB = new THREE.Color(dark), cU = new THREE.Color(under), c = new THREE.Color();
  const nor = new Float32Array(p.count * 3), col = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    let x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const th = Math.atan2(z, x) + rot;
    const scal = 1 + 0.16 * Math.sin(lobes * th + ph) + 0.08 * Math.sin((lobes * 2 + 1) * th + ph * 2) + (noise3(x * 2.2 + ph, y * 2.2, z * 2.2) - 0.5) * 0.18;
    const top = y > 0;
    const yy = top ? y * H * (0.85 + 0.3 * noise3(x * 3 + ph, 0, z * 3)) : y * H * 0.28; // flat-ish underside
    const px = x * R * scal, pz = z * R * scal * sq;
    p.setXYZ(i, cx + px, cy + yy, cz + pz);
    // normals: ellipsoid-smooth so the toon band sweeps across the whole tier
    const n = new THREE.Vector3(x / (R * scal), (top ? y / H : y / (H * 0.28)) * 0.9, z / (R * scal * sq)).normalize();
    nor.set([n.x, n.y, n.z], i * 3);
    // three grouped values: lit crown, mid rim, cool dark underside
    const t = top ? THREE.MathUtils.smoothstep(y, 0.0, 0.55) : 0;
    if (!top) c.copy(cU); else c.copy(cB).lerp(cA, t);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  (CANOPY ? VEG.canopy : VEG.leaf).add(g, null, 0xffffff, { keepNormals: true });
}
// A canopy mass = a main tier plus a few smaller rim lobes stepping down/out
function mass(cx, cy, cz, R, opts = {}) {
  tier(cx, cy, cz, R, R * 0.42, opts);
  const n = opts.sub ?? 3;
  for (let i = 0; i < n; i++) {
    const a = (opts.subA ?? 0) + i * (Math.PI * 2 / n) * 0.55 + rr(-0.2, 0.2);
    const d = R * rr(0.75, 0.95);
    tier(cx + Math.cos(a) * d, cy - R * rr(0.12, 0.28), cz + Math.sin(a) * d * 0.85, R * rr(0.36, 0.5), R * 0.2, { ...opts, lobes: 4, rot: a });
  }
}

// The large tree: leaning asymmetric trunk that forks into three limbs, each
// carrying one broad tier; gaps between tiers show the branch structure.
export function bigTree(x, y, z) {
  const T = (pts, r0, r1, c = PAL.bark) => branch(pts.map(([a, b, cc]) => [x + a, y + b, z + cc]), r0, r1, c);
  // trunk: thick, leaning toward the courtyard, with a twist and a scar-like kink
  T([[0, -0.4, 0], [0.15, 1.2, 0.05], [0.55, 2.6, 0.35], [0.7, 3.5, 0.2], [1.1, 4.3, 0.35]], 1.15, 0.62);
  // exposed buttress roots, long on the courtyard side, short against the cliff
  const roots = [[0.3, 1.5], [1.1, 1.8], [2.0, 1.2], [3.0, 1.0], [3.9, 0.9], [4.8, 1.2], [5.6, 1.0]];
  for (const [a, L] of roots) T([[Math.cos(a) * 0.25, 1.4, Math.sin(a) * 0.25], [Math.cos(a) * 0.8, 0.45, Math.sin(a) * 0.8], [Math.cos(a + 0.25) * L, 0.08, Math.sin(a + 0.25) * L], [Math.cos(a + 0.5) * (L + 0.35), 0.0, Math.sin(a + 0.5) * (L + 0.35)]], 0.75, 0.16, PAL.root);
  // three major limbs from the fork
  T([[1.0, 4.1, 0.3], [2.4, 5.0, 0.7], [3.8, 5.7, 1.2], [5.2, 6.1, 1.6]], 0.5, 0.18);   // A: out over the courtyard
  T([[1.0, 4.2, 0.2], [0.8, 5.6, -0.4], [0.9, 7.0, -1.3], [1.1, 7.9, -1.9]], 0.46, 0.16); // B: up and back
  T([[0.9, 4.0, 0.4], [-0.3, 4.8, 0.9], [-1.5, 5.4, 1.2], [-2.6, 5.7, 1.5]], 0.36, 0.12); // C: low, toward the cliff
  // secondary limbs/twigs reaching the rim lobes (visible in the gaps)
  T([[3.2, 5.5, 1.0], [4.4, 5.2, 2.4], [5.6, 4.9, 3.4]], 0.17, 0.05);
  T([[2.4, 5.0, 0.7], [3.0, 6.3, -0.4], [3.4, 7.0, -0.9]], 0.18, 0.06);
  T([[0.85, 6.4, -0.9], [-0.4, 7.1, -1.4], [-1.0, 7.4, -1.6]], 0.14, 0.05);
  T([[5.0, 6.05, 1.55], [6.4, 6.2, 1.2], [7.2, 6.0, 0.9]], 0.12, 0.04);
  // canopy: four tiers at distinct heights, heaviest over the courtyard
  CANOPY = true;
  mass(x + 5.1, y + 6.6, z + 1.7, 2.7, { color: PAL.leaf, sub: 3, subA: 0.2 });
  mass(x + 1.1, y + 8.5, z - 1.9, 2.3, { color: PAL.leafOlive, sub: 3, subA: 2.4 });
  mass(x - 2.5, y + 6.0, z + 1.5, 1.7, { color: PAL.leaf, sub: 2, subA: 1.6 });
  mass(x + 5.7, y + 5.2, z + 3.6, 1.1, { color: PAL.leafOlive, sub: 1, subA: 0.8 });
  CANOPY = false;
  // hanging growth from the undersides (selective, two places only)
  for (const [hx, hz, hy, n] of [[4.0, 2.4, 5.95, 4], [-2.0, 2.2, 5.6, 2]]) for (let i = 0; i < n; i++) vine(x + hx + i * 0.45, y + hy, z + hz + rr(-0.3, 0.3), rr(1.4, 2.6), 0, 0.2, 1.1);
}

// A slimmer secondary tree
export function smallTree(x, y, z, s = 1, lean = 0.3) {
  const T = (pts, r0, r1) => branch(pts.map(([a, b, c]) => [x + a * s, y + b * s, z + c * s]), r0 * s, r1 * s, PAL.bark);
  T([[0, -0.2, 0], [lean * 0.5, 1.8, 0], [lean, 3.4, 0.2], [lean * 1.6, 4.6, 0.1]], 0.35, 0.16);
  T([[lean, 3.2, 0.2], [lean + 1.2, 4.0, 0.6], [lean + 1.9, 4.4, 0.9]], 0.16, 0.06);
  mass(x + (lean * 1.6) * s, y + 5.0 * s, z, 1.6 * s, { color: PAL.leafOlive, sub: 2 });
  tier(x + (lean + 1.9) * s, y + 4.5 * s, z + 0.9 * s, 0.9 * s, 0.4 * s, { color: PAL.leaf });
}

export function buildVegMeshes(mats) {
  const out = [];
  const mk = (b, m, cast = true) => { if (b.empty) return; const me = new THREE.Mesh(b.build(), m); me.castShadow = cast; me.receiveShadow = true; out.push(me); };
  mk(VEG.leaf, mats.leaf);
  mk(VEG.frond, mats.frond);
  mk(VEG.wood, mats.wood);
  if (!VEG.canopy.empty) {
    const me = new THREE.Mesh(VEG.canopy.build(), mats.canopy); me.castShadow = true; me.receiveShadow = true; me.userData.canopy = true;
    out.push(me);
  }
  return out;
}
void rng;

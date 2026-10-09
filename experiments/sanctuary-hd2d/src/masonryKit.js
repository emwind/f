// Authored masonry edge kit. The terrain builder makes walls as clean slabs;
// this pass walks every built (masonry) wall edge and dresses it with a small
// vocabulary of hand-shaped pieces so wall tops stop reading as boxes:
//   coping courses (intact, worn, broken, missing), capstones on free-standing
//   walls, chunky corner stones, stepped collapsed wall ends with rubble,
//   protruding stones on tall faces, drains over water, damp moss-stained
//   stones near water and in the shade.
// It is visual only: collision still follows the level grid.
import * as THREE from '../vendor/three.module.min.js';
import { T } from './level.js';
import { mulberry32, fbm2, smoothstep } from './noise.js';

const TEX_SCALE = 0.25;

// a small chipped box (world-space uvs) appended straight into flat arrays
function addBox(out, x0, y0, z0, x1, y1, z1, { chip = 0.04, seed = 1, rotY = 0, tilt = 0, col = [1, 1, 1] } = {}) {
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, 1, 1, 1);
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, cz = (z0 + z1) / 2;
  const r = mulberry32(seed);
  const p = g.attributes.position;
  // wear the top corners down, unevenly
  for (let k = 0; k < p.count; k++) {
    const y = p.getY(k);
    if (y > 0) p.setY(k, y - r() * chip);
    p.setX(k, p.getX(k) + (r() - 0.5) * chip * 0.5);
    p.setZ(k, p.getZ(k) + (r() - 0.5) * chip * 0.5);
  }
  const m = new THREE.Matrix4().makeRotationY(rotY).multiply(new THREE.Matrix4().makeRotationZ(tilt));
  m.setPosition(cx, cy, cz);
  g.applyMatrix4(m);
  g.computeVertexNormals();
  const n = g.attributes.normal;
  const base = out.p.length / 3;
  const ylo = Math.min(y0, y1), yspan = Math.max(0.01, y1 - y0);
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    out.p.push(x, y, z);
    out.n.push(n.getX(k), n.getY(k), n.getZ(k));
    if (Math.abs(n.getY(k)) > 0.5) out.uv.push(x * TEX_SCALE, z * TEX_SCALE);
    else if (Math.abs(n.getX(k)) > 0.5) out.uv.push(z * TEX_SCALE, -y * TEX_SCALE);
    else out.uv.push(x * TEX_SCALE, -y * TEX_SCALE);
    // tops catch light, undersides sit in their own shadow
    const ny = n.getY(k);
    const s = ny > 0.5 ? 1.08 : ny < -0.5 ? 0.42 : 0.72 + 0.22 * (y - ylo) / yspan;
    out.c.push(s * col[0], s * col[1], s * col[2]);
  }
  const idx = g.index.array;
  for (let k = 0; k < idx.length; k++) out.i.push(base + idx[k]);
  g.dispose();
}

export function buildMasonryKit(L, mat, capMat = mat) {
  const W = L.W, D = L.D;
  const rough = { p: [], n: [], uv: [], c: [], i: [] };
  const caps = { p: [], n: [], uv: [], c: [], i: [] };
  const Hh = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? 99 : L.H[z * W + x]);
  const isMas = (x, z) => x >= 0 && z >= 0 && x < W && z < D && L.MAS[z * W + x] && !L.stairs.has(z * W + x);
  const isWater = (x, z) => x >= 0 && z >= 0 && x < W && z < D && L.TY[z * W + x] === T.WATER;
  const DAMP = [0.78, 0.9, 0.7];
  const shrine = L.id === 'shrine';

  // edges: [dx, dz] outward normal; a tile edge is a wall face when the
  // neighbour that way is clearly lower
  const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0]];
  for (let tz = 0; tz < D; tz++)
    for (let tx = 0; tx < W; tx++) {
      if (!isMas(tx, tz)) continue;
      const h = L.H[tz * W + tx];
      if (h > 9) continue;
      for (const [dx, dz] of DIRS) {
        const nh = Hh(tx + dx, tz + dz);
        const drop = h - nh;
        if (drop < 0.7 || nh > 50) continue;
        if (L.stairs.has((tz + dz) * W + tx + dx)) continue;
        const seed = tx * 7919 + tz * 104729 + dx * 31 + dz * 17;
        const r = mulberry32(seed);
        // free-standing (thin) wall: lower on the opposite side too
        const thin = h - Hh(tx - dx, tz - dz) > 0.7;
        const damp = isWater(tx + dx, tz + dz) || (shrine ? false : fbm2(tx * 0.3, tz * 0.3, 2, 13) > 0.62);
        const col = damp ? DAMP : shrine ? [0.86, 0.9, 1.0] : [1, 1, 1];
        // edge frame: along axis a (0..1 across the tile edge), outward n
        const along = dz !== 0; // edge runs along x
        const ex = (t) => (along ? tx + t : dx > 0 ? tx + 1 : tx);
        const ez = (t) => (along ? (dz > 0 ? tz + 1 : tz) : tz + t);
        const box = (t0, t1, out0, out1, y0, y1, opts, cap = false) => {
          // out0/out1: offsets along the outward normal (negative = inside)
          const xa = ex(t0), za = ez(t0), xb = ex(t1), zb = ez(t1);
          const ox0 = dx * out0, oz0 = dz * out0, ox1 = dx * out1, oz1 = dz * out1;
          const X0 = Math.min(xa + ox0, xb + ox1, xa + ox1, xb + ox0), X1 = Math.max(xa + ox0, xb + ox1, xa + ox1, xb + ox0);
          const Z0 = Math.min(za + oz0, zb + oz1, za + oz1, zb + oz0), Z1 = Math.max(za + oz0, zb + oz1, za + oz1, zb + oz0);
          addBox(cap ? caps : rough, X0, y0, Z0, X1, y1, Z1, { seed: seed + Math.floor(t0 * 100), col, ...opts });
        };

        // --- coping course / capstones along the top edge
        let t = 0;
        while (t < 0.98) {
          const len = Math.min(1 - t, 0.3 + r() * 0.55);
          const roll = r();
          if (roll < (thin ? 0.16 : 0.1)) {
            // missing stone: leave a notch in the line
          } else if (thin) {
            // capstone across the whole wall top, proud of both faces
            const worn = roll < 0.35;
            const top = h + (worn ? 0.02 : 0.06) + (r() - 0.5) * 0.02;
            const half = roll > 0.9 ? 0.6 : 1;
            box(t + 0.02, t + len * half - 0.02, 0.1, -1.1, h - 0.06, top, { chip: worn ? 0.09 : 0.04, rotY: (r() - 0.5) * 0.08, tilt: roll > 0.9 ? (r() - 0.5) * 0.25 : 0 }, true);
          } else {
            // coping block flush with the walkable top, proud of the face
            const worn = roll < 0.3, broken = roll > 0.9;
            const ytop = h + (worn ? -0.04 : 0.015);
            const yb = ytop - (0.2 + r() * 0.08);
            box(t + 0.02, t + len * (broken ? 0.55 : 1) - 0.02, 0.06 + r() * 0.07, -0.22, broken ? yb - 0.06 : yb, broken ? ytop - 0.08 : ytop, { chip: worn ? 0.08 : 0.03, rotY: (r() - 0.5) * (broken ? 0.3 : 0.05), tilt: broken ? (r() - 0.5) * 0.35 : 0 }, true);
          }
          t += len;
        }

        // --- protruding stones and drains on tall faces
        if (drop > 1.4) {
          const nStones = r() < 0.35 ? 1 + Math.floor(r() * 2) : 0;
          for (let k = 0; k < nStones; k++) {
            const tt = 0.1 + r() * 0.7, yy = nh + 0.3 + r() * (drop - 0.8);
            box(tt, tt + 0.18 + r() * 0.2, 0.05 + r() * 0.06, -0.1, yy, yy + 0.14 + r() * 0.1, { chip: 0.04 });
          }
          if (isWater(tx + dx, tz + dz) && r() < 0.3) {
            const yy = nh + 0.6 + r() * Math.min(1.2, drop - 1.2);
            box(0.38, 0.62, 0.32, -0.05, yy, yy + 0.16, { chip: 0.02 });
            box(0.44, 0.56, 0.33, 0.0, yy + 0.08, yy + 0.15, { chip: 0, col: [0.18, 0.18, 0.2] });
          }
        }

        // --- corner stones at convex corners
        for (const side of [0, 1]) {
          // the perpendicular direction at this end of the edge
          const sx = along ? (side ? 1 : -1) : 0, sz = along ? 0 : side ? 1 : -1;
          const convex = Hh(tx + sx, tz + sz) < h - 0.7;
          if (!convex || r() < 0.25) continue;
          const t0 = side ? 0.72 : 0, t1 = side ? 1.0 : 0.28;
          const chipped = r() < 0.4;
          const top = h + (thin ? 0.16 : 0.04) - (chipped ? 0.12 : 0);
          box(t0 + (side ? 0 : -0.06), t1 + (side ? 0.06 : 0), 0.12, thin ? -1.08 : -0.3, top - 0.34, top, { chip: chipped ? 0.12 : 0.05 }, true);
        }

        // --- collapsed end of a free-standing wall: stepped stones and rubble
        if (thin) {
          for (const side of [0, 1]) {
            const sx = along ? (side ? 1 : -1) : 0, sz = along ? 0 : side ? 1 : -1;
            if (Hh(tx + sx, tz + sz) > h - 0.7 || isMas(tx + sx, tz + sz) && Hh(tx + sx, tz + sz) > nh + 0.5) continue;
            if (r() < 0.3) continue;
            const base = Math.max(nh, Hh(tx + sx, tz + sz));
            const t0 = side ? 1.0 : -0.5, t1 = side ? 1.5 : 0.0;
            box(t0, t1, 0.0, -0.9, base, base + (h - base) * 0.45, { chip: 0.15, rotY: (r() - 0.5) * 0.3 });
            const tm = side ? 1.05 : -0.25;
            box(tm, tm + 0.22, -0.2, -0.6, base + (h - base) * 0.45, base + (h - base) * 0.62, { chip: 0.1, tilt: (r() - 0.5) * 0.5 });
          }
        }

        // --- rubble at the foot of the wall
        if (r() < (shrine ? 0.12 : 0.22) && !isWater(tx + dx, tz + dz)) {
          const n = 2 + Math.floor(r() * 3);
          for (let k = 0; k < n; k++) {
            const tt = r() * 0.8, s = 0.1 + r() * 0.16, o = 0.05 + r() * 0.35;
            box(tt, tt + s * 1.4, o + s, o, nh - 0.05, nh + s, { chip: 0.06, rotY: r() * 3, col: [0.85, 0.85, 0.85] });
          }
        }
      }
    }

  const group = new THREE.Group();
  group.name = 'masonryKit';
  for (const [out, m] of [[rough, mat], [caps, capMat]]) {
    if (!out.i.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(out.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(out.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(out.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(out.c, 3));
    g.setIndex(out.i);
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

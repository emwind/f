import * as THREE from '../vendor/three.module.min.js';
import { Batch, R, rr, mat4, mesh, stoneBlock, rockGeom, noise3 } from './geom.js';
import { PAL, paintMat } from './materials.js';
import { Collider } from './collision.js';
import * as V from './vegetation.js';

// ---------------------------------------------------------------------------
// Layout (metres). x east, z south (toward camera), y up.
//   Terrace (y 6)     z -24..-12   shrine at x≈-2, the visible destination
//   Courtyard (y 3)   z -12..0     big tree west, colonnade, guardian ring
//   North bank (y 0)  z 0..5       foot of the main staircase
//   Stream (bed -0.8) z 6..8.5     wadeable, shallow banks
//   South bank (y 0)  z 9.5..18    start area
//   Gorge (bed -0.8)  x 10..18     under the bridge, waterfall from culvert
//   Promontory (y 3)  x 18..28     reached by bridge, stair up to the terrace
// ---------------------------------------------------------------------------
export const Y = { bed: -0.8, water: -0.38, low: 0, cy: 3, ter: 6 };
export const SPAWN = { x: -9, z: 14 };
export const SHRINE_DOOR = { x: -2, y: 6.66, z: -18.8 };
const SHRINE_ROOTS = [];

export function buildLevel(scene) {
  const col = new Collider();
  const B = {
    stone: new Batch(), stoneClean: new Batch(), ground: new Batch(), paving: new Batch(),
    rock: new Batch(), trim: new Batch(), gold: new Batch(), bed: new Batch(),
  };
  const M = {
    stone: paintMat(0xffffff, { noise: 0.13, scale: 0.28, moss: 0.55, streak: 0.55 }),
    stoneClean: paintMat(0xffffff, { noise: 0.09, scale: 0.3, moss: 0.2, streak: 0.25 }),
    ground: paintMat(0xffffff, { noise: 0.16, scale: 0.18, moss: 0.65, mossColor: PAL.moss }),
    paving: paintMat(0xffffff, { noise: 0.11, scale: 0.22, moss: 0.42 }),
    rock: paintMat(0xffffff, { noise: 0.15, scale: 0.25, moss: 0.6, streak: 0.4, mossColor: PAL.mossDark }),
    trim: paintMat(0xffffff, { noise: 0.06, scale: 0.5, moss: 0.08, streak: 0.2 }),
    gold: paintMat(0xffffff, { noise: 0.1, scale: 1.2, moss: 0.0 }),
    bed: paintMat(0xffffff, { noise: 0.2, scale: 0.35, moss: 0.3, mossColor: PAL.mossDark }),
    leaf: paintMat(0xffffff, { noise: 0.1, scale: 0.4, moss: 0 }),
    canopy: paintMat(0xffffff, { noise: 0.1, scale: 0.4, moss: 0, canopy: 1 }),
    frond: paintMat(0xffffff, { noise: 0.08, scale: 0.6, moss: 0, side: THREE.DoubleSide }),
    wood: paintMat(0xffffff, { noise: 0.12, scale: 0.8, moss: 0.35, mossColor: PAL.mossDark }),
  };

  const stoneCols = [PAL.limestone, PAL.limestone, PAL.limeCool, PAL.paving, 0xae9f82];
  const pick = (a) => a[(R() * a.length) | 0];
  const tint = (c, v = 0.07) => new THREE.Color(c).multiplyScalar(1 + rr(-v, v));

  // ---- solid ground masses (collider + plain core mesh) ----
  const core = (x0, x1, z0, z1, y0, y1, color = PAL.dirt, batch = B.ground) => {
    col.box(x0, x1, z0, z1, y0, y1);
    const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, Math.max(1, Math.round((x1 - x0) / 4)), 1, Math.max(1, Math.round((z1 - z0) / 4)));
    batch.add(g, mat4((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), color);
  };

  // ---- masonry face: courses of irregular blocks on one side of a mass ----
  // axis 'x' → face runs along x at z=at, outward normal (0,0,out)
  function masonry({ axis, at, out, from, to, y0, y1, depth = 0.7, course = [0.55, 0.85], len = [0.9, 2.0],
    colors = stoneCols, ruin = 0, coping = true, batch = B.stone, chip = 0.2 }) {
    let y = y0;
    const ruinPhase = R() * 10;
    while (y < y1 - 0.05) {
      const h = Math.min(y1 - y, rr(course[0], course[1]));
      let a = from - rr(0, 0.6);
      const inset = rr(-0.03, 0.05);
      while (a < to) {
        const L = Math.min(rr(len[0], len[1]), to - a + 0.2);
        const c = a + L / 2;
        if (c > from - 0.1 && c < to + 0.1) {
          const top = y1 - ruin * (0.5 + 0.5 * Math.sin(c * 0.7 + ruinPhase)) * (0.5 + 0.5 * Math.sin(c * 1.9 + ruinPhase * 2));
          if (y + h * 0.5 < top) {
            const g = stoneBlock(L - 0.05, h - 0.04, depth, { jitter: 0.07, chip });
            const prot = rr(-0.02, 0.07) + inset;
            const off = at + out * (prot - depth / 2 + 0.02);
            const m = axis === 'x' ? mat4(c, y + h / 2, off, 0, 0, rr(-0.012, 0.012)) : mat4(off, y + h / 2, c, rr(-0.012, 0.012), 0, 0);
            // lower courses darker/cooler (damp), upper courses warmer
            const lift = THREE.MathUtils.clamp((y - y0) / Math.max(1, y1 - y0), 0, 1);
            const base = new THREE.Color(pick(colors)).lerp(new THREE.Color(PAL.limeDark), (1 - lift) * 0.35);
            batch.add(g, m, tint(base, 0.08));
          }
        }
        a += L;
      }
      y += h;
    }
    if (coping) {
      // lighter coping lip marks the walkable edge clearly
      let a = from;
      while (a < to - 0.1) {
        const L = Math.min(rr(1.2, 2.2), to - a);
        if (R() > 0.12) {
          const g = stoneBlock(L - 0.06, 0.22, 0.9, { jitter: 0.05, chip: 0.3 });
          const c = a + L / 2, off = at + out * (0.1 - 0.45);
          const m = axis === 'x' ? mat4(c, y1 + 0.06, off, 0, 0, rr(-0.02, 0.02)) : mat4(off, y1 + 0.06, c, rr(-0.02, 0.02), 0, 0);
          B.stoneClean.add(g, m, tint(0xc2b494, 0.05));
        }
        a += L;
      }
    }
  }

  // ---- natural rock face (cliffs / gorge bottom) ----
  function rockFace({ axis, at, out, from, to, y0, y1, size = 1.6 }) {
    // layered limestone strata: big irregular slabs, each course stepping in/out
    let y = y0;
    while (y < y1) {
      const h = Math.min(y1 - y + 0.2, size * rr(0.45, 0.8));
      const courseOff = rr(-0.25, 0.25);
      for (let a = from - rr(0, 1); a < to; ) {
        const L = size * rr(1.0, 2.2);
        const dpt = size * rr(0.8, 1.2);
        const g = stoneBlock(L, h, dpt, { jitter: 0.12, chip: 0.5 });
        const off = at + out * (courseOff + rr(-0.12, 0.12) - dpt / 2 + 0.1);
        const m = axis === 'x' ? mat4(a + L / 2, y + h / 2, off, rr(-0.04, 0.04), rr(-0.06, 0.06), rr(-0.05, 0.05)) : mat4(off, y + h / 2, a + L / 2, rr(-0.05, 0.05), rr(-0.06, 0.06), rr(-0.04, 0.04));
        B.rock.add(g, m, tint(R() < 0.6 ? PAL.rock : PAL.rockDark, 0.07));
        a += L * rr(0.85, 1.0);
      }
      y += h;
    }
  }

  // ---- paving: slabs with gaps, some missing, cracked or tilted ----
  function pave(x0, x1, z0, z1, y, { size = 1.5, missing = 0.08, tilt = 0.02, colors = [PAL.paving, PAL.paving, 0xa39880], avoid = () => false, loss = 0.5 } = {}) {
    for (let z = z0; z < z1 - 0.2; ) {
      const d = Math.min(rr(size * 0.7, size * 1.1), z1 - z);
      for (let x = x0 + rr(-0.4, 0); x < x1 - 0.2; ) {
        const big = R() < 0.12;
        const w = Math.min(rr(size * 0.8, size * 1.3) * (big ? 1.6 : 1), x1 - x);
        const cx = x + w / 2, cz = z + d / 2;
        // clustered loss: low-frequency noise opens calm soil/moss zones
        const n = noise3(cx * 0.16 + 3.1, cz * 0.16, y * 0.3);
        const lost = n > 1 - loss * 0.6 + (R() - 0.5) * 0.08;
        const edge = n > 1 - loss * 0.6 - 0.07; // fringe of the lost zone: broken / tilted slabs
        if (cx > x0 && R() > missing && !avoid(cx, cz) && !lost) {
          const t = edge ? tilt * 4 : tilt;
          const g = stoneBlock((w - 0.05) * (edge ? rr(0.55, 0.9) : 1), 0.16, (d - 0.05) * (edge ? rr(0.6, 0.9) : 1), { jitter: 0.04, chip: edge ? 0.6 : 0.2, bevel: 0.25 });
          B.paving.add(g, mat4(cx, y + 0.03 + rr(-0.02, 0.02), cz, rr(-t, t), rr(-0.02, 0.02) * (edge ? 6 : 1), rr(-t, t)), tint(pick(colors), 0.035));
        }
        x += w;
      }
      z += d;
    }
  }

  // ---- flat irregular ground patch (moss / dirt / damp zones) ----
  function patch(x, y, z, r, color, { pts = 22, squash = 0.7, rot = 0 } = {}) {
    const s = new THREE.Shape();
    const ph = R() * 10;
    for (let i = 0; i < pts; i++) {
      const a = (i / pts) * Math.PI * 2, rad = r * (0.85 + 0.22 * Math.sin(a * 2 + ph) + 0.12 * Math.sin(a * 5 + ph * 2) + rr(-0.04, 0.04));
      const px = Math.cos(a) * rad, pz = Math.sin(a) * rad * squash;
      if (i === 0) s.moveTo(px, pz); else s.lineTo(px, pz);
    }
    const g = new THREE.ShapeGeometry(s);
    g.rotateX(Math.PI / 2);
    // ShapeGeometry after rotateX faces down; flip winding by mirroring
    g.scale(1, 1, -1);
    B.ground.add(g, mat4(x, y + 0.025, z, 0, rot, 0), tint(color, 0.05));
  }

  // Extruded hand-drawn profile (front view, x/y) facing +z, centred on z
  function slabXY(batch, pts, depth, x, y, z, color, rz = 0) {
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b))), { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 1 });
    g.translate(0, 0, -depth / 2);
    batch.add(g, mat4(x, y, z, 0, 0, rz), color);
  }
  // Polygonal masonry face: wandering bed lines + slanted joints → irregular quads
  function polyWall(x0, x1, y0, y1, zf, skip, topDrop) {
    const bed = (row, x) => row === 0 ? 0 : 0.18 * Math.sin(x * 1.3 + row * 2.1) + 0.1 * Math.sin(x * 3.1 + row);
    let rowY = y0, row = 0;
    while (rowY < y1 - 0.2) {
      const h = Math.min(y1 - rowY, rr(0.9, 1.35));
      let xa = x0, xaT = x0;
      while (xa < x1 - 0.05) {
        const w = Math.min(rr(1.0, 2.1), x1 - xa);
        let xb = xa + w, xbT = Math.min(x1, xb + rr(-0.35, 0.35));
        if (x1 - xb < 0.5) { xb = x1; xbT = x1; }
        const yA = rowY + bed(row, xa), yB = rowY + bed(row, xb);
        const top = Math.min(y1, rowY + h);
        const tA = top + bed(row + 1, xaT) - topDrop(xaT), tB = top + bed(row + 1, xbT) - topDrop(xbT);
        const cx = (xa + xb + xaT + xbT) / 4, cy = (yA + yB + tA + tB) / 4;
        if (!skip(cx, cy) && tA - yA > 0.25 && tB - yB > 0.25) {
          const k = Math.min(1, (cy - y0) / (y1 - y0));
          const col = new THREE.Color(pick([PAL.limeCool, PAL.limestone, 0xa89c82, 0x9a9584])).lerp(new THREE.Color(PAL.limeDark), (1 - k) * 0.35);
          const sh = [[xa - cx + 0.03, yA - cy + 0.03], [xb - cx - 0.03, yB - cy + 0.03], [xbT - cx - 0.03, tB - cy - 0.03], [xaT - cx + 0.03, tA - cy - 0.03]];
          slabXY(B.stone, sh, 0.85, cx, cy, zf - 0.42 + rr(0.0, 0.08), tint(col, 0.05), rr(-0.02, 0.02));
        }
        xa = xb; xaT = xbT;
      }
      rowY += h; row++;
    }
  }

  function pillar(x, y, z, h, { r = 0.42, broken = false, gold = false, cap = true, batch = B.stoneClean } = {}) {
    // plinth
    B.stone.add(stoneBlock(r * 2.7, 0.35, r * 2.7, { jitter: 0.05, chip: 0.4 }), mat4(x, y + 0.17, z), tint(PAL.limeCool));
    let yy = y + 0.35;
    const drums = Math.max(1, Math.round(h / 0.9));
    for (let i = 0; i < drums; i++) {
      const dh = (h - 0.35) / drums;
      const last = i === drums - 1;
      const g = new THREE.CylinderGeometry(r * (last && broken ? 0.9 : 0.96), r, dh - 0.03, 10, 1);
      // break: jitter the top ring heavily on the final drum
      if (last && broken) {
        const p = g.attributes.position;
        for (let k = 0; k < p.count; k++) if (p.getY(k) > 0) p.setY(k, p.getY(k) - R() * dh * 0.6);
      }
      batch.add(g, mat4(x + rr(-0.02, 0.02), yy + dh / 2, z + rr(-0.02, 0.02), 0, rr(0, 3), 0), tint(pick(stoneCols), 0.05));
      yy += dh;
    }
    if (gold) {
      B.gold.add(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.12, 10), mat4(x, y + 1.2, z), PAL.bronze);
      B.gold.add(new THREE.CylinderGeometry(r * 1.02, r * 1.02, 0.08, 10), mat4(x, y + 1.42, z), PAL.gold);
    }
    if (cap && !broken) {
      B.stoneClean.add(stoneBlock(r * 2.5, 0.26, r * 2.5, { jitter: 0.05, chip: 0.35 }), mat4(x, yy + 0.13, z), tint(PAL.limestone));
      B.stoneClean.add(stoneBlock(r * 2.9, 0.22, r * 2.9, { jitter: 0.06, chip: 0.4 }), mat4(x, yy + 0.37, z), tint(0xbfb193));
    }
    col.box(x - r, x + r, z - r, z + r, y, y + h + (cap && !broken ? 0.5 : 0));
  }

  // stairs: visual steps over a ramp collider; rises toward -z by default
  function stairs(x0, x1, zTop, zBot, yTop, yBot, { steps, cheeks = true }) {
    const run = (zBot - zTop) / steps, rise = (yTop - yBot) / steps;
    col.ramp(x0, x1, zTop, zBot, 'z', yTop, yBot + rise);
    for (let i = 0; i < steps; i++) {
      const sy = yBot + rise * (i + 1); // tread top
      const sz = zBot - run * (i + 0.5);
      // each tread broken into 2–3 slabs for an authored, worn look
      let x = x0;
      while (x < x1 - 0.1) {
        const w = Math.min(rr(1.4, 2.6), x1 - x);
        const worn = R() < 0.15;
        const g = stoneBlock(w - 0.04, rise + (i === 0 ? 0.3 : 0.12), run + 0.06, { jitter: 0.025, chip: worn ? 0.5 : 0.05, bevel: 0.18 });
        B.stoneClean.add(g, mat4(x + w / 2, sy - (rise + 0.12) / 2 - (worn ? 0.05 : 0), sz + 0.03, rr(-0.02, 0.02), 0, 0), tint(pick([PAL.limestone, 0xc0b293, PAL.paving]), 0.06));
        x += w;
      }
      // solid fill under the steps
      B.stone.add(new THREE.BoxGeometry(x1 - x0 - 0.1, Math.max(0.1, sy - rise - yBot + 0.01), run), mat4((x0 + x1) / 2, yBot + (sy - rise - yBot) / 2, sz), PAL.limeDark);
    }
    if (cheeks) {
      for (const [cx0, cx1] of [[x0 - 0.65, x0], [x1, x1 + 0.65]]) {
        const parts = 3;
        for (let k = 0; k < parts; k++) {
          const za = zTop + (zBot - zTop) * k / parts, zb = zTop + (zBot - zTop) * (k + 1) / parts;
          const top = yTop - (yTop - yBot) * k / parts + 0.45;
          col.box(cx0, cx1, za, zb, yBot - 1, top);
          masonry({ axis: 'z', at: cx1, out: 1, from: za, to: zb, y0: yBot - 0.3, y1: top, depth: 0.62, coping: false, len: [0.8, 1.4], chip: 0.35 });
          B.stoneClean.add(stoneBlock(0.75, 0.22, zb - za + 0.02, { chip: 0.4 }), mat4((cx0 + cx1) / 2, top + 0.05, (za + zb) / 2), tint(0xc2b494, 0.05));
        }
      }
    }
  }

  // =========================================================================
  // GROUND MASSES
  // =========================================================================
  // south bank (start) and stream
  core(-24, 28, 9.5, 19, -3, Y.low, 0x8c7a5d);
  col.ramp(-24, 28, 8.5, 9.5, 'z', Y.bed, Y.low);
  B.ground.add(new THREE.BoxGeometry(52, 0.6, 1.2), mat4(2, -0.45, 9.0, -0.66, 0, 0), PAL.dirtDark);
  core(-24, 28, 6, 8.5, -3, Y.bed, PAL.dirtDark, B.bed);
  core(10, 18, -12, 6, -3, Y.bed, PAL.dirtDark, B.bed);
  col.ramp(-24, 10, 5, 6, 'z', Y.low, Y.bed);
  col.ramp(18, 28, 5, 6, 'z', Y.low, Y.bed);
  B.ground.add(new THREE.BoxGeometry(34, 0.6, 1.2), mat4(-7, -0.45, 5.5, 0.66, 0, 0), PAL.dirtDark);
  B.ground.add(new THREE.BoxGeometry(10, 0.6, 1.2), mat4(23, -0.45, 5.5, 0.66, 0, 0), PAL.dirtDark);
  // north bank
  core(-24, 10, 0, 5, -3, Y.low, 0x86755a);
  core(18, 28, 0, 5, -3, Y.low, 0x86755a);
  // courtyard + promontory + terrace
  core(-24, 10, -12, 0, -3, Y.cy, 0x8a7d66);
  core(18, 28, -12, 0, -3, Y.cy, 0x8a7d66);
  core(-24, 28, -24, -12, -3, Y.ter, 0x8a7d66);
  // back cliff + side cliffs (bounds)
  core(-30, 34, -34, -24, -3, 14, PAL.rockDark, B.rock);
  col.box(-34, -24, -34, 22, -3, 12);
  col.box(28, 38, -34, 22, -3, 12);
  col.box(-34, 38, 19, 22, -3, 12); // invisible south bound

  // retaining wall: courtyard south face (the main drop)
  masonry({ axis: 'x', at: 0, out: 1, from: -24, to: -6.6, y0: -0.4, y1: Y.cy, course: [0.6, 0.95], len: [1.1, 2.3] });
  masonry({ axis: 'x', at: 0, out: 1, from: 0.6, to: 10, y0: -0.4, y1: Y.cy, course: [0.6, 0.95], len: [1.1, 2.3] });
  // a recessed carved inset panel in the retaining wall (sanctuary motif)
  B.trim.add(stoneBlock(2.2, 1.3, 0.2, { chip: 0.1 }), mat4(-13, 1.55, 0.02), PAL.indigoDeep);
  B.gold.add(new THREE.TorusGeometry(0.42, 0.06, 6, 18), mat4(-13, 1.55, 0.14), PAL.bronze);
  B.trim.add(stoneBlock(0.7, 0.7, 0.12, { chip: 0 }), mat4(-13, 1.55, 0.12, 0, 0, Math.PI / 4), PAL.indigo);
  // collapse: a chunk of fallen blocks at the wall foot east of the stair
  for (let i = 0; i < 6; i++) B.stone.add(stoneBlock(rr(0.8, 1.4), rr(0.5, 0.8), rr(0.6, 0.9), { chip: 0.5 }), mat4(5 + rr(-1.2, 1.5), 0.25 + (i > 3 ? 0.55 : 0), 0.8 + rr(0, 1.2), rr(-0.4, 0.4), rr(0, 3), rr(-0.3, 0.3)), tint(PAL.limeCool));
  col.box(4, 6.6, 0, 2.2, -1, 0.9);

  // courtyard east face (gorge west wall): rock below, masonry above
  rockFace({ axis: 'z', at: 10, out: 1, from: -12, to: 5.5, y0: -1.2, y1: 0.6, size: 1.5 });
  masonry({ axis: 'z', at: 10, out: 1, from: -12, to: 0, y0: 0.3, y1: Y.cy, ruin: 0.0 });
  // promontory west face (gorge east wall) and south face
  rockFace({ axis: 'z', at: 18, out: -1, from: -12, to: 5.5, y0: -1.2, y1: 0.6, size: 1.5 });
  masonry({ axis: 'z', at: 18, out: -1, from: -12, to: 0, y0: 0.3, y1: Y.cy });
  masonry({ axis: 'x', at: 0, out: 1, from: 18, to: 28, y0: -0.4, y1: Y.cy, ruin: 0 });
  // north bank east edge to gorge: low rock lip
  rockFace({ axis: 'z', at: 10, out: 1, from: 0, to: 5, y0: -1, y1: 0.1, size: 1.0 });
  rockFace({ axis: 'z', at: 18, out: -1, from: 0, to: 5, y0: -1, y1: 0.1, size: 1.0 });

  // terrace face (courtyard north wall) with the culvert over the gorge
  masonry({ axis: 'x', at: -12, out: 1, from: -24, to: 10, y0: Y.cy - 0.2, y1: Y.ter, course: [0.55, 0.85] });
  masonry({ axis: 'x', at: -12, out: 1, from: 18, to: 28, y0: Y.cy - 0.2, y1: Y.ter });
  masonry({ axis: 'x', at: -12, out: 1, from: 10, to: 12.6, y0: -0.8, y1: Y.ter, coping: false });
  masonry({ axis: 'x', at: -12, out: 1, from: 15.4, to: 18, y0: -0.8, y1: Y.ter, coping: false });
  masonry({ axis: 'x', at: -12, out: 1, from: 12.6, to: 15.4, y0: 4.4, y1: Y.ter, coping: false });
  masonry({ axis: 'x', at: -12, out: 1, from: 12.6, to: 15.4, y0: -0.8, y1: 1.0, coping: false });
  // culvert mouth: dark recess with lintel
  B.trim.add(new THREE.BoxGeometry(2.8, 3.4, 0.3), mat4(14, 2.7, -11.95), 0x2b3330);
  B.stoneClean.add(stoneBlock(3.6, 0.5, 1.0, { chip: 0.3 }), mat4(14, 4.6, -11.9), tint(PAL.limestone));
  // coping along the terrace top over the gorge
  for (let x = 10.2; x < 17.8; x += 1.6) B.stoneClean.add(stoneBlock(1.5, 0.22, 0.9, { chip: 0.3 }), mat4(x + 0.75, Y.ter + 0.06, -12.35), tint(0xc2b494, 0.05));

  // back cliff face + west/east cliff faces (scenery)
  rockFace({ axis: 'x', at: -24, out: 1, from: -24, to: 28, y0: Y.ter, y1: 13, size: 2.2 });
  rockFace({ axis: 'z', at: -24, out: 1, from: -24, to: 19, y0: -1, y1: 9, size: 2.4 });
  rockFace({ axis: 'z', at: 28, out: -1, from: -24, to: 19, y0: -1, y1: 9, size: 2.4 });

  // =========================================================================
  // MAIN STAIRCASE: north bank → courtyard (10 steps, 6 m wide)
  // =========================================================================
  stairs(-6, 0, 0, 4.5, Y.cy, Y.low, { steps: 10 });
  // promontory stair: up to the terrace
  stairs(20.5, 24.5, -12, -6, Y.ter, Y.cy, { steps: 10 });

  // =========================================================================
  // BRIDGE over the gorge (courtyard → promontory)
  // =========================================================================
  col.box(10, 18, -7.2, -4.8, 2.3, Y.cy);
  pave(10, 18, -7.0, -5.0, Y.cy - 0.12, { size: 1.0, missing: 0.0, tilt: 0.03, loss: 0 });
  B.stone.add(new THREE.BoxGeometry(8, 0.55, 2.4), mat4(14, 2.62, -6), PAL.limeDark);
  // arch ring of voussoirs
  {
    const cx = 14, cy = -1.9, rad = 4.15, n = 15;
    for (let i = 0; i <= n; i++) {
      const a = Math.PI * (i / n);
      const g = stoneBlock(0.62, 0.95, 2.4, { jitter: 0.04, chip: 0.25 });
      B.stone.add(g, mat4(cx - Math.cos(a) * rad, cy + Math.sin(a) * rad, -6, 0, 0, Math.PI / 2 - a), tint(pick(stoneCols), 0.06));
    }
    // spandrel fill
    for (const s of [-1, 1]) B.stone.add(new THREE.BoxGeometry(2.0, 2.2, 2.3), mat4(cx + s * 3.0, 1.3, -6), PAL.limeDark);
    col.box(10, 11.3, -7.2, -4.8, -1, 1.7);
    col.box(16.7, 18, -7.2, -4.8, -1, 1.7);
  }
  // parapets (south one partly broken → a gap you can fall through)
  for (const [z, gap] of [[-7.05, false], [-4.95, true]]) {
    for (let x = 10; x < 18; x += 1.0) {
      if (gap && x > 13.4 && x < 15.6) continue;
      const h = gap && (x > 12.4 && x < 16.6) ? rr(0.15, 0.35) : rr(0.55, 0.7);
      B.stoneClean.add(stoneBlock(0.95, h, 0.32, { chip: 0.35 }), mat4(x + 0.5, Y.cy + h / 2, z), tint(PAL.limestone));
      col.box(x, x + 1, z - 0.16, z + 0.16, Y.cy, Y.cy + h);
    }
  }

  // =========================================================================
  // COURTYARD DRESSING
  // =========================================================================
  // central worn paving, leaving soil gaps around the tree and edges
  const treeX = -17.5, treeZ = -7.5;
  pave(-15, 10, -11.4, -0.4, Y.cy, { missing: 0.1, avoid: (x, z) => Math.hypot(x - treeX, z - treeZ) < 4.5 || (x < -12 && z > -3) });
  pave(-24, -15, -3.5, -0.4, Y.cy, { missing: 0.35 });
  // the sanctuary ring: indigo inset with bronze inlay, cracked and half-overgrown
  {
    const rx = -3, rz = -5.5;
    const ring = new THREE.RingGeometry(1.6, 2.5, 28, 1); ring.rotateX(-Math.PI / 2);
    B.trim.add(ring, mat4(rx, Y.cy + 0.13, rz), PAL.indigoDeep);
    for (let i = 0; i < 12; i++) {
      if (i === 3 || i === 4 || i === 9) continue; // lost segments
      const a = (i / 12) * Math.PI * 2;
      B.gold.add(stoneBlock(0.5, 0.05, 0.14, { chip: 0 }), mat4(rx + Math.cos(a) * 2.05, Y.cy + 0.16, rz + Math.sin(a) * 2.05, 0, -a + Math.PI / 2, 0), i % 2 ? PAL.bronze : PAL.gold);
    }
    const disc = new THREE.CylinderGeometry(1.55, 1.6, 0.22, 24);
    B.stoneClean.add(disc, mat4(rx, Y.cy + 0.09, rz), 0xb3a78c);
    B.trim.add(new THREE.CylinderGeometry(0.55, 0.55, 0.06, 6), mat4(rx, Y.cy + 0.22, rz), PAL.indigo);
  }

  // colonnade along the terrace wall: varied heights, some broken
  const cols = [[-11, 4.6, false], [-7, 1.5, true], [-3, 4.6, false], [1, 2.6, true], [5, 4.6, false], [8.6, 0.9, true]];
  for (const [x, h, br] of cols) pillar(x, Y.cy, -10.2, h, { broken: br });
  // architrave fragment spanning two intact columns
  B.stoneClean.add(stoneBlock(4.8, 0.55, 1.1, { chip: 0.4 }), mat4(-5, Y.cy + 5.4, -10.2, 0, 0, 0.0), tint(PAL.limestone));
  // fallen column drums
  for (let i = 0; i < 3; i++) {
    const g = new THREE.CylinderGeometry(0.42, 0.42, 0.85, 10);
    B.stoneClean.add(g, mat4(2.4 + i * 1.05, Y.cy + 0.42, -6.5 + i * 0.55, 0, 0.5, Math.PI / 2 + rr(-0.1, 0.1)), tint(PAL.limestone));
  }
  col.box(1.9, 5.3, -7, -5.1, Y.cy, Y.cy + 0.84);
  // low ruined enclosure wall west
  masonry({ axis: 'x', at: -3.2, out: 1, from: -14, to: -9, y0: Y.cy, y1: Y.cy + 1.3, depth: 0.7, ruin: 0.9, coping: false, len: [0.8, 1.5] });
  col.box(-14, -9, -3.9, -3.2, Y.cy, Y.cy + 1.0);
  // carved stele near the stair head
  B.stoneClean.add(stoneBlock(0.9, 2.0, 0.45, { chip: 0.3 }), mat4(1.6, Y.cy + 1.0, -1.1, 0, -0.2, 0.04), tint(PAL.limeCool));
  B.trim.add(stoneBlock(0.5, 0.9, 0.06, { chip: 0 }), mat4(1.55, Y.cy + 1.2, -0.86, 0, -0.2, 0.04), PAL.indigo);
  col.box(1.1, 2.1, -1.4, -0.8, Y.cy, Y.cy + 2);

  // =========================================================================
  // TERRACE + SHRINE (the destination)
  // =========================================================================
  pave(-12, 27, -23.5, -12.4, Y.ter, { missing: 0.16, size: 1.7, loss: 0.75, avoid: (x, z) => x > -8.5 && x < 4.5 && z < -15.4 });
  {
    // Monumental shrine: battered façade, deep stepped portal, corbelled crown.
    const sx = -2, F = -17.6; // façade plane
    const T0 = Y.ter;
    // plinth: three steps
    for (let i = 0; i < 3; i++) {
      const w = 13 - i * 1.2, d0 = -15.6 - i * 0.5;
      col.box(sx - w / 2, sx + w / 2, -24, d0, T0, T0 + 0.22 * (i + 1));
      B.stoneClean.add(stoneBlock(w, 0.24, -24 - d0 > 0 ? 0 : (d0 + 24), { chip: 0.15, bevel: 0.3 }), mat4(sx, T0 + 0.22 * i + 0.11, (d0 - 24) / 2), tint(i === 1 ? 0xbfb193 : PAL.limestone, 0.03));
    }
    const P0 = T0 + 0.66;
    // façade wings (heavy coursing, larger blocks low down)
    // Façade: polygonal "cyclopean" masonry (slanted joints, wandering bed lines,
    // big irregular blocks) — deliberately unlike the courtyard's coursed walls.
    const inPortal = (cx, cy) => {
      if (cx > -4.55 && cx < 0.55 && cy < P0 + 4.95) return true;              // jambs + lintel
      const ty = cy - (P0 + 4.85), half = 1.75 - ty * 1.15;                    // relieving triangle
      return ty > -0.1 && ty < 1.55 && Math.abs(cx - sx) < half + 0.15;
    };
    const crownBreak = (cx) => cx > 0.9 ? (cx - 0.9) * 0.55 : 0;                // right side collapsed
    polyWall(-7.5, 3.5, P0, P0 + 6.25, F, inPortal, crownBreak);    masonry({ axis: 'z', at: -7.5, out: -1, from: -23.8, to: F, y0: P0, y1: P0 + 6.2, coping: false, depth: 0.9 });
    masonry({ axis: 'z', at: 3.5, out: 1, from: -23.8, to: F, y0: P0, y1: P0 + 6.2, coping: false, depth: 0.9 });
    B.stone.add(new THREE.BoxGeometry(10.6, 6.2, 4.6), mat4(sx, P0 + 3.1, -21.4), PAL.limeDark);
    col.box(-7.5, -4.1, -24, F, T0, T0 + 14);
    col.box(0.1, 3.5, -24, F, T0, T0 + 14);
    col.box(-4.1, 0.1, -24, -18.7, T0, T0 + 14);
    // Battered monolithic portal: tapering jambs, one huge cracked lintel.
    const JB = [[-0.6, 0], [0.55, 0], [0.42, 4.0], [-0.55, 4.0]];             // left jamb profile (inner edge leans in)
    slabXY(B.stone, JB, 0.95, -3.75, P0, F - 0.05, tint(0xb0a487, 0.03));
    slabXY(B.stone, JB.map(([x, y]) => [-x, y]), 0.95, -0.25, P0, F - 0.05, tint(0xa59a80, 0.03));
    // dark reveals: the inner faces of the opening fall into near-black
    B.trim.add(new THREE.BoxGeometry(0.12, 4.0, 0.9), mat4(-3.15, P0 + 2.0, F - 0.45, 0, 0, -0.03), 0x2a2f2e);
    B.trim.add(new THREE.BoxGeometry(0.12, 4.0, 0.9), mat4(-0.85, P0 + 2.0, F - 0.45, 0, 0, 0.03), 0x2a2f2e);
    B.trim.add(new THREE.BoxGeometry(2.4, 0.12, 0.9), mat4(sx, P0 + 3.95, F - 0.45), 0x222726);
    // lintel in two pieces: the right half has dropped and shifted along an old crack
    slabXY(B.stone, [[-2.55, 0], [-0.1, 0], [0.05, 0.85], [-2.45, 0.9]], 1.1, sx, P0 + 4.0, F - 0.02, tint(0xbcae8f, 0.02));
    slabXY(B.stone, [[0.0, 0], [2.5, 0.05], [2.4, 0.86], [0.12, 0.84]], 1.1, sx + 0.05, P0 + 3.94, F + 0.04, tint(0xb2a588, 0.02), -0.035);
    // relieving triangle above the lintel: indigo field, bronze sun disc, carved rays
    slabXY(B.trim, [[-1.6, 0], [1.6, 0], [0, 1.45]], 0.3, sx, P0 + 4.9, F - 0.12, PAL.indigoDeep);
    slabXY(B.trim, [[-1.35, 0.08], [1.35, 0.08], [0, 1.25]], 0.3, sx, P0 + 4.9, F - 0.05, PAL.indigo);
    B.gold.add(new THREE.CylinderGeometry(0.3, 0.3, 0.08, 14), mat4(sx, P0 + 5.36, F + 0.12, Math.PI / 2, 0, 0), PAL.gold);
    for (let i = 0; i < 5; i++) { const a = 0.35 + i * 0.6; B.gold.add(new THREE.BoxGeometry(0.3, 0.05, 0.05), mat4(sx + Math.cos(a) * 0.52, P0 + 5.36 + Math.sin(a) * 0.44, F + 0.1, 0, 0, a), i === 2 ? PAL.gold : PAL.bronze); }
    // worn threshold slab, darker and damp
    B.stone.add(stoneBlock(2.6, 0.12, 1.3, { chip: 0.3, bevel: 0.3 }), mat4(sx, P0 + 0.04, F + 0.15), tint(0x8b8573));
    // dark interior volume behind the frames (reads as depth, not a painted door)
    B.trim.add(new THREE.BoxGeometry(3.0, 3.6, 0.2), mat4(sx, P0 + 1.8, -18.75), 0x262b2c);
    // sealed door slab: deep indigo with bronze seal
    B.trim.add(stoneBlock(2.3, 3.4, 0.3, { chip: 0.05 }), mat4(sx, P0 + 1.7, -18.55), PAL.indigo);
    B.gold.add(new THREE.TorusGeometry(0.62, 0.07, 6, 24), mat4(sx, P0 + 2.0, -18.37), PAL.gold);
    B.gold.add(new THREE.TorusGeometry(0.3, 0.05, 6, 16), mat4(sx, P0 + 2.0, -18.37), PAL.bronze);
    B.gold.add(new THREE.BoxGeometry(0.06, 2.8, 0.04), mat4(sx, P0 + 1.7, -18.38), PAL.bronze);
    // cornice: intact on the left, broken off on the right; mossy ledges (B.stone = moss + streaks)
    slabXY(B.stone, [[-5.8, 0], [1.4, 0], [1.1, 0.42], [-5.85, 0.48]], 6.8, sx, P0 + 6.2, -20.7, tint(PAL.limestone, 0.03));
    slabXY(B.stone, [[1.4, 0], [3.0, 0.05], [2.7, 0.3], [1.6, 0.38]], 6.2, sx, P0 + 6.05, -20.8, tint(0xa99d84, 0.03), -0.06);
    // corbelled crown: stepped on the left, collapsed on the right (uneven tops)
    slabXY(B.stone, [[-4.9, 0], [0.9, 0], [0.4, 0.62], [-4.8, 0.7]], 5.4, sx, P0 + 6.66, -20.9, tint(PAL.limeCool, 0.03));
    slabXY(B.stone, [[-3.9, 0], [-0.4, 0], [-0.9, 0.7], [-3.7, 0.66]], 4.4, sx, P0 + 7.32, -21.0, tint(0xb3a68a, 0.03));
    slabXY(B.stone, [[-2.9, 0], [-1.3, 0], [-1.6, 0.6], [-2.7, 0.75]], 3.0, sx, P0 + 7.98, -21.1, tint(PAL.limeCool, 0.03));
    // a crown stone slid off and lodged on the broken cornice end; two more fell to the terrace
    B.stone.add(stoneBlock(1.3, 0.6, 1.0, { chip: 0.6 }), mat4(1.8, P0 + 6.6, -17.9, 0.2, 0.5, -0.45), tint(PAL.limeCool));
    B.stone.add(stoneBlock(1.2, 0.65, 0.9, { chip: 0.7 }), mat4(4.3, T0 + 0.33, -15.0, 0.1, 0.9, 0.2), tint(0xa99d84));
    B.stone.add(stoneBlock(0.8, 0.45, 0.7, { chip: 0.7 }), mat4(5.3, T0 + 0.22, -14.0, 0.3, 0.2, -0.3), tint(PAL.limeCool));
    col.box(3.7, 4.9, -15.5, -14.5, T0, T0 + 0.7);
    // damp: dark mineral stains running down from the cornice drip line
    for (const [x, len] of [[-6.6, 2.6], [-5.0, 1.6], [-1.2, 1.1], [1.3, 3.2], [2.9, 2.2]]) B.trim.add(new THREE.BoxGeometry(0.35, len, 0.04), mat4(x, P0 + 6.15 - len / 2, F + 0.1), 0x5f6158);
    // broken capstone fallen onto the plinth
    B.stoneClean.add(stoneBlock(1.4, 0.7, 1.1, { chip: 0.6 }), mat4(2.9, T0 + 1.0, -16.6, 0.3, 0.6, 0.4), tint(PAL.limeCool));
    col.box(2.2, 3.6, -17.2, -16.0, T0, T0 + 1.3);
    // flanking pillars with bronze bands
    pillar(-6.2, T0 + 0.66, -16.4, 4.0, { gold: true, r: 0.4 });
    pillar(2.2 - 0.0, T0 + 0.66, -16.4, 2.2, { broken: true, r: 0.4 });
    // kneeling guardian effigies in shallow niches (foreshadow the enemy)
    for (const nx of [-5.8, 1.8]) {
      B.trim.add(new THREE.BoxGeometry(1.2, 2.0, 0.3), mat4(nx, P0 + 1.6, F + 0.02), 0x3b403e);
      B.stoneClean.add(stoneBlock(0.8, 0.7, 0.5, { chip: 0.3 }), mat4(nx, P0 + 0.95, F + 0.3), tint(PAL.guardian));
      B.stoneClean.add(stoneBlock(0.5, 0.45, 0.45, { chip: 0.3 }), mat4(nx, P0 + 1.55, F + 0.32), tint(PAL.guardianDark));
      B.gold.add(new THREE.BoxGeometry(0.3, 0.05, 0.03), mat4(nx, P0 + 1.6, F + 0.56), PAL.bronze);
    }
    SHRINE_ROOTS.push([sx - 4.8, P0 + 6.9, -21]);
  }
  // bronze braziers (cold) framing the forecourt
  for (const x of [-9.4, 5.4]) {
    B.stone.add(stoneBlock(0.8, 0.9, 0.8, { chip: 0.3 }), mat4(x, Y.ter + 0.45, -14.6), tint(PAL.limeCool));
    B.gold.add(new THREE.CylinderGeometry(0.55, 0.3, 0.35, 8, 1, true), mat4(x, Y.ter + 1.07, -14.6), PAL.bronze);
    col.box(x - 0.45, x + 0.45, -15.05, -14.15, Y.ter, Y.ter + 1.3);
  }

  // =========================================================================
  // PROMONTORY: fallen colossal head + ruined gateposts
  // =========================================================================
  {
    const hx = 25.2, hz = -2.8, hy = Y.cy;
    const head = new THREE.Group();
    const add = (g, x, y, z, c, rx = 0) => { const m = mesh(g, M.stone); m.position.set(x, y, z); m.rotation.x = rx; head.add(m); setColor(g, c); };
    add(stoneBlock(2.1, 2.5, 1.9, { chip: 0.3, jitter: 0.1 }), 0, 0, 0, PAL.limeCool);           // skull mass
    add(stoneBlock(1.7, 0.9, 0.5, { chip: 0.3 }), 0, -0.85, 0.85, PAL.limeCool);                  // jaw / chin
    add(stoneBlock(0.42, 0.85, 0.5, { chip: 0.2 }), 0, 0.0, 1.05, PAL.limestone);                 // nose ridge
    add(stoneBlock(1.95, 0.22, 0.3, { chip: 0.1 }), 0, 0.5, 0.98, PAL.limestone);                 // brow
    add(stoneBlock(0.55, 0.16, 0.12, { chip: 0 }), -0.5, 0.28, 0.96, 0x45443d);                   // closed eyes
    add(stoneBlock(0.55, 0.16, 0.12, { chip: 0 }), 0.5, 0.28, 0.96, 0x45443d);
    add(stoneBlock(0.8, 0.12, 0.12, { chip: 0 }), 0, -0.62, 1.1, 0x5c5a50);                       // mouth line
    add(stoneBlock(2.3, 0.35, 2.1, { chip: 0.4 }), 0, 1.35, -0.05, PAL.limestone);                // headdress rim
    add(stoneBlock(1.6, 0.28, 0.12, { chip: 0 }), 0, 1.35, 1.0, PAL.indigo);                      // faded indigo band
    add(stoneBlock(0.55, 1.4, 0.45, { chip: 0.3 }), -1.2, 0.0, 0.1, PAL.limeCool);                // ear slabs
    add(stoneBlock(0.55, 1.4, 0.45, { chip: 0.3 }), 1.2, 0.0, 0.1, PAL.limeCool);
    // lying on its side, face turned up toward the sky/camera, half sunk
    head.position.set(hx, hy + 0.75, hz); head.rotation.set(-1.0, -0.35, 1.3);
    head.traverse((o) => { if (o.isMesh) { o.castShadow = o.receiveShadow = true; } });
    scene.add(head);
    col.box(hx - 1.4, hx + 1.4, hz - 1.4, hz + 1.4, hy, hy + 2.0);
  }
  pillar(19.5, Y.cy, -6.6, 2.2, { broken: true });
  pillar(25.5, Y.cy, -6.6, 3.1, { broken: true });
  pave(18.4, 27.6, -11.8, -0.4, Y.cy, { missing: 0.3, size: 1.4, avoid: (x, z) => x > 20 && x < 25 && z < -6 });

  // =========================================================================
  // LOWER LEVEL: banks, stepping stones, gate ruin, rocks
  // =========================================================================
  // stepping stones across the stream
  for (const [x, z, r] of [[-4.2, 6.4, 0.55], [-3.1, 7.4, 0.6], [-4.0, 8.4, 0.5]]) {
    B.rock.add(rockGeom(r, { flat: 0.45, detail: 1 }), mat4(x, Y.bed + 0.35, z), tint(PAL.rock));
    col.box(x - r * 0.7, x + r * 0.7, z - r * 0.7, z + r * 0.7, Y.bed, -0.2);
  }
  // ruined gate on the south bank (the start frame)
  pillar(-13.5, Y.low, 12.2, 3.4, { broken: false });
  pillar(-9.9, Y.low, 11.2, 1.6, { broken: true });
  B.stoneClean.add(stoneBlock(2.6, 0.5, 0.9, { chip: 0.5 }), mat4(-11.2, 0.25, 13.1, 0.1, 0.7, 0.25), tint(PAL.limestone)); // fallen lintel
  col.box(-12.4, -10.1, 12.6, 13.6, -1, 0.6);
  // half-buried carved block
  B.stoneClean.add(stoneBlock(1.3, 0.8, 1.0, { chip: 0.3 }), mat4(-1.5, 0.3, 14.5, 0.2, 0.4, 0.1), tint(PAL.limeCool));
  B.trim.add(new THREE.TorusGeometry(0.25, 0.05, 5, 12), mat4(-1.38, 0.42, 15.0, 0.2, 0.4, 0.1), PAL.bronze);
  col.box(-2.2, -0.8, 14, 15, -1, 0.7);
  // boulders
  const boulder = (x, y, z, r) => { B.rock.add(stoneBlock(r * 1.7, r * 1.1, r * 1.4, { jitter: 0.2, chip: 0.7 }), mat4(x, y + r * 0.4, z, rr(-0.15, 0.15), rr(0, 3), rr(-0.15, 0.15)), tint(R() < 0.5 ? PAL.rock : PAL.limeCool)); B.rock.add(stoneBlock(r * 0.9, r * 0.6, r * 0.8, { jitter: 0.12, chip: 0.6 }), mat4(x + r * 0.7, y + r * 0.2, z + r * 0.4, 0, rr(0, 3), 0.2), tint(PAL.rock)); col.box(x - r * 0.75, x + r * 0.75, z - r * 0.75, z + r * 0.75, y - 1, y + r * 0.8); };
  boulder(6.5, 0, 12.5, 1.1); boulder(8.2, 0, 13.8, 0.7); boulder(-20, 0, 11, 1.4); boulder(-18.4, 0, 16.5, 1.0);
  boulder(13.5, Y.bed, -1, 0.9); boulder(16.6, Y.bed, 2.2, 0.7); boulder(11.4, Y.bed, -9.5, 0.8);
  boulder(24, 0, 12, 1.3); boulder(26, 0, 15.5, 1.6);

  // remnant processional path on the south bank (gate → crossing), mostly lost
  pave(-13, -1.5, 10.0, 12.6, 0, { size: 1.25, loss: 0.8, missing: 0.15, tilt: 0.04 });
  pave(-6.5, -1.5, 12.6, 17.5, 0, { size: 1.25, loss: 0.9, missing: 0.25, tilt: 0.04 });
  for (const [x, z, ry] of [[6.2, 15.4, 0.3], [7.3, 15.9, 1.2]]) B.stoneClean.add(new THREE.CylinderGeometry(0.42, 0.42, 0.85, 10), mat4(x, 0.38, z, 0, ry, Math.PI / 2 + 0.05), tint(PAL.limestone));
  col.box(5.6, 7.9, 15, 16.4, -1, 0.75);

  // stream banks: limestone slabs, rocks and overhanging growth break the straight edges
  for (const [zEdge, dir] of [[5.4, 1], [9.1, -1]]) {
    for (let x = -23; x < 27; x += rr(1.4, 3.2)) {
      if (x > 9.6 && x < 18.4 && dir > 0) continue; // gorge mouth stays open
      if (x > -5.5 && x < -1.8) continue;          // the crossing stays readable
      const k = R();
      if (k < 0.45) {
        const w = rr(0.9, 1.8);
        B.rock.add(stoneBlock(w, rr(0.3, 0.55), rr(0.7, 1.2), { jitter: 0.08, chip: 0.5 }), mat4(x, -0.25, zEdge + dir * rr(0.1, 0.5), rr(-0.15, 0.15), rr(-0.4, 0.4), rr(-0.12, 0.12)), tint(R() < 0.5 ? PAL.limeCool : PAL.rock, 0.06));
      } else if (k < 0.75) {
        V.fern(x, -0.15, zEdge + dir * 0.2, rr(0.7, 1.0), R() < 0.5 ? PAL.leafOlive : PAL.leaf);
      } else {
        V.shrub(x, -0.35, zEdge - dir * 0.25, rr(0.55, 0.8), { color: PAL.leafOlive, dark: PAL.leafDark, flat: 0.5 });
      }
    }
  }

  // ground zones: moss beds, damp dark soil by water, dirt path
  patch(-17, 0, 13.5, 3.2, PAL.moss);
  patch(3, 0, 16, 3.0, PAL.moss, { squash: 0.6 });
  patch(-6.5, 0, 11.6, 2.2, 0x6c5c46, { squash: 0.55 }); // trodden path toward the crossing
  patch(-3.5, 0, 10.8, 1.8, 0x6c5c46, { squash: 0.6 });
  patch(-14, 0, 2.6, 2.6, PAL.mossDark, { squash: 0.6 });
  patch(5, 0, 3.0, 2.4, PAL.moss, { squash: 0.6 });
  patch(24, 0, 2.5, 2.4, PAL.mossDark);
  patch(-19, Y.cy, -2, 2.4, PAL.moss);
  patch(-18, Y.cy, -9, 3.2, PAL.mossDark, { squash: 0.8 });
  patch(7.5, Y.cy, -2, 1.6, PAL.moss);
  patch(-15, Y.ter, -15, 2.6, PAL.moss);
  patch(22, Y.ter, -19, 3.0, PAL.mossDark);
  patch(22, Y.cy, -2.6, 1.8, PAL.moss);

  // =========================================================================
  // VEGETATION
  // =========================================================================
  V.bigTree(treeX, Y.cy, treeZ);
  // roots crawling over the courtyard and spilling down the retaining wall
  const T = (pts, r0, r1) => V.root(pts.map(([a, b, c]) => [treeX + a, b, treeZ + c]), r0, r1);
  // two meandering surface roots that find the wall edge and spill down it
  T([[1.4, 3.06, 1.0], [2.4, 3.02, 2.6], [1.9, 3.02, 4.3], [2.9, 3.02, 5.9], [3.3, 3.0, 7.4], [3.5, 2.6, 7.8], [3.6, 1.2, 7.9], [3.9, 0.1, 8.05]], 0.3, 0.08);
  T([[-0.9, 3.06, 1.2], [-0.6, 3.02, 3.0], [-1.6, 3.02, 4.6], [-1.2, 3.02, 6.4], [-1.5, 2.7, 7.75], [-1.6, 1.5, 7.9], [-1.4, 0.3, 8.1]], 0.32, 0.08);
  T([[1.2, 3.1, -0.3], [2.4, 3.03, -1.1], [3.6, 3.03, -0.6], [4.6, 3.02, -1.3]], 0.3, 0.06);
  T([[0.0, 3.2, -0.8], [-0.4, 3.1, -3.0], [-0.2, 3.6, -4.4], [0.0, 5.6, -4.55], [0.2, 6.1, -5.4]], 0.24, 0.07);
  T([[-0.9, 3.1, 0.0], [-2.0, 3.03, 0.7], [-3.1, 3.03, 0.3], [-4.2, 3.05, 1.0]], 0.3, 0.06);
  // wall vegetation: vine curtains & ferns at the wall foot
  V.vineCurtain(-21.5, -16.2, Y.cy, 0.05, 2.6, 1, 1.4);
  V.vineCurtain(6.5, 9.8, Y.cy, 0.05, 1.8, 1, 1.2);
  V.vineCurtain(-20, -14, Y.ter, -11.95, 2.2, 1, 1.0);
  V.vineCurtain(4, 7, Y.ter, -11.95, 1.6, 1, 1.0);
  V.vineCurtain(10.5, 12.3, Y.ter, -11.95, 3.4, 1, 1.4);
  V.vineCurtain(15.6, 17.6, Y.ter, -11.95, 3.6, 1, 1.4);
  V.vineCurtain(11.0, 16.8, Y.cy, -4.75, 2.2, 1, 1.2);
  // bridge underside / gorge greenery
  V.fern(10.8, Y.bed, -3.5, 1.1); V.fern(17.2, Y.bed, -1.5, 1.0); V.fern(12.2, Y.bed, -10.8, 1.1); V.fern(16.8, Y.bed, -10.6, 0.9);
  V.reeds(11.0, Y.bed, 3.0, 1.0); V.reeds(17.0, Y.bed, 4.6, 0.9); V.reeds(12.6, Y.bed, -8.0, 0.8);
  // wall-foot ferns along the retaining wall
  for (const x of [-22.5, -19.6, -15.8, -10.6, -8.2, 2.0, 8.4]) V.fern(x, 0, 0.75 + rr(0, 0.4), rr(0.9, 1.3));
  for (const x of [-21, -11.5, 8.8]) V.shrub(x, 0, 1.3, rr(0.8, 1.1));
  // stream bank reeds & shrubs
  for (const [x, z] of [[-21, 5.4], [-16, 5.2], [-9.5, 5.3], [3.5, 5.4], [7.5, 5.2], [-12, 9.6], [-0.5, 9.7], [5.5, 9.6], [21, 9.5], [25, 5.3]]) V.reeds(x, -0.1, z, rr(0.8, 1.1));
  // south bank groups (calm areas left open on the path)
  V.shrub(-18.5, 0, 9.8, 1.3, { color: PAL.leafOlive }); V.shrub(-15.6, 0, 16.8, 1.5); V.fern(-14.5, 0, 14.5, 1.2);
  V.shrub(2.5, 0, 12.4, 1.0, { color: PAL.leafOlive }); V.fern(4.2, 0, 11.4, 1.0); V.shrub(10, 0, 16.5, 1.6); V.fern(12, 0, 11.2, 1.2);
  V.smallTree(-21.5, 0, 14.5, 1.2, 0.5);
  V.smallTree(20.5, 0, 14.2, 1.1, -0.4);
  // foreground framing masses (near the camera, dark)
  V.shrub(-8, 0, 18.4, 1.8, { color: PAL.leafDark, dark: 0x222d24 }); V.shrub(4, 0, 18.6, 2.0, { color: PAL.leafDark, dark: 0x222d24 });
  V.fern(-2, 0, 18.0, 1.4, PAL.leafDark);
  // courtyard planting
  V.shrub(-13.6, Y.cy, -10.6, 1.1); V.fern(-9.2, Y.cy, -11.2, 1.0); V.fern(-0.7, Y.cy, -11.1, 0.9); V.shrub(7.0, Y.cy, -10.9, 1.0);
  V.fern(8.6, Y.cy, -9.6, 1.0); V.fern(-14.2, Y.cy, -1.4, 1.0); V.shrub(-21.6, Y.cy, -1.2, 1.3); V.fern(-6.8, Y.cy, -0.9, 0.8);
  V.fern(9.2, Y.cy, -3.6, 0.9); V.shrub(-22.5, Y.cy, -11, 1.4);
  // promontory + terrace
  V.shrub(26.8, Y.cy, -10.8, 1.3); V.fern(19, Y.cy, -1.2, 1.0); V.fern(26.8, Y.cy, -6.0, 1.1); V.shrub(18.9, Y.cy, -11, 0.9);
  V.smallTree(25.5, Y.ter, -21.5, 1.3, -0.5);
  V.smallTree(-18, Y.ter, -21, 1.2, 0.6);
  // a tree grown out of the shrine roof, roots pouring down the façade corner
  for (const [rx, ry, rz] of SHRINE_ROOTS) {
    V.smallTree(rx, ry - 0.2, rz, 0.9, 0.5);
    V.root([[rx, ry, rz], [rx - 0.3, ry, rz + 2.5], [rx - 0.5, ry - 0.6, rz + 3.35], [rx - 0.55, ry - 3.0, rz + 3.5], [rx - 0.4, ry - 6.0, rz + 3.6], [rx - 0.2, ry - 7.0, rz + 4.2]], 0.2, 0.06);
    V.root([[rx + 0.4, ry, rz], [rx + 1.5, ry, rz + 2.4], [rx + 1.8, ry - 0.7, rz + 3.4], [rx + 2.0, ry - 2.6, rz + 3.5]], 0.16, 0.04);
    V.vineCurtain(rx - 0.6, rx + 4.0, ry - 0.55, rz + 3.45, 3.4, 1, 1.3);
  }
  V.shrub(-10.8, Y.ter, -22.8, 1.4); V.shrub(6.5, Y.ter, -23.2, 1.3); V.fern(-8, Y.ter, -17.4, 1.0); V.fern(4.6, Y.ter, -17.6, 1.0);
  V.shrub(12, Y.ter, -22.6, 1.4); V.shrub(18.5, Y.ter, -23.0, 1.2); V.fern(-14, Y.ter, -12.8, 0.9);
  // cliff-top canopies behind the terrace (backdrop masses)
  for (let x = -22; x < 28; x += rr(4, 6)) V.clump(x, 13.6 + rr(-0.5, 1), -26.5 + rr(-1, 1), rr(2.0, 2.8), { n: 5, color: R() < 0.5 ? PAL.leafDark : PAL.leaf });
  V.vineCurtain(-10, -4, 13.2, -23.6, 3.5, 1, 0.8);
  V.vineCurtain(8, 14, 13.0, -23.6, 4.5, 1, 0.8);
  // west/east cliff greenery
  for (let z = -18; z < 18; z += rr(5, 8)) { V.clump(-24.5, rr(6, 9), z, rr(1.6, 2.4), { n: 4, color: PAL.leafDark }); V.clump(28.5, rr(6, 9), z, rr(1.6, 2.4), { n: 4, color: PAL.leafDark }); }

  // =========================================================================
  // assemble meshes
  // =========================================================================
  const group = new THREE.Group();
  const add = (b, m, cast = true) => { if (!b.empty) group.add(mesh(b.build(), m, { cast })); };
  add(B.stone, M.stone); add(B.stoneClean, M.stoneClean); add(B.ground, M.ground, false);
  add(B.paving, M.paving, false); add(B.rock, M.rock); add(B.trim, M.trim); add(B.gold, M.gold);
  add(B.bed, M.bed, false);
  for (const m of V.buildVegMeshes(M)) group.add(m);
  scene.add(group);

  return { col, group, mats: M };
}

function setColor(g, c) {
  const col = new THREE.Color(c), n = g.attributes.position.count, arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) arr.set([col.r, col.g, col.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  g.computeVertexNormals();
}

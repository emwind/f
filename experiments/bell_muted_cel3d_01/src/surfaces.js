import * as THREE from '../vendor/three.module.min.js';
import { RAMP } from './materials.js';
import { rng } from './geom.js';

// ---------------------------------------------------------------------------
// Authored large surfaces (final deciding test).
// The courtyard floor and the main retaining wall are PAINTED: each is a
// hand-designed 2D illustration (stone layout, worn route, lost slabs, moss
// along joints, damp washes, a repair, a crack) drawn once into a canvas and
// mapped onto a single plane. Lighting/toon ramp are unchanged; the surface
// design carries the detail, as in hand-painted textures of late-90s 3D.
// ---------------------------------------------------------------------------

const C = {
  joint: '#625646', soil: '#6e5c45', soilLight: '#857055', soilDark: '#54473a',
  slab: ['#b3a68a', '#aa9d82', '#a39880', '#b9ab8e', '#9f9783'],
  route: ['#b6a98c', '#b1a488', '#b9ac8f'],
  lit: 'rgba(236,226,198,0.38)', shade: 'rgba(70,60,48,0.42)',
  moss: '#646a40', mossDark: '#4b5135', mossLight: '#7a7d4c',
  damp: 'rgba(52,62,60,0.38)', stain: 'rgba(48,52,46,0.42)',
  wall: ['#b4a88e', '#aaa18a', '#bdb194', '#a29a86', '#b6ab91'],
  wallLow: ['#958d7c', '#8b8576', '#9a927f'],
  mortar: '#4f473d', crack: '#2e2a25',
};

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')]; }
function toTexture(canvas, renderer) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}
function surfaceMaterial(tex, tone = 0xe2e0dc) {
  // tone: a slight overall value drop so painted surfaces sit with the rest of the world
  const toon = new THREE.MeshToonMaterial({ map: tex, gradientMap: RAMP, color: tone });
  const lam = new THREE.MeshLambertMaterial({ map: tex, color: tone });
  toon.userData.alt = lam; lam.userData.alt = toon;
  return toon;
}
const path = (ctx, pts) => { ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); };
const shift = (pts, dx, dy) => pts.map(([x, y]) => [x + dx, y + dy]);
const inset = (pts, d) => {
  const cx = pts.reduce((a, p) => a + p[0], 0) / pts.length, cy = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  return pts.map(([x, y]) => { const l = Math.hypot(x - cx, y - cy) || 1; return [x - (x - cx) / l * d, y - (y - cy) / l * d]; });
};
const soft = (ctx, x, y, r, color, a) => {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, color.replace('A', a)); g.addColorStop(1, color.replace('A', 0));
  ctx.fillStyle = g; ctx.fillRect(x - r, y - r, r * 2, r * 2);
};

// One painted stone: shade band bottom-right, lit band top-left (light from
// upper-left), a calm body, and one or two broad pigment blotches — no noise.
function stone(ctx, pts, base, R, { edge = 4, lit = C.lit, shade = C.shade, blotch = 0.5 } = {}) {
  ctx.save(); path(ctx, pts); ctx.clip();
  ctx.fillStyle = base; ctx.fill();
  ctx.fillStyle = shade; path(ctx, pts); ctx.fill();
  ctx.fillStyle = base; path(ctx, shift(pts, -edge, -edge)); ctx.fill();
  ctx.fillStyle = lit; path(ctx, pts); ctx.fill();
  ctx.fillStyle = base; path(ctx, shift(inset(pts, edge), edge * 0.35, edge * 0.35)); ctx.fill();
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  if (R() < blotch) soft(ctx, x0 + (x1 - x0) * R(), y0 + (y1 - y0) * R(), Math.max(x1 - x0, y1 - y0) * (0.4 + R() * 0.4), R() < 0.5 ? 'rgba(240,230,205,A)' : 'rgba(80,72,60,A)', 0.16);
  ctx.restore();
}
// Organic blob (moss, soil, stains)
function blob(ctx, x, y, rx, ry, color, R, n = 14) {
  ctx.beginPath();
  const ph = R() * 6;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2, k = 0.78 + 0.22 * Math.sin(a * 3 + ph) + 0.12 * Math.sin(a * 7 + ph * 2);
    const px = x + Math.cos(a) * rx * k, py = y + Math.sin(a) * ry * k;
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath(); ctx.fillStyle = color; ctx.fill();
}
function crackLine(ctx, pts, w) {
  ctx.lineJoin = 'miter'; ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(232,222,196,0.45)'; ctx.lineWidth = w + 2; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x - 1.5, y - 1.5) : ctx.moveTo(x - 1.5, y - 1.5))); ctx.stroke();
  ctx.strokeStyle = C.crack; ctx.lineWidth = w; ctx.beginPath(); pts.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.stroke();
}

// ===========================================================================
// COURTYARD FLOOR  (x −24..10, z −12..0)
// ===========================================================================
export const FLOOR = { x0: -24, x1: 10, z0: -12, z1: 0 };
const FK = 60; // px per metre

// Authored zones (world metres)
const ROUTE = [[-3, 0.2], [-3.1, -2.4], [-2.2, -3.4], [0.4, -4.6], [3.6, -5.9], [7.0, -6.0], [10.2, -6.0]]; // stair head → ring → bridge
const ROUTE_W = [[-3, -3.0], [-6.5, -4.4], [-10.5, -5.2], [-13.2, -6.2]];                                   // faint branch toward the tree
const LOST = [ // missing-slab soil zones: [x, z, rx, rz]
  [-17.5, -7.5, 5.2, 4.0], [-21.5, -1.6, 2.8, 1.8], [-22.5, -11, 2.0, 1.4], [7.6, -10.6, 2.2, 1.2],
  [9.0, -2.4, 1.3, 1.6], [-11.6, -3.1, 2.2, 1.1], [-7.2, -9.6, 1.5, 0.9], [4.0, -1.0, 1.2, 0.7],
];
const ringAvoid = (x, z) => Math.hypot(x + 3, z + 5.5) < 2.55;
function distToPolyline(x, z, pl) {
  let best = Infinity;
  for (let i = 0; i < pl.length - 1; i++) {
    const [ax, az] = pl[i], [bx, bz] = pl[i + 1];
    const vx = bx - ax, vz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / (vx * vx + vz * vz)));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}
const lostAmt = (x, z) => LOST.reduce((m, [lx, lz, rx, rz]) => Math.max(m, 1 - Math.hypot((x - lx) / rx, (z - lz) / rz)), 0);

export function paintFloor(renderer) {
  const W = (FLOOR.x1 - FLOOR.x0) * FK, H = (FLOOR.z1 - FLOOR.z0) * FK;
  const [cv, ctx] = makeCanvas(W, H);
  const R = rng(4242);
  const P = (x, z) => [(x - FLOOR.x0) * FK, (z - FLOOR.z0) * FK];

  // 1. ground: compacted soil, with broad warm/cool pigment regions
  ctx.fillStyle = C.joint; ctx.fillRect(0, 0, W, H);
  // 2. slabs in east-west courses of varying depth; route slabs bigger and calmer
  let z = FLOOR.z0 + 0.15;
  const bedOff = (zz, x) => 0.08 * Math.sin(x * 0.45 + zz * 3.1) + 0.05 * Math.sin(x * 1.3 + zz);
  const soilFills = [];
  while (z < FLOOR.z1 - 0.1) {
    const d = Math.min(FLOOR.z1 - z, 0.95 + R() * 0.9);
    let x = FLOOR.x0 - R() * 0.8;
    while (x < FLOOR.x1) {
      const cx0 = x, cz = z + d / 2;
      const onRoute = Math.min(distToPolyline(cx0 + 0.7, cz, ROUTE), distToPolyline(cx0 + 0.7, cz, ROUTE_W) + 0.6) < 1.5;
      const w = onRoute ? 1.6 + R() * 1.4 : 0.8 + R() * 1.5;
      const cx = x + w / 2;
      const la = lostAmt(cx, cz);
      const g = (onRoute ? 0.02 : 0.03) + R() * 0.025; // joint half-width (m)
      const j = () => (R() - 0.5) * 0.12;
      let q = [
        [x + g + j(), z + g + bedOff(z, x) + j() * 0.5], [x + w - g + j(), z + g + bedOff(z, x + w) + j() * 0.5],
        [x + w - g + j(), z + d - g + bedOff(z + d, x + w) + j() * 0.5], [x + g + j(), z + d - g + bedOff(z + d, x) + j() * 0.5],
      ];
      if (!ringAvoid(cx, cz)) {
        if (la > 0.25 + R() * 0.25) {
          soilFills.push([cx, cz, w, d, la]);
        } else {
          const broken = la > 0.05 || R() < 0.06;
          if (broken) { // broken edge: knock a corner off toward the lost zone
            const k = (R() * 4) | 0, o = 0.25 + R() * 0.35;
            q.splice(k, 1, [q[k][0] + (k === 0 || k === 3 ? o : -o), q[k][1]], [q[k][0], q[k][1] + (k < 2 ? o : -o)]);
          }
          const base = onRoute ? C.route[(R() * 3) | 0] : C.slab[(R() * C.slab.length) | 0];
          stone(ctx, q.map(([a, b]) => P(a, b)), base, R, { edge: onRoute ? 2.5 : 3.5, blotch: onRoute ? 0.3 : 0.6, lit: onRoute ? 'rgba(240,232,206,0.35)' : C.lit, shade: onRoute ? 'rgba(80,70,56,0.4)' : C.shade });
          // a crack across some off-route slabs
          if (!onRoute && R() < 0.12) { const [ax, ay] = P(x + w * 0.2, z + g), [bx, by] = P(x + w * (0.5 + R() * 0.3), z + d - g); crackLine(ctx, [[ax, ay], [(ax + bx) / 2 + 6, (ay + by) / 2], [bx, by]], 2); }
        }
      }
      x += w;
    }
    z += d;
  }
  // 3. lost slabs → soil beds with pebbles, edged by moss
  for (const [cx, cz, w, d, la] of soilFills) {
    const [px, py] = P(cx, cz);
    blob(ctx, px, py, w * FK * 0.62, d * FK * 0.62, R() < 0.5 ? C.soil : C.soilDark, R);
    if (R() < 0.6) blob(ctx, px + (R() - 0.5) * w * FK * 0.4, py, w * FK * 0.3, d * FK * 0.25, C.soilLight, R);
    for (let i = 0; i < 3; i++) if (R() < 0.5) { ctx.fillStyle = 'rgba(190,178,150,0.8)'; ctx.beginPath(); ctx.ellipse(px + (R() - 0.5) * w * FK * 0.8, py + (R() - 0.5) * d * FK * 0.6, 3 + R() * 4, 2 + R() * 3, R() * 3, 0, 7); ctx.fill(); }
    if (la > 0.5 && R() < 0.75) blob(ctx, px + (R() - 0.5) * 30, py + (R() - 0.5) * 20, w * FK * 0.42, d * FK * 0.36, R() < 0.5 ? C.moss : C.mossDark, R);
  }
  // 4. moss creeping along joints in the sheltered bands (terrace wall base, around the tree, low wall)
  const mossy = (x, z) => Math.max(1 - (z + 12) / 1.9, lostAmt(x, z) * 1.25, 1 - Math.hypot(x + 11.5, z + 3.4) / 2.6, 1 - Math.hypot(x - 8.8, z + 9.6) / 2.4);
  ctx.lineCap = 'round';
  for (let i = 0; i < 2200; i++) {
    const x = FLOOR.x0 + R() * (FLOOR.x1 - FLOOR.x0), zz = FLOOR.z0 + R() * (FLOOR.z1 - FLOOR.z0);
    const m = mossy(x, zz);
    if (m < 0.1 || R() > m * 1.2 || ringAvoid(x, zz) || distToPolyline(x, zz, ROUTE) < 1.1) continue;
    const [px, py] = P(x, zz);
    blob(ctx, px, py, 7 + R() * 22 * m, 5 + R() * 12 * m, R() < 0.35 ? C.mossDark : R() < 0.7 ? C.moss : C.mossLight, R, 9);
  }
  // 5. broad washes: damp cool band at the terrace wall foot and the gorge lip; warm exposed centre
  let g = ctx.createLinearGradient(0, 0, 0, 2.6 * FK);
  g.addColorStop(0, 'rgba(46,56,56,0.42)'); g.addColorStop(1, 'rgba(46,56,56,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, 2.6 * FK);
  g = ctx.createLinearGradient(W - 1.8 * FK, 0, W, 0); g.addColorStop(0, 'rgba(46,56,56,0)'); g.addColorStop(1, 'rgba(46,56,56,0.32)');
  ctx.fillStyle = g; ctx.fillRect(W - 1.8 * FK, 0, 1.8 * FK, H);
  { const [px, py] = P(-17.5, -7.5); soft(ctx, px, py, 7 * FK, 'rgba(40,48,42,A)', 0.35); }       // under the canopy
  { const [px, py] = P(-1.5, -4.5); soft(ctx, px, py, 8 * FK, 'rgba(236,222,190,A)', 0.12); }     // warm exposed centre
  { const [px, py] = P(-3, -1.2); soft(ctx, px, py, 2.4 * FK, 'rgba(236,224,196,A)', 0.14); }     // polished stair head
  // 6. route wear: soften joints along the walked line
  ctx.globalCompositeOperation = 'soft-light';
  ctx.strokeStyle = 'rgba(240,230,205,0.22)'; ctx.lineJoin = 'round';
  for (const [pl, w] of [[ROUTE, 1.7], [ROUTE_W, 0.9]]) { ctx.lineWidth = w * FK; ctx.beginPath(); pl.forEach(([x, zz], i) => { const [px, py] = P(x, zz); i ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }); ctx.stroke(); }
  ctx.globalCompositeOperation = 'source-over';

  const tex = toTexture(cv, renderer);
  const geo = new THREE.PlaneGeometry(FLOOR.x1 - FLOOR.x0, FLOOR.z1 - FLOOR.z0);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, surfaceMaterial(tex));
  mesh.position.set((FLOOR.x0 + FLOOR.x1) / 2, 3.03, (FLOOR.z0 + FLOOR.z1) / 2);
  mesh.receiveShadow = true;
  return mesh;
}

// Authored relief on the floor: heaved / tilted slabs where roots and loss zones meet
export const FLOOR_RELIEF = [
  // [x, z, w, d, rx, rz, ry, color]
  [-13.6, -5.4, 1.4, 1.0, 0.12, 0.0, 0.3, '#a39880'], [-14.8, -9.6, 1.2, 0.9, -0.1, 0.14, 0.9, '#9f9783'],
  [-12.9, -8.4, 1.0, 0.8, 0.0, -0.16, 0.2, '#aa9d82'], [-19.5, -2.6, 1.1, 0.8, 0.1, 0.08, 1.2, '#a39880'],
  [8.0, -3.2, 0.9, 0.9, -0.12, 0.05, 0.6, '#9f9783'], [6.3, -10.0, 1.1, 0.7, 0.06, -0.1, 0.1, '#aa9d82'],
  [-10.4, -2.4, 0.8, 0.6, 0.18, 0.0, 0.5, '#a39880'],
];

// ===========================================================================
// RETAINING WALL  (south face z = 0, y −0.4 .. 3.0)
// ===========================================================================
const WK = 112;
export const WALL_SEGMENTS = [{ x0: -24, x1: -6.6 }, { x0: 0.6, x1: 10 }];
const WY0 = -0.4, WY1 = 3.0;

export function paintWall(renderer, seg, seed) {
  const L = seg.x1 - seg.x0, Hm = WY1 - WY0;
  const W = Math.round(L * WK), H = Math.round(Hm * WK);
  const [cv, ctx] = makeCanvas(W, H);
  const R = rng(seed);
  const P = (x, y) => [(x - seg.x0) * WK, (WY1 - y) * WK]; // canvas y down from wall top
  ctx.fillStyle = C.mortar; ctx.fillRect(0, 0, W, H);

  // authored features in world x
  const repair = seg.x0 < -10 ? { x0: -18.4, x1: -15.6, y0: 0.55, y1: 2.15 } : null;  // rubble repair
  const crack = seg.x0 < -10 ? -9.6 : 5.4;                                            // big crack x
  const throughAt = seg.x0 < -10 ? [-22.2, -13.8, -11.0] : [3.0, 8.2];                // tall stones spanning courses
  // course rhythm: footing, then alternating tall/short courses (not uniform)
  const courses = [[WY0, 0.42], [0.42, 1.12], [1.12, 1.6], [1.6, 2.3], [2.3, 2.62], [2.62, WY1]];
  const disp = (x, y) => (x > crack ? 0.03 : 0) * (y > 0.8 ? 1 : 0); // stones east of the crack have slumped

  for (let ci = 0; ci < courses.length; ci++) {
    const [y0, y1] = courses[ci];
    let x = seg.x0 - R() * 0.9;
    while (x < seg.x1) {
      let w = ci === 0 ? 1.4 + R() * 1.2 : (R() < 0.5 ? 0.8 + R() * 0.5 : 1.4 + R() * 1.0);
      let top = y1;
      const ta = throughAt.find((t) => t > x && t < x + w + 0.6);
      if (ta !== undefined && ci === 1) { top = courses[2][1]; w = 1.0 + R() * 0.3; } // through-stone spans two courses
      if (ci === 2 && throughAt.some((t) => t > x - 0.3 && t < x + 1.3)) { x += 1.3; continue; }
      const cx = x + w / 2, cy = (y0 + top) / 2;
      if (repair && cx > repair.x0 && cx < repair.x1 && cy > repair.y0 && cy < repair.y1) { x += w; continue; }
      const g = 0.03;
      const dy = disp(cx, cy);
      const q = [[x + g + (R() - 0.5) * 0.06, top - g - dy], [x + w - g + (R() - 0.5) * 0.06, top - g - dy + (R() - 0.5) * 0.04],
                 [x + w - g + (R() - 0.5) * 0.08, y0 + g - dy], [x + g + (R() - 0.5) * 0.08, y0 + g - dy]].map(([a, b]) => P(a, b));
      // rounded/broken outer corners on some stones
      if (R() < 0.35) { const k = (R() * 4) | 0; q.splice(k, 1, [q[k][0] + (k === 0 || k === 3 ? 6 : -6), q[k][1]], [q[k][0], q[k][1] + (k < 2 ? 6 : -6)]); }
      const low = ci <= 1;
      const base = low ? C.wallLow[(R() * C.wallLow.length) | 0] : C.wall[(R() * C.wall.length) | 0];
      stone(ctx, q, base, R, { edge: 5, blotch: 0.55 });
      x += w;
    }
  }
  // rubble repair: small stones in lighter mortar, slightly lighter limestone
  if (repair) {
    const [rx0, ry0] = P(repair.x0, repair.y1), [rx1, ry1] = P(repair.x1, repair.y0);
    ctx.fillStyle = '#7a705f'; ctx.fillRect(rx0, ry0, rx1 - rx0, ry1 - ry0);
    for (let y = repair.y0 + 0.02; y < repair.y1 - 0.05; y += 0.24 + R() * 0.1) {
      for (let x = repair.x0 + R() * 0.2; x < repair.x1 - 0.1; x += 0.3 + R() * 0.25) {
        const s = 0.22 + R() * 0.14;
        const q = [[x, y + s * 0.9], [x + s, y + s * (0.8 + R() * 0.2)], [x + s * 1.1, y + 0.02], [x + 0.03, y]].map(([a, b]) => P(a, b));
        stone(ctx, q, ['#b8ad94', '#ada38c', '#c0b49a'][(R() * 3) | 0], R, { edge: 3, blotch: 0.2 });
      }
    }
  }
  // big crack from the top down through the courses
  {
    const pts = []; let x = crack, y = WY1;
    while (y > 0.5) { pts.push(P(x, y)); y -= 0.22 + R() * 0.2; x += (R() - 0.5) * 0.35; }
    crackLine(ctx, pts, 6);
  }
  // damp: dark wash rising from the foot with an irregular tide line, plus vertical runs
  ctx.save();
  ctx.beginPath(); ctx.moveTo(0, H);
  for (let x = 0; x <= W; x += 24) ctx.lineTo(x, H - (0.85 + 0.35 * Math.sin(x * 0.011) + 0.2 * Math.sin(x * 0.037)) * WK);
  ctx.lineTo(W, H); ctx.closePath();
  const dg = ctx.createLinearGradient(0, H - 1.4 * WK, 0, H); dg.addColorStop(0, 'rgba(44,52,50,0.05)'); dg.addColorStop(1, 'rgba(40,48,46,0.4)');
  ctx.fillStyle = dg; ctx.fill(); ctx.restore();
  const runs = seg.x0 < -10 ? [[-20.6, 2.6], [-18.9, 3.0], [-16.8, 1.8], [-13.6, 3.0], [-13.0, 1.2], [-8.4, 1.6]] : [[7.2, 2.2], [8.6, 2.6], [2.2, 1.3]];
  for (const [rx, len] of runs) {
    const [px, py] = P(rx, WY1 - 0.1);
    const w = (0.25 + R() * 0.3) * WK;
    const sg = ctx.createLinearGradient(0, py, 0, py + len * WK);
    sg.addColorStop(0, 'rgba(46,52,46,0.5)'); sg.addColorStop(1, 'rgba(46,52,46,0)');
    ctx.fillStyle = sg;
    ctx.beginPath(); ctx.moveTo(px - w / 2, py); ctx.lineTo(px + w / 2, py); ctx.lineTo(px + w * 0.15, py + len * WK); ctx.lineTo(px - w * 0.2, py + len * WK * 0.9); ctx.closePath(); ctx.fill();
  }
  // moss: under the coping lip, in the damp foot, and along the crack
  for (let i = 0; i < 70; i++) {
    const x = seg.x0 + R() * L;
    const [px, py] = P(x, WY1 - 0.06 - R() * 0.12);
    if (R() < 0.55) blob(ctx, px, py, 10 + R() * 26, 4 + R() * 6, R() < 0.5 ? C.moss : C.mossDark, R, 9);
  }
  for (let i = 0; i < 40; i++) {
    const x = seg.x0 + R() * L, [px, py] = P(x, WY0 + 0.1 + R() * 0.5);
    if (R() < 0.6) blob(ctx, px, py, 10 + R() * 22, 6 + R() * 12, R() < 0.6 ? C.mossDark : C.moss, R, 9);
  }
  for (let y = 2.6; y > 0.9; y -= 0.45) { const [px, py] = P(crack + (R() - 0.5) * 0.2, y); blob(ctx, px, py, 7 + R() * 9, 5 + R() * 6, C.mossDark, R, 8); }

  const tex = toTexture(cv, renderer);
  const geo = new THREE.PlaneGeometry(L, Hm);
  const mesh = new THREE.Mesh(geo, surfaceMaterial(tex));
  mesh.position.set((seg.x0 + seg.x1) / 2, (WY0 + WY1) / 2, 0.035);
  mesh.receiveShadow = true;
  return mesh;
}

// Authored relief stones on the wall face (protruding stones, broken corner quoins)
// [x, y, w, h, d(protrusion), rz, color]
export const WALL_RELIEF = [
  [-21.0, 0.75, 1.3, 0.62, 0.16, 0.02, '#8b8473'], [-14.6, 2.0, 0.9, 0.5, 0.12, -0.03, '#a89c84'],
  [-10.2, 1.4, 1.1, 0.45, 0.1, 0.0, '#9e9580'], [-7.4, 0.3, 1.2, 0.7, 0.2, 0.04, '#7c776a'],
  [2.0, 0.9, 1.0, 0.55, 0.14, -0.02, '#857e6f'], [6.6, 1.9, 0.8, 0.42, 0.1, 0.03, '#aaa088'],
  // broken quoins at the gorge corner (x 10) and at the west stair cheek (x −6.6)
  [9.55, 2.55, 0.9, 0.5, 0.22, 0.0, '#b2a68b'], [9.7, 1.6, 0.7, 0.62, 0.18, 0.0, '#a89c84'], [9.5, 0.55, 1.0, 0.7, 0.24, 0.0, '#8b8473'],
  [-6.95, 2.2, 0.7, 0.55, 0.16, 0.0, '#a89c84'], [-7.05, 1.1, 0.9, 0.6, 0.14, 0.0, '#968f7d'],
];

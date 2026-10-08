// The sanctuary layout. A tile grid of heights (1 unit = 1 tile = roughly two
// thirds of the hero's height) painted region by region, plus a few free-standing
// solids (bridges, roof) that the grid cannot express.
//
//  north (far, top of screen)
//  z 0-2   forest rim (8)                      waterfall into the gorge
//  z 3-11  upper sanctuary court (5)  | gorge (0) | Sky Altar pinnacle (6/7)
//  z 12-19 middle bank (2), hall built into the court, bridge landing (3)
//  z 20-27 ravine floor (0) with the stream
//  z 28-41 south forest (3), where the hero starts
//  south (near, bottom of screen)

import { fbm2, value2 } from './noise.js';

export const W = 48;
export const D = 42;

export const T = { GRASS: 0, DIRT: 1, FLAG: 2, WATER: 3, ROCK: 4, ROOT: 5 };

export const WATER_BED = -0.45;
export const WATER_LEVEL = -0.08;

export function buildLevel() {
  const H = new Float32Array(W * D);
  const TY = new Uint8Array(W * D);
  const MAS = new Uint8Array(W * D); // 1 = built masonry sides, 0 = natural rock
  const stairs = new Map();
  const idx = (x, z) => z * W + x;

  const fill = (x0, z0, x1, z1, h, type, mas = 0) => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (x < 0 || z < 0 || x >= W || z >= D) continue;
        const i = idx(x, z);
        if (h !== null) H[i] = h;
        if (type !== null) TY[i] = type;
        MAS[i] = mas;
        stairs.delete(i);
      }
  };
  const typeAt = (x0, z0, x1, z1, type) => {
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) TY[idx(x, z)] = type;
  };
  // Stair run: `dir` is the direction of ascent. Heights interpolate across the run.
  const stair = (x0, z0, x1, z1, dir, from, to, type = T.FLAG) => {
    const len = dir === 'n' || dir === 's' ? z1 - z0 + 1 : x1 - x0 + 1;
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        let k;
        if (dir === 'n') k = z1 - z;
        else if (dir === 's') k = z - z0;
        else if (dir === 'e') k = x - x0;
        else k = x1 - x;
        const a = from + ((to - from) * k) / len;
        const b = from + ((to - from) * (k + 1)) / len;
        const i = idx(x, z);
        stairs.set(i, { dir, from: a, to: b, natural: type !== T.FLAG });
        H[i] = Math.max(a, b);
        TY[i] = type;
        MAS[i] = type === T.FLAG ? 1 : 0;
      }
  };

  // --- base: south forest everywhere
  fill(0, 0, W - 1, D - 1, 3, T.GRASS);

  // --- forest rim at the back, organic lower edge
  for (let x = 0; x < W; x++) {
    const depth = 2 + (fbm2(x * 0.35, 1.3, 3, 4) > 0.55 ? 1 : 0);
    fill(x, 0, x, depth - 1, 8, T.GRASS);
  }

  // --- upper sanctuary court (5), built retaining wall along the south
  fill(0, 3, 29, 11, 5, T.GRASS, 1);
  for (let x = 0; x <= 2; x++) fill(x, 3, x, 11, 5, T.GRASS, 0);
  typeAt(8, 4, 23, 9, T.FLAG);
  typeAt(3, 7, 7, 8, T.DIRT);
  // court back edge meets the rim irregularly
  for (let x = 3; x <= 29; x++) if (value2(x * 0.7, 3, 9) > 0.6) fill(x, 3, x, 3, 8, T.GRASS);

  // landing up to the narrow walkway (6)
  fill(27, 3, 29, 7, 6, T.FLAG, 1);
  stair(25, 5, 26, 6, 'e', 5, 6);

  // --- middle bank (2), natural ravine edge
  fill(0, 12, 29, 19, 2, T.GRASS, 0);
  for (let x = 0; x <= 29; x++) {
    const n = fbm2(x * 0.3, 7.7, 3, 2);
    if (n > 0.58) fill(x, 19, x, 19, 1, T.ROCK);
    if (n < 0.4) fill(x, 18, x, 19, 1.0, T.DIRT);
  }
  typeAt(18, 12, 22, 19, T.DIRT);

  // --- the hall: walls of the court continue down around a sunken interior
  fill(5, 9, 15, 18, 5, T.FLAG, 1); // wall mass
  fill(6, 9, 14, 17, 2, T.FLAG, 1); // interior floor
  fill(9, 18, 11, 18, 2, T.FLAG, 1); // doorway
  // collapsed east wall section: a breach you can climb through after a jump
  fill(15, 14, 15, 15, 3, T.FLAG, 1);
  stair(6, 10, 7, 14, 'n', 2, 5); // interior stair along the west wall
  fill(6, 9, 7, 9, 5, T.FLAG, 1); // landing onto the court

  // --- bridge landing platform (3) with stairs up to the court
  fill(24, 14, 28, 18, 3, T.FLAG, 1);
  stair(25, 12, 26, 13, 'n', 3, 5);
  stair(23, 16, 23, 17, 'e', 2, 3);

  // --- gorge under the narrow walkway (0)
  fill(30, 3, 34, 19, 0, T.ROCK, 0);
  for (let z = 3; z <= 19; z++) {
    const w0 = 31 + (value2(z * 0.4, 1, 3) > 0.6 ? -1 : 0);
    fill(w0, z, 33, z, WATER_BED, T.WATER, 0);
  }

  // --- Sky Altar pinnacle (6) with a raised dais (7)
  fill(35, 3, 45, 11, 6, T.GRASS, 0);
  typeAt(37, 3, 44, 9, T.FLAG);
  fill(39, 4, 43, 8, 7, T.FLAG, 1);
  stair(38, 5, 38, 7, 'e', 6, 7);

  // --- east rise from the ravine: natural ledges, then the root ramp
  fill(35, 12, 45, 16, 2, T.GRASS, 0);
  fill(35, 17, 45, 19, 1, T.ROCK, 0);
  for (let x = 35; x <= 45; x++) {
    if (value2(x * 0.6, 4, 5) > 0.55) fill(x, 17, x, 17, 2, T.GRASS, 0);
    if (value2(x * 0.6, 8, 5) > 0.6) fill(x, 19, x, 19, 0, T.DIRT, 0);
  }
  stair(42, 12, 43, 15, 'n', 2, 5, T.ROOT);

  // --- ravine floor (0)
  fill(0, 20, 45, 27, 0, T.DIRT, 0);
  for (let z = 20; z <= 27; z++)
    for (let x = 0; x <= 45; x++) {
      if (fbm2(x * 0.25, z * 0.25, 3, 6) > 0.52) TY[idx(x, z)] = T.GRASS;
    }
  // stream: from the gorge, bending west along the ravine
  for (let x = 0; x <= 34; x++) {
    const c = 23.4 + 1.1 * Math.sin(x * 0.27) + 0.5 * Math.sin(x * 0.61 + 1);
    for (let z = 20; z <= 27; z++) {
      if (Math.abs(z + 0.5 - c) < 1.45 + (x > 28 ? 0.4 : 0)) fill(x, z, x, z, WATER_BED, T.WATER, 0);
    }
  }
  for (let z = 19; z <= 22; z++) fill(31, z, 33, z, WATER_BED, T.WATER, 0);
  // stepping stones
  for (const [x, z] of [[8, 23], [9, 24], [17, 23], [18, 22], [36 - 30, 22]]) fill(x, z, x, z, 0.15, T.ROCK, 0);

  // --- south forest edge over the ravine (3), organic
  for (let x = 0; x < W; x++) {
    const n = fbm2(x * 0.22, 3.1, 3, 8);
    const edge = 28 + (n > 0.6 ? -1 : n < 0.38 ? 1 : 0);
    fill(x, 28, x, edge - 1 + 1, 3, T.GRASS, 0);
    if (edge > 28) fill(x, 28, x, 28, 0, T.DIRT, 0);
    if (edge < 28) fill(x, 27, x, 27, 3, T.GRASS, 0);
  }
  // the bank is exactly straight where the bridge lands
  fill(24, 27, 28, 27, 0, T.DIRT, 0);
  fill(24, 28, 28, 29, 3, T.FLAG, 1);

  // south forest features
  fill(17, 32, 21, 35, 4, T.GRASS, 0); // mossy knoll
  fill(18, 33, 20, 34, 4, T.ROCK, 0);
  typeAt(18, 33, 20, 34, T.GRASS);
  fill(31, 32, 36, 36, 4, T.FLAG, 1); // ruined shrine plinth
  stair(33, 37, 34, 37, 'n', 3, 4);
  // dirt paths
  for (let x = 4; x <= 40; x++) {
    const z = Math.round(33.5 + Math.sin(x * 0.3) * 1.2);
    for (let dz = 0; dz <= 1; dz++) {
      const i = idx(x, z + dz);
      if (H[i] === 3 && !stairs.has(i)) TY[i] = T.DIRT;
    }
  }
  for (let z = 29; z <= 32; z++) typeAt(12, z, 13, z, T.DIRT);

  // stairs down into the ravine and the natural east slope
  stair(12, 26, 13, 28, 's', 0, 3);
  stair(40, 26, 43, 29, 's', 0, 3, T.DIRT);
  fill(40, 25, 43, 25, 0, T.DIRT, 0);

  // --- borders: tall forest walls left and right, open where the ravine runs
  for (let z = 0; z < D; z++) {
    const inRavine = z >= 20 && z <= 27;
    if (!inRavine) {
      fill(0, z, 0, z, 8, T.GRASS, 0);
      fill(W - 2, z, W - 1, z, 8, T.GRASS, 0);
    } else {
      fill(W - 2, z, W - 1, z, 0, T.DIRT, 0);
    }
  }
  for (let x = 0; x < W; x++) fill(x, D - 2, x, D - 1, 5, T.GRASS, 0);

  // free-standing solids: [x0, z0, x1, z1, bottom, top, kind]
  const solids = [
    // main bridge across the ravine, broken in the middle
    { x0: 25, z0: 19, x1: 27, z1: 22.2, y0: 2.45, y1: 3, kind: 'bridge' },
    { x0: 25, z0: 24.2, x1: 27, z1: 28, y0: 2.45, y1: 3, kind: 'bridge' },
    { x0: 25.15, z0: 20.4, x1: 26.85, z1: 21.6, y0: WATER_BED, y1: 2.45, kind: 'pier' },
    { x0: 25.15, z0: 25.0, x1: 26.85, z1: 26.2, y0: WATER_BED, y1: 2.45, kind: 'pier' },
    // narrow stone beam to the pinnacle
    { x0: 29.9, z0: 5.0, x1: 35.1, z1: 6.0, y0: 5.55, y1: 6, kind: 'beam' },
    // hall roof (walkable if you get up there)
    { x0: 5, z0: 12, x1: 16, z1: 19, y0: 5.3, y1: 5.85, kind: 'roof', hole: [10, 13, 13.5, 15.5] },
  ];

  const level = { W, D, H, TY, MAS, stairs, solids, idx };
  return level;
}

// Height of the walkable terrain surface at a point (stairs are ramps).
export function terrainHeight(L, x, z) {
  const tx = Math.floor(x), tz = Math.floor(z);
  if (tx < 0 || tz < 0 || tx >= L.W || tz >= L.D) return 99;
  const i = tz * L.W + tx;
  const s = L.stairs.get(i);
  if (!s) return L.H[i];
  const fx = x - tx, fz = z - tz;
  let k;
  if (s.dir === 'n') k = 1 - fz;
  else if (s.dir === 's') k = fz;
  else if (s.dir === 'e') k = fx;
  else k = 1 - fx;
  return s.from + (s.to - s.from) * k;
}

export function tileHeight(L, tx, tz) {
  if (tx < 0 || tz < 0 || tx >= L.W || tz >= L.D) return 99;
  return L.H[tz * L.W + tx];
}

export function tileType(L, tx, tz) {
  if (tx < 0 || tz < 0 || tx >= L.W || tz >= L.D) return -1;
  return L.TY[tz * L.W + tx];
}

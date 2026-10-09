// The playable maps. Each map is a tile grid of heights (1 unit = 1 tile, the
// hero is about 1.5 units tall) painted region by region, plus free-standing
// solids (bridges, aqueduct, roof, gates) the grid cannot express, plus lists
// of trees, props, creatures and interactions placed by hand.
//
// OVERWORLD (north is the top of the screen; the journey goes north)
//   z  0-27  Overgrown Sanctuary: upper court + sealed shrine door, ravine, gorge,
//            Sky Altar pinnacle, the hall built into the terrace
//   z 28-41  sanctuary outskirts (3) above the courtyard's north wall
//   z 42-63  Ruined Courtyard (1): pool, broken walls, aqueduct, two terraces
//   z 64-85  Forest Approach: start on a ridge (7), arch bridge, lower path (4)
// SHRINE (entered through the sanctuary door)
//   z 18-45  Underground Shrine: grand stair, pillared hall, galleries, channel
//   z  0-17  Warden's Chamber, and the sealed doorway to what lies beyond

import { fbm2, value2 } from './noise.js';

export const T = { GRASS: 0, DIRT: 1, FLAG: 2, WATER: 3, ROCK: 4, ROOT: 5 };
export const WATER_DEPTH = 0.37; // water surface sits this far above the bed

function painter(W, D) {
  const H = new Float32Array(W * D);
  const TY = new Uint8Array(W * D);
  const MAS = new Uint8Array(W * D);
  const stairs = new Map();
  const idx = (x, z) => z * W + x;
  const ok = (x, z) => x >= 0 && z >= 0 && x < W && z < D;
  const fill = (x0, z0, x1, z1, h, type, mas = 0) => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (!ok(x, z)) continue;
        const i = idx(x, z);
        if (h !== null) H[i] = h;
        if (type !== null) TY[i] = type;
        MAS[i] = mas;
        stairs.delete(i);
      }
  };
  const typeAt = (x0, z0, x1, z1, type, onlyH = null) => {
    for (let z = z0; z <= z1; z++)
      for (let x = x0; x <= x1; x++) {
        if (!ok(x, z)) continue;
        const i = idx(x, z);
        if (onlyH !== null && H[i] !== onlyH) continue;
        if (stairs.has(i)) continue;
        TY[i] = type;
      }
  };
  // Stair run: `dir` is the direction of ascent; heights interpolate across the run.
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
  return { W, D, H, TY, MAS, stairs, idx, fill, typeAt, stair, ok };
}

// =====================================================================
export function buildOverworld() {
  const W = 48, D = 92; // rows 86+ are a non-walkable forest skirt in front of the camera
  const P = painter(W, D);
  const { fill, typeAt, stair, idx, H, TY } = P;

  // ---------------------------------------------------------- base
  fill(0, 0, W - 1, D - 1, 3, T.GRASS);

  // ================= OVERGROWN SANCTUARY (z 0-41) ==================
  // forest rim at the back with an organic lower edge
  for (let x = 0; x < W; x++) {
    const depth = 2 + (fbm2(x * 0.35, 1.3, 3, 4) > 0.55 ? 1 : 0);
    fill(x, 0, x, depth - 1, 8, T.GRASS);
  }
  // upper court (5) with a built retaining wall along the south
  fill(0, 3, 29, 11, 5, T.GRASS, 1);
  for (let x = 0; x <= 2; x++) fill(x, 3, x, 11, 5, T.GRASS, 0);
  typeAt(8, 4, 23, 9, T.FLAG);
  typeAt(3, 7, 7, 8, T.DIRT);
  for (let x = 3; x <= 29; x++) if (value2(x * 0.7, 3, 9) > 0.6 && (x < 11 || x > 20)) fill(x, 3, x, 3, 8, T.GRASS);
  // the shrine facade: a carved recess in the rim, sealed by a stone slab
  fill(11, 0, 20, 2, 8, T.ROCK, 1);
  fill(15, 2, 16, 2, 5, T.FLAG, 1);
  typeAt(11, 3, 20, 4, T.FLAG);

  // landing up to the narrow beam (6)
  fill(27, 3, 29, 7, 6, T.FLAG, 1);
  stair(25, 5, 26, 6, 'e', 5, 6);

  // middle bank (2), natural ravine edge
  fill(0, 12, 29, 19, 2, T.GRASS, 0);
  for (let x = 0; x <= 29; x++) {
    const n = fbm2(x * 0.3, 7.7, 3, 2);
    if (n > 0.58) fill(x, 19, x, 19, 1, T.ROCK);
    if (n < 0.4) fill(x, 18, x, 19, 1.0, T.DIRT);
  }
  typeAt(18, 12, 22, 19, T.DIRT);

  // the hall: built into the court, sunken interior, partly roofed
  fill(5, 9, 15, 18, 5, T.FLAG, 1);
  fill(6, 9, 14, 17, 2, T.FLAG, 1);
  fill(9, 18, 11, 18, 2, T.FLAG, 1); // doorway
  fill(15, 14, 15, 15, 3, T.FLAG, 1); // collapsed breach in the east wall
  stair(6, 10, 7, 14, 'n', 2, 5);
  fill(6, 9, 7, 9, 5, T.FLAG, 1);
  fill(7, 19, 13, 19, 2, T.FLAG, 1); // little forecourt before the door

  // bridge landing platform (3), stairs up to the court and down to the bank
  fill(24, 14, 28, 18, 3, T.FLAG, 1);
  stair(25, 12, 26, 13, 'n', 3, 5);
  stair(23, 16, 23, 17, 'e', 2, 3);

  // gorge under the narrow beam (0) with the stream's source
  fill(30, 3, 34, 19, 0, T.ROCK, 0);
  for (let z = 3; z <= 19; z++) {
    const w0 = 31 + (value2(z * 0.4, 1, 3) > 0.6 ? -1 : 0);
    fill(w0, z, 33, z, -0.45, T.WATER, 0);
  }
  // secret niche behind the waterfall
  fill(31, 2, 33, 2, -0.45, T.WATER, 0);
  fill(32, 1, 33, 1, 0, T.ROCK, 0);

  // Sky Altar pinnacle (6) with raised dais (7)
  fill(35, 3, 45, 11, 6, T.GRASS, 0);
  typeAt(37, 3, 44, 9, T.FLAG);
  fill(39, 4, 43, 8, 7, T.FLAG, 1);
  stair(38, 5, 38, 7, 'e', 6, 7);

  // east rise: natural ledges, then the root ramp
  fill(35, 12, 45, 16, 2, T.GRASS, 0);
  fill(35, 17, 45, 19, 1, T.ROCK, 0);
  for (let x = 35; x <= 45; x++) {
    if (value2(x * 0.6, 4, 5) > 0.55) fill(x, 17, x, 17, 2, T.GRASS, 0);
    if (value2(x * 0.6, 8, 5) > 0.6) fill(x, 19, x, 19, 0, T.DIRT, 0);
  }
  stair(42, 12, 43, 15, 'n', 2, 5, T.ROOT);

  // ravine floor (0) and the stream
  fill(0, 20, 45, 27, 0, T.DIRT, 0);
  for (let z = 20; z <= 27; z++)
    for (let x = 0; x <= 45; x++) if (fbm2(x * 0.18, z * 0.18, 3, 6) > 0.5) TY[idx(x, z)] = T.GRASS;
  for (let x = 0; x <= 34; x++) {
    const c = 23.4 + 1.1 * Math.sin(x * 0.27) + 0.5 * Math.sin(x * 0.61 + 1);
    for (let z = 20; z <= 27; z++) if (Math.abs(z + 0.5 - c) < 1.45 + (x > 28 ? 0.4 : 0)) fill(x, z, x, z, -0.45, T.WATER, 0);
  }
  for (let z = 19; z <= 22; z++) fill(31, z, 33, z, -0.45, T.WATER, 0);
  for (const [x, z] of [[8, 23], [9, 24], [17, 23], [18, 22], [6, 22]]) fill(x, z, x, z, 0.15, T.ROCK, 0);

  // ================= SANCTUARY OUTSKIRTS (z 28-41, height 3) ==========
  for (let x = 0; x < W; x++) {
    const n = fbm2(x * 0.22, 3.1, 3, 8);
    const edge = 28 + (n > 0.6 ? -1 : n < 0.38 ? 1 : 0);
    if (edge > 28) fill(x, 28, x, 28, 0, T.DIRT, 0);
    if (edge < 28) fill(x, 27, x, 27, 3, T.GRASS, 0);
  }
  fill(24, 27, 28, 27, 0, T.DIRT, 0);
  fill(24, 28, 28, 29, 3, T.FLAG, 1);
  fill(17, 32, 21, 35, 4, T.GRASS, 0); // mossy knoll
  fill(31, 32, 36, 36, 4, T.FLAG, 1); // ruined shrine plinth
  stair(33, 37, 34, 37, 'n', 3, 4);
  for (let x = 4; x <= 40; x++) {
    const z = Math.round(33.5 + Math.sin(x * 0.3) * 1.2);
    for (let dz = 0; dz <= 1; dz++) {
      const i = idx(x, z + dz);
      if (H[i] === 3 && !P.stairs.has(i)) TY[i] = T.DIRT;
    }
  }
  typeAt(12, 29, 13, 32, T.DIRT, 3);
  typeAt(21, 36, 23, 41, T.DIRT, 3);
  stair(12, 26, 13, 28, 's', 0, 3);
  stair(40, 26, 43, 29, 's', 0, 3, T.DIRT);
  fill(40, 25, 43, 25, 0, T.DIRT, 0);
  // the outskirts end in a built wall above the courtyard
  fill(1, 40, 45, 41, 3, T.GRASS, 1);
  typeAt(18, 40, 27, 41, T.FLAG);

  // ================= RUINED COURTYARD (z 42-63, floor 1) ==============
  fill(1, 42, 45, 63, 1, T.DIRT, 0);
  for (let z = 42; z <= 63; z++)
    for (let x = 1; x <= 45; x++) if (fbm2(x * 0.2 + 40, z * 0.2, 3, 12) > 0.52) TY[idx(x, z)] = T.GRASS;
  // plaza
  typeAt(15, 46, 32, 59, T.FLAG);
  for (let z = 46; z <= 59; z++)
    for (let x = 15; x <= 32; x++) if (fbm2(x * 0.4, z * 0.4, 2, 31) > 0.66) TY[idx(x, z)] = T.GRASS;
  typeAt(22, 42, 25, 46, T.FLAG);
  typeAt(22, 59, 25, 63, T.FLAG);
  // reflecting pool
  fill(19, 50, 28, 55, 0.55, T.WATER, 0);
  // broken low walls around the plaza (jumpable, chipped to different heights)
  const lowWall = (x, z) => {
    const r = value2(x * 1.7, z * 1.3, 17);
    if (r < 0.18) return; // fully fallen
    fill(x, z, x, z, r < 0.35 ? 1.45 : r > 0.8 ? 2.3 : 1.95, T.FLAG, 1);
  };
  for (let x = 15; x <= 32; x++) {
    if (x < 22 || x > 25) {
      lowWall(x, 47);
      lowWall(x, 58);
    }
  }
  for (let z = 47; z <= 58; z++) {
    if (z < 51 || z > 53) {
      lowWall(15, z);
      lowWall(32, z);
    }
  }
  // west terrace (3.5) with a roofless house
  fill(1, 42, 12, 62, 3.5, T.GRASS, 1);
  typeAt(1, 52, 12, 58, T.DIRT);
  fill(3, 45, 10, 51, 6, T.FLAG, 1);
  fill(4, 46, 9, 50, 3.5, T.FLAG, 1);
  fill(6, 51, 7, 51, 3.5, T.FLAG, 1);
  fill(10, 47, 10, 48, 4.4, T.FLAG, 1); // tumbled section of wall
  stair(13, 56, 14, 57, 'w', 1, 3.5);
  // east terrace (3.5) and the moat you jump across to reach the outskirts
  fill(35, 44, 45, 62, 3.5, T.GRASS, 1);
  typeAt(36, 48, 44, 52, T.FLAG);
  fill(35, 42, 45, 43, 0, T.GRASS, 0);
  stair(33, 58, 34, 59, 'e', 1, 3.5);
  // the shortcut: a stair up to the outskirts behind a grate
  stair(22, 42, 23, 43, 'n', 1, 3);
  fill(21, 42, 21, 43, 3, T.FLAG, 1);
  fill(24, 42, 24, 43, 3, T.FLAG, 1);
  // stairs and a slope up into the forest
  stair(14, 60, 15, 63, 's', 1, 4);
  stair(30, 61, 31, 63, 's', 1, 4, T.DIRT);

  // ================= FOREST APPROACH (z 64-85) ========================
  fill(1, 64, 46, D - 1, 4, T.GRASS, 0);
  for (let z = 64; z < D; z++)
    for (let x = 1; x <= 46; x++) if (fbm2(x * 0.22 + 7, z * 0.22, 3, 44) > 0.56) TY[idx(x, z)] = T.DIRT;
  // ridge (7) where the journey starts, organic north edge
  for (let x = 1; x <= 30; x++) {
    const n = fbm2(x * 0.3, 70, 3, 51);
    const edge = x >= 12 && x <= 17 ? 74 : 74 + (n > 0.58 ? -1 : n < 0.42 ? 1 : 0);
    fill(x, edge, x, D - 1, 7, T.GRASS, 0);
  }
  for (let x = 2; x <= 30; x++) {
    const z = Math.round(79.5 + Math.sin(x * 0.25) * 1.5);
    typeAt(x, z, x, z + 1, T.DIRT, 7);
  }
  stair(31, 77, 32, 78, 'w', 4, 7, T.DIRT);
  // thicket knoll (5.5) that forces the lower path under the arch bridge
  fill(18, 64, 33, 69, 5.5, T.GRASS, 0);
  for (let x = 18; x <= 33; x++) if (value2(x * 0.5, 66, 61) > 0.55) fill(x, 69, x, 69, 4, T.GRASS, 0);
  // lookout outcrop (7) reached over the bridge
  fill(12, 65, 17, 69, 7, T.ROCK, 0);
  typeAt(13, 66, 16, 68, T.GRASS);
  // ruins in the east glade
  fill(38, 66, 43, 68, 4.6, T.FLAG, 1);
  fill(39, 67, 42, 67, 4.6, T.FLAG, 1);
  typeAt(1, 64, 11, 73, T.DIRT, 4);
  typeAt(12, 64, 17, 64, T.DIRT, 4);
  typeAt(18, 70, 33, 73, T.DIRT, 4);

  // ---------------------------------------------------------- borders
  for (let z = 0; z < D; z++) {
    const inRavine = z >= 20 && z <= 27;
    if (!inRavine) {
      fill(0, z, 0, z, z > 63 ? 10 : 8, T.GRASS, 0);
      fill(W - 2, z, W - 1, z, z > 63 ? 10 : 8, T.GRASS, 0);
    } else fill(W - 2, z, W - 1, z, 0, T.DIRT, 0);
  }
  // front skirt: the ridge and forest floor continue past the walkable edge so
  // the camera never sees the end of the world; trees there act as foreground
  // the bridge landing must not be eaten by the organic outskirts edge
  fill(24, 28, 28, 29, 3, T.FLAG, 1);

  const solids = [
    // main bridge across the ravine, broken in the middle
    { x0: 25, z0: 19, x1: 27, z1: 22.2, y0: 2.45, y1: 3, kind: 'bridge', parapet: true, brokenEnd: 'z1' },
    { x0: 25, z0: 24.2, x1: 27, z1: 28, y0: 2.45, y1: 3, kind: 'bridge', parapet: true, brokenEnd: 'z0' },
    { x0: 25.15, z0: 20.4, x1: 26.85, z1: 21.6, y0: -0.45, y1: 2.45, kind: 'pier' },
    { x0: 25.15, z0: 25.0, x1: 26.85, z1: 26.2, y0: -0.45, y1: 2.45, kind: 'pier' },
    // narrow stone beam to the pinnacle
    { x0: 29.9, z0: 5.0, x1: 35.1, z1: 6.0, y0: 5.55, y1: 6, kind: 'beam' },
    // hall roof (walkable if you get up there)
    { x0: 5, z0: 12, x1: 16, z1: 19, y0: 5.3, y1: 5.85, kind: 'roof', hole: [10, 13, 13.5, 15.5] },
    // courtyard aqueduct walkway, broken over the pool
    { x0: 12.9, z0: 52.1, x1: 21.6, z1: 52.9, y0: 3.0, y1: 3.5, kind: 'bridge', parapet: true, brokenEnd: 'x1', axis: 'x' },
    { x0: 23.2, z0: 52.1, x1: 35.1, z1: 52.9, y0: 3.0, y1: 3.5, kind: 'bridge', parapet: true, brokenEnd: 'x0', axis: 'x' },
    { x0: 16.15, z0: 52.2, x1: 16.85, z1: 52.8, y0: 1, y1: 3.0, kind: 'pier' },
    { x0: 20.15, z0: 52.2, x1: 20.85, z1: 52.8, y0: 0.55, y1: 3.0, kind: 'pier' },
    { x0: 25.15, z0: 52.2, x1: 25.85, z1: 52.8, y0: 0.55, y1: 3.0, kind: 'pier' },
    { x0: 30.15, z0: 52.2, x1: 30.85, z1: 52.8, y0: 1, y1: 3.0, kind: 'pier' },
    // the forest arch bridge to the lookout, with the lower path beneath
    { x0: 13, z0: 69.0, x1: 16, z1: 74.3, y0: 6.4, y1: 7, kind: 'bridge', parapet: true, arch: true },
    // lintel over the shrine door
    { x0: 14, z0: 2.0, x1: 18, z1: 3.0, y0: 7.2, y1: 8.2, kind: 'lintel' },
  ];

  const trees = [
    // sanctuary
    { x: 44.5, z: 11.4, size: 'giant' },
    { x: 19.5, z: 15.6 },
    { x: 17.6, z: 10.2, size: 'small' },
    { x: 2.6, z: 5.2 },
    { x: 38.5, z: 22.6, size: 'small' },
    { x: 3.8, z: 15.8, size: 'small' },
    { x: 9.5, z: 31.5, size: 'big' },
    { x: 33.5, z: 29.8 },
    { x: 41.5, z: 34.5, size: 'big' },
    { x: 26.5, z: 35.5, size: 'small' },
    ...[2, 7, 23, 28, 37, 42, 46].map((x) => ({ x: x + 0.5, z: 1.2, size: 'big', rim: true })),
    // courtyard
    { x: 3.5, z: 59.5, size: 'big' },
    { x: 43.0, z: 57.5, size: 'big' },
    { x: 33.8, z: 45.5, size: 'small' },
    { x: 12.0, z: 43.5, size: 'small' },
    { x: 37.5, z: 62.5 },
    // forest
    { x: 4.5, z: 76.5, size: 'big' },
    { x: 10.5, z: 83.0, size: 'big' },
    { x: 20.5, z: 77.0, size: 'big' },
    { x: 27.5, z: 83.2, size: 'big' },
    { x: 15.0, z: 80.5 },
    { x: 30.5, z: 66.0 },
    { x: 37.0, z: 72.5, size: 'big' },
    { x: 44.0, z: 78.5, size: 'big' },
    { x: 41.0, z: 83.5, size: 'big' },
    { x: 35.5, z: 81.0 },
    { x: 6.0, z: 67.0 },
    { x: 44.5, z: 65.5 },
    // the skirt in front of the camera
    { x: 3.0, z: 88.5, size: 'big' },
    { x: 13.5, z: 89.5, size: 'big' },
    { x: 22.0, z: 88.0, size: 'big' },
    { x: 33.0, z: 89.0, size: 'big' },
    { x: 41.5, z: 88.5, size: 'big' },
  ];

  const props = [
    // sanctuary: colonnade in front of the shrine door
    ...[[9.5, 5.2, 3.2], [12.5, 5.2, 1.1], [19.5, 5.2, 3.2], [22.5, 5.2, 0.6]].map(([x, z, h]) => ({ type: 'column', x, z, h })),
    { type: 'drum', x: 21.3, z: 7.8 },
    { type: 'statue', x: 13.3, z: 3.5 },
    { type: 'statue', x: 18.7, z: 3.5 },
    { type: 'relief', x0: 11.2, x1: 14.85, z: 3.0, y: 5.5, h: 1.3 },
    { type: 'relief', x0: 17.15, x1: 20.8, z: 3.0, y: 5.5, h: 1.3 },
    { type: 'statue', x: 8.3, z: 19.4, scale: 0.85 },
    { type: 'statue', x: 12.7, z: 19.4, scale: 0.85 },
    { type: 'column', x: 39.3, z: 4.3, h: 2.6 },
    { type: 'column', x: 43.7, z: 4.3, h: 1.0 },
    { type: 'column', x: 39.3, z: 8.7, h: 1.6 },
    { type: 'column', x: 43.7, z: 8.7, h: 3.0 },
    { type: 'column', x: 24.5, z: 14.5, h: 0.9 },
    { type: 'column', x: 28.5, z: 14.5, h: 2.2 },
    { type: 'brazier', x: 7.8, z: 16.6, lit: true },
    { type: 'brazier', x: 13.4, z: 16.6, lit: true },
    { type: 'stele', x: 33.6, z: 33.4, text: 'Three stones remember the sun: one above the hall, one beneath the bridge, one upon the altar. Wake them, and the door will listen.' },
    { type: 'stele', x: 2.7, z: 13.0, text: 'The hall was built for those who came down from the court. Its roof fell long before its doors.' },
    // courtyard
    { type: 'column', x: 16.5, z: 46.4, h: 2.6 },
    { type: 'column', x: 31.5, z: 46.4, h: 0.8 },
    { type: 'column', x: 16.5, z: 59.4, h: 1.3 },
    { type: 'column', x: 31.5, z: 59.4, h: 2.8 },
    { type: 'drum', x: 27.6, z: 48.6, rot: 0.6 },
    { type: 'statue', x: 23.5, z: 49.2, scale: 1.1 },
    { type: 'stele', x: 26.2, z: 60.3, text: 'Ruined Courtyard. Water was kept here so the sky could be looked at from below.' },
    { type: 'stele', x: 37.0, z: 46.2, text: 'The north gate is barred from the far side. Those who leap the moat may open it.' },
    { type: 'brazier', x: 5, z: 47.2, lit: true },
    // forest
    { type: 'stele', x: 15.5, z: 66.6, text: 'From here the old ones watched the courtyard, and beyond it the sanctuary in its ravine.' },
    { type: 'column', x: 38.5, z: 66.4, h: 2.4 },
    { type: 'column', x: 42.5, z: 66.4, h: 1.0 },
    { type: 'column', x: 38.5, z: 68.4, h: 0.7 },
    { type: 'stele', x: 7.5, z: 79.0, text: 'Forest Approach. The path descends to the courtyard. Arrows: move. Space: jump. J: strike. K: dash. E: read.' },
  ];

  const entities = [
    // forest
    { type: 'slime', x: 37.5, z: 74.5 },
    { type: 'slime', x: 8.5, z: 70.5 },
    { type: 'moth', x: 40, z: 69 },
    { type: 'pot', x: 16.2, z: 67.6 },
    { type: 'pot', x: 13.6, z: 66.2, drop: 'heart' },
    { type: 'pot', x: 41.5, z: 69.6 },
    // courtyard
    { type: 'slime', x: 19.5, z: 48.5 },
    { type: 'slime', x: 27.5, z: 57.0 },
    { type: 'slime', x: 17.5, z: 55.5 },
    { type: 'sentinel', x: 23.5, z: 56.6 },
    { type: 'bulb', x: 9.5, z: 55.0 },
    { type: 'bulb', x: 39.5, z: 55.5 },
    { type: 'moth', x: 40, z: 47 },
    { type: 'pot', x: 4.6, z: 46.6, drop: 'heart' },
    { type: 'pot', x: 8.6, z: 49.6 },
    { type: 'pot', x: 44.0, z: 45.0 },
    { type: 'pot', x: 2.5, z: 61.5, drop: 'heart' },
    { type: 'lever', x: 20.4, z: 40.6, opens: 'grate' },
    // sanctuary
    { type: 'slime', x: 10.5, z: 21.5 },
    { type: 'slime', x: 21.5, z: 26.0 },
    { type: 'slime', x: 5.5, z: 34.0 },
    { type: 'bulb', x: 20.5, z: 13.5 },
    { type: 'bulb', x: 35.5, z: 34.2 },
    { type: 'sentinel', x: 15.5, z: 7.2 },
    { type: 'moth', x: 32, z: 13 },
    { type: 'moth', x: 38, z: 25 },
    { type: 'sunstone', x: 7.5, z: 16.3, id: 'roof' },
    { type: 'sunstone', x: 26.0, z: 27.4, id: 'bridge' },
    { type: 'sunstone', x: 41.0, z: 6.0, id: 'altar' },
    { type: 'pot', x: 13.5, z: 10.6 },
    { type: 'pot', x: 12.7, z: 10.3, drop: 'heart' },
    { type: 'pot', x: 25.0, z: 9.6 },
    { type: 'pot', x: 3.6, z: 31.2 },
    { type: 'vessel', x: 32.6, z: 1.6 }, // secret behind the waterfall
  ];

  const gates = [
    { id: 'grate', x0: 22.0, z0: 43.7, x1: 24.0, z1: 44.0, y0: 1, y1: 3.4, style: 'grate' },
    { id: 'shrineDoor', x0: 14.9, z0: 2.55, x1: 17.1, z1: 2.95, y0: 5, y1: 7.2, style: 'slab', needs: ['roof', 'bridge', 'altar'] },
  ];

  const portals = [{ x0: 15, z0: 2.0, x1: 17, z1: 2.5, to: 'shrine', spawn: { x: 14.5, z: 42.2, dir: 'up' }, gate: 'shrineDoor' }];

  const areas = [
    { name: 'Forest Approach', z0: 64, z1: 86 },
    { name: 'Ruined Courtyard', z0: 42, z1: 64 },
    { name: 'Overgrown Sanctuary', z0: 0, z1: 42 },
  ];
  const checkpoints = [
    { x: 6.5, z: 80.5 },
    { x: 24, z: 61.5 },
    { x: 21, z: 38.5 },
    { x: 16, z: 6.5 },
  ];
  const waterfalls = [{ x0: 31.0, x1: 34.0, z: 3.06, y0: -0.1, y1: 8.0 }];

  // authored plant compositions: frames for the key views, placed before the
  // niche scatter fills in around them
  const dressing = [
    // forest start: ferns frame the first path, a dark thicket on the left
    { x: 2.6, z: 77.2, niche: 'forest', r: 1.8 },
    { x: 12.4, z: 76.4, niche: 'forest', r: 1.3 },
    { x: 9.2, z: 84.6, niche: 'forest', r: 2.0, density: 0.8 },
    // the ring of fallen stones in the clearing is overgrown inside
    { x: 14.9, z: 67.4, niche: 'wall', r: 1.1, density: 1.3 },
    { x: 20.0, z: 66.6, niche: 'forest', r: 1.5 },
    { x: 35.4, z: 66.0, niche: 'forest', r: 1.4 },
    // courtyard: a flowering lawn to the east, a drift in the foreground
    { x: 40.5, z: 57.5, niche: 'meadow', r: 2.2, density: 1.1 },
    { x: 45.0, z: 61.4, niche: 'meadow', r: 1.3 },
    { x: 7.5, z: 61.0, niche: 'meadow', r: 1.8 },
    { x: 27.2, z: 61.3, niche: 'meadow', r: 1.0, density: 1.2 },
    // the ravine: reeds and ferns where the river meets the banks
    { x: 16.0, z: 20.6, niche: 'water', r: 1.2 },
    { x: 22.6, z: 21.2, niche: 'water', r: 1.0 },
    { x: 36.6, z: 22.4, niche: 'water', r: 1.3 },
    // the waterfall's upper banks
    { x: 29.4, z: 9.5, niche: 'water', r: 1.0 },
    { x: 35.5, z: 14.2, niche: 'water', r: 1.1 },
  ];

  // authored wall history (see wallStateFn in world.js): cond 0 intact .. 1 collapsed
  const wallWear = [
    // the waterfall: soaked, eroded lower courses
    { x0: 28, z0: 0, x1: 37, z1: 9, cond: 0.55, wet: 1 },
    // the temple front behind the shrine door stays crisp and carved
    { x0: 6, z0: 0, x1: 26, z1: 4.5, cond: 0.12 },
    // the aqueduct's supports have lost their facing in places
    { x0: 14, z0: 48, x1: 31, z1: 51, cond: 0.78 },
    // a collapsed corner of the courtyard's west precinct
    { x0: 2, z0: 44, x1: 7, z1: 48, cond: 0.9 },
    // the ring of fallen stones in the forest clearing
    { x0: 11.5, z0: 64.5, x1: 18, z1: 70, cond: 1 },
  ];

  return {
    id: 'overworld',
    dressing,
    wallWear,
    ...P,
    walkMaxZ: 86,
    solids,
    trees,
    props,
    entities,
    gates,
    portals,
    areas,
    checkpoints,
    waterfalls,
    spawn: { x: 6.5, z: 80.6, dir: 'up' },
    theme: 'day',
  };
}

// Cutaway walls: tall rock directly south of (in front of) a room would hide
// the room from the 3/4 camera, so its visual height drops to a low lip above
// the floor it fronts. Collision keeps the full wall via invisible blockers.
function cutaway(P, solids, { rockH, depth = 6, lip = 1.4 }) {
  const { W, D, H, idx } = P;
  const cut = new Map();
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      if (H[idx(x, z)] < rockH) continue;
      for (let k = 1; k <= depth && z - k >= 0; k++) {
        const h = H[idx(x, z - k)];
        if (h < rockH - 2) {
          cut.set(idx(x, z), h + lip);
          break;
        }
      }
    }
  for (const [i, h] of cut) H[i] = h;
  // merge blockers into row runs to keep the collider cheap
  for (let z = 0; z < D; z++) {
    let x0 = -1;
    for (let x = 0; x <= W; x++) {
      const on = x < W && cut.has(idx(x, z));
      if (on && x0 < 0) x0 = x;
      if (!on && x0 >= 0) {
        solids.push({ x0, z0: z, x1: x, z1: z + 1, y0: -5, y1: 50, kind: 'invisible' });
        x0 = -1;
      }
    }
  }
}

// =====================================================================
// The Hidden Vale: the reveal after the Warden. A balcony cut into the cliff
// looks down over a lake valley and a drowned tower. Only the balcony is
// walkable; everything else is composition built from the same kit.
export function buildVista() {
  const W = 40, D = 40;
  const P = painter(W, D);
  const { fill, typeAt, stair, idx, H, TY } = P;
  fill(0, 0, W - 1, D - 1, -4, T.GRASS);
  for (let z = 0; z < 22; z++)
    for (let x = 0; x < W; x++) if (fbm2(x * 0.25, z * 0.25, 3, 91) > 0.58) TY[idx(x, z)] = T.DIRT;
  // lake with a ragged shore
  for (let z = 5; z <= 19; z++)
    for (let x = 6; x <= 33; x++) {
      const dx = (x - 20) / 13, dz = (z - 12) / 6.5;
      if (dx * dx + dz * dz + (fbm2(x * 0.3, z * 0.3, 2, 93) - 0.5) * 0.7 < 1) fill(x, z, x, z, -4.55, T.WATER, 0);
    }
  // tower island
  fill(17, 9, 23, 14, -3.4, T.FLAG, 1);
  // terraced slopes on both sides, organic edges
  for (let z = 0; z < 22; z++) {
    const n = fbm2(3, z * 0.3, 3, 95), m = fbm2(9, z * 0.3, 3, 96);
    const a = 4 + Math.round(n * 4), b = 2 + Math.round(m * 3);
    fill(0, z, a, z, -1.5, T.GRASS, 0);
    fill(0, z, b, z, 1.5, T.GRASS, 0);
    const c = W - 5 - Math.round(m * 4), d = W - 3 - Math.round(n * 3);
    fill(c, z, W - 1, z, -1.5, T.GRASS, 0);
    fill(d, z, W - 1, z, 1.5, T.GRASS, 0);
  }
  // far cliff wall with a cascade
  for (let x = 0; x < W; x++) {
    const e = 2 + Math.round(fbm2(x * 0.3, 5, 3, 97) * 2);
    fill(x, 0, x, e, 5, T.ROCK, 0);
  }
  fill(25, 0, 27, 3, 5, T.ROCK, 0);
  // stepped ruin terraces on the far shore
  fill(9, 3, 15, 5, -2.5, T.FLAG, 1);
  fill(10, 3, 13, 4, -1.0, T.FLAG, 1);
  // forested slopes below the promontory, falling towards the lake
  for (let z = 20; z < D; z++)
    for (let x = 0; x < W; x++) {
      const n = fbm2(x * 0.2, z * 0.2, 3, 99);
      fill(x, z, x, z, z > 26 ? 2.5 + Math.round(n * 2) : 0.5 + Math.round(n * 2), T.GRASS, 0);
    }
  // the promontory (6) the hero arrives on, with the shrine tunnel behind
  fill(13, 22, 27, D - 1, 6, T.FLAG, 1);
  fill(11, 35, 29, D - 1, 7.4, T.ROCK, 1);
  fill(17, 35, 23, 35, 6, T.FLAG, 1);
  for (let x = 13; x <= 27; x++) if (value2(x * 0.7, 3, 98) > 0.6) TY[idx(x, 22)] = T.GRASS;
  typeAt(19, 26, 21, D - 1, T.FLAG);

  const solids = [
    // the drowned tower, broken near the top
    { x0: 18.2, z0: 10.0, x1: 21.8, z1: 13.4, y0: -3.6, y1: 4.5, kind: 'block' },
    { x0: 17.8, z0: 9.6, x1: 22.2, z1: 13.8, y0: 0.4, y1: 0.9, kind: 'block' },
    { x0: 17.8, z0: 9.6, x1: 22.2, z1: 13.8, y0: 4.5, y1: 5.0, kind: 'block' },
    { x0: 18.6, z0: 10.4, x1: 21.4, z1: 13.0, y0: 5.0, y1: 11.5, kind: 'block' },
    { x0: 18.3, z0: 10.1, x1: 21.7, z1: 13.3, y0: 11.5, y1: 11.9, kind: 'block' },
    { x0: 18.8, z0: 10.6, x1: 20.9, z1: 12.8, y0: 11.9, y1: 14.6, kind: 'block' },
    { x0: 18.8, z0: 10.6, x1: 19.7, z1: 11.7, y0: 14.6, y1: 16.2, kind: 'block' },
    // tunnel mouth the hero arrives through
    { x0: 16.6, z0: 34.6, x1: 17.4, z1: 35.6, y0: 6, y1: 9.2, kind: 'block' },
    { x0: 22.6, z0: 34.6, x1: 23.4, z1: 35.6, y0: 6, y1: 9.2, kind: 'block' },
    { x0: 16.4, z0: 34.5, x1: 23.6, z1: 35.6, y0: 9.2, y1: 9.9, kind: 'block' },
    // keep the hero on the promontory
    { x0: 12.2, z0: 22, x1: 12.95, z1: 36, y0: -10, y1: 50, kind: 'invisible' },
    { x0: 27.05, z0: 22, x1: 27.8, z1: 36, y0: -10, y1: 50, kind: 'invisible' },
    // a broken causeway from the far shore towards the tower
    { x0: 19.0, z0: 5.0, x1: 21.0, z1: 7.4, y0: -4.0, y1: -2.6, kind: 'block' },
    { x0: 19.2, z0: 7.9, x1: 20.8, z1: 9.0, y0: -4.0, y1: -3.0, kind: 'block' },
    // balcony parapet, broken in the middle so the view opens up
    { x0: 13.1, z0: 22.0, x1: 17.6, z1: 22.35, y0: 6, y1: 6.55, kind: 'parapet' },
    { x0: 22.6, z0: 22.0, x1: 26.9, z1: 22.35, y0: 6, y1: 6.55, kind: 'parapet' },
    { x0: 17.6, z0: 22.0, x1: 18.5, z1: 22.35, y0: 6, y1: 6.25, kind: 'parapet' },
    { x0: 12, z0: 21.4, x1: 29, z1: 22.1, y0: -10, y1: 50, kind: 'invisible' },
  ];
  const trees = [
    { x: 2.5, z: 6, size: 'big' }, { x: 3.5, z: 14, size: 'big' }, { x: 1.5, z: 19.5 }, { x: 6.5, z: 18.5 },
    { x: 37.5, z: 7, size: 'big' }, { x: 36, z: 15.5, size: 'big' }, { x: 33.5, z: 19.5 }, { x: 38.5, z: 20 },
    { x: 7, z: 1.5, size: 'big' }, { x: 15, z: 1.2, size: 'big' }, { x: 31, z: 1.5, size: 'big' }, { x: 36.5, z: 2 },
    { x: 10.5, z: 24.5, size: 'big' }, { x: 30, z: 25, size: 'big' }, { x: 6, z: 29, size: 'big' }, { x: 34, z: 30, size: 'big' },
    { x: 9.5, z: 36.5, size: 'big' }, { x: 31.5, z: 36.5, size: 'big' }, { x: 2.5, z: 35 }, { x: 37.5, z: 35.5 },
    { x: 5, z: 23 }, { x: 35, z: 22.5 },
  ];
  const props = [
    { type: 'column', x: 14.2, z: 23.2, h: 3.2, carved: true },
    { type: 'column', x: 25.8, z: 23.2, h: 1.6, carved: true },
    { type: 'statue', x: 14.4, z: 29.5, scale: 1.0 },
    { type: 'statue', x: 25.6, z: 29.5, scale: 1.0 },
    { type: 'brazier', x: 17.0, z: 31.0, lit: true },
    { type: 'brazier', x: 23.0, z: 31.0, lit: true },
    { type: 'column', x: 9.6, z: 3.6, h: 2.4, carved: true },
    { type: 'column', x: 14.2, z: 3.6, h: 1.2, carved: true },
  ];
  return {
    id: 'vista',
    ...P,
    walkMaxZ: 35.2,
    backdrop: { x: 20, y: 6, z: -36, w: 150 },
    solids,
    trees,
    props,
    entities: [{ type: 'moth', x: 30, z: 12 }].slice(0, 0),
    gates: [],
    portals: [],
    areas: [{ name: 'The Hidden Vale', z0: 0, z1: D }],
    checkpoints: [],
    waterfalls: [{ x0: 25.2, x1: 27.8, z: 4.06, y0: -4.2, y1: 5.0 }],
    spawn: { x: 20, z: 33.5, dir: 'up' },
    endZ: 24.5,
    camera: { pitch: 36, viewH: 20, ahead: 7.5 },
    theme: 'vista',
  };
}

// =====================================================================
export function buildShrine() {
  const W = 30, D = 46;
  const P = painter(W, D);
  const { fill, typeAt, stair, idx, TY } = P;
  fill(0, 0, W - 1, D - 1, 7.5, T.ROCK, 1);

  // entrance landing (4) and the grand stair down into the hall
  fill(11, 40, 18, 44, 4, T.FLAG, 1);
  stair(12, 34, 17, 39, 's', 0, 4);
  // main hall (0)
  fill(3, 18, 26, 33, 0, T.FLAG, 1);
  for (let z = 18; z <= 33; z++)
    for (let x = 3; x <= 26; x++) if (fbm2(x * 0.3, z * 0.3, 3, 71) > 0.62) TY[idx(x, z)] = T.DIRT;
  // side galleries (2) with their stairs
  fill(1, 19, 4, 33, 2, T.FLAG, 1);
  fill(25, 19, 28, 33, 2, T.FLAG, 1);
  stair(5, 31, 5, 32, 'w', 0, 2);
  stair(24, 31, 24, 32, 'e', 0, 2);
  // water channel across the hall
  fill(3, 25, 26, 26, -0.45, T.WATER, 0);
  // secret chamber beyond a cracked gallery wall
  fill(1, 14, 4, 17, 2, T.FLAG, 1);
  fill(1, 18, 4, 18, 2, T.FLAG, 1);
  // boss door wall, then the Warden's chamber (0)
  fill(13, 16, 16, 17, 0, T.FLAG, 1);
  fill(7, 2, 23, 15, 0, T.FLAG, 1);
  for (let z = 2; z <= 15; z++)
    for (let x = 7; x <= 23; x++) if (fbm2(x * 0.35, z * 0.35, 3, 83) > 0.6) TY[idx(x, z)] = T.DIRT;
  // raised ledges around the arena
  fill(7, 2, 8, 15, 1, T.FLAG, 1);
  fill(22, 2, 23, 15, 1, T.FLAG, 1);
  fill(7, 2, 23, 3, 1, T.FLAG, 1);
  stair(9, 2, 9, 3, 'w', 0, 1);
  stair(21, 2, 21, 3, 'e', 0, 1);
  // the far doorway, closed by a slab until the Warden falls
  fill(13, 0, 16, 1, 0, T.FLAG, 1);
  fill(13, 2, 16, 3, 0, T.FLAG, 1);

  const solids = [
    { x0: 13.4, z0: 24.6, x1: 15.6, z1: 27.4, y0: -0.2, y1: 0.35, kind: 'bridge', parapet: true },
    { x0: 12, z0: 0, x1: 18, z1: 2.0, y0: 4.2, y1: 7.5, kind: 'lintel' },
    { x0: 1.0, z0: 18.05, x1: 5.0, z1: 18.95, y0: 2, y1: 6, kind: 'crack', id: 'crack' },
  ];
  cutaway(P, solids, { rockH: 7.5 });

  const props = [
    ...[[7.5, 20.5], [7.5, 29.5], [21.5, 20.5], [21.5, 29.5], [11, 20.5], [18, 20.5]].map(([x, z], i) => ({ type: 'column', x, z, h: i === 1 ? 1.4 : 4.6, carved: true })),
    ...[[10, 5], [20, 5], [10, 13], [20, 13]].map(([x, z], i) => ({ type: 'column', x, z, h: [4.6, 2.0, 1.1, 4.6][i], carved: true })),
    { type: 'relief', x0: 9.5, x1: 20.5, z: 17.95, y: 0.9, h: 1.0 },
    { type: 'relief', x0: 8, x1: 22, z: 1.98, y: 5.0, h: 1.4 },
    { type: 'brazier', x: 11.2, z: 37.8, lit: true },
    { type: 'brazier', x: 18.8, z: 37.8, lit: true },
    { type: 'brazier', x: 11.4, z: 18.7, lit: true },
    { type: 'brazier', x: 17.6, z: 18.7, lit: true },
    { type: 'brazier', x: 8.2, z: 8.5, lit: true },
    { type: 'brazier', x: 22.0, z: 8.5, lit: true },
    { type: 'statue', x: 2.8, z: 26.0, scale: 0.9 },
    { type: 'statue', x: 26.2, z: 26.0, scale: 0.9 },
    { type: 'stele', x: 14.5, z: 33.0, text: 'Underground Shrine. Below the sanctuary the old ones kept their warden, and the warden kept the way.' },
  ];

  const entities = [
    { type: 'moth', x: 8, z: 24 },
    { type: 'moth', x: 21, z: 28 },
    { type: 'sentinel', x: 14.5, z: 21.0 },
    { type: 'slime', x: 6.5, z: 29.5 },
    { type: 'slime', x: 22.5, z: 22.0 },
    { type: 'bulb', x: 26.5, z: 21.5 },
    { type: 'pot', x: 1.8, z: 32.5, drop: 'heart' },
    { type: 'pot', x: 27.4, z: 32.4 },
    { type: 'chest', x: 2.6, z: 15.2 }, // secret
    { type: 'boss', x: 15, z: 7 },
  ];

  const gates = [
    { id: 'bossDoor', x0: 12.9, z0: 16.2, x1: 17.1, z1: 16.7, y0: 0, y1: 2.6, style: 'slab', open: true },
    { id: 'vistaDoor', x0: 12.9, z0: 1.4, x1: 17.1, z1: 1.8, y0: 0, y1: 4.2, style: 'slab' },
  ];
  const portals = [
    { x0: 13, z0: 44.2, x1: 17, z1: 45.5, to: 'overworld', spawn: { x: 16, z: 4.2, dir: 'down' } },
    { x0: 13, z0: 0, x1: 17, z1: 0.7, to: 'vista', spawn: { x: 20, z: 33.5, dir: 'up' }, gate: 'vistaDoor' },
  ];
  const areas = [
    { name: 'Underground Shrine', z0: 18, z1: 46 },
    { name: "Warden's Chamber", z0: 0, z1: 16 },
  ];

  return {
    id: 'shrine',
    ...P,
    solids,
    trees: [],
    props,
    entities,
    gates,
    portals,
    areas,
    checkpoints: [{ x: 14.5, z: 42.2 }, { x: 14.5, z: 19.5 }],
    waterfalls: [],
    spawn: { x: 14.5, z: 42.2, dir: 'up' },
    theme: 'shrine',
  };
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

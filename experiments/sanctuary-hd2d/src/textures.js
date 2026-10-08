// Procedural "painted pixel" surface textures. Each texture is computed per
// pixel as a light value, then snapped to a hand-picked ramp with ordered
// dithering, so surfaces read as deliberate clusters rather than noise.
// Light is assumed from the upper left, matching the sun in the scene.

import * as THREE from '../vendor/three.module.min.js';
import { R, rampColor, mix } from './palette.js';
import { fbm2t, value2t, mulberry32, clamp, smoothstep } from './noise.js';

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(w, h);
  return { c, ctx, img, d: img.data, w, h };
}

function put(t, x, y, col, a = 255) {
  const i = (y * t.w + x) * 4;
  t.d[i] = col[0];
  t.d[i + 1] = col[1];
  t.d[i + 2] = col[2];
  t.d[i + 3] = a;
}

function toTexture(t, { repeat = true, nearest = false } = {}) {
  t.ctx.putImageData(t.img, 0, 0);
  const tex = new THREE.CanvasTexture(t.c);
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeat) tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 8;
  if (nearest) {
    tex.magFilter = THREE.NearestFilter;
  }
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.needsUpdate = true;
  return tex;
}

// Tileable jittered-grid voronoi. Returns [d1, d2, cellId, cx, cy].
function voronoi(x, y, cells, size, seed) {
  const cs = size / cells;
  const gx = Math.floor(x / cs), gy = Math.floor(y / cs);
  let d1 = 1e9, d2 = 1e9, id = 0, bx = 0, by = 0;
  for (let j = -1; j <= 1; j++) {
    for (let i = -1; i <= 1; i++) {
      const cx = gx + i, cy = gy + j;
      const wx = ((cx % cells) + cells) % cells, wy = ((cy % cells) + cells) % cells;
      const r = mulberry32(seed + wx * 131 + wy * 7919);
      const px = (cx + 0.15 + r() * 0.7) * cs, py = (cy + 0.15 + r() * 0.7) * cs;
      const dx = x - px, dy = y - py;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d < d1) {
        d2 = d1;
        d1 = d;
        id = wx * 1000 + wy;
        bx = px;
        by = py;
      } else if (d < d2) d2 = d;
    }
  }
  return [d1, d2, id, bx, by];
}

const hashId = (id, s = 0) => mulberry32(id * 2654435761 + s)();

// ---------------------------------------------------------------- grass top
export function grassTexture(size = 256, seed = 11) {
  const t = canvas(size, size);
  const P = 4; // noise period in texture-space units
  const rnd = mulberry32(seed);
  const val = new Float32Array(size * size);
  const dry = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      const big = fbm2t(u, v, P, 4, seed);
      const clump = fbm2t(u * 4, v * 4, P * 4, 3, seed + 5);
      let l = 0.38 + (big - 0.5) * 0.5 + (clump - 0.5) * 0.55;
      val[y * size + x] = l;
      dry[y * size + x] = fbm2t(u * 0.5 + 3, v * 0.5, P * 0.5, 3, seed + 9);
    }
  }
  // blade strokes: short slanted ticks, lit tip, dark root
  for (let k = 0; k < 2600; k++) {
    const x = Math.floor(rnd() * size), y = Math.floor(rnd() * size);
    const len = 2 + Math.floor(rnd() * 4);
    const lean = rnd() < 0.5 ? -1 : 1;
    for (let i = 0; i < len; i++) {
      const px = (x + Math.round(i * 0.4 * lean) + size) % size;
      const py = (y - i + size) % size;
      val[py * size + px] += i === len - 1 ? 0.22 : 0.1;
    }
    val[((y + 1) % size) * size + x] -= 0.16;
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x;
      const isDry = dry[i] + ((x * 7 + y * 13) % 5) * 0.004 > 0.58;
      put(t, x, y, rampColor(isDry ? R.grassDry : R.grass, clamp(val[i], 0, 1), x, y));
    }
  }
  // sparse tiny flowers, restrained: cream and indigo
  for (let k = 0; k < 22; k++) {
    const x = Math.floor(rnd() * (size - 2)), y = Math.floor(rnd() * (size - 2));
    const col = rnd() < 0.7 ? R.cream[5] : R.indigo[5];
    put(t, x, y, col);
    put(t, x + 1, y, mix(col, R.grass[2], 0.5));
    put(t, x, y + 1, R.grass[1]);
  }
  return toTexture(t);
}

// ---------------------------------------------------------------- dirt path
export function dirtTexture(size = 256, seed = 23) {
  const t = canvas(size, size);
  const P = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      let l = 0.42 + (fbm2t(u * 2, v * 2, P * 2, 4, seed) - 0.5) * 0.6;
      const [d1, d2, id] = voronoi(x, y, 22, size, seed);
      const peb = hashId(id) < 0.35;
      if (peb && d1 < 3.2) l = 0.62 + (hashId(id, 2) - 0.5) * 0.2 - (d1 / 3.2) * 0.15 + (y % 2 ? 0 : 0.02);
      else if (peb && d1 < 4.2) l -= 0.18;
      const grassy = fbm2t(u + 9, v, P, 3, seed + 3);
      let col = rampColor(R.dirt, clamp(l, 0, 1), x, y);
      if (grassy > 0.6) col = rampColor(R.grass, clamp(l - 0.08, 0, 1), x, y);
      put(t, x, y, col);
    }
  }
  return toTexture(t);
}

// ---------------------------------------------------------------- flagstones
export function flagstoneTexture(size = 256, seed = 37) {
  const t = canvas(size, size);
  const P = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      const wob = (fbm2t(u * 6, v * 6, P * 6, 2, seed) - 0.5) * 6;
      const [d1, d2, id, cx, cy] = voronoi(x + wob, y - wob, 7, size, seed);
      const edge = d2 - d1;
      const stoneTone = (hashId(id) - 0.5) * 0.18;
      const surf = (fbm2t(u * 5, v * 5, P * 5, 3, seed + 1) - 0.5) * 0.35;
      // bevel: light from upper-left along cell border
      const dx = x - cx, dy = y - cy;
      const len = Math.hypot(dx, dy) + 1e-3;
      const facing = (-dx - dy) / len; // >0 toward upper-left
      let l = 0.55 + stoneTone + surf;
      if (edge < 6) l += facing * (6 - edge) * 0.03;
      let col;
      if (edge < 2.2) {
        // joint: moss or dark grit
        const m = fbm2t(u * 3, v * 3, P * 3, 2, seed + 7);
        col = m > 0.5 ? rampColor(R.moss, 0.35 + (m - 0.5), x, y) : rampColor(R.lime, 0.1, x, y);
      } else {
        // worn darker centre stains + cracks
        const crack = Math.abs(fbm2t(u * 3 + id, v * 3, P * 3, 3, seed + 4) - 0.5);
        if (crack < 0.012 && hashId(id, 5) < 0.4) l -= 0.3;
        col = rampColor(R.lime, clamp(l, 0, 1), x, y);
        const mossy = fbm2t(u * 1.5, v * 1.5, P * 1.5, 3, seed + 8);
        if (mossy > 0.62 && edge < 8) col = rampColor(R.moss, clamp(l - 0.1, 0, 1), x, y);
      }
      put(t, x, y, col);
    }
  }
  return toTexture(t);
}

// ---------------------------------------------------------------- masonry wall
// Irregular coursed ashlar: courses of varying height, blocks of varying width,
// chipped arrises, run-off streaks.
export function masonryTexture(size = 256, seed = 51) {
  const t = canvas(size, size);
  const rnd = mulberry32(seed);
  const P = 4;
  // build courses
  const rows = [];
  let y0 = 0;
  while (y0 < size) {
    let h = [18, 22, 26, 30][Math.floor(rnd() * 4)];
    if (size - y0 - h < 16) h = size - y0;
    const blocks = [];
    let x0 = Math.floor(rnd() * 40);
    const start = x0;
    while (x0 < start + size) {
      const w = 26 + Math.floor(rnd() * 48);
      blocks.push([x0, Math.min(w, start + size - x0), rnd(), rnd()]);
      x0 += w;
    }
    rows.push({ y0, h, blocks });
    y0 += h;
  }
  for (let y = 0; y < size; y++) {
    const row = rows.find((r) => y >= r.y0 && y < r.y0 + r.h);
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      let bx = 0, bw = 1, tone = 0.5, chip = 0.5;
      for (const b of row.blocks) {
        const lx = (((x - b[0]) % size) + size) % size;
        if (lx < b[1]) {
          bx = lx;
          bw = b[1];
          tone = b[2];
          chip = b[3];
          break;
        }
      }
      const by = y - row.y0;
      const n = fbm2t(u * 6, v * 6, P * 6, 2, seed + 3);
      const chipN = fbm2t(u * 10, v * 10, P * 10, 2, seed + 9);
      // distances to block edges, roughened
      const dl = bx, dr = bw - 1 - bx, dt = by, db = row.h - 1 - by;
      const rough = (chipN - 0.5) * 5 * (0.6 + chip);
      const dmin = Math.min(dl, dr, dt, db) + rough;
      let l = 0.5 + (tone - 0.5) * 0.22 + (n - 0.5) * 0.3;
      // carved bevel: lit top/left faces, shadowed bottom/right
      if (dt + rough < 4) l += 0.16;
      if (dl + rough < 3) l += 0.08;
      if (db + rough < 4) l -= 0.2;
      if (dr + rough < 3) l -= 0.1;
      // vertical run-off streaks
      const streak = fbm2t(u * 14, v * 0.6, P * 14, 2, seed + 21);
      if (streak > 0.64) l -= (streak - 0.64) * 1.4;
      let col;
      if (dmin < 1.6) {
        const m = fbm2t(u * 2, v * 2, P * 2, 2, seed + 13);
        col = m > 0.55 ? rampColor(R.moss, 0.25 + (m - 0.55), x, y) : R.lime[0];
      } else {
        col = rampColor(R.lime, clamp(l, 0, 1), x, y, 0.9);
        const moss = fbm2t(u * 2.2, v * 2.2, P * 2.2, 3, seed + 17);
        if (moss > 0.64 && dt < row.h * 0.6) col = rampColor(R.moss, clamp(l - 0.05, 0, 1), x, y);
      }
      put(t, x, y, col);
    }
  }
  return toTexture(t);
}

// ---------------------------------------------------------------- natural cliff
// Layered rock strata: horizontal beds with lit lips and shadowed undersides,
// broken by vertical joints. Cooler than the built limestone.
export function cliffTexture(size = 256, seed = 67) {
  const t = canvas(size, size);
  const P = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      const warp = (fbm2t(u * 2, v * 2, P * 2, 3, seed) - 0.5) * 18;
      const bedH = 30;
      const yy = y + warp;
      const bed = Math.floor(yy / bedH);
      const by = ((yy % bedH) + bedH) % bedH;
      const jointN = fbm2t(u * 3 + bed * 1.7, v * 0.3, P * 3, 2, seed + 5);
      const joint = Math.abs(((x + bed * 37 + jointN * 40) % 46) - 23);
      let l = 0.5 + (value2t(bed, 0.5, 8, seed + 2) - 0.5) * 0.25;
      l += (fbm2t(u * 8, v * 8, P * 8, 2, seed + 7) - 0.5) * 0.3;
      if (by < 4) l += 0.22; // lit lip
      else if (by > bedH - 6) l -= 0.28; // undercut shadow
      else l -= (by / bedH) * 0.12;
      if (joint < 1.3) l -= 0.35;
      else if (joint < 3) l -= 0.12;
      let col = rampColor(R.rock, clamp(l, 0, 1), x, y);
      // warm mineral staining
      const warm = fbm2t(u * 1.3, v * 1.3, P * 1.3, 3, seed + 11);
      if (warm > 0.6) col = rampColor(R.lime, clamp(l - 0.08, 0, 1), x, y);
      // damp moss gathers on ledge lips
      const moss = fbm2t(u * 3, v * 3, P * 3, 2, seed + 13);
      if (by < 5 && moss > 0.5) col = rampColor(R.moss, clamp(l, 0, 1), x, y);
      put(t, x, y, col);
    }
  }
  return toTexture(t);
}

// ---------------------------------------------------------------- river bed
export function bedTexture(size = 256, seed = 79) {
  const t = canvas(size, size);
  const P = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      const [d1, d2, id, cx, cy] = voronoi(x, y, 18, size, seed);
      let l = 0.3 + (fbm2t(u * 3, v * 3, P * 3, 3, seed) - 0.5) * 0.3;
      if (d2 - d1 > 2.5) {
        l = 0.45 + (hashId(id) - 0.5) * 0.3;
        const dx = x - cx, dy = y - cy;
        l += ((-dx - dy) / (Math.hypot(dx, dy) + 1)) * 0.12;
      } else l = 0.12;
      put(t, x, y, rampColor(R.bed, clamp(l, 0, 1), x, y));
    }
  }
  return toTexture(t);
}

// ---------------------------------------------------------------- bark
export function barkTexture(size = 256, seed = 91) {
  const t = canvas(size, size);
  const P = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      const ridge = fbm2t(u * 10, v * 1.2, P * 10, 3, seed);
      const r = Math.abs(ridge - 0.5) * 2;
      let l = 0.25 + r * 0.55 + (fbm2t(u * 4, v * 4, P * 4, 2, seed + 2) - 0.5) * 0.25;
      let col = rampColor(R.bark, clamp(l, 0, 1), x, y);
      const moss = fbm2t(u * 2, v * 2, P * 2, 3, seed + 4);
      if (moss > 0.6 && r < 0.6) col = rampColor(R.moss, clamp(l, 0, 1), x, y);
      put(t, x, y, col);
    }
  }
  return toTexture(t);
}

// ---------------------------------------------------------------- carved relief
// A frieze of carved spirals and eye-glyphs, used on the hall lintel, altar and
// tablets. Rendered as inset carving lit from the upper left.
export function reliefTexture(w = 256, h = 64, seed = 103) {
  const t = canvas(w, h);
  const depth = new Float32Array(w * h);
  const stamp = (fn) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (fn(x, y)) depth[y * w + x] = 1;
  };
  // border lines
  stamp((x, y) => y === 5 || y === 6 || y === h - 7 || y === h - 6);
  // repeating motifs: spiral, eye, spiral...
  const motifW = 64;
  for (let m = 0; m < w / motifW; m++) {
    const cx = m * motifW + 32, cy = h / 2;
    if (m % 2 === 0) {
      stamp((x, y) => {
        const dx = x - cx, dy = y - cy;
        const r = Math.hypot(dx, dy);
        if (r > 17) return false;
        const a = Math.atan2(dy, dx);
        const s = (r - (a / (Math.PI * 2)) * 6 + 60) % 6;
        return s < 1.7;
      });
    } else {
      stamp((x, y) => {
        const dx = (x - cx) / 20, dy = (y - cy) / 10;
        const e = dx * dx + dy * dy;
        const pupil = Math.hypot(x - cx, y - cy) < 4.5;
        return (e > 0.8 && e < 1.05) || pupil || (Math.abs(y - cy) < 1 && Math.abs(x - cx) > 21 && Math.abs(x - cx) < 30);
      });
    }
  }
  const rough = (x, y) => fbm2t((x / w) * 8, (y / h) * 2, 8, 2, seed);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      let l = 0.55 + (rough(x, y) - 0.5) * 0.3;
      const d = depth[i];
      if (d) {
        // inside the cut: shadowed from upper-left edge, lit at lower-right edge
        const ul = (x > 0 && !depth[i - 1]) || (y > 0 && !depth[i - w]);
        const lr = (x < w - 1 && !depth[i + 1]) || (y < h - 1 && !depth[i + w]);
        l = ul ? 0.12 : lr ? 0.7 : 0.3;
      }
      put(t, x, y, rampColor(R.lime, clamp(l, 0, 1), x, y));
    }
  }
  const tex = toTexture(t);
  tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

// ---------------------------------------------------------------- water detail
// Greyscale ripple/caustic pattern sampled by the water shader.
export function rippleTexture(size = 256, seed = 117) {
  const t = canvas(size, size);
  const P = 4;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      const n = fbm2t(u * 3, v * 3, P * 3, 3, seed);
      const band = Math.abs(((n * 9) % 1) - 0.5);
      const g = band < 0.06 ? 255 : band < 0.12 ? 110 : 0;
      put(t, x, y, [g, g, g]);
    }
  }
  const tex = toTexture(t);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

// Three independent tileable fbm channels used to break up ground-type borders.
export function noiseTexture(size = 128, seed = 131) {
  const t = canvas(size, size);
  const P = 4;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const u = (x / size) * P, v = (y / size) * P;
      put(t, x, y, [0, 1, 2].map((c) => Math.round(fbm2t(u, v, P, 4, seed + c * 101) * 255)));
    }
  const tex = toTexture(t);
  tex.colorSpace = THREE.NoColorSpace;
  return tex;
}

export function makeTextures() {
  return {
    grass: grassTexture(),
    dirt: dirtTexture(),
    flag: flagstoneTexture(),
    masonry: masonryTexture(),
    cliff: cliffTexture(),
    bed: bedTexture(),
    bark: barkTexture(),
    relief: reliefTexture(),
    ripple: rippleTexture(),
    noise: noiseTexture(),
  };
}

export { smoothstep };

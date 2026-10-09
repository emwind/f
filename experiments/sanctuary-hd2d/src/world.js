// Builds the 3D massing of the sanctuary from the level grid and answers the
// collision questions the hero and creatures ask. The same data drives both,
// so every height you see is a height you can stand on.
import * as THREE from '../vendor/three.module.min.js';
import { T, WATER_DEPTH, terrainHeight, tileHeight } from './level.js';
import { fbm2, fbm3, smoothstep, clamp, mulberry32 } from './noise.js';
import { patchWorldMaterial, worldUniforms } from './shaderPatch.js';
import { buildMasonryKit } from './masonryKit.js';

export const STEP = 0.36; // how high you can walk up without jumping
const TEX_SCALE = 0.25; // one texture repeat per 4 units
const SUB = 3; // subdivisions per tile edge (tops and walls must agree)

// irregular, chipped silhouettes: every world vertex is nudged sideways by a
// smooth 3D noise field, so shared vertices move together and nothing cracks.
let ampField = null; // per-vertex amplitude: built masonry stays straighter than raw rock
function ampAt(x, z) {
  if (!ampField) return 0.13;
  const { W, a } = ampField;
  const x0 = Math.max(0, Math.min(W - 1, Math.floor(x))), z0 = Math.max(0, Math.min(a.length / W - 2, Math.floor(z)));
  const fx = Math.min(1, Math.max(0, x - x0)), fz = Math.min(1, Math.max(0, z - z0));
  const g = (i, j) => a[Math.min(a.length - 1, (z0 + j) * W + Math.min(W - 1, x0 + i))];
  return (g(0, 0) * (1 - fx) + g(1, 0) * fx) * (1 - fz) + (g(0, 1) * (1 - fx) + g(1, 1) * fx) * fz;
}
function disp(x, y, z, amp = ampAt(x, z)) {
  const dx = (fbm3(x * 0.8, y * 0.8, z * 0.8, 2, 3) - 0.5) * 2 + (fbm3(x * 2.3, y * 2.3, z * 2.3, 1, 5) - 0.5) * 0.6;
  const dz = (fbm3(x * 0.8 + 11, y * 0.8, z * 0.8, 2, 7) - 0.5) * 2 + (fbm3(x * 2.3, y * 2.3 + 4, z * 2.3, 1, 9) - 0.5) * 0.6;
  return [dx * amp, dz * amp];
}

class Geo {
  constructor() {
    this.p = [];
    this.uv = [];
    this.c = [];
    this.i = [];
    this.wa = []; // optional wallInfo (cond, wet, style, up)
    this.wb = []; // optional wallB (distance below the lip, run seed)
  }
  v(x, y, z, u, w, c, wa, wb) {
    this.p.push(x, y, z);
    this.uv.push(u, w);
    this.c.push(c, c, c);
    if (wa) {
      this.wa.push(...wa);
      this.wb.push(...wb);
    }
    return this.p.length / 3 - 1;
  }
  quad(a, b, c, d) {
    this.i.push(a, b, c, a, c, d);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    if (this.wa.length) {
      g.setAttribute('wallInfo', new THREE.Float32BufferAttribute(this.wa, 4));
      g.setAttribute('wallB', new THREE.Float32BufferAttribute(this.wb, 2));
    }
    g.setIndex(this.i);
    g.computeVertexNormals();
    return g;
  }
}

// Per-tile damp and wear fields, blurred and sampled per vertex. Damp gathers
// where water sits, at the foot of walls and under canopies; wear follows the
// bare paths and the open middles of paved floors.
function dampWearField(L) {
  const W = L.W, D = L.D;
  const damp = new Float32Array(W * D), wear = new Float32Array(W * D);
  const ty = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? -1 : L.TY[z * W + x]);
  const hh = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? 99 : L.H[z * W + x]);
  const shrine = L.id === 'shrine';
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      const i = z * W + x, h = L.H[i], t = L.TY[i];
      let d = shrine ? 0.35 : 0, wallBase = false, open = 0;
      for (let dz = -2; dz <= 2; dz++)
        for (let dx = -2; dx <= 2; dx++) {
          const r = Math.hypot(dx, dz);
          if (ty(x + dx, z + dz) === T.WATER) d = Math.max(d, 1 - r / 3);
        }
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nh = hh(x + dx, z + dz);
        if (nh > h + 0.7 && nh < 50) wallBase = true;
        if (Math.abs(nh - h) < 0.1 && ty(x + dx, z + dz) === t) open++;
      }
      if (wallBase) d = Math.max(d, dz0(z) ? 0.75 : 0.6);
      // runoff: damp collects on the south (lower, shaded) side of walls
      function dz0(zz) { return hh(x, zz - 1) > h + 0.7; }
      for (const tr of L.trees ?? []) {
        const r = Math.hypot(tr.x - x - 0.5, tr.z - z - 0.5);
        const R = tr.size === 'giant' ? 4 : tr.size === 'big' ? 3.2 : tr.size === 'small' ? 1.8 : 2.6;
        if (r < R) d = Math.max(d, 0.55 * (1 - r / R) + 0.2);
      }
      damp[i] = Math.min(1, d);
      if (t === T.DIRT) wear[i] = 1;
      else if (t === T.FLAG && open === 4 && !wallBase) wear[i] = 0.55;
    }
  // blur twice so the fields read as soft gradients, then bleed wear onto verges
  const blur = (a) => {
    const o = new Float32Array(a.length);
    for (let z = 0; z < D; z++)
      for (let x = 0; x < W; x++) {
        let s = 0, n = 0;
        for (let dz = -1; dz <= 1; dz++)
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, zz = z + dz;
            if (xx < 0 || zz < 0 || xx >= W || zz >= D) continue;
            const k = dx === 0 && dz === 0 ? 2 : 1;
            s += a[zz * W + xx] * k;
            n += k;
          }
        o[z * W + x] = s / n;
      }
    return o;
  };
  const dampB = blur(blur(damp));
  const wearB = blur(wear);
  const at = (a, x, z) => {
    const fx = clamp(x - 0.5, 0, W - 1.001), fz = clamp(z - 0.5, 0, D - 1.001);
    const x0 = Math.floor(fx), z0 = Math.floor(fz), ax = fx - x0, az = fz - z0;
    const x1 = Math.min(W - 1, x0 + 1), z1 = Math.min(D - 1, z0 + 1);
    return (a[z0 * W + x0] * (1 - ax) + a[z0 * W + x1] * ax) * (1 - az) + (a[z1 * W + x0] * (1 - ax) + a[z1 * W + x1] * ax) * az;
  };
  return { damp: dampB, wear: wearB, at };
}

// Authored wall faces. Every wall vertex carries its condition (intact, aged,
// damaged, collapsed as 0..1), wetness, style (coursed or monumental) and its
// height above the wall foot. The shader picks coursed or monumental stone
// (with a monumental foundation course under coursed walls), drops whole
// stones out to the rubble core on damaged walls, runs cracks across several
// stones, darkens and streaks wet stone with moss riding the runoff and pale
// mineral lines, and shifts large wall sections in value so long walls never
// read as one repeated tile.
function wallMaterial(tex, L, cliff) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, map: cliff ? tex.cliff : tex.wallAshlar });
  patchWorldMaterial(mat);
  const inner = mat.onBeforeCompile;
  mat.onBeforeCompile = (shader) => {
    inner(shader);
    Object.assign(shader.uniforms, {
      tAsh: { value: tex.wallAshlar }, tAshId: { value: tex.wallAshlarId }, tMon: { value: tex.wallMon }, tRub: { value: tex.wallRubble },
      tRock: { value: tex.cliff }, tNoiseW: { value: tex.noise }, uCliff: { value: cliff ? 1 : 0 }, uCool: { value: L.id === 'shrine' ? 1 : 0 },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 wallInfo; attribute vec2 wallB; varying vec4 vWI; varying vec2 vWB;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWI = wallInfo; vWB = wallB;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tAsh, tAshId, tMon, tRub, tRock, tNoiseW; uniform float uCliff, uCool; uniform vec3 uBounce;
        varying vec4 vWI; varying vec2 vWB;`)
      .replace('#include <map_fragment>', `
        vec2 uv = vMapUv;
        float along = uv.x * 4.0;
        float cond = vWI.x, wet = vWI.y, style = vWI.z, up = vWI.w, lip = vWB.x, seed = vWB.y;
        float nLow = texture2D(tNoiseW, vec2(along * 0.035 + seed, vWPos.y * 0.04)).r;
        float nMid = texture2D(tNoiseW, uv * 0.6 + vec2(0.17, 0.43)).g;
        vec4 tc;
        if (uCliff > 0.5) {
          tc = texture2D(tRock, uv + vec2(0.13, 0.4));
        } else {
          vec2 auv = vec2(uv.x * 0.5 + seed * 0.37, uv.y);
          // a heavier foundation course under coursed walls; its height steps per bay
          float bay = floor(along * 0.25 + seed * 3.0);
          float found = 0.42 + 0.28 * fract(sin(bay * 12.9898) * 43758.5453);
          if (style > 0.5 || up < found) {
            tc = texture2D(tMon, vec2(auv.x * 0.8 + 0.31, uv.y));
            float j = abs(up - found);
            if (style < 0.5 && j < 0.035) tc.rgb *= 0.35;
          } else {
            tc = texture2D(tAsh, auv);
            vec3 idv = texture2D(tAshId, auv).rgb;
            // facing stones fall out in clusters on damaged walls
            float patchN = smoothstep(0.44, 0.62, texture2D(tNoiseW, vec2(along * 0.08 + seed, vWPos.y * 0.1)).b);
            float lose = clamp((cond - 0.42) * 1.15, 0.0, 0.62) * patchN;
            if (idv.r < lose) {
              vec4 rb = texture2D(tRub, uv * 1.6);
              tc.rgb = rb.rgb * mix(0.32, 0.82, smoothstep(0.0, 0.3, idv.g));
            }
          }
          // cracks that run across several stones; the shrine cracks from settling, not roots
          float cn = texture2D(tNoiseW, vec2(along * 0.16 + seed, vWPos.y * 0.22)).r;
          float cw = fwidth(cn) * 1.1 + 1e-4;
          float crackAmt = clamp((cond - 0.18) * 2.0 + uCool * 0.6, 0.0, 1.0);
          float crackZone = smoothstep(0.42, 0.6, texture2D(tNoiseW, vec2(along * 0.05 - seed, vWPos.y * 0.05)).g);
          tc.rgb *= 1.0 - (1.0 - smoothstep(0.0, cw, abs(cn - 0.5))) * crackAmt * crackZone * 0.6;
        }
        // large-scale value drift so long walls never repeat flatly
        tc.rgb *= 0.86 + 0.28 * nLow;
        // wet stone: darker and cooler, worst low down and down the runoff channels
        float streak = texture2D(tNoiseW, vec2(along * 0.7 + seed, vWPos.y * 0.03)).b;
        float streakF = texture2D(tNoiseW, vec2(along * 1.9 + 0.5 + seed, vWPos.y * 0.045)).r;
        float lowWet = wet * (1.0 - smoothstep(0.0, 1.3, up));
        float w = max(clamp(wet * (0.55 + 1.6 * (streak - 0.5)), 0.0, 1.0), lowWet);
        w = max(w, 0.18 * smoothstep(0.6, 0.72, streak));
        tc.rgb *= mix(vec3(1.0), vec3(0.56, 0.6, 0.64), w);
        // moss follows the water: down the channels from the lip, and along the wet foot
        float mossM = smoothstep(0.56, 0.68, streak) * wet * (0.35 + 0.65 * (1.0 - smoothstep(0.0, 1.6, lip)));
        mossM = max(mossM, lowWet * smoothstep(0.45, 0.6, nMid));
        vec3 mossC = vec3(0.16, 0.21, 0.08) * (0.6 + 1.4 * dot(tc.rgb, vec3(0.333)));
        tc.rgb = mix(tc.rgb, mossC, clamp(mossM, 0.0, 0.8) * (1.0 - uCool));
        // pale mineral streaks where water seeps but does not pour
        float mineral = smoothstep(0.68, 0.72, streakF) * wet * (1.0 - lowWet) * (1.0 - uCliff * 0.5);
        tc.rgb = mix(tc.rgb, vec3(0.5, 0.48, 0.42), mineral * 0.3);
        // the shrine's stone is a colder family
        tc.rgb *= mix(vec3(1.0), vec3(0.88, 0.94, 1.08), uCool);
        diffuseColor *= tc;
        // bounce from the lit ground in front: walls facing the camera stay legible in shade
        vec3 nW = normalize(cross(dFdx(vWPos), dFdy(vWPos)));
        float facing = max(0.0, nW.z) * (1.0 - abs(nW.y));
        totalEmissiveRadiance += diffuseColor.rgb * uBounce * facing * (0.65 + 0.35 * (1.0 - smoothstep(0.0, 2.5, up)));
      `);
  };
  return mat;
}

// Where a wall stands decides how it has aged: the forest's walls are old and
// swallowed, the courtyard's mostly intact, the sanctuary's span the whole
// range, the shrine's are cracked by settling and the Warden's hall is
// monumental. Wetness comes from water nearby and the falls; L.wallWear
// boxes override both for authored spots.
function wallStateFn(L) {
  const W = L.W, D = L.D;
  const wdist = new Float32Array(W * D).fill(9);
  for (let z = 0; z < D; z++)
    for (let x = 0; x < W; x++) {
      if (L.TY[z * W + x] !== T.WATER) continue;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) {
          const xx = x + dx, zz = z + dz;
          if (xx < 0 || zz < 0 || xx >= W || zz >= D) continue;
          wdist[zz * W + xx] = Math.min(wdist[zz * W + xx], Math.hypot(dx, dz));
        }
    }
  const shr = L.id === 'shrine', vista = L.id === 'vista';
  return (x, z, y) => {
    const n = fbm2(x * 0.11, z * 0.11, 2, 41);
    const ix = clamp(Math.floor(x), 0, W - 1), iz = clamp(Math.floor(z), 0, D - 1);
    let cond, wet = 0, style = 0;
    if (shr) {
      cond = 0.15 + n * 0.4;
      wet = 0.12;
      if (z < 17) style = 1;
    } else if (vista) cond = 0.3;
    else if (z >= 64) cond = 0.45 + n * 0.7;
    else if (z >= 42) cond = 0.05 + n * 0.55;
    else cond = n * 1.1;
    const d = Math.min(wdist[iz * W + ix], wdist[clamp(iz + 1, 0, D - 1) * W + ix], wdist[iz * W + clamp(ix + 1, 0, W - 1)]);
    wet = Math.max(wet, clamp(1 - d / 3.2, 0, 1) * (shr ? 0.6 : 1));
    for (const wf of L.waterfalls ?? []) {
      const dx = Math.max(wf.x0 - x, 0, x - wf.x1), dz = Math.abs(z - wf.z);
      wet = Math.max(wet, clamp(1.2 - Math.hypot(dx, dz) / 4, 0, 1));
    }
    for (const o of L.wallWear ?? [])
      if (x >= o.x0 && x <= o.x1 && z >= o.z0 && z <= o.z1) {
        if (o.cond !== undefined) cond = o.cond;
        if (o.wet !== undefined) wet = o.wet;
        if (o.style !== undefined) style = o.style;
      }
    return [clamp(cond, 0, 1), clamp(wet, 0, 1), style];
  };
}

function groundMaterial(tex) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  const base = mat;
  patchWorldMaterial(base);
  const inner = base.onBeforeCompile;
  base.onBeforeCompile = (shader) => {
    inner(shader);
    Object.assign(shader.uniforms, {
      tGrass: { value: tex.grass }, tDirt: { value: tex.dirt }, tFlag: { value: tex.flag }, tFlagDamp: { value: tex.flagDamp },
      tRock: { value: tex.cliff }, tBed: { value: tex.bed }, tRoot: { value: tex.bark }, tNoise: { value: tex.noise },
    });
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 splatA; attribute vec2 splatB; attribute vec2 dampWear; varying vec4 vSA; varying vec2 vSB; varying vec2 vDW;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSA = splatA; vSB = splatB; vDW = dampWear;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>
        uniform sampler2D tGrass, tDirt, tFlag, tFlagDamp, tRock, tBed, tRoot, tNoise;
        varying vec4 vSA; varying vec2 vSB; varying vec2 vDW;`)
      .replace('#include <map_fragment>', `
        vec2 wuv = vWPos.xz * 0.25;
        float n1 = texture2D(tNoise, wuv * 1.3).r;
        float n2 = texture2D(tNoise, wuv * 3.1 + vec2(0.31, 0.77)).g;
        float n3 = texture2D(tNoise, wuv * 2.2 + vec2(0.61, 0.13)).b;
        float w[6];
        w[0] = vSA.x + (n1 - 0.5) * 0.55 + (n2 - 0.5) * 0.25;
        w[1] = vSA.y + (n3 - 0.5) * 0.5;
        w[2] = vSA.z + (n2 - 0.5) * 0.3;
        w[3] = vSA.w + (n3 - 0.5) * 0.45 + (n1 - 0.5) * 0.2;
        w[4] = vSB.x + 0.08;
        w[5] = vSB.y + (n1 - 0.5) * 0.3;
        int best = 0; float bw = -9.0; float sw = -9.0;
        for (int q = 0; q < 6; q++) { if (w[q] > bw) { sw = bw; bw = w[q]; best = q; } else if (w[q] > sw) sw = w[q]; }
        // damp: water, shade and wall bases; wear: the walked routes
        float damp = clamp(vDW.x + (n2 - 0.5) * 0.35 + (n1 - 0.5) * 0.2, 0.0, 1.0);
        float wear = clamp(vDW.y + (n3 - 0.5) * 0.3, 0.0, 1.0);
        vec4 tc;
        if (best == 0) {
          tc = texture2D(tGrass, wuv);
          // trampled verge: grass thins toward the bare path
          tc.rgb = mix(tc.rgb, texture2D(tDirt, wuv).rgb * 1.04, smoothstep(0.45, 0.9, wear) * 0.55);
          tc.rgb *= mix(1.0, 0.88, damp);
        }
        else if (best == 1) tc = texture2D(tDirt, wuv);
        else if (best == 2) {
          tc = mix(texture2D(tFlag, wuv), texture2D(tFlagDamp, wuv), smoothstep(0.38, 0.62, damp));
          // walked paving is worn smooth and a touch paler
          tc.rgb = mix(tc.rgb, texture2D(tFlag, wuv, 3.5).rgb * 1.03, smoothstep(0.3, 0.8, wear) * 0.3);
        }
        else if (best == 3) tc = texture2D(tRock, wuv * vec2(1.0, 1.0) + vec2(0.13, 0.4));
        else if (best == 4) tc = texture2D(tBed, wuv);
        else tc = texture2D(tRoot, wuv);
        // a thin shadowed seam where one ground type laps over another
        if (bw - sw < 0.07) tc.rgb *= (best == 0 ? mix(0.86, 0.7, damp) : 0.86);
        diffuseColor *= tc;
      `);
  };
  return mat;
}

function lambert(map, extra = {}) {
  return patchWorldMaterial(new THREE.MeshLambertMaterial({ map, vertexColors: true, ...extra }));
}

export function buildWorld(L, tex) {
  const group = new THREE.Group();
  const mats = {
    [T.GRASS]: lambert(tex.grass),
    [T.DIRT]: lambert(tex.dirt),
    [T.FLAG]: lambert(tex.flag),
    [T.WATER]: lambert(tex.bed),
    [T.ROCK]: lambert(tex.cliff),
    [T.ROOT]: lambert(tex.bark),
    masonry: wallMaterial(tex, L, false),
    cliff: wallMaterial(tex, L, true),
  };
  const geos = {};
  const G = (k) => (geos[k] ??= new Geo());

  const H = (x, z) => terrainHeight(L, x, z);
  {
    const VW = L.W + 1, a = new Float32Array(VW * (L.D + 1));
    for (let z = 0; z <= L.D; z++)
      for (let x = 0; x <= L.W; x++) {
        let mas = 0;
        for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) {
          const tx = x + ox, tz = z + oz;
          if (tx >= 0 && tz >= 0 && tx < L.W && tz < L.D) {
            const ii = tz * L.W + tx;
            if (L.MAS[ii] || (L.stairs.get(ii) && !L.stairs.get(ii).natural)) mas = 1;
          }
        }
        a[z * VW + x] = mas ? 0.07 : 0.3;
      }
    ampField = { W: VW, a };
  }
  const field = dampWearField(L);
  const wallState = wallStateFn(L);
  const varTint = (x, z) => 0.9 + fbm2(x * 0.13, z * 0.13, 3, 21) * 0.2;

  // ambient occlusion / rim light for a point on a top surface
  function topShade(x, z, h) {
    let occ = 0, rim = 0;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      for (const r of [0.35, 0.8]) {
        const hn = H(x + Math.cos(ang) * r, z + Math.sin(ang) * r);
        if (hn > h + 0.2) occ += clamp(hn - h, 0, 1.5) * (r < 0.5 ? 1 : 0.5);
        if (hn < h - 0.4 && r < 0.5) rim = 1;
      }
    }
    return clamp(1 - occ * 0.085, 0.42, 1) * (rim ? 1.2 : 1) * varTint(x, z);
  }

  // --- top surfaces: one mesh, ground types blended per vertex and resolved
  // per pixel with a noisy argmax, so transitions are crisp but hand-shaped.
  const N = SUB;
  const ground = new Geo();
  const splatA = [], splatB = [], dw = [];
  const typeW = (x, z, hv) => {
    const w = [0, 0, 0, 0, 0, 0];
    for (let a = -1; a <= 1; a++)
      for (let b = -1; b <= 1; b++) {
        const sx = x + a * 0.45, sz = z + b * 0.45;
        const tx = Math.floor(sx), tz = Math.floor(sz);
        if (tx < 0 || tz < 0 || tx >= L.W || tz >= L.D) continue;
        if (Math.abs(H(sx, sz) - hv) > 0.3) continue;
        const k = a === 0 && b === 0 ? 1.6 : a === 0 || b === 0 ? 1 : 0.6;
        w[L.TY[tz * L.W + tx]] += k;
      }
    const sum = w.reduce((p, c) => p + c, 0) || 1;
    return w.map((v) => v / sum);
  };
  for (let tz = 0; tz < L.D; tz++) {
    for (let tx = 0; tx < L.W; tx++) {
      const i = tz * L.W + tx;
      const st = L.stairs.get(i);
      if (st && !st.natural) continue;
      const ids = [];
      for (let j = 0; j <= N; j++) {
        for (let k = 0; k <= N; k++) {
          const x = tx + k / N, z = tz + j / N;
          const y = st ? H(Math.min(x, tx + 0.999), Math.min(z, tz + 0.999)) : L.H[i];
          const [dx, dz] = disp(x, y, z);
          ids.push(ground.v(x + dx, y, z + dz, x * TEX_SCALE, z * TEX_SCALE, topShade(x, z, y)));
          const w = st ? [0, 0, 0, 0, 0, 0].map((_, q) => (q === L.TY[i] ? 1 : 0)) : typeW(x, z, y);
          splatA.push(w[T.GRASS], w[T.DIRT], w[T.FLAG], w[T.ROCK]);
          splatB.push(w[T.WATER], w[T.ROOT]);
          dw.push(field.at(field.damp, x, z), field.at(field.wear, x, z));
        }
      }
      for (let j = 0; j < N; j++)
        for (let k = 0; k < N; k++) {
          const a = ids[j * (N + 1) + k];
          ground.quad(a, ids[(j + 1) * (N + 1) + k], ids[(j + 1) * (N + 1) + k + 1], ids[j * (N + 1) + k + 1]);
        }
    }
  }
  {
    const g = ground.build();
    g.setAttribute('splatA', new THREE.Float32BufferAttribute(splatA, 4));
    g.setAttribute('splatB', new THREE.Float32BufferAttribute(splatB, 2));
    g.setAttribute('dampWear', new THREE.Float32BufferAttribute(dw, 2));
    const mesh = new THREE.Mesh(g, groundMaterial(tex));
    mesh.castShadow = mesh.receiveShadow = true;
    group.add(mesh);
  }

  // --- vertical faces wherever a tile stands above its neighbour
  const EPS = 0.001;
  const edges = [
    // [neighbour dx, dz, edge start (x,z) offset, edge end offset]
    [0, 1, [0, 1], [1, 1]], // south face (towards camera)
    [0, -1, [1, 0], [0, 0]], // north face
    [1, 0, [1, 1], [1, 0]], // east face
    [-1, 0, [0, 0], [0, 1]], // west face
  ];
  for (let tz = 0; tz < L.D; tz++) {
    for (let tx = 0; tx < L.W; tx++) {
      const i = tz * L.W + tx;
      for (const [ndx, ndz, s, e] of edges) {
        const nx = tx + ndx, nz = tz + ndz;
        if (nx < 0 || nz < 0 || nx >= L.W || nz >= L.D) continue;
        // sample my heights and the neighbour's at both ends of the shared edge
        const sx = tx + s[0], sz = tz + s[1], ex = tx + e[0], ez = tz + e[1];
        const inset = (px, pz, toNeighbour) => {
          const ox = toNeighbour ? ndx * 0.5 : -ndx * 0.5;
          const oz = toNeighbour ? ndz * 0.5 : -ndz * 0.5;
          // pull the sample slightly towards the edge midpoint along the edge
          const mx = (sx + ex) / 2, mz = (sz + ez) / 2;
          const qx = px + (mx - px) * EPS * 2 + ox * 0.02;
          const qz = pz + (mz - pz) * EPS * 2 + oz * 0.02;
          return H(qx, qz);
        };
        const a0 = inset(sx, sz, false), a1 = inset(ex, ez, false);
        const b0 = inset(sx, sz, true), b1 = inset(ex, ez, true);
        if (a0 <= b0 + 0.01 && a1 <= b1 + 0.01) continue;
        const bot0 = Math.min(a0, b0), bot1 = Math.min(a1, b1);
        const mas = L.MAS[i] || (L.stairs.get(i) && !L.stairs.get(i).natural);
        const g = G(mas ? 'masonry' : 'cliff');
        const runSeed = ((ndz !== 0 ? tz + ndz * 0.5 : tx + ndx * 0.5) * 0.137) % 1;
        const hspan = Math.max(a0 - bot0, a1 - bot1);
        const NV = Math.max(1, Math.ceil(hspan / 0.5));
        const NH = SUB;
        const ids = [];
        for (let r = 0; r <= NV; r++) {
          for (let k = 0; k <= NH; k++) {
            const t = k / NH;
            const x = sx + (ex - sx) * t, z = sz + (ez - sz) * t;
            const top = a0 + (a1 - a0) * t, bot = bot0 + (bot1 - bot0) * t;
            const y = bot + (top - bot) * (r / NV);
            const [dx, dz] = disp(x, y, z);
            const along = ndz !== 0 ? x : z;
            const up = y - bot;
            let shade = 0.5 + 0.5 * smoothstep(0, 1.8, up);
            if (top - y < 0.08) shade *= 1.08;
            // the lowest part of a wall standing in water darkens and cools
            if (bot < 0) shade *= 0.85;
            shade *= varTint(x + 3, z - 2);
            const st = wallState(x, z, y);
            ids.push(g.v(x + dx, y, z + dz, along * TEX_SCALE, -y * TEX_SCALE, shade, [st[0], st[1], st[2], up], [top - y, runSeed]));
          }
        }
        for (let r = 0; r < NV; r++)
          for (let k = 0; k < NH; k++) {
            const a = ids[r * (NH + 1) + k];
            g.quad(a, ids[r * (NH + 1) + k + 1], ids[(r + 1) * (NH + 1) + k + 1], ids[(r + 1) * (NH + 1) + k]);
          }
      }
    }
  }

  // --- stairs: real steps for the built ones (collision treats them as ramps)
  for (const [i, s] of L.stairs) {
    if (s.natural) continue;
    const tx = i % L.W, tz = Math.floor(i / L.W);
    const rise = Math.abs(s.to - s.from);
    const n = Math.max(2, Math.round(rise / 0.2));
    const tread = G('stairTread');
    const riser = G('stairRiser');
    for (let k = 0; k < n; k++) {
      // step k spans [k/n,(k+1)/n] along the ascent direction
      const y = s.from + ((s.to - s.from) * (k + 1)) / n;
      const yb = s.from + ((s.to - s.from) * k) / n;
      const f0 = k / n, f1 = (k + 1) / n;
      // map ascent fraction to tile coordinates
      const P = (f, w) => {
        if (s.dir === 'n') return [tx + w, tz + 1 - f];
        if (s.dir === 's') return [tx + w, tz + f];
        if (s.dir === 'e') return [tx + f, tz + w];
        return [tx + 1 - f, tz + w];
      };
      const sh = 0.82 + (k % 2) * 0.06;
      const [ax, az] = P(f0, 0), [bx, bz] = P(f0, 1), [cx, cz] = P(f1, 1), [dx2, dz2] = P(f1, 0);
      const tv = (x, z) => tread.v(x, y, z, x * TEX_SCALE, z * TEX_SCALE, sh * 1.08);
      const t0 = tv(ax, az), t1 = tv(bx, bz), t2 = tv(cx, cz), t3 = tv(dx2, dz2);
      // keep winding facing up regardless of direction
      const cross = (bx - ax) * (dz2 - az) - (bz - az) * (dx2 - ax);
      if (cross < 0) tread.quad(t0, t1, t2, t3);
      else tread.quad(t0, t3, t2, t1);
      const rv = (x, z, yy, c) => riser.v(x, yy, z, (s.dir === 'n' || s.dir === 's' ? x : z) * TEX_SCALE, -yy * TEX_SCALE, c);
      const r0 = rv(ax, az, yb, 0.55), r1 = rv(bx, bz, yb, 0.55), r2 = rv(bx, bz, y, 0.8), r3 = rv(ax, az, y, 0.8);
      const fx = ax - (s.dir === 'e' ? 1 : s.dir === 'w' ? -1 : 0);
      const fz = az - (s.dir === 's' ? 1 : s.dir === 'n' ? -1 : 0);
      const c2 = (bx - ax) * (fz - az) - (bz - az) * (fx - ax);
      if (c2 > 0) riser.quad(r0, r1, r2, r3);
      else riser.quad(r0, r3, r2, r1);
    }
  }
  mats.stairTread = lambert(tex.flag);
  mats.stairRiser = mats.masonry;

  for (const k in geos) {
    const mesh = new THREE.Mesh(geos[k].build(), mats[k] ?? mats.masonry);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  // authored coping, capstones, corners and collapsed ends over the masonry edges
  if (!/[?&]nokit/.test(location.search)) group.add(buildMasonryKit(L, mats.masonry, mats[T.FLAG]));

  // --- free-standing solids: bridge decks, piers, the beam, the roof
  const solids = expandSolids(L.solids);
  const masonryMat = mats.masonry;
  const flagMat = mats[T.FLAG];
  for (const s of solids) {
    if (s.kind === 'crack' || s.kind === 'invisible') continue; // crack is drawn by its entity
    if (s.kind === 'roof') {
      group.add(buildRoof(s, flagMat, masonryMat));
      continue;
    }
    group.add(buildBlock(s, s.kind === 'parapet' ? masonryMat : flagMat, masonryMat, wallState));
  }

  // --- water surface
  const water = buildWater(L, tex);
  group.add(water);

  return { group, mats, solids, water };
}

function expandSolids(list) {
  const out = [];
  for (const s of list) {
    out.push(s);
    if (s.kind === 'bridge' && s.parapet) {
      // low broken parapets along both sides; ragged where the deck is broken
      const r = mulberry32(Math.floor(s.z0 * 100 + s.x0 * 7));
      const alongX = s.axis === 'x';
      const a0 = alongX ? s.x0 : s.z0, a1 = alongX ? s.x1 : s.z1;
      const sides = alongX ? [[s.z0, s.z0 + 0.2], [s.z1 - 0.2, s.z1]] : [[s.x0, s.x0 + 0.22], [s.x1 - 0.22, s.x1]];
      const endHi = alongX ? 'x1' : 'z1', endLo = alongX ? 'x0' : 'z0';
      for (const [p0, p1] of sides) {
        let t = a0;
        while (t < a1 - 0.2) {
          const len = Math.min(0.8 + r() * 1.4, a1 - t);
          const h = 0.28 + r() * 0.18;
          const nearBreak = (s.brokenEnd === endHi && t + len > a1 - 0.8) || (s.brokenEnd === endLo && t < a0 + 0.6);
          const missing = r() < 0.12;
          if (!missing && (!nearBreak || r() < 0.45)) {
            const box = alongX
              ? { x0: t, z0: p0, x1: t + len - 0.04, z1: p1 }
              : { x0: p0, z0: t, x1: p1, z1: t + len - 0.04 };
            out.push({ ...box, y0: s.y1, y1: s.y1 + (nearBreak ? h * 0.5 : h), kind: 'parapet' });
          }
          t += len;
        }
      }
    }
    if (s.kind === 'roof') {
      // a ragged hole: slab cells are present unless inside the hole or knocked out near it
      const r = mulberry32(77);
      s.cells = new Set();
      for (let z = s.z0; z < s.z1; z++)
        for (let x = s.x0; x < s.x1; x++) {
          const [hx0, hz0, hx1, hz1] = s.hole;
          const cx = x + 0.5, cz = z + 0.5;
          const inHole = cx > hx0 && cx < hx1 && cz > hz0 && cz < hz1;
          const nearHole = cx > hx0 - 1 && cx < hx1 + 1 && cz > hz0 - 1 && cz < hz1 + 1;
          if (inHole) continue;
          if (nearHole && r() < 0.35) continue;
          s.cells.add(`${x},${z}`);
        }
    }
  }
  return out;
}

function boxGeo(x0, y0, z0, x1, y1, z1, chip = 0.05, seed = 1) {
  // a box whose top corners are slightly worn down
  const g = new THREE.BoxGeometry(x1 - x0, y1 - y0, z1 - z0, 2, 1, 2);
  g.translate((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
  const p = g.attributes.position;
  // offsets are a function of position so the box's faces stay welded
  const h = (x, y, z, s) => mulberry32(Math.floor(x * 1000) * 73856093 ^ Math.floor(y * 1000) * 19349663 ^ Math.floor(z * 1000) * 83492791 ^ (seed + s))();
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    const top = y > (y0 + y1) / 2;
    p.setXYZ(k, x + (h(x, y, z, 1) - 0.5) * chip * 0.6, top ? y - h(x, y, z, 2) * chip : y, z + (h(x, y, z, 3) - 0.5) * chip * 0.6);
  }
  // world-space uvs so the textures match the terrain
  const n = g.attributes.normal, uv = g.attributes.uv;
  for (let k = 0; k < p.count; k++) {
    const x = p.getX(k), y = p.getY(k), z = p.getZ(k);
    if (Math.abs(n.getY(k)) > 0.5) uv.setXY(k, x * TEX_SCALE, z * TEX_SCALE);
    else if (Math.abs(n.getX(k)) > 0.5) uv.setXY(k, z * TEX_SCALE, -y * TEX_SCALE);
    else uv.setXY(k, x * TEX_SCALE, -y * TEX_SCALE);
  }
  g.computeVertexNormals();
  return g;
}

function withShade(g, fn) {
  const p = g.attributes.position;
  const cols = new Float32Array(p.count * 3);
  for (let k = 0; k < p.count; k++) {
    const c = fn(p.getX(k), p.getY(k), p.getZ(k), k);
    cols[k * 3] = cols[k * 3 + 1] = cols[k * 3 + 2] = c;
  }
  g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g;
}

function buildBlock(s, topMat, sideMat, wallState) {
  const grp = new THREE.Group();
  const g = withShade(boxGeo(s.x0, s.y0, s.z0, s.x1, s.y1, s.z1, s.kind === 'parapet' ? 0.08 : 0.05, Math.floor(s.z0 * 31 + s.x0 * 7)), (x, y) =>
    0.6 + 0.4 * smoothstep(s.y0, s.y0 + 1.5, y)
  );
  if (wallState) {
    // piers and parapets age like the walls around them
    const p = g.attributes.position, wa = [], wb = [];
    const seed = ((s.x0 * 0.31 + s.z0 * 0.17) % 1 + 1) % 1;
    for (let k = 0; k < p.count; k++) {
      const st = wallState(p.getX(k), p.getZ(k), p.getY(k));
      wa.push(st[0], st[1], st[2], p.getY(k) - Math.max(s.y0, -0.2));
      wb.push(s.y1 - p.getY(k), seed);
    }
    g.setAttribute('wallInfo', new THREE.Float32BufferAttribute(wa, 4));
    g.setAttribute('wallB', new THREE.Float32BufferAttribute(wb, 2));
  }
  // BoxGeometry groups: 0 +x,1 -x,2 +y,3 -y,4 +z,5 -z
  const mesh = new THREE.Mesh(g, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
  mesh.castShadow = mesh.receiveShadow = true;
  grp.add(mesh);
  return grp;
}

function buildRoof(s, topMat, sideMat) {
  const grp = new THREE.Group();
  const r = mulberry32(5);
  for (const key of s.cells) {
    const [x, z] = key.split(',').map(Number);
    const dy = (r() - 0.5) * 0.08;
    const g = withShade(boxGeo(x + 0.02, s.y0 + dy, z + 0.02, x + 0.98, s.y1 + dy, z + 0.98, 0.09, x * 13 + z * 7), (px, py) =>
      py > s.y1 - 0.2 ? 0.85 + r() * 0.1 : 0.55
    );
    const m = new THREE.Mesh(g, [sideMat, sideMat, topMat, sideMat, sideMat, sideMat]);
    m.castShadow = m.receiveShadow = true;
    grp.add(m);
  }
  return grp;
}

function buildWater(L, tex) {
  const g = new Geo();
  const isW = (x, z) => x >= 0 && z >= 0 && x < L.W && z < L.D && L.TY[z * L.W + x] === T.WATER;
  // distance from the shore (tiles), so broad water darkens toward its middle
  const dist = new Float32Array(L.W * L.D).fill(9);
  for (let tz = 0; tz < L.D; tz++)
    for (let tx = 0; tx < L.W; tx++) {
      if (!isW(tx, tz)) continue;
      let d = 9;
      for (let dz = -3; dz <= 3; dz++)
        for (let dx = -3; dx <= 3; dx++) if (!isW(tx + dx, tz + dz) && tx + dx >= 0 && tz + dz >= 0 && tx + dx < L.W && tz + dz < L.D) d = Math.min(d, Math.hypot(dx, dz));
      dist[tz * L.W + tx] = d;
    }
  // flow: churned water under the falls and in narrow channels; still pools get none
  const flowAt = (x, z) => {
    let f = 0;
    for (const wf of L.waterfalls ?? []) {
      const dx = Math.max(wf.x0 - x, 0, x - wf.x1), dz = z - wf.z;
      if (dz > -0.5) f = Math.max(f, 1 - Math.hypot(dx, Math.max(0, dz)) / 3.5);
    }
    let n = 0;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) if (isW(Math.floor(x) + dx, Math.floor(z) + dz)) n++;
    if (n < 14) f = Math.max(f, 0.4);
    return f;
  };
  const vDist = (x, z) => {
    let d = 0, n = 0;
    for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (isW(x + ox, z + oz)) { d += Math.min(3, dist[(z + oz) * L.W + x + ox]); n++; }
    return n ? d / n / 3 : 0;
  };
  for (let tz = 0; tz < L.D; tz++)
    for (let tx = 0; tx < L.W; tx++) {
      if (!isW(tx, tz)) continue;
      const ids = [];
      for (let j = 0; j <= 1; j++)
        for (let k = 0; k <= 1; k++) {
          const x = tx + k, z = tz + j;
          // shore factor: 1 at vertices touching dry land (foam / shallows)
          let shore = 0;
          for (const [ox, oz] of [[-1, -1], [0, -1], [-1, 0], [0, 0]]) if (!isW(x + ox, z + oz)) shore = 1;
          ids.push(g.v(x, L.H[tz * L.W + tx] + WATER_DEPTH, z, x * TEX_SCALE, z * TEX_SCALE, shore));
          const ci = g.c.length - 3;
          g.c[ci + 1] = flowAt(x, z);
          g.c[ci + 2] = shore ? 0 : vDist(x, z);
        }
      g.quad(ids[0], ids[2], ids[3], ids[1]);
    }
  const geo = g.build();
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: {
      ...worldUniforms,
      uRipple: { value: tex.ripple },
      uShallow: { value: new THREE.Color('#3f6168') },
      uDeepW: { value: new THREE.Color('#1b2c3b') },
      uSky: { value: new THREE.Color('#9fb3b8') },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      varying vec3 vWPos; varying float vViewZ; varying float vShore; varying vec3 vView; varying float vFlow; varying float vDepth;
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWPos = wp.xyz; vShore = color.r; vFlow = color.g; vDepth = color.b;
        vec4 mv = viewMatrix * wp; vViewZ = -mv.z;
        vView = normalize(cameraPosition - wp.xyz);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uRipple; uniform vec3 uShallow; uniform vec3 uDeepW; uniform vec3 uSky; uniform vec3 uSunDir;
      uniform float uTime;
      varying vec3 vWPos; varying float vViewZ; varying float vShore; varying vec3 vView; varying float vFlow; varying float vDepth;
      float bayer4(vec2 p) {
        ivec2 q = ivec2(mod(p, 4.0)); int i = q.y * 4 + q.x;
        int m[16] = int[16](0,8,2,10,12,4,14,6,3,11,1,9,15,7,13,5);
        return (float(m[i]) + 0.5) / 16.0;
      }
      void main() {
        vec2 uv = vWPos.xz * 0.25;
        float sp = 1.0 + vFlow * 2.5;
        float r1 = texture2D(uRipple, uv * 1.3 + vec2(uTime * 0.02, uTime * 0.035 * sp)).r;
        float r2 = texture2D(uRipple, uv * 0.9 - vec2(uTime * 0.03, -uTime * 0.012 * sp) + 0.37).r;
        float ripple = r1 * r2;
        float shore = vShore;
        // shallow band hugs the shore; broad water deepens toward its middle
        vec3 c = mix(uDeepW, uShallow, smoothstep(0.35, 1.0, shore) * 0.85);
        c *= 1.0 - 0.22 * smoothstep(0.3, 1.0, vDepth);
        float fres = pow(1.0 - clamp(vView.y, 0.0, 1.0), 3.0);
        c = mix(c, uSky * 0.55, fres * 0.6 + 0.08);
        // restrained glints: quantised, dithered, never blown out
        float glint = step(0.35, ripple) * 0.5 + step(0.8, ripple) * 0.5;
        c += vec3(0.23, 0.24, 0.2) * glint * (0.35 + 0.35 * vFlow + 0.3 * step(bayer4(gl_FragCoord.xy), 0.6));
        // a thin wet line where water meets stone, everywhere
        float edge = smoothstep(0.82, 1.0, shore);
        c = mix(c, uShallow * 1.35, edge * 0.35);
        // foam only where the water is moving: under the falls, along channels
        float churn = clamp(vFlow * (0.4 + shore * 0.9), 0.0, 1.0);
        float foam = smoothstep(0.2, 0.8, churn) * step(bayer4(gl_FragCoord.xy + floor(uTime * 6.0)), 0.25 + r1 * 0.55);
        c = mix(c, vec3(0.66, 0.68, 0.62), foam * 0.6);
        float alpha = 0.55 + fres * 0.25 - shore * 0.12;
        gl_FragColor = vec4(c, alpha);
        #include <colorspace_fragment>
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.renderOrder = 2;
  return mesh;
}

// ------------------------------------------------------------------ physics

export function makeCollider(L, solids) {
  const terrain = (x, z) => terrainHeight(L, x, z);
  const inside = (s, x, z) => {
    if (s.off) return false;
    if (x < s.x0 || x > s.x1 || z < s.z0 || z > s.z1) return false;
    if (s.cells) return s.cells.has(`${Math.floor(x)},${Math.floor(z)}`);
    return true;
  };

  // highest surface under (x,z) that is not above y + tolerance
  function ground(x, z, y, tol = STEP) {
    let g = terrain(x, z);
    for (const s of solids) if (s.kind !== 'invisible' && inside(s, x, z) && s.y1 <= y + tol && s.y1 > g) g = s.y1;
    return g;
  }

  function blockedPoint(x, z, y, h) {
    if (x < 0.3 || z < 0.3 || x > L.W - 0.3 || z > (L.walkMaxZ ?? L.D) - 0.3) return true;
    if (terrain(x, z) > y + STEP) return true;
    for (const s of solids) if (inside(s, x, z) && s.y1 > y + STEP && s.y0 < y + h) return true;
    return false;
  }

  function blocked(x, z, y, r = 0.28, h = 1.35) {
    if (blockedPoint(x, z, y, h)) return true;
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2;
      if (blockedPoint(x + Math.cos(ang) * r, z + Math.sin(ang) * r, y, h)) return true;
    }
    return false;
  }

  function isWater(x, z) {
    const tx = Math.floor(x), tz = Math.floor(z);
    if (tx < 0 || tz < 0 || tx >= L.W || tz >= L.D) return false;
    return L.TY[tz * L.W + tx] === T.WATER;
  }

  // sun occlusion test for sprites: march towards the sun through terrain and solids
  function sunlit(x, y, z, sun, canopies = []) {
    let lit = 1;
    for (let t = 0.4; t < 16; t += 0.35) {
      const px = x + sun.x * t, py = y + sun.y * t, pz = z + sun.z * t;
      if (terrain(px, pz) > py) return 0;
      for (const s of solids) if (inside(s, px, pz) && py > s.y0 && py < s.y1) return 0;
    }
    for (const c of canopies) {
      // project the canopy centre onto the sun ray
      const dx = c.x - x, dy = c.y - y, dz = c.z - z;
      const t = dx * sun.x + dy * sun.y + dz * sun.z;
      if (t <= 0) continue;
      const qx = dx - sun.x * t, qy = dy - sun.y * t, qz = dz - sun.z * t;
      const d2 = qx * qx + qy * qy + qz * qz;
      if (d2 < c.r * c.r * 0.7) lit = Math.min(lit, 0.35);
    }
    return lit;
  }

  return { terrain, ground, blocked, isWater, sunlit, solids };
}

export { tileHeight };

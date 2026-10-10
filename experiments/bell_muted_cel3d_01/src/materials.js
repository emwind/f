import * as THREE from '../vendor/three.module.min.js';
import { smoothNormalsCopy } from './geom.js';

// ---------------------------------------------------------------------------
// Palette: muted ancient-fantasy. Saturation is hierarchical: environment low,
// player + gameplay accents slightly stronger.
// ---------------------------------------------------------------------------
export const PAL = {
  limestone:   0xb8a888, // warm aged limestone (exposed)
  limeCool:    0x9c988a, // cool grey-beige stone
  limeDark:    0x7f7b6e, // darker coursing / lower walls
  paving:      0xa99d84,
  dirt:        0x7a6850,
  dirtDark:    0x5c4f3e,
  moss:        0x6b6f43, // muted olive
  mossDark:    0x4d5436,
  leaf:        0x56643f, // desaturated forest green
  leafDark:    0x34432f, // dark cool green
  leafOlive:   0x6e7446,
  bark:        0x574536,
  barkDark:    0x3d3129,
  root:        0x5f4b39,
  indigo:      0x434a6b,
  indigoDeep:  0x2e3350,
  gold:        0xa38645,
  bronze:      0x7d6438,
  water:       0x506660,
  waterDeep:   0x2c4143,
  rock:        0x8a8577,
  rockDark:    0x666356,
  // characters
  skin:        0xc4a07f,
  hair:        0x3b2c22,
  tunic:       0x4b5876, // muted indigo-blue
  tunicDark:   0x363f58,
  scarf:       0x9c5634, // the one warm accent
  leather:     0x6a4c33,
  cloth:       0xa79a7c,
  blade:       0xa9a597,
  guardian:    0x8f8c80,
  guardianDark:0x6b6a61,
  eye:         0xd9b45c,
};

export const STATE = { toon: true, outlines: true, shadows: true, grade: true };

// Shared uniforms (time, height falloff) for all painted materials
export const GLOBAL = {
  uTime: { value: 0 },
  uLowTint: { value: new THREE.Color(0x56656a) },   // what deep/low areas drift toward
  uLowRange: { value: new THREE.Vector2(-1.2, 1.6) },
  uCloud: { value: 0.24 },                            // large soft shade zones (authored value composition)
};

// 3-band toon ramp with slightly soft transitions (avoids the hard anime edge)
function makeRamp() {
  const N = 64, data = new Uint8Array(N * 4);
  const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < N; i++) {
    const ndl = (i + 0.5) / N * 2 - 1; // toon coord = ndl*0.5+0.5
    // shadow 0.0 | mid 0.42 | lit 1.0
    let v = 0.0 + 0.42 * ss(-0.02, 0.06, ndl) + 0.58 * ss(0.36, 0.44, ndl);
    const c = Math.round(v * 255);
    data.set([c, c, c, 255], i * 4);
  }
  const t = new THREE.DataTexture(data, N, 1, THREE.RGBAFormat);
  t.minFilter = t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}
export const RAMP = makeRamp();

const NOISE_GLSL = /* glsl */`
varying vec3 vWPos;
varying vec3 vWN;
uniform float uTime;
uniform vec3 uLowTint;
uniform vec2 uLowRange;
uniform float uCloud;
uniform float uNoiseAmt;
uniform float uNoiseScale;
uniform float uMoss;
uniform vec3 uMossColor;
uniform float uStreak;
uniform vec3 uDampColor;
float h31(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(h31(i+vec3(0,0,0)),h31(i+vec3(1,0,0)),f.x), mix(h31(i+vec3(0,1,0)),h31(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(h31(i+vec3(0,0,1)),h31(i+vec3(1,0,1)),f.x), mix(h31(i+vec3(0,1,1)),h31(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ return vnoise(p)*0.6 + vnoise(p*2.13+7.1)*0.3 + vnoise(p*4.7+3.3)*0.1; }
// soft posterize: painted tonal regions rather than continuous noise
float bands(float n){ return smoothstep(0.38,0.46,n)*0.5 + smoothstep(0.60,0.68,n)*0.5; }
`;

export function patchPaintShader(shader) {
    shader.vertexShader = shader.vertexShader
    .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWN;')
    .replace('#include <project_vertex>', `#include <project_vertex>
      vec4 wp4 = vec4(transformed, 1.0);
      vec3 wn = objectNormal;
      #ifdef USE_INSTANCING
        wp4 = instanceMatrix * wp4; wn = mat3(instanceMatrix) * wn;
      #endif
      vWPos = (modelMatrix * wp4).xyz;
      vWN = normalize(mat3(modelMatrix) * wn);`);
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\n' + NOISE_GLSL)
    .replace('#include <color_fragment>', `#include <color_fragment>
      {
        vec3 wp = vWPos; vec3 n = normalize(vWN);
        float big = fbm(wp * uNoiseScale);
        float b = bands(big);
        diffuseColor.rgb *= mix(1.0 - uNoiseAmt, 1.0 + uNoiseAmt * 0.6, b);
        // vertical weathering streaks on walls
        float vert = 1.0 - abs(n.y);
        float st = vnoise(vec3(wp.x * 2.3 + wp.z * 2.3, wp.y * 0.22, 0.0));
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * uDampColor * 1.6, uStreak * vert * smoothstep(0.55, 0.75, st));
        // moss creeping over up-facing surfaces + wall tops
        float up = smoothstep(0.55, 0.9, n.y);
        float mn = fbm(wp * 0.55 + 11.0);
        float m = uMoss * up * smoothstep(0.5, 0.58, mn + uMoss * 0.18);
        // a little moss also on damp low walls
        m = max(m, uMoss * 0.7 * vert * smoothstep(0.62, 0.7, mn) * (1.0 - smoothstep(-0.5, 1.6, wp.y)));
        diffuseColor.rgb = mix(diffuseColor.rgb, uMossColor * mix(0.85, 1.08, b), m);
        // height falloff: ravine reads cooler & darker (aerial / damp depth cue)
        float hl = smoothstep(uLowRange.x, uLowRange.y, wp.y);
        diffuseColor.rgb = mix(diffuseColor.rgb * uLowTint * 1.35, diffuseColor.rgb, 0.45 + 0.55 * hl);
        // broad cloud/canopy shade zones: big calm value shapes across the playfield
        float cl = smoothstep(0.47, 0.6, fbm(vec3(wp.x * 0.05, 0.0, wp.z * 0.065) + vec3(5.0, 1.0, 2.0)));
        diffuseColor.rgb *= 1.0 - uCloud * cl;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * vec3(0.92, 0.97, 1.06), uCloud * cl * 1.5);
      }`);
}

function inject(mat, p) {
  const u = {
    uNoiseAmt: { value: p.noise ?? 0.12 },
    uNoiseScale: { value: p.scale ?? 0.35 },
    uMoss: { value: p.moss ?? 0 },
    uMossColor: { value: new THREE.Color(p.mossColor ?? PAL.moss) },
    uStreak: { value: p.streak ?? 0 },
    uDampColor: { value: new THREE.Color(p.dampColor ?? 0x4f5548) },
  };
  mat.userData.paint = u;
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, GLOBAL);
    patchPaintShader(shader);
  };
  mat.customProgramCacheKey = () => 'paint';
}

const cache = new Map();
const allMats = [];

// Painted environment / character material. Returns the toon material; the
// unquantised Lambert twin lives in userData.alt for the T comparison toggle.
export function paintMat(color, p = {}) {
  const key = JSON.stringify([color, p]);
  if (cache.has(key)) return cache.get(key);
  const common = { color: new THREE.Color(color), vertexColors: true, side: p.side ?? THREE.FrontSide };
  const toon = new THREE.MeshToonMaterial({ ...common, gradientMap: RAMP });
  const lam = new THREE.MeshLambertMaterial({ ...common });
  inject(toon, p); inject(lam, p);
  lam.userData.paint = toon.userData.paint;
  toon.userData.alt = lam; lam.userData.alt = toon;
  cache.set(key, toon);
  allMats.push(toon);
  return toon;
}

// Swap every painted material between toon and lambert
export function applyShadingMode(scene) {
  scene.traverse((o) => {
    if (!o.isMesh || !o.material || !o.material.userData || !o.material.userData.alt) return;
    const wantToon = STATE.toon;
    if (o.material.isMeshToonMaterial !== wantToon) o.material = o.material.userData.alt;
  });
}

// ---------------------------------------------------------------------------
// Inverted-hull outline for characters (stronger than the environment edges)
// ---------------------------------------------------------------------------
export const OUTLINE_MAT = new THREE.ShaderMaterial({
  uniforms: { uColor: { value: new THREE.Color(0x231b16) }, uWidth: { value: 0.022 } },
  vertexShader: /* glsl */`
    uniform float uWidth;
    void main(){
      vec3 p = position + normal * uWidth;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
    }`,
  fragmentShader: /* glsl */`uniform vec3 uColor; void main(){ gl_FragColor = vec4(uColor, 1.0); }`,
  side: THREE.BackSide,
});

export function addHull(root, width = 1) {
  const hulls = [];
  root.traverse((o) => {
    if (!o.isMesh || o.userData.noHull || o.userData.isHull) return;
    hulls.push(o);
  });
  for (const o of hulls) {
    const mat = width === 1 ? OUTLINE_MAT : OUTLINE_MAT.clone();
    if (width !== 1) mat.uniforms.uWidth.value = OUTLINE_MAT.uniforms.uWidth.value * width;
    if (!o.geometry.userData.hullGeom) o.geometry.userData.hullGeom = smoothNormalsCopy(o.geometry);
    const h = new THREE.Mesh(o.geometry.userData.hullGeom, mat);
    h.userData.isHull = true;
    h.castShadow = false; h.receiveShadow = false;
    o.add(h);
  }
}

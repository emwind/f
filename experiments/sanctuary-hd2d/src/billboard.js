// Instanced sprite batches. Three placements:
//   mode 0  upright card that faces the camera's yaw (characters, plants, props)
//   mode 1  flat on the ground (contact shadows, ripples)
//   mode 2  hanging against a wall from a top anchor (vines, grass lips, ivy)
// Upright cards are stretched by 1/cos(pitch) so the art keeps its drawn
// proportions under the 3/4 camera. For the shadow pass the same cards turn to
// face the sun, so their silhouettes throw real shadows onto the 3D terrain.
import * as THREE from '../vendor/three.module.min.js';
import { worldUniforms, GLSL_COMMON } from './shaderPatch.js';

export const spriteUniforms = {
  uRight: { value: new THREE.Vector3(1, 0, 0) },
  uStretch: { value: 1.3 },
  uSunRight: { value: new THREE.Vector3(1, 0, 0) },
};

const VERT = /* glsl */ `
attribute vec3 iPos;
attribute vec2 iSize;
attribute vec4 iRect;
attribute vec4 iTint;
attribute vec4 iMisc;   // sway, flip, mode, angle
attribute vec4 iExtra;  // revealable, flash, castShadow, lean
uniform vec3 uRight;
uniform float uStretch;
uniform vec3 uSunRight;
varying vec2 vUv;
varying vec4 vTint;
varying vec4 vExtra;
SHADOW_DEFINE
vec3 placeVertex(vec2 q) {
  float mode = iMisc.z;
  vec3 wp;
  if (mode < 0.5) {
    #ifdef SHADOW_PASS
      vec3 right = uSunRight;
      float stretch = 1.0;
    #else
      vec3 right = uRight;
      float stretch = uStretch;
    #endif
    wp = iPos + right * q.x * iSize.x + vec3(0.0, q.y * iSize.y * stretch, 0.0);
    float t = uTime * 1.4 + iPos.x * 0.61 + iPos.z * 0.37;
    wp += right * (sin(t) + 0.4 * sin(t * 2.3)) * iMisc.x * q.y * q.y;
    // lean: tilt the top towards the camera a little (keeps tall cards off walls)
    wp.z += iExtra.w * q.y * iSize.y;
  } else if (mode < 1.5) {
    wp = iPos + vec3(q.x * iSize.x, 0.0, (0.5 - q.y) * iSize.y);
  } else {
    float a = iMisc.w;
    vec3 r = vec3(cos(a), 0.0, -sin(a));
    wp = iPos + r * q.x * iSize.x + vec3(0.0, (q.y - 1.0) * iSize.y, 0.0);
    float t = uTime * 1.1 + iPos.x * 0.8 + iPos.z;
    vec3 n = vec3(sin(a), 0.0, cos(a));
    wp += n * sin(t) * iMisc.x * (1.0 - q.y);
  }
  return wp;
}
void main() {
  vec2 q = position.xy;
  vec2 uq = vec2(iMisc.y > 0.5 ? 1.0 - uv.x : uv.x, uv.y);
  vUv = iRect.xy + uq * iRect.zw;
  vTint = iTint;
  vExtra = iExtra;
  vec3 wp = placeVertex(q);
  #ifdef SHADOW_PASS
    if (iExtra.z < 0.5 || iMisc.z > 0.5) wp = vec3(0.0, -999.0, 0.0);
  #endif
  vWPos = wp;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  vViewZ = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vTint;
varying vec4 vExtra;
void main() {
  vec4 c = texture2D(map, vUv);
  if (c.a < 0.5) discard;
  // dithered fade for things that come and go (alpha in tint.a)
  if (bayer4(gl_FragCoord.xy) > vTint.a) discard;
  #ifdef SHADOW_PASS
    gl_FragColor = packDepthToRGBA(gl_FragCoord.z);
  #else
    if (vExtra.x > 0.5) revealDiscard();
    vec3 col = c.rgb * vTint.rgb;
    col = mix(col, vec3(1.0, 0.93, 0.8), vExtra.y);
    col = depthTint(col);
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  #endif
}
`;

function makeMaterial(map, shadow) {
  const uniforms = { ...worldUniforms, ...spriteUniforms, map: { value: map } };
  const head = GLSL_COMMON;
  const vhead = 'uniform float uTime;\nvarying vec3 vWPos;\nvarying float vViewZ;\n';
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: vhead + VERT.replace('SHADOW_DEFINE', shadow ? '#define SHADOW_PASS' : ''),
    fragmentShader: (shadow ? '#define SHADOW_PASS\n#include <packing>\n' : '') + head + FRAG,
    side: THREE.DoubleSide,
  });
  return mat;
}

export class SpriteBatch {
  constructor(atlas, capacity, { castShadow = false } = {}) {
    this.atlas = atlas;
    this.capacity = capacity;
    const base = new THREE.PlaneGeometry(1, 1);
    base.translate(0, 0.5, 0);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index;
    g.setAttribute('position', base.attributes.position);
    g.setAttribute('uv', base.attributes.uv);
    const mk = (n) => new THREE.InstancedBufferAttribute(new Float32Array(capacity * n), n).setUsage(THREE.DynamicDrawUsage);
    this.a = { iPos: mk(3), iSize: mk(2), iRect: mk(4), iTint: mk(4), iMisc: mk(4), iExtra: mk(4) };
    for (const k in this.a) g.setAttribute(k, this.a[k]);
    g.instanceCount = 0;
    this.geo = g;
    this.mesh = new THREE.Mesh(g, makeMaterial(atlas.tex, false));
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = castShadow;
    if (castShadow) this.mesh.customDepthMaterial = makeMaterial(atlas.tex, true);
    this.count = 0;
  }
  clear() {
    this.count = 0;
  }
  // s: {x,y,z, rect name, w,h (world units; defaults from pixel size), tint [r,g,b,a],
  //     sway, flip, mode, angle, reveal, flash, cast, lean}
  add(s) {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    this.set(i, s);
    return i;
  }
  set(i, s) {
    const r = this.atlas.rects[s.rect];
    if (!r) throw new Error('missing sprite ' + s.rect);
    const ppu = s.ppu ?? 60;
    const w = s.w ?? r.pw / ppu, h = s.h ?? r.ph / ppu;
    const t = s.tint ?? [1, 1, 1, 1];
    this.a.iPos.setXYZ(i, s.x, s.y, s.z);
    this.a.iSize.setXY(i, w, h);
    this.a.iRect.setXYZW(i, r.u, r.v, r.w, r.h);
    this.a.iTint.setXYZW(i, t[0], t[1], t[2], t[3] ?? 1);
    this.a.iMisc.setXYZW(i, s.sway ?? 0, s.flip ? 1 : 0, s.mode ?? 0, s.angle ?? 0);
    this.a.iExtra.setXYZW(i, s.reveal ? 1 : 0, s.flash ?? 0, s.cast ? 1 : 0, s.lean ?? 0);
  }
  commit() {
    this.geo.instanceCount = this.count;
    for (const k in this.a) {
      this.a[k].needsUpdate = true;
      this.a[k].clearUpdateRanges?.();
    }
  }
}

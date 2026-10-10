import * as THREE from '../vendor/three.module.min.js';
import { PAL, RAMP, GLOBAL } from './materials.js';
import { Y } from './level.js';

// Restrained stylised water: toon-lit (so it receives the same cast shadows),
// colour driven by a per-vertex depth attribute, a pale shoreline band and a
// few drifting illustrated highlight dashes. No reflections, no SSR.
function waterMaterial({ flow = new THREE.Vector2(1, 0), speed = 0.35 } = {}) {
  const m = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: RAMP, transparent: true, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, GLOBAL, {
      uShallow: { value: new THREE.Color(PAL.water) },
      uDeep: { value: new THREE.Color(PAL.waterDeep) },
      uFoam: { value: new THREE.Color(0xb9bfae) },
      uFlow: { value: flow }, uSpeed: { value: speed },
    });
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aDepth;\nvarying float vDepth;\nvarying vec3 vWP;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvDepth = aDepth; vWP = (modelMatrix * vec4(transformed,1.0)).xyz;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying float vDepth; varying vec3 vWP;
        uniform float uTime; uniform vec3 uShallow, uDeep, uFoam; uniform vec2 uFlow; uniform float uSpeed;
        float wh(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float wn(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(wh(i),wh(i+vec2(1,0)),f.x), mix(wh(i+vec2(0,1)),wh(i+vec2(1,1)),f.x), f.y); }`)
      .replace('#include <color_fragment>', `#include <color_fragment>
        {
          vec2 fl = normalize(uFlow);
          vec2 q = vec2(dot(vWP.xz, fl), dot(vWP.xz, vec2(-fl.y, fl.x)));
          float t = uTime * uSpeed;
          float d = smoothstep(0.0, 1.0, vDepth);
          // soft painted bands of depth rather than a gradient
          float band = smoothstep(0.32, 0.42, d) * 0.5 + smoothstep(0.7, 0.8, d) * 0.5;
          vec3 c = mix(uShallow * 1.08, uDeep, band);
          // slow large-scale tonal drift
          c *= 0.94 + 0.1 * wn(q * vec2(0.18, 0.5) - vec2(t * 0.6, 0.0));
          // sparse elongated highlight dashes drifting with the flow
          float h = wn(q * vec2(0.9, 5.0) - vec2(t * 2.2, 0.0));
          float h2 = wn(q * vec2(0.35, 1.6) + vec2(-t, 3.0));
          float dash = smoothstep(0.80, 0.86, h) * smoothstep(0.45, 0.65, h2);
          c = mix(c, uFoam, dash * 0.55);
          // shoreline band (wobbling)
          float shore = 1.0 - smoothstep(0.05, 0.14 + 0.04 * sin(q.x * 1.3 + t * 3.0), vDepth);
          c = mix(c, uFoam * 0.92, shore * 0.6);
          diffuseColor.rgb = c;
          diffuseColor.a = mix(0.62, 0.93, d) + shore * 0.05;
        }`);
  };
  return m;
}

function waterPlane(x0, x1, z0, z1, depthFn, mat) {
  const sx = Math.max(2, Math.round((x1 - x0) / 0.5)), sz = Math.max(2, Math.round((z1 - z0) / 0.5));
  const g = new THREE.PlaneGeometry(x1 - x0, z1 - z0, sx, sz);
  g.rotateX(-Math.PI / 2);
  g.translate((x0 + x1) / 2, Y.water, (z0 + z1) / 2);
  const p = g.attributes.position, d = new Float32Array(p.count);
  for (let i = 0; i < p.count; i++) d[i] = depthFn(p.getX(i), p.getZ(i));
  g.setAttribute('aDepth', new THREE.BufferAttribute(d, 1));
  const m = new THREE.Mesh(g, mat);
  m.receiveShadow = true; m.renderOrder = 2;
  return m;
}

export function buildWater(scene) {
  const stream = waterMaterial({ flow: new THREE.Vector2(1, 0.05), speed: 0.3 });
  const gorge = waterMaterial({ flow: new THREE.Vector2(0, 1), speed: 0.45 });
  const sm = THREE.MathUtils.smoothstep;
  // stream: shallow at the sloping banks, deepest down the middle
  scene.add(waterPlane(-24, 28, 5.35, 9.15, (x, z) => {
    let d = Math.min(sm(z, 5.35, 6.7), 1 - sm(z, 7.8, 9.15));
    if (x > 10 && x < 18) d = Math.max(d, sm(z, 5.35, 6.4)); // joins the gorge pool
    if (Math.hypot(x + 3.6, z - 7.4) < 1.5) d *= 0.6; // stepping stones riffle
    return d;
  }, stream));
  // gorge: deeper and darker in the middle, shallow along the rock walls
  scene.add(waterPlane(10.2, 17.8, -12, 5.4, (x, z) => {
    let d = Math.min(sm(x, 10.2, 12.2), 1 - sm(x, 15.8, 17.8)) * 1.15;
    d = Math.max(d, 1 - sm(z, -11.9, -10.2)); // plunge pool under the waterfall
    return Math.min(1, d);
  }, gorge));

  // waterfall from the culvert: curved sheet with streaming bands
  const wf = new THREE.MeshToonMaterial({ color: 0xffffff, gradientMap: RAMP, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  wf.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, GLOBAL);
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nvarying vec2 vUv2;').replace('#include <uv_vertex>', '#include <uv_vertex>\nvUv2 = uv;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vUv2; uniform float uTime;\nfloat fh(float x){ return fract(sin(x*91.7)*4375.5); }')
      .replace('#include <color_fragment>', `#include <color_fragment>
        float col = floor(vUv2.x * 14.0);
        float s = fract(vUv2.y * 2.5 + uTime * (0.9 + fh(col) * 0.5) + fh(col + 3.0));
        float streak = smoothstep(0.55, 0.62, s) * (1.0 - smoothstep(0.75, 0.9, s));
        vec3 c = mix(vec3(0.33, 0.44, 0.43), vec3(0.72, 0.76, 0.70), streak * 0.7 + (1.0 - vUv2.y) * 0.15);
        diffuseColor.rgb = c;
        float edge = smoothstep(0.0, 0.12, vUv2.x) * smoothstep(1.0, 0.88, vUv2.x);
        diffuseColor.a = (0.62 + streak * 0.3) * edge;`);
  };
  // sheet bends outward from the culvert lip then falls
  const pts = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push([0.15 + Math.sin(t * Math.PI * 0.5) * 0.9, 4.3 - t * t * 5.1]); }
  const geo = new THREE.BufferGeometry();
  const pos = [], uv = [], idx = [];
  const W = 2.1;
  for (let i = 0; i <= 10; i++) for (let j = 0; j <= 6; j++) {
    const [dz, y] = pts[i]; pos.push(14 - W / 2 + (W * j) / 6, y, -12 + dz); uv.push(j / 6, i / 10);
  }
  for (let i = 0; i < 10; i++) for (let j = 0; j < 6; j++) { const a = i * 7 + j; idx.push(a, a + 7, a + 1, a + 1, a + 7, a + 8); }
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  const fall = new THREE.Mesh(geo, wf); fall.renderOrder = 3;
  scene.add(fall);
  // splash rings at the base
  const ringMat = new THREE.MeshBasicMaterial({ color: 0xb4baa8, transparent: true, opacity: 0.45, depthWrite: false });
  const rings = [];
  for (let i = 0; i < 3; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.72, 20), ringMat.clone());
    r.rotation.x = -Math.PI / 2; r.position.set(14, Y.water + 0.02, -10.9); r.renderOrder = 4;
    scene.add(r); rings.push(r);
  }
  return {
    update(t) {
      rings.forEach((r, i) => {
        const k = (t * 0.5 + i / 3) % 1;
        r.scale.setScalar(0.7 + k * 1.8); r.material.opacity = 0.45 * (1 - k);
      });
    },
  };
}

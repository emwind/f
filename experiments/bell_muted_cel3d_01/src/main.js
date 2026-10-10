import * as THREE from '../vendor/three.module.min.js';
import { STATE, GLOBAL, applyShadingMode, OUTLINE_MAT, PAL } from './materials.js';
import { buildLevel, SPAWN, SHRINE_DOOR, Y } from './level.js';
import { buildWater } from './water.js';
import { Player } from './player.js';
import { Guardian } from './enemy.js';
import { FX } from './fx.js';
import { Post } from './post.js';

const Q = new URLSearchParams(location.search);
const W = () => window.innerWidth, H = () => window.innerHeight;

// ---------------------------------------------------------------- renderer
const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.setSize(W(), H());
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.NoToneMapping;
document.body.appendChild(renderer.domElement);
const pr = renderer.getPixelRatio();
const post = new Post(renderer, W() * pr, H() * pr);

// ---------------------------------------------------------------- scene
const scene = new THREE.Scene();
const SKY = new THREE.Color(0x9aa29a);
scene.background = SKY;
scene.fog = new THREE.Fog(0x8f988f, 34, 95);

// restrained key light from the upper-left (west, slightly south) + cool sky fill
const sun = new THREE.DirectionalLight(0xfff0d8, 2.7);
const SUN_DIR = new THREE.Vector3(-0.72, 0.8, 0.36).normalize();
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -24, right: 24, top: 24, bottom: -24, near: 1, far: 90 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.04; sun.shadow.radius = 3;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight(0xc3cbd0, 0x5e5848, 1.05);
scene.add(hemi);

// ---------------------------------------------------------------- world
const level = buildLevel(scene);
const water = buildWater(scene);
const fx = new FX(scene, level.col);
const player = new Player(scene, level.col, fx);
player.spawn(+(Q.get('x') ?? SPAWN.x), +(Q.get('z') ?? SPAWN.z));
let guardian = new Guardian(scene, level.col, fx, -3, Y.cy, -5.5);

// big-tree canopy fades when the player walks beneath it (keeps the player readable)
let canopy = null;
level.group.traverse((o) => { if (o.userData.canopy) canopy = o; });
if (canopy) for (const m of [canopy.material, canopy.material.userData.alt]) { m.transparent = true; m.opacity = 1; }
let canopyA = 1;

// faint seal glow on the shrine door: brightens as the player approaches
const sealGlow = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.09, 6, 28), new THREE.MeshBasicMaterial({ color: 0xe2c37a, transparent: true, opacity: 0.0, depthWrite: false }));
sealGlow.position.set(SHRINE_DOOR.x, SHRINE_DOOR.y + 2.0, -18.33);
scene.add(sealGlow);

// ---------------------------------------------------------------- camera
// Fixed-yaw elevated 3/4 camera. Restrained perspective (narrow-ish FOV).
const CAM = { pitch: +(Q.get('pitch') ?? 42), dist: +(Q.get('dist') ?? 30), fov: +(Q.get('fov') ?? 34), yaw: +(Q.get('yaw') ?? 0) };
const camera = new THREE.PerspectiveCamera(CAM.fov, W() / H(), 1, 160);
const camTarget = new THREE.Vector3();
function desiredTarget(out) {
  out.set(player.pos.x, player.pos.y * 0.8 + 0.9, player.pos.z - 3.6);
  out.x = THREE.MathUtils.clamp(out.x, -12, 19);
  out.z = THREE.MathUtils.clamp(out.z, -19, 9);
  return out;
}
function placeCamera(dt, snap = false) {
  const d = desiredTarget(new THREE.Vector3());
  if (snap) camTarget.copy(d); else camTarget.lerp(d, 1 - Math.exp(-dt * 4));
  const p = THREE.MathUtils.degToRad(CAM.pitch), y = THREE.MathUtils.degToRad(CAM.yaw);
  camera.fov = CAM.fov; camera.updateProjectionMatrix();
  camera.position.set(camTarget.x + Math.sin(y) * Math.cos(p) * CAM.dist, camTarget.y + Math.sin(p) * CAM.dist, camTarget.z + Math.cos(y) * Math.cos(p) * CAM.dist);
  camera.lookAt(camTarget);
  // shadow frustum follows the view
  sun.position.copy(camTarget).addScaledVector(SUN_DIR, 45);
  sun.target.position.copy(camTarget);
}
placeCamera(0, true);

// ---------------------------------------------------------------- input
const keys = new Set(); const pressed = new Set();
addEventListener('keydown', (e) => { if (!keys.has(e.code)) pressed.add(e.code); keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault(); onDebugKey(e.code); });
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousedown', (e) => { if (e.button === 0) pressed.add('Mouse0'); });
function readInput() {
  const k = (c) => keys.has(c);
  const inp = {
    mx: (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0),
    mz: (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0),
    jump: pressed.has('Space'),
    attack: pressed.has('KeyJ') || pressed.has('Mouse0') || pressed.has('KeyX'),
    dash: pressed.has('ShiftLeft') || pressed.has('ShiftRight') || pressed.has('KeyK') || pressed.has('KeyL'),
  };
  pressed.clear();
  return inp;
}

// ---------------------------------------------------------------- debug toggles
const PITCHES = [35, 42, 50, 58];
function onDebugKey(code) {
  if (code === 'KeyT') { STATE.toon = !STATE.toon; applyShadingMode(scene); }
  else if (code === 'KeyO') { STATE.outlines = !STATE.outlines; applyOutlines(); }
  else if (code === 'KeyP') { STATE.shadows = !STATE.shadows; sun.castShadow = STATE.shadows; scene.traverse((o) => { if (o.material) o.material.needsUpdate = true; }); }
  else if (code === 'KeyG') { STATE.grade = !STATE.grade; post.mat.uniforms.uGrade.value = STATE.grade ? 1 : 0; }
  else if (code.startsWith('Digit') && +code.slice(5) >= 1 && +code.slice(5) <= 4) CAM.pitch = PITCHES[+code.slice(5) - 1];
  else if (code === 'BracketLeft') CAM.dist = Math.max(12, CAM.dist - 2);
  else if (code === 'BracketRight') CAM.dist = Math.min(48, CAM.dist + 2);
  else if (code === 'Minus') CAM.fov = Math.max(18, CAM.fov - 3);
  else if (code === 'Equal') CAM.fov = Math.min(60, CAM.fov + 3);
  else if (code === 'KeyC') GLOBAL.uCloud.value = GLOBAL.uCloud.value > 0 ? 0 : 0.24;
  else if (code === 'KeyH') document.getElementById('help').classList.toggle('hide');
  else if (code === 'KeyR') reset();
  updateHud();
}
function applyOutlines() {
  post.mat.uniforms.uEdge.value = STATE.outlines ? 0.7 : 0;
  scene.traverse((o) => { if (o.userData.isHull) o.visible = STATE.outlines; });
}
function reset() {
  player.spawn(SPAWN.x, SPAWN.z);
  for (const d of guardian.debris) scene.remove(d.m);
  scene.remove(guardian.root);
  guardian = new Guardian(scene, level.col, fx, -3, Y.cy, -5.5);
  if (!STATE.toon) applyShadingMode(scene);
  applyOutlines();
  placeCamera(0, true);
}

// ---------------------------------------------------------------- HUD
const hud = document.getElementById('hud'), dbg = document.getElementById('dbg');
function updateHud() {
  let s = '';
  for (let i = 0; i < player.maxHp; i++) s += `<i class="${i < player.hp ? 'on' : ''}"></i>`;
  hud.innerHTML = s;
  dbg.textContent = `toon:${STATE.toon ? 'on' : 'off'}  edges:${STATE.outlines ? 'on' : 'off'}  shadows:${STATE.shadows ? 'on' : 'off'}  grade:${STATE.grade ? 'on' : 'off'}  pitch:${CAM.pitch}°  dist:${CAM.dist}  fov:${CAM.fov}°`;
}

// ---------------------------------------------------------------- loop
let lastHp = -1, rippleT = 0;
function step(dt, inp) {
  GLOBAL.uTime.value += dt;
  player.update(dt, inp);
  guardian.update(dt, player);
  if (guardian.alive && player.attacking && player.swingHit(guardian.pos.x, guardian.pos.z, 1.25) && !player.hitList.has(guardian)) {
    player.hitList.add(guardian);
    guardian.hit(player.pos.x, player.pos.z);
  }
  fx.update(dt);
  water.update(GLOBAL.uTime.value);
  // wading ripples
  rippleT -= dt;
  if (player.pos.y < Y.water && Math.hypot(player.vel.x, player.vel.z) > 1 && rippleT <= 0) { fx.ripple(new THREE.Vector3(player.pos.x, Y.water + 0.02, player.pos.z)); rippleT = 0.22; }
  const dd = Math.hypot(player.pos.x - SHRINE_DOOR.x, player.pos.z - SHRINE_DOOR.z);
  sealGlow.material.opacity = (0.08 + 0.5 * (1 - THREE.MathUtils.smoothstep(dd, 2, 12))) * (0.85 + 0.15 * Math.sin(GLOBAL.uTime.value * 2));
  if (canopy) {
    const under = Math.hypot(player.pos.x + 14.2, player.pos.z + 6.4) < 6.4 && player.pos.y < 6;
    canopyA += ((under ? 0.38 : 1) - canopyA) * Math.min(1, dt * 6);
    canopy.material.opacity = canopy.material.userData.alt.opacity = canopyA;
  }
  if (player.hp !== lastHp) { lastHp = player.hp; updateHud(); }
  placeCamera(dt);
}
const clock = new THREE.Clock();
let frames = 0, fpsT = 0, fps = 0;
function frame() {
  const dt = Math.min(0.05, clock.getDelta());
  step(dt, readInput());
  post.render(scene, camera);
  frames++; fpsT += dt; if (fpsT > 1) { fps = frames / fpsT; frames = 0; fpsT = 0; document.getElementById('perf').textContent = `${fps.toFixed(0)} fps · ${post.stats.calls} draws · ${(post.stats.tris / 1000).toFixed(0)}k tris`; }
  requestAnimationFrame(frame);
}
addEventListener('resize', () => {
  renderer.setSize(W(), H()); post.setSize(W() * pr, H() * pr);
  camera.aspect = W() / H(); camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------- test/capture API
window.__G = {
  THREE, scene, camera, renderer, player, get guardian() { return guardian; }, level, CAM, STATE, post, PAL,
  sim(inp = {}, seconds = 1) {
    const n = Math.round(seconds * 60);
    for (let i = 0; i < n; i++) step(1 / 60, { mx: 0, mz: 0, jump: false, attack: false, dash: false, ...inp, ...(i > 0 ? { jump: false, attack: false, dash: false } : {}) });
  },
  tp(x, z, y) { player.pos.set(x, y ?? level.col.ground(x, z, 50), z); player.vel.set(0, 0, 0); placeCamera(0, true); },
  toggle(code) { onDebugKey(code); },
  snapCam() { placeCamera(0, true); },
};
updateHud();
if (Q.has('nohelp')) document.getElementById('help').classList.add('hide');
// warm up shaders before the first visible frame
renderer.compile(scene, camera);
post.render(scene, camera);
window.__G.render = () => { post.render(scene, camera); return `${post.stats.calls} draws, ${(post.stats.tris / 1000).toFixed(0)}k tris`; };
window.__ready = true;
if (!Q.has('capture')) requestAnimationFrame(frame); // ?capture: frames rendered on demand by tools/


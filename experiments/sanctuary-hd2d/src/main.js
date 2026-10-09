// Ravine Sanctuary: game loop, maps, camera, light themes, HUD and debug.
import * as THREE from '../vendor/three.module.min.js';
import { makeTextures } from './textures.js';
import { buildOverworld, buildShrine, buildVista, WATER_DEPTH, T } from './level.js';
import { buildWorld, makeCollider } from './world.js';
import { worldUniforms } from './shaderPatch.js';
import { buildAtlas } from './sprites.js';
import { SpriteBatch, spriteUniforms } from './billboard.js';
import { dressMap, retint } from './decor.js';
import { LIGHT, spriteTint, setSunFromAngles, sunAngles } from './light.js';
import { Player, Pot, SunStone, Lever, Chest, Stele, Crack, Pickup, Seed, Ring, Fx, CREATURES, len2 } from './entities.js';
import { Audio } from './audio.js';

const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------ renderer
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(30, innerWidth / innerHeight, 1, 300);

const sun = new THREE.DirectionalLight('#ffe2b6', 2.7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.035;
sun.shadow.radius = 2;
const hemi = new THREE.HemisphereLight('#b8c7c8', '#4b3f30', 1.25);
const fill = new THREE.DirectionalLight('#9fb0c8', 0.4);
scene.add(sun, sun.target, hemi, fill);

const THEMES = {
  day: {
    bg: '#0e1411', sunAz: 305, sunEl: 52, sunColor: '#ffe6c0', sunI: 3.3, sky: '#a6bccb', ground: '#4b4232', hemiI: 1.1,
    fillI: 0.22, deep: '#16232a', deepAmt: 0.55, deepTop: 1.6, highY: 7.6, haze: '#26302c', hazeAmt: 0.35,
    spriteAmbient: [0.44, 0.5, 0.56], spriteSun: [0.8, 0.7, 0.52], audio: 'day', bounce: '#9a8466',
  },
  shrine: {
    bg: '#06080a', sunAz: 200, sunEl: 74, sunColor: '#a9bfd8', sunI: 1.1, sky: '#5d6e86', ground: '#2b2420', hemiI: 0.62,
    fillI: 0.12, deep: '#0c141b', deepAmt: 0.45, deepTop: 0.6, highY: 4.4, haze: '#050607', hazeAmt: 1.0,
    spriteAmbient: [0.3, 0.34, 0.44], spriteSun: [0.26, 0.29, 0.36], audio: 'shrine', bounce: '#3e4658',
  },
  // late light over the hidden vale: low warm sun from behind the tower,
  // the valley floor sinking into warm haze
  vista: {
    bg: '#a9b3a6', sunAz: 160, sunEl: 30, sunColor: '#ffd9a0', sunI: 2.7, sky: '#c8ccc0', ground: '#56493a', hemiI: 1.35,
    fillI: 0.42, deep: '#4c5c55', deepAmt: 0.42, deepTop: 0.5, highY: 30, haze: '#000000', hazeAmt: 0,
    spriteAmbient: [0.6, 0.6, 0.58], spriteSun: [0.64, 0.53, 0.38], audio: 'day', bounce: '#9a8a6c',
  },
};

// Per-area light inside a map. The sun keeps its angle (shadows never jump);
// colour, intensity, sky fill, ravine depth tint and the sprite light shift
// between areas, blended over a few tiles at each border.
const MOODS = {
  // cool shade under the canopy, warm broken sun patches
  'Forest Approach': {
    bounce: '#6f6a58', sunColor: '#ffd8a2', sunI: 3.55, sky: '#88a2b6', ground: '#3f3a2c', hemiI: 0.92, fillI: 0.16,
    deep: '#13222a', deepAmt: 0.6, spriteAmbient: [0.37, 0.44, 0.53], spriteSun: [0.88, 0.73, 0.5],
  },
  // open sun on warm limestone, the pool as the cool counterpoint
  'Ruined Courtyard': {
    bounce: '#a88f6c', sunColor: '#ffe7c2', sunI: 3.6, sky: '#b2c3cc', ground: '#64563f', hemiI: 1.18, fillI: 0.26, deepAmt: 0.42,
    spriteAmbient: [0.47, 0.51, 0.55], spriteSun: [0.84, 0.74, 0.55],
  },
  // the strongest contrast: bright architecture, cool ravine shadow
  'Overgrown Sanctuary': {
    bounce: '#8c7a62', sunColor: '#ffe3b2', sunI: 3.75, sky: '#90a9c2', ground: '#433a2d', hemiI: 0.9, fillI: 0.18,
    deep: '#0f1f2b', deepAmt: 0.7, deepTop: 1.8, spriteAmbient: [0.39, 0.46, 0.56], spriteSun: [0.88, 0.75, 0.53],
  },
  // cooler and bluer, darker ambient; the braziers carry the warmth
  'Underground Shrine': {
    bounce: '#3e4658', sunColor: '#9cb6dc', sunI: 1.0, sky: '#4c6286', hemiI: 0.55, fillI: 0.1,
    spriteAmbient: [0.26, 0.31, 0.44], spriteSun: [0.24, 0.28, 0.37],
  },
  // focused and readable: a brighter shaft over the arena, less murk
  "Warden's Chamber": {
    bounce: '#4d5468', sunColor: '#b7c8e0', sunI: 1.55, sky: '#6a7d99', hemiI: 0.78, fillI: 0.16, hazeAmt: 0.75,
    spriteAmbient: [0.35, 0.39, 0.5], spriteSun: [0.36, 0.38, 0.45],
  },
};
const MOOD_KEYS = ['bounce', 'sunColor', 'sunI', 'sky', 'ground', 'hemiI', 'fillI', 'deep', 'deepAmt', 'deepTop', 'hazeAmt', 'spriteAmbient', 'spriteSun'];
const moodCache = new Map();
const _mc = new THREE.Color();
function moodAt(z) {
  const key = Math.round(z * 2);
  const hit = moodCache.get(key);
  if (hit) return hit;
  const th = G.theme, L = G.L;
  const sat = (v) => Math.min(1, Math.max(0, v));
  const ws = [];
  for (const a of L.areas) {
    const m = MOODS[a.name];
    if (!m) continue;
    const w = sat((z - a.z0 + 3) / 6) * sat((a.z1 + 3 - z) / 6);
    if (w > 0) ws.push([m, w]);
  }
  const tot = ws.reduce((s, [, w]) => s + w, 0);
  const out = {};
  for (const k of MOOD_KEYS) {
    const base = th[k];
    if (!tot) out[k] = typeof base === 'string' ? new THREE.Color(base) : base;
    else if (typeof base === 'string') {
      let r = 0, g = 0, b = 0;
      for (const [m, w] of ws) {
        _mc.set(m[k] ?? base);
        r += _mc.r * w;
        g += _mc.g * w;
        b += _mc.b * w;
      }
      out[k] = new THREE.Color(r / tot, g / tot, b / tot);
    } else if (Array.isArray(base)) out[k] = base.map((_, i) => ws.reduce((s, [m, w]) => s + (m[k] ?? base)[i] * w, 0) / tot);
    else out[k] = ws.reduce((s, [m, w]) => s + (m[k] ?? base) * w, 0) / tot;
  }
  moodCache.set(key, out);
  return out;
}
let moodZ = null;
function applyMood(z, force) {
  if (!force && moodZ !== null && Math.abs(z - moodZ) < 0.25) return;
  moodZ = z;
  const m = moodAt(z);
  LIGHT.sunColor.copy(m.sunColor);
  sun.color.copy(m.sunColor);
  worldUniforms.uDeep.value.copy(m.deep);
  worldUniforms.uDeepAmount.value = m.deepAmt;
  worldUniforms.uDeepTop.value = m.deepTop;
  worldUniforms.uHazeAmt.value = m.hazeAmt;
  worldUniforms.uBounce.value.copy(m.bounce);
  if (!G.debug.lighting) return;
  sun.intensity = m.sunI;
  hemi.color.copy(m.sky);
  hemi.groundColor.copy(m.ground);
  hemi.intensity = m.hemiI;
  fill.intensity = m.fillI;
}

// ------------------------------------------------------------ game state
const tex = makeTextures();
const atlas = buildAtlas();
const audio = new Audio();

const G = {
  state: { hp: 5, maxHp: 5, flags: {}, secrets: 0, checkpoint: null, startTime: performance.now() },
  input: { mx: 0, mz: 0 },
  debug: { lighting: true, shadows: true, depth: true, spriteLight: true, canopy: true, reveal: true, contactShadows: true, spriteShadows: true },
  entities: [],
  projectiles: [],
  fxList: [],
  locked: false,
  shakeT: 0,
  stopT: 0,
  ending: false,
};
window.__G = G;
G.scene = scene;

G.actors = new SpriteBatch(atlas, 512, { castShadow: true });
G.fx = new SpriteBatch(atlas, 1024);
G.flat = new SpriteBatch(atlas, 64);
scene.add(G.actors.mesh, G.fx.mesh, G.flat.mesh);

G.sfx = (name, src) => {
  let vol = 1;
  if (src && G.player) {
    const d = len2(src.x - G.player.x, src.z - G.player.z);
    vol = Math.max(0, 1 - d / 14);
    if (vol <= 0.02) return;
  }
  audio.play(name, vol);
};
G.shake = (s) => (G.shakeT = Math.max(G.shakeT, s));
G.hitstop = (s) => (G.stopT = Math.max(G.stopT, s));
G.spawnFx = (kind, x, y, z) => G.fxList.push(new Fx(kind, x, y, z));
G.spawnProjectile = (x, y, z, tx, ty, tz, sp) => G.projectiles.push(new Seed(x, y, z, tx, ty, tz, sp));
G.spawnRing = (x, y, z, r, dur, owner) => G.projectiles.push(new Ring(x, y, z, r, dur, owner));
G.spawnPickup = (kind, x, z) => G.entities.push(new Pickup(kind, x, z, G));
G.spawnCreature = (type, x, z) => G.entities.push(new CREATURES[type]({ x, z }, G));
G.waterY = (x, z) => {
  const tx = Math.floor(x), tz = Math.floor(z);
  return G.L.H[tz * G.L.W + tx] + WATER_DEPTH;
};
G.sunlitAt = (x, y, z) => (G.theme === THEMES.shrine ? shrineLit(x, y, z) : G.collider.sunlit(x, y, z, LIGHT.sunDir, G.dressing.canopies));
G.tintAt = (x, y, z, lit, out) => {
  if (!G.debug.spriteLight || !G.debug.lighting) {
    out[0] = out[1] = out[2] = 1;
    return out;
  }
  return spriteTint(x, y, z, lit, out);
};
function shrineLit(x, y, z) {
  return G.collider.sunlit(x, y, z, LIGHT.sunDir, []);
}
G.lightsChanged = () => {};

// ------------------------------------------------------------ messages / HUD
let msgT = 0;
G.message = (text, dur = 4) => {
  $('msg').textContent = text;
  $('msg').classList.add('on');
  msgT = dur;
};
let bannerT = 0;
function banner(text) {
  $('banner').textContent = text;
  $('banner').classList.add('on');
  bannerT = 3;
}

const heartImgs = (() => {
  const r = atlas.rects.heart;
  const mk = (dim) => {
    const c = document.createElement('canvas');
    c.width = r.pw;
    c.height = r.ph;
    const g = c.getContext('2d');
    g.drawImage(atlas.canvas, r.u * 2048, (1 - r.v - r.h) * 2048, r.pw, r.ph, 0, 0, r.pw, r.ph);
    if (dim) {
      const d = g.getImageData(0, 0, c.width, c.height);
      for (let i = 0; i < d.data.length; i += 4) {
        const l = (d.data[i] + d.data[i + 1] + d.data[i + 2]) / 3;
        d.data[i] = l * 0.35 + 20;
        d.data[i + 1] = l * 0.35 + 22;
        d.data[i + 2] = l * 0.4 + 26;
      }
      g.putImageData(d, 0, 0);
    }
    return c.toDataURL();
  };
  return [mk(false), mk(true)];
})();
let hudKey = '';
function drawHud() {
  const s = G.state;
  const sun = ['roof', 'bridge', 'altar'].filter((k) => s.flags[`sun:${k}`]).length;
  const key = `${s.hp}/${s.maxHp}/${sun}`;
  if (key === hudKey) return;
  hudKey = key;
  let html = '';
  for (let i = 0; i < Math.min(s.maxHp, 12); i++) html += `<img class="heart" src="${heartImgs[i < s.hp ? 0 : 1]}">`;
  html += `<span class="suns">${'<i class="on"></i>'.repeat(sun)}${'<i></i>'.repeat(3 - sun)}</span>`;
  $('hud').innerHTML = html;
}

// ------------------------------------------------------------ map loading
const MAPS = { overworld: buildOverworld, shrine: buildShrine, vista: buildVista };
let mapGroup = null;
const sunLights = [];

function disposeGroup(g) {
  g.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
  });
}

function applyTheme(name) {
  const th = THEMES[name];
  G.theme = th;
  scene.background = new THREE.Color(th.bg);
  setSunFromAngles(th.sunAz, th.sunEl);
  LIGHT.sunColor.set(th.sunColor);
  sun.color.set(th.sunColor);
  sun.intensity = th.sunI;
  hemi.color.set(th.sky);
  hemi.groundColor.set(th.ground);
  hemi.intensity = th.hemiI;
  fill.intensity = th.fillI;
  worldUniforms.uDeep.value.set(th.deep);
  worldUniforms.uDeepAmount.value = th.deepAmt;
  worldUniforms.uDeepTop.value = th.deepTop;
  worldUniforms.uHighY.value = th.highY;
  worldUniforms.uHaze.value.set(th.haze);
  worldUniforms.uHazeAmt.value = th.hazeAmt;
  LIGHT.spriteAmbient = th.spriteAmbient.slice();
  LIGHT.spriteSun = th.spriteSun.slice();
  moodCache.clear();
  moodZ = null;
  LIGHT.zoneTint = (x, z) => {
    const m = moodAt(z);
    return { amb: m.spriteAmbient, sun: m.spriteSun };
  };
  audio.setMode(th.audio);
  syncDebugUi();
}

function loadMap(id, spawn) {
  if (mapGroup) {
    scene.remove(mapGroup);
    disposeGroup(mapGroup);
  }
  G.entities = [];
  G.projectiles = [];
  G.fxList = [];
  const L = MAPS[id]();
  G.L = L;
  applyTheme(L.theme);
  // composed maps bring their own framing; others restore the default rig
  CAM_BASE ??= { pitch: CAM.pitch, viewH: CAM.viewH };
  Object.assign(CAM, L.camera ? { pitch: L.camera.pitch, viewH: L.camera.viewH } : CAM_BASE);
  mapGroup = new THREE.Group();
  const world = buildWorld(L, tex);
  mapGroup.add(world.group);
  const solids = world.solids;
  const collider = makeCollider(L, solids);
  G.collider = collider;
  G.world = world;

  // gates: live solids whose height animates
  G.gates = {};
  for (const def of L.gates) {
    const open = def.open ?? false;
    const gate = { def, solid: { ...def, kind: 'gate' }, t: 0, target: 0 };
    const flagged = G.state.flags[`gate:${def.id}`];
    gate.t = gate.target = flagged !== undefined ? (flagged ? 1 : 0) : open ? 1 : 0;
    solids.push(gate.solid);
    gate.mesh = buildGateMesh(def);
    mapGroup.add(gate.mesh);
    G.gates[def.id] = gate;
    updateGate(gate, 0);
  }

  G.dressing = dressMap(L, { atlas, tex, collider, scene });
  solids.push(...G.dressing.extraSolids);
  mapGroup.add(G.dressing.group);
  G.dressing.canopyBatch.mesh.visible = G.debug.canopy;

  // entities
  for (const e of L.entities) {
    if (CREATURES[e.type]) {
      if (e.type === 'boss' && G.state.flags.bossDown) continue;
      const c = new CREATURES[e.type](e, G);
      G.entities.push(c);
      if (e.type === 'boss') G.boss = c;
    } else if (e.type === 'pot') G.entities.push(new Pot(e, G));
    else if (e.type === 'sunstone') G.entities.push(new SunStone(e, G));
    else if (e.type === 'lever') G.entities.push(new Lever(e, G));
    else if (e.type === 'chest') G.entities.push(new Chest(e, G));
    else if (e.type === 'vessel' && !G.state.flags.waterfallVessel) {
      const p = new Pickup('vessel', e.x, e.z, G);
      p.def = { secret: true };
      p.flag = 'waterfallVessel';
      G.entities.push(p);
    }
  }
  if (!L.entities.some((e) => e.type === 'boss') || G.state.flags.bossDown) G.boss = null;
  for (const p of L.props) if (p.type === 'stele') G.entities.push(new Stele(p, G));
  for (const s of solids)
    if (s.kind === 'crack') {
      const m = new THREE.Mesh(new THREE.BoxGeometry(s.x1 - s.x0, s.y1 - s.y0, s.z1 - s.z0), G.world.mats.masonry);
      m.geometry.translate((s.x0 + s.x1) / 2, (s.y0 + s.y1) / 2, (s.z0 + s.z1) / 2);
      const n = m.geometry.attributes.position.count;
      m.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 3).fill(0.8), 3));
      const uv = m.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (s.x1 - s.x0) * 0.25, uv.getY(i) * (s.y1 - s.y0) * 0.25);
      m.castShadow = m.receiveShadow = true;
      mapGroup.add(m);
      G.entities.push(new Crack(s, G, m));
    }
  // lit sun-stones glow
  for (const e of G.entities) if (e instanceof SunStone && e.lit) addStoneLight(e);

  scene.add(mapGroup);
  const sp = spawn ?? L.spawn;
  G.player = new Player(sp.x, sp.z, collider.ground(sp.x, sp.z, 50), sp.dir);
  G.state.checkpoint = G.state.checkpoint?.map === id ? G.state.checkpoint : { map: id, x: sp.x, z: sp.z, dir: sp.dir };
  G.area = null;
  applyMood(G.player.z, true);
  G.bossActive = false;
  $('bossbar').classList.remove('on');
  snapCamera();
  hudKey = '';
  retintIfNeeded();
}

function addStoneLight(stone) {
  const l = new THREE.PointLight('#ffcf73', 2.2, 4.5, 1.4);
  l.position.set(stone.x, stone.y + 1.1, stone.z + 0.3);
  mapGroup.add(l);
  LIGHT.locals.push({ x: stone.x, y: stone.y + 1, z: stone.z, r: 3.2, color: [1, 0.8, 0.4], k: 0.55 });
}

function buildGateMesh(def) {
  const grp = new THREE.Group();
  const w = def.x1 - def.x0, h = def.y1 - def.y0, d = def.z1 - def.z0;
  if (def.style === 'grate') {
    const mat = new THREE.MeshLambertMaterial({ color: '#2c2f33' });
    for (let x = def.x0 + 0.12; x < def.x1; x += 0.28) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(0.07, h, 0.07), mat);
      bar.position.set(x, h / 2, (def.z0 + def.z1) / 2);
      bar.castShadow = true;
      grp.add(bar);
    }
    for (const y of [0.3, h - 0.3]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(w, 0.09, 0.1), mat);
      rail.position.set((def.x0 + def.x1) / 2, y, (def.z0 + def.z1) / 2);
      rail.castShadow = true;
      grp.add(rail);
    }
  } else {
    // stone slab with a carved face
    const g = new THREE.BoxGeometry(w, h, Math.max(0.3, d));
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * w * 0.25, uv.getY(i) * h * 0.25);
    const n = g.attributes.position.count;
    const cols = new Float32Array(n * 3);
    const p = g.attributes.position;
    for (let i = 0; i < n; i++) cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = 0.7 + (p.getY(i) / h + 0.5) * 0.25;
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const slab = new THREE.Mesh(g, G.world.mats.masonry);
    slab.position.set((def.x0 + def.x1) / 2, h / 2, (def.z0 + def.z1) / 2);
    slab.castShadow = slab.receiveShadow = true;
    grp.add(slab);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.86, Math.min(1.2, h * 0.4)), new THREE.MeshLambertMaterial({ map: tex.relief }));
    face.position.set((def.x0 + def.x1) / 2, h * 0.6, def.z1 + 0.16);
    grp.add(face);
  }
  grp.position.y = def.y0;
  return grp;
}

function updateGate(gate, dt) {
  const before = gate.t;
  gate.t += Math.sign(gate.target - gate.t) * Math.min(Math.abs(gate.target - gate.t), dt * (gate.def.style === 'grate' ? 0.9 : 0.45));
  const d = gate.def, h = d.y1 - d.y0;
  if (d.style === 'grate') {
    gate.mesh.position.y = d.y0 + gate.t * (h - 0.2);
    gate.solid.off = gate.t > 0.75;
  } else {
    gate.mesh.position.y = d.y0 - gate.t * (h - 0.02);
    gate.solid.y1 = d.y1 - gate.t * h;
    gate.solid.off = gate.t > 0.98;
  }
  if (gate.t !== before && Math.random() < 0.3 && dt > 0) G.spawnFx('puff', d.x0 + Math.random() * (d.x1 - d.x0), d.y0 + 0.1, d.z1 + 0.2);
}

G.openGate = (id, persist = true, close = false) => {
  const g = G.gates[id];
  if (!g) return;
  g.target = close ? 0 : 1;
  if (persist) G.state.flags[`gate:${id}`] = !close;
  G.sfx('door');
  G.shake(0.2);
};

G.onSunstone = (stone) => {
  addStoneLight(stone);
  retintIfNeeded(true);
  const n = ['roof', 'bridge', 'altar'].filter((k) => G.state.flags[`sun:${k}`]).length;
  if (n < 3) G.message(`A sun-stone wakes. ${n} of 3.`);
  else {
    G.message('The third stone wakes. Somewhere above, the sealed door sinks into the earth.', 5);
    setTimeout(() => {
      G.openGate('shrineDoor');
      G.focus = { x: 16, z: 5.5, y: 6, t: 3.2 };
      G.sfx('chime');
    }, 900);
  }
};

G.onBossDefeated = (boss) => {
  G.state.flags.bossDown = true;
  G.sfx('victory');
  G.shake(0.6);
  setTimeout(() => {
    G.openGate('vistaDoor');
    G.openGate('bossDoor', false);
    G.focus = { x: 15, z: 3, y: 1, t: 2.5 };
    G.message('The Warden falls still. Light pours through the far doorway.', 5);
    G.bossActive = false;
    $('bossbar').classList.remove('on');
  }, 1800);
};

G.onDeath = () => {
  G.sfx('die');
  setTimeout(() => {
    $('fade').classList.add('on');
    setTimeout(() => {
      G.state.hp = G.state.maxHp;
      const cp = G.state.checkpoint ?? { map: G.L.id, ...G.L.spawn };
      if (G.boss && !G.state.flags.bossDown) G.state.flags['gate:bossDoor'] = true;
      loadMap(cp.map, { x: cp.x, z: cp.z, dir: cp.dir ?? 'up' });
      $('fade').classList.remove('on');
      G.message('You wake at the last resting place.');
    }, 700);
  }, 1300);
};

// sword strikes: creatures, pots, stones, levers, seeds, the crack, and bushes
G.strike = (x, y, z, r, dmg, src, hitSet, down) => {
  let hit = false;
  for (const e of [...G.entities, ...G.projectiles]) {
    if (!e.takeHit || e === src || hitSet?.has(e)) continue;
    if (e.alive === false) continue;
    let dx, dz, dy;
    if (e instanceof Crack) {
      const s = e.solid;
      dx = Math.max(s.x0 - x, 0, x - s.x1);
      dz = Math.max(s.z0 - z, 0, z - s.z1);
      dy = y > s.y0 - 0.5 && y < s.y1 ? 0 : 9;
    } else {
      dx = e.x - x;
      dz = e.z - z;
      dy = (e.y + (e.height ?? 0.8) * 0.5) - y;
    }
    const reach = r + (e.radius ?? 0.3) * 0.6;
    if (dx * dx + dz * dz < reach * reach && Math.abs(dy) < (e.height ?? 1) * 0.5 + 0.9) {
      if (e.takeHit(G, dmg, src)) {
        hit = true;
        hitSet?.add(e);
      }
    }
  }
  // cut through bushes and ferns
  const D = G.dressing;
  for (const item of D.pending) {
    const def = item[1];
    if (def.cut || !(def.rect.startsWith('bush') || def.rect.startsWith('fern'))) continue;
    if ((def.x - x) ** 2 + (def.z - z) ** 2 < (r + 0.25) ** 2 && Math.abs(def.y - (y - 0.6)) < 1) {
      def.cut = true;
      def.tint = [def.tint[0], def.tint[1], def.tint[2], 0];
      const batch = item[0];
      const i = D.pending.filter((p) => p[0] === batch).indexOf(item);
      batch.set(i, def);
      batch.commit();
      for (let k = 0; k < 5; k++) G.spawnFx('leaf', def.x + (Math.random() - 0.5) * 0.8, def.y + 0.4 + Math.random() * 0.5, def.z);
      G.sfx('pot');
      if (Math.random() < 0.15) G.spawnPickup('heart', def.x, def.z);
    }
  }
  return hit;
};

// ------------------------------------------------------------ input
const keys = new Set();
const pressed = new Set();
addEventListener('keydown', (e) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'F1'].includes(e.code)) e.preventDefault();
  if (!keys.has(e.code)) pressed.add(e.code);
  keys.add(e.code);
  startGame();
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('mousedown', startGame);
addEventListener('blur', () => keys.clear());

let padPrev = {};
function readInput() {
  const I = G.input;
  const k = (...c) => c.some((x) => keys.has(x));
  const p = (...c) => c.some((x) => pressed.has(x));
  let mx = (k('KeyD', 'ArrowRight') ? 1 : 0) - (k('KeyA', 'ArrowLeft') ? 1 : 0);
  let mz = (k('KeyS', 'ArrowDown') ? 1 : 0) - (k('KeyW', 'ArrowUp') ? 1 : 0);
  let jumpP = p('Space'), jumpH = k('Space');
  let atkP = p('KeyJ', 'KeyZ'), dashP = p('KeyK', 'KeyX', 'ShiftLeft', 'ShiftRight'), useP = p('KeyE', 'KeyC');
  const pad = navigator.getGamepads?.()[0];
  if (pad) {
    const ax = pad.axes[0] ?? 0, az = pad.axes[1] ?? 0;
    if (Math.abs(ax) > 0.25) mx = ax;
    if (Math.abs(az) > 0.25) mz = az;
    const b = (i) => pad.buttons[i]?.pressed;
    const e = (i) => b(i) && !padPrev[i];
    if (pad.buttons[14]?.pressed) mx = -1;
    if (pad.buttons[15]?.pressed) mx = 1;
    if (pad.buttons[12]?.pressed) mz = -1;
    if (pad.buttons[13]?.pressed) mz = 1;
    jumpP ||= e(0);
    jumpH ||= b(0);
    atkP ||= e(2);
    dashP ||= e(1) || e(5);
    useP ||= e(3);
    padPrev = Object.fromEntries(pad.buttons.map((x, i) => [i, x.pressed]));
    if (pad.buttons.some((x) => x.pressed)) startGame();
  }
  I.mx = mx;
  I.mz = mz;
  I.jumpPressed = jumpP;
  I.jumpHeld = jumpH;
  I.attackPressed = atkP;
  I.dashPressed = dashP;
  I.usePressed = useP;
  if (p('F1', 'Backquote')) $('debug').classList.toggle('on');
  if (p('KeyM')) audio.muted = !audio.muted;
  pressed.clear();
}

let started = params.has('notitle');
function startGame() {
  audio.start();
  if (started || !G.ready) return;
  started = true;
  $('title').classList.add('gone');
}

// ------------------------------------------------------------ camera
let CAM_BASE = null;
const CAM = { pitch: 42, viewH: 15.5, fov: 30, yaw: 0, target: new THREE.Vector3(), groundY: 0 };
if (params.has('pitch')) CAM.pitch = +params.get('pitch');
if (params.has('viewH')) CAM.viewH = +params.get('viewH');
if (params.has('fov')) CAM.fov = +params.get('fov');

function camGoal() {
  const P = G.player;
  if (G.focus) return [G.focus.x, G.focus.y, G.focus.z];
  const LC = G.L.camera;
  if (LC) {
    // composed map: look ahead into the view rather than at the hero
    const k = G.ending ? 1 : 0;
    return [P.x * 0.4 + (G.L.W / 2) * 0.6, P.y - 1 + k * 1.5, P.z - LC.ahead - k * 4];
  }
  const g = G.collider.ground(P.x, P.z, P.y + 0.1);
  CAM.groundY += (Math.min(P.y, g + 1.2) - CAM.groundY) * 0.06;
  const fl = len2(P.fx, P.fz) || 1;
  let x = P.x + (P.fx / fl) * 0.9, z = P.z + (P.fz / fl) * 0.7 + 0.4;
  const aspect = innerWidth / innerHeight;
  const halfW = (CAM.viewH * aspect) / 2;
  const L = G.L;
  x = Math.max(Math.min(halfW - 1.5, L.W / 2), Math.min(Math.max(L.W - halfW + 1.5, L.W / 2), x));
  // keep the far and near map edges out of frame: half the visible ground depth
  const halfD = CAM.viewH / 2 / Math.sin(THREE.MathUtils.degToRad(CAM.pitch));
  const zMax = L.walkMaxZ ? L.D - halfD + 0.6 : L.D - 4.5;
  z = Math.max(3.5, Math.min(Math.max(zMax, L.D / 2), z));
  return [x, CAM.groundY + 0.6, z];
}

function placeCamera() {
  const p = THREE.MathUtils.degToRad(CAM.pitch), y = THREE.MathUtils.degToRad(CAM.yaw);
  const dist = CAM.viewH / (2 * Math.tan(THREE.MathUtils.degToRad(CAM.fov) / 2));
  camera.fov = CAM.fov;
  camera.near = Math.max(0.5, dist - 40);
  camera.far = dist + 120;
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  const t = CAM.target;
  let sx = 0, sy = 0;
  if (G.shakeT > 0) {
    sx = (Math.random() - 0.5) * G.shakeT * 0.6;
    sy = (Math.random() - 0.5) * G.shakeT * 0.6;
  }
  camera.position.set(t.x + Math.sin(y) * Math.cos(p) * dist + sx, t.y + Math.sin(p) * dist + sy, t.z + Math.cos(y) * Math.cos(p) * dist);
  camera.lookAt(t.x + sx, t.y + sy, t.z);
  spriteUniforms.uRight.value.set(Math.cos(y), 0, -Math.sin(y));
  spriteUniforms.uStretch.value = 1 + (1 / Math.cos(p) - 1) * 0.85;
  // the sprite shadow cards turn to face the sun
  const sd = LIGHT.sunDir;
  spriteUniforms.uSunRight.value.set(-sd.z, 0, sd.x).normalize();
}

function snapCamera() {
  const [x, y, z] = camGoal();
  CAM.groundY = G.player.y;
  CAM.target.set(x, y, z);
  placeCamera();
}

function updateCamera(dt) {
  const [x, y, z] = camGoal();
  const k = 1 - Math.pow(0.004, dt);
  CAM.target.x += (x - CAM.target.x) * k;
  CAM.target.y += (y - CAM.target.y) * k;
  CAM.target.z += (z - CAM.target.z) * k;
  if (G.ending && G.L.camera) {
    // the closing shot slowly widens and flattens over the vale
    const e = 1 - Math.pow(0.6, dt);
    CAM.viewH += (G.L.camera.viewH * 1.35 - CAM.viewH) * e;
    CAM.pitch += (G.L.camera.pitch - 6 - CAM.pitch) * e;
  }
  placeCamera();
}

// shadows follow the view; the shadow camera is snapped to its texel grid so
// shadows do not swim as the camera moves
const _v = new THREE.Vector3();
function updateSun() {
  const ext = CAM.viewH * 1.25 + 8;
  const sc = sun.shadow.camera;
  sc.left = -ext;
  sc.right = ext;
  sc.top = ext;
  sc.bottom = -ext;
  sc.near = 1;
  sc.far = 160;
  sc.updateProjectionMatrix();
  const d = LIGHT.sunDir;
  const texel = (2 * ext) / sun.shadow.mapSize.x;
  const right = new THREE.Vector3(-d.z, 0, d.x).normalize();
  const up = new THREE.Vector3().crossVectors(right, d).normalize();
  _v.copy(CAM.target);
  const a = Math.round(_v.dot(right) / texel) * texel - _v.dot(right);
  const b = Math.round(_v.dot(up) / texel) * texel - _v.dot(up);
  _v.addScaledVector(right, a).addScaledVector(up, b);
  sun.target.position.copy(_v);
  sun.position.copy(_v).addScaledVector(d, 70);
  sun.target.updateMatrixWorld();
  fill.position.copy(_v).add(new THREE.Vector3(12, 10, 20));
  fill.target.position.copy(_v);
}

// ------------------------------------------------------------ main loop
let last = performance.now();
let pTime = 0;
const _p = new THREE.Vector3();
function frame(now) {
  requestAnimationFrame(frame);
  let dt = Math.min(1 / 30, (now - last) / 1000);
  last = now;
  pTime += dt;
  worldUniforms.uTime.value = pTime;
  readInput();
  if (!G.ready) return;
  if (started) step(dt);
  render();
}

function step(dt) {
  const P = G.player;
  if (G.stopT > 0) {
    G.stopT -= dt;
    dt *= 0.08;
  }
  G.shakeT = Math.max(0, G.shakeT - dt);
  G.locked = !!G.focus || G.ending;
  if (G.focus) {
    G.focus.t -= dt;
    if (G.focus.t <= 0) G.focus = null;
  }
  P.update(dt, G);
  for (const e of G.entities) if (e.alive !== false && e.update) e.update(dt, G);
  for (const pr of G.projectiles) pr.update(dt, G);
  for (const f of G.fxList) f.update(dt);
  G.entities = G.entities.filter((e) => e.alive !== false || e instanceof Pot);
  G.projectiles = G.projectiles.filter((p) => p.alive);
  G.fxList = G.fxList.filter((f) => f.alive);
  for (const id in G.gates) updateGate(G.gates[id], dt);

  // brazier flicker
  for (const pl of G.dressing.pointLights) {
    const f = 0.85 + Math.sin(pTime * 9 + pl.prop.x) * 0.06 + Math.random() * 0.09;
    pl.light.intensity = G.debug.lighting ? pl.base * f : 0;
    if (pl.prop.local) pl.prop.local.flicker = f;
  }

  // interaction prompt
  let best = null, bd = 1.5;
  for (const e of G.entities) {
    if (!e.interactable || !e.interactable(G)) continue;
    const d = len2(e.x - P.x, e.z - P.z);
    if (d < bd && Math.abs(e.y - P.y) < 1.4) {
      best = e;
      bd = d;
    }
  }
  $('prompt').classList.toggle('on', !!best && !P.dead);
  if (best && G.input.usePressed) best.interact(G);

  // areas, checkpoints, portals
  applyMood(P.z);
  const L = G.L;
  const area = L.areas.find((a) => P.z >= a.z0 && P.z < a.z1);
  if (area && area !== G.area) {
    G.area = area;
    banner(area.name);
  }
  for (const c of L.checkpoints) if (len2(c.x - P.x, c.z - P.z) < 2.2) G.state.checkpoint = { map: L.id, x: c.x, z: c.z, dir: 'up' };
  for (const pt of L.portals) {
    if (P.x > pt.x0 && P.x < pt.x1 && P.z > pt.z0 && P.z < pt.z1 && !G.transition) {
      if (pt.gate && G.gates[pt.gate].t < 0.95) continue;
      if (pt.to === 'end') beginEnding();
      else travel(pt.to, pt.spawn);
    }
  }
  if (L.endZ && P.z < L.endZ && !G.ending) beginEnding();

  // the Warden's chamber seals behind you
  if (G.boss && L.id === 'shrine' && !G.state.flags.bossDown && P.z < 14.6 && !G.bossActive) {
    G.bossActive = true;
    G.openGate('bossDoor', false, true);
    G.boss.wake(G);
    G.sfx('bossCue');
    banner('The Root Warden');
    $('bossbar').classList.add('on');
  }
  if (G.bossActive && G.boss) $('bossfill').style.width = `${(Math.max(0, G.boss.hp) / G.boss.maxHp) * 100}%`;

  // ambience: how close is moving water?
  let water = 0;
  if (L.waterfalls.length) for (const w of L.waterfalls) water = Math.max(water, 1 - len2((w.x0 + w.x1) / 2 - P.x, w.z - P.z) / 14);
  const tx = Math.floor(P.x), tz = Math.floor(P.z);
  for (let dz = -3; dz <= 3; dz++)
    for (let dx = -3; dx <= 3; dx++) {
      const x = tx + dx, z = tz + dz;
      if (x >= 0 && z >= 0 && x < L.W && z < L.D && L.TY[z * L.W + x] === T.WATER) water = Math.max(water, 0.55 - len2(dx, dz) * 0.08);
    }
  audio.tick(dt, Math.max(0, water), G.bossActive);

  msgT -= dt;
  if (msgT <= 0) $('msg').classList.remove('on');
  bannerT -= dt;
  if (bannerT <= 0) $('banner').classList.remove('on');
  updateCamera(dt);
  drawHud();
}

function travel(to, spawn) {
  G.transition = true;
  $('fade').classList.add('on');
  setTimeout(() => {
    loadMap(to, spawn);
    G.state.checkpoint = { map: to, x: spawn.x, z: spawn.z, dir: spawn.dir };
    $('fade').classList.remove('on');
    G.transition = false;
  }, 600);
}

function beginEnding() {
  if (G.ending) return;
  G.ending = true;
  G.sfx('victory');
  const secs = Math.round((performance.now() - G.state.startTime) / 1000);
  setTimeout(() => {
    $('endcard').innerHTML = `<h2>The way beyond lies open</h2><p>Below the sanctuary, a hidden valley and a tower older than the forest.</p>
      <p class="dim">end of prototype · ${Math.floor(secs / 60)}m ${secs % 60}s · secrets ${G.state.secrets} / 2</p>`;
    $('endcard').classList.add('on');
  }, 2600);
}

function render() {
  const P = G.player;
  G.actors.clear();
  G.fx.clear();
  G.flat.clear();
  P.draw(G);
  for (const e of G.entities) if (e.draw && (e.alive !== false || e instanceof Pot)) e.draw(G);
  for (const pr of G.projectiles) pr.draw(G);
  for (const f of G.fxList) f.draw(G);
  G.actors.commit();
  G.fx.commit();
  G.flat.commit();
  G.actors.mesh.castShadow = G.debug.spriteShadows;

  // reveal circle follows the hero on screen
  _p.set(P.x, P.y + 0.8, P.z).project(camera);
  const pr = renderer.getPixelRatio();
  worldUniforms.uRevealPos.value.set(((_p.x + 1) / 2) * innerWidth * pr, ((_p.y + 1) / 2) * innerHeight * pr);
  worldUniforms.uRevealRadius.value = (innerHeight / CAM.viewH) * 1.5 * pr;
  _p.set(P.x, P.y + 0.8, P.z).applyMatrix4(camera.matrixWorldInverse);
  worldUniforms.uPlayerDepth.value = -_p.z;
  worldUniforms.uPlayerY.value = P.y;
  worldUniforms.uRevealOn.value = G.debug.reveal ? 1 : 0;
  if (!started) updateCamera(1 / 60);
  updateSun();
  renderer.render(scene, camera);
}

// ------------------------------------------------------------ debug panel
function bindRange(id, get, set, fmt = (v) => v) {
  const el = $(id);
  el.value = get();
  $(id + 'V').textContent = fmt(get());
  el.addEventListener('input', () => {
    set(+el.value);
    $(id + 'V').textContent = fmt(+el.value);
  });
}
function bindCheck(id, key, onChange) {
  const el = $(id);
  el.checked = G.debug[key];
  el.addEventListener('change', () => {
    G.debug[key] = el.checked;
    onChange?.(el.checked);
  });
}
function retintIfNeeded() {
  if (!G.dressing) return;
  retint(G.dressing, G.collider, G.debug.spriteLight && G.debug.lighting ? 'lit' : 'flat', G.L.id === 'shrine');
}
function applyLighting() {
  const th = G.theme;
  if (G.debug.lighting) {
    sun.intensity = th.sunI;
    hemi.color.set(th.sky);
    hemi.groundColor.set(th.ground);
    hemi.intensity = th.hemiI;
    fill.intensity = th.fillI;
    if (G.player) applyMood(G.player.z, true);
  } else {
    sun.intensity = 0;
    fill.intensity = 0;
    hemi.color.set('#ffffff');
    hemi.groundColor.set('#ffffff');
    hemi.intensity = Math.PI;
  }
  retintIfNeeded();
}
function syncDebugUi() {
  const [az, el] = sunAngles();
  $('dbSunAz').value = Math.round(az);
  $('dbSunAzV').textContent = Math.round(az);
  $('dbSunEl').value = Math.round(el);
  $('dbSunElV').textContent = Math.round(el);
}
bindRange('dbPitch', () => CAM.pitch, (v) => (CAM.pitch = v), (v) => v + '°');
bindRange('dbZoom', () => CAM.viewH, (v) => (CAM.viewH = v), (v) => v.toFixed(1));
bindRange('dbFov', () => CAM.fov, (v) => (CAM.fov = v), (v) => v + '°');
bindRange('dbSunAz', () => 305, (v) => {
  const [, el] = sunAngles();
  setSunFromAngles(v, el);
  retintIfNeeded();
});
bindRange('dbSunEl', () => 52, (v) => {
  const [az] = sunAngles();
  setSunFromAngles(az, v);
  retintIfNeeded();
});
bindCheck('dbLighting', 'lighting', applyLighting);
bindCheck('dbShadows', 'shadows', (on) => (sun.castShadow = on));
bindCheck('dbDepth', 'depth', (on) => {
  worldUniforms.uDeepAmount.value = on ? G.theme.deepAmt : 0;
  worldUniforms.uHazeAmt.value = on ? G.theme.hazeAmt : 0;
});
bindCheck('dbSpriteLight', 'spriteLight', retintIfNeeded);
bindCheck('dbCanopy', 'canopy', (on) => (G.dressing.canopyBatch.mesh.visible = on));
bindCheck('dbReveal', 'reveal');
bindCheck('dbBlob', 'contactShadows');
bindCheck('dbSpriteShadows', 'spriteShadows');
for (const b of document.querySelectorAll('[data-preset]')) {
  b.addEventListener('click', () => {
    const p = [
      { pitch: 42, fov: 30, viewH: 15.5 },
      { pitch: 35, fov: 30, viewH: 15.5 },
      { pitch: 55, fov: 30, viewH: 15.5 },
      { pitch: 42, fov: 12, viewH: 15.5 },
    ][+b.dataset.preset];
    Object.assign(CAM, p);
    for (const [id, k] of [['dbPitch', 'pitch'], ['dbFov', 'fov'], ['dbZoom', 'viewH']]) {
      $(id).value = CAM[k];
      $(id + 'V').textContent = CAM[k];
    }
  });
}
$('dbShot').addEventListener('click', () => {
  const a = document.createElement('a');
  a.download = `sanctuary-${Date.now()}.png`;
  a.href = renderer.domElement.toDataURL('image/png');
  a.click();
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  placeCamera();
});

// ------------------------------------------------------------ boot
// URL hooks used for staging screenshots: ?map=shrine&x=..&z=..&flags=a,b&notitle
if (params.has('flags')) for (const f of params.get('flags').split(',')) G.state.flags[f] = true;
if (params.has('god')) G.state.maxHp = G.state.hp = 99;
const startMap = params.get('map') ?? 'overworld';
const startSpawn = params.has('x') ? { x: +params.get('x'), z: +params.get('z'), dir: params.get('dir') ?? 'up' } : null;
loadMap(startMap, startSpawn);
G.ready = true;
$('go').textContent = 'press any key';
if (started) $('title').classList.add('gone');
// deterministic stepping for automated playtests: sim({mx, mz, jump, attack, dash, use}, seconds)
function sim(inp = {}, sec = 0.5) {
  const n = Math.round(sec * 60);
  for (let i = 0; i < n; i++) {
    const I = G.input;
    I.mx = inp.mx ?? 0;
    I.mz = inp.mz ?? 0;
    I.jumpHeld = !!inp.jump;
    I.jumpPressed = !!inp.jump && i === 0;
    I.attackPressed = !!inp.attack && i === 0;
    I.dashPressed = !!inp.dash && i === 0;
    I.usePressed = !!inp.use && i === 0;
    step(1 / 60);
  }
  const P = G.player;
  return { map: G.L.id, x: +P.x.toFixed(2), y: +P.y.toFixed(2), z: +P.z.toFixed(2), hp: G.state.hp, dead: !!P.dead };
}
G.debugApi = { CAM, loadMap, sun, hemi, THEMES, applyLighting, sim };
window.__ready = true;
requestAnimationFrame(frame);

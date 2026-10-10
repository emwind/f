import * as THREE from '../vendor/three.module.min.js';
import { PAL, RAMP, addHull, GLOBAL, patchPaintShader } from './materials.js';

// Sanctuary guardian: a squat carved stone sentinel that kneels dormant on the
// ring, wakes when approached, telegraphs a two-fist slam, staggers when hit
// and crumbles when defeated. Same toon/paint language as the architecture.
function gMat(color, moss = 0.6) {
  // own (uncached) material so the hit flash can tint it
  const m = new THREE.MeshToonMaterial({ color: new THREE.Color(color), gradientMap: RAMP, vertexColors: true });
  const lam = new THREE.MeshLambertMaterial({ color: new THREE.Color(color), vertexColors: true });
  const u = {
    uNoiseAmt: { value: 0.0 }, uNoiseScale: { value: 1.1 }, uMoss: { value: 0 }, uMossColor: { value: new THREE.Color(PAL.moss) },
    uStreak: { value: 0.0 }, uDampColor: { value: new THREE.Color(0x4f5548) },
  };
  for (const mm of [m, lam]) {
    mm.userData.paint = u;
    mm.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, u, GLOBAL);
      patchPaintShader(sh);
    };
    mm.customProgramCacheKey = () => 'paint';
  }
  m.userData.alt = lam; lam.userData.alt = m;
  m.userData.mossAmt = moss;
  return m;
}

// Hand-authored stone piece: a front-view silhouette polygon extruded to depth.
// Profiles are drawn per part (asymmetric, uneven), so the guardian reads as
// carved rather than assembled from boxes. Flat normals keep the hewn planes.
function hewn(pts, depth, mat, parent, x, y, z, { mossy = 0, stain = 0, bevel = 0.025 } = {}) {
  const sh = new THREE.Shape(pts.map(([a, b]) => new THREE.Vector2(a, b)));
  const g0 = new THREE.ExtrudeGeometry(sh, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, steps: 1 });
  g0.translate(0, 0, -depth / 2);
  const g = g0.index ? g0.toNonIndexed() : g0;
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, c = new Float32Array(p.count * 3);
  const base = mat.color, moss = new THREE.Color(PAL.moss), mossD = new THREE.Color(PAL.mossDark);
  const seed = Math.random() * 1000;
  let y0 = Infinity, y1 = -Infinity;
  for (let i = 0; i < p.count; i++) { y0 = Math.min(y0, p.getY(i)); y1 = Math.max(y1, p.getY(i)); }
  for (let i = 0; i < p.count; i++) {
    const t = (p.getY(i) - y0) / Math.max(0.01, y1 - y0);
    let k = 1 - stain * (1 - t) * 0.45;                       // grime/mineral stain from below
    if (n.getZ(i) < -0.5) k *= 0.82;                           // back faces sheltered, darker
    // localized moss: only some up-facing triangles, toward the back/one side
    const tri = Math.floor(i / 3), h = Math.abs(Math.sin((tri + seed) * 12.9898) * 43758.5453) % 1;
    const up = mossy && n.getY(i) > 0.55 && h < 0.55;
    const mc = h < 0.25 ? mossD : moss;
    c.set(up ? [mc.r / base.r, mc.g / base.g, mc.b / base.b] : [k, k * 0.99, k * 0.97], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  parent.add(m); return m;
}
function fillColor(g) { g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3)); return g; }
// Crack: a thin dark strip following a polyline on the front face (z)
function crack(pts, mat, parent, z) {
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i], [bx, by] = pts[i + 1];
    const L = Math.hypot(bx - ax, by - ay);
    const g = fillColor(new THREE.BoxGeometry(L + 0.02, 0.028, 0.02));
    const m = new THREE.Mesh(g, mat); m.position.set((ax + bx) / 2, (ay + by) / 2, z); m.rotation.z = Math.atan2(by - ay, bx - ax);
    m.userData.noHull = true; parent.add(m);
  }
}

export class Guardian {
  constructor(scene, col, fx, x, y, z) {
    this.scene = scene; this.col = col; this.fx = fx;
    this.home = new THREE.Vector3(x, y, z);
    this.pos = this.home.clone(); this.facing = 0;
    this.state = 'dormant'; this.t = 0; this.hp = 5; this.stagger = 0; this.flash = 0;
    this.hitThisSwing = false;
    // Broad-shape material variation: warm hewn limestone body, cool darker
    // limbs, near-black recesses, indigo/bronze sanctuary inlay, olive moss.
    const W = gMat(0xa69c86), S = gMat(PAL.guardian), D = gMat(0x75736a), K = gMat(0x2b2f2e), I = gMat(PAL.indigo), G = gMat(PAL.gold), M = gMat(PAL.mossDark), F = gMat(PAL.leafOlive);
    this.mats = [W, S, D, I, G, M];
    const root = new THREE.Group(); this.root = root;
    const r = {};
    r.body = new THREE.Group(); root.add(r.body);
    // ---- base: low plinth-feet, more pedestal than legs
    for (const s2 of [-1, 1]) {
      const lg = new THREE.Group(); lg.position.set(s2 * 0.36, 0.62, 0); r.body.add(lg);
      hewn([[-0.26, -0.62], [0.27, -0.62], [0.24, -0.25], [0.2, 0.05], [-0.22, 0.05], [-0.28, -0.3]], 0.62, D, lg, 0, 0, 0.04, { stain: 0.25 });
      r[s2 < 0 ? 'lgL' : 'lgR'] = lg;
    }
    // ---- pelvis band: wide skirt slab with an indigo trim course
    hewn([[-0.78, 0.55], [0.74, 0.55], [0.7, 0.92], [-0.72, 0.95]], 0.82, S, r.body, 0, 0, 0, { stain: 0.35 });
    hewn([[-0.6, 0.6], [0.56, 0.6], [0.55, 0.7], [-0.6, 0.7]], 0.06, I, r.body, 0, 0, 0.42);
    // ---- torso: one tapered stele mass, asymmetric shoulders, right side broken away
    r.torso = new THREE.Group(); r.torso.position.set(0, 0.92, 0); r.body.add(r.torso);
    hewn([[-0.6, 0], [0.56, 0], [0.66, 0.38], [0.8, 0.86], [0.7, 0.98], [0.55, 0.96], [0.48, 1.1], [0.3, 1.06], [0.18, 1.22], [-0.2, 1.3], [-0.72, 1.26], [-0.9, 1.12], [-0.82, 0.86], [-0.68, 0.4]], 1.0, W, r.torso, 0, 0, 0, { stain: 0.5, mossy: 0.0 });
    // jagged break surface on the right shoulder (darker, rougher, mossy ledge)
    hewn([[0.42, 0.9], [0.82, 0.86], [0.76, 1.0], [0.6, 1.02], [0.52, 1.12], [0.4, 1.05]], 0.7, S, r.torso, 0.02, 0.0, -0.08, { mossy: 1 });
    // shrine-roof cap: two receding slabs, shifted off-axis, mossy
    hewn([[-0.86, 1.26], [0.38, 1.2], [0.44, 1.34], [-0.92, 1.4]], 1.18, D, r.torso, 0, 0, 0.0, { stain: 0.3 });
    hewn([[-0.6, 1.42], [0.12, 1.4], [0.06, 1.62], [-0.5, 1.66]], 0.8, D, r.torso, -0.08, 0, -0.06, { mossy: 1 });
    // recessed head niche: dark recess with a heavy lintel and two jambs
    hewn([[-0.42, 0.7], [0.28, 0.7], [0.28, 1.08], [-0.42, 1.08]], 0.06, K, r.torso, 0, 0, 0.49);
    hewn([[-0.56, 1.06], [0.4, 1.04], [0.42, 1.2], [-0.58, 1.22]], 0.3, S, r.torso, 0, 0, 0.42, {});      // lintel
    hewn([[-0.56, 0.66], [-0.4, 0.66], [-0.42, 1.08], [-0.56, 1.08]], 0.24, S, r.torso, 0, 0, 0.44, {});  // jambs
    hewn([[0.26, 0.66], [0.4, 0.66], [0.4, 1.06], [0.27, 1.06]], 0.24, S, r.torso, 0, 0, 0.44, {});
    r.head = new THREE.Group(); r.head.position.set(-0.07, 0.86, 0.5); r.torso.add(r.head);
    hewn([[-0.2, -0.13], [0.2, -0.13], [0.22, 0.12], [0.0, 0.18], [-0.22, 0.12]], 0.16, D, r.head, 0, 0, 0, {}); // the sunk face
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x5a4a2c });
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.045, 0.03), this.eyeMat); eye.position.set(0, 0.03, 0.09); eye.userData.noHull = true; r.head.add(eye);
    // carved seal motif on the chest: indigo field, bronze ring and bar (echoes the shrine door)
    hewn([[-0.34, 0.16], [0.24, 0.16], [0.26, 0.6], [-0.36, 0.6]], 0.05, I, r.torso, 0, 0, 0.5);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.03, 6, 18), G); ring.position.set(-0.05, 0.38, 0.54); fillColor(ring.geometry); r.torso.add(ring);
    hewn([[-0.065, 0.18], [-0.035, 0.18], [-0.035, 0.58], [-0.065, 0.58]], 0.04, G, r.torso, 0, 0, 0.53);
    // cracks: dark zigzag strips running from the broken shoulder down across the motif
    crack([[0.5, 0.95], [0.38, 0.78], [0.44, 0.6], [0.3, 0.42], [0.36, 0.2], [0.24, 0.02]], K, r.torso, 0.505);
    crack([[-0.6, 0.5], [-0.48, 0.34], [-0.55, 0.15]], K, r.torso, 0.505);
    // ---- left arm: intact, massive, with a broad mossy pauldron slab and carved disc
    {
      const sh = new THREE.Group(); sh.position.set(-0.98, 1.0, 0); r.torso.add(sh);
      hewn([[-0.42, -0.2], [0.3, -0.24], [0.36, 0.08], [0.16, 0.22], [-0.3, 0.24], [-0.48, 0.06]], 0.95, S, sh, -0.02, 0, 0, { mossy: 1 });
      const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.04, 10), G); disc.rotation.x = Math.PI / 2; disc.position.set(-0.08, -0.02, 0.49); fillColor(disc.geometry); sh.add(disc);
      hewn([[-0.2, -0.85], [0.18, -0.85], [0.2, -0.2], [-0.22, -0.2]], 0.42, D, sh, -0.04, 0, 0, { stain: 0.2 });
      const fo = new THREE.Group(); fo.position.set(-0.04, -0.85, 0); sh.add(fo);
      hewn([[-0.17, -0.42], [0.17, -0.42], [0.18, 0.02], [-0.18, 0.02]], 0.38, D, fo, 0, 0, 0, {});
      hewn([[-0.32, -0.95], [0.3, -0.95], [0.34, -0.6], [0.24, -0.4], [-0.26, -0.4], [-0.34, -0.6]], 0.58, S, fo, 0, 0, 0.03, { stain: 0.3 }); // fist
      hewn([[-0.34, -0.5], [0.34, -0.5], [0.34, -0.44], [-0.34, -0.44]], 0.62, G, fo, 0, 0, 0.03);                                  // bronze cuff
      r.shL = sh; r.foL = fo;
    }
    // ---- right arm: the broken side, thinner, shorter, no pauldron, sprouting fern
    {
      const sh = new THREE.Group(); sh.position.set(0.82, 0.84, 0); r.torso.add(sh);
      hewn([[-0.16, -0.7], [0.16, -0.7], [0.2, 0.05], [0.05, 0.14], [-0.18, 0.08]], 0.36, D, sh, 0.02, 0, 0, { mossy: 1, stain: 0.2 });
      const fo = new THREE.Group(); fo.position.set(0.02, -0.7, 0); sh.add(fo);
      hewn([[-0.14, -0.34], [0.14, -0.34], [0.15, 0.02], [-0.15, 0.02]], 0.32, D, fo, 0, 0, 0, {});
      hewn([[-0.24, -0.76], [0.26, -0.72], [0.28, -0.44], [0.12, -0.3], [-0.22, -0.32], [-0.27, -0.5]], 0.46, S, fo, 0, 0, 0.02, { stain: 0.3 });
      r.shR = sh; r.foR = fo;
      // small fern grown out of the break
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        const g = new THREE.ConeGeometry(0.035, 0.38, 3); g.translate(0, 0.19, 0); fillColor(g);
        const m = new THREE.Mesh(g, F); m.position.set(0.62, 1.04, -0.1); m.rotation.set(Math.sin(a) * 0.9, 0, Math.cos(a) * 0.9); m.userData.noHull = true;
        r.torso.add(m);
      }
    }
    // hanging moss strands off the cap's front-left lip
    for (const [x, len] of [[-0.7, 0.32], [-0.52, 0.2], [-0.3, 0.26]]) {
      const g = new THREE.BoxGeometry(0.07, len, 0.04); g.translate(0, -len / 2, 0); fillColor(g);
      const m = new THREE.Mesh(g, M); m.position.set(x, 1.3, 0.55); m.userData.noHull = true; r.torso.add(m);
    }
    root.scale.setScalar(1.15); // heavier presence at gameplay scale
    addHull(root, 1.1);
    this.r = r;
    root.position.copy(this.pos);
    scene.add(root);
    this.debris = [];
    this.pose(0, 0);
  }
  get alive() { return this.state !== 'dead' && this.state !== 'crumble'; }
  // collect animatable pose: kneel (0..1), arms raise (0..1)
  pose(kneel, raise, slam = 0) {
    const r = this.r;
    r.body.position.y = -0.45 * kneel - 0.12 * slam;
    r.torso.rotation.x = 0.35 * kneel + 0.25 * slam - 0.15 * raise;
    r.head.rotation.x = 0.3 * kneel - 0.1 * raise;
    const armX = -2.5 * raise + 1.4 * slam;
    r.shL.rotation.x = r.shR.rotation.x = armX + 0.15 * kneel;
    r.shL.rotation.z = -0.1 - 0.1 * raise; r.shR.rotation.z = 0.1 + 0.1 * raise;
    r.foL.rotation.x = r.foR.rotation.x = -0.6 * raise - 0.2;
    r.lgL.rotation.x = -1.2 * kneel; r.lgR.rotation.x = 0.6 * kneel;
  }
  hit(fromX, fromZ) {
    if (!this.alive || this.stagger > 0) return false;
    this.hp--; this.flash = 0.18; this.stagger = 0.32;
    if (this.state === 'dormant') { this.state = 'wake'; this.t = 0; }
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
    this.kb = new THREE.Vector2(dx / l * 4, dz / l * 4);
    this.fx.chips(new THREE.Vector3(this.pos.x - dx / l * 0.5, this.pos.y + 1.4, this.pos.z - dz / l * 0.5), 6);
    if (this.hp <= 0) this.crumble();
    else if (this.state === 'windup') { this.state = 'recover'; this.t = 0.3; } // a hit interrupts the slam
    return true;
  }
  crumble() {
    this.state = 'crumble'; this.t = 0;
    this.eyeMat.color.set(0x2a2a26);
    this.root.updateMatrixWorld(true);
    const parts = [];
    this.root.traverse((o) => { if (o.isMesh && !o.userData.isHull) parts.push(o); });
    for (const m of parts) {
      const wp = new THREE.Vector3(); const wq = new THREE.Quaternion(); const ws = new THREE.Vector3();
      m.matrixWorld.decompose(wp, wq, ws);
      this.scene.attach(m);
      const a = Math.random() * Math.PI * 2;
      this.debris.push({ m, v: new THREE.Vector3(Math.cos(a) * 1.6, 1.5 + Math.random() * 2, Math.sin(a) * 1.6), w: new THREE.Vector3(Math.random() * 4 - 2, Math.random() * 4 - 2, Math.random() * 4 - 2), rest: false });
    }
    this.fx.dust(this.pos, 14, 0xa39880);
  }
  update(dt, player) {
    this.t += dt;
    if (this.flash > 0) this.flash -= dt;
    const f = Math.max(0, this.flash) / 0.18;
    for (const m of this.mats) { const base = m.userData.base || (m.userData.base = m.color.clone()); m.color.copy(base).lerp(new THREE.Color(0xfff4e0), f * 0.7); m.userData.alt.color.copy(m.color); }
    if (this.state === 'crumble' || this.state === 'dead') {
      for (const d of this.debris) {
        if (d.rest) continue;
        d.v.y -= 20 * dt; d.m.position.addScaledVector(d.v, dt);
        d.m.rotation.x += d.w.x * dt; d.m.rotation.y += d.w.y * dt; d.m.rotation.z += d.w.z * dt;
        const g = this.col.ground(d.m.position.x, d.m.position.z, d.m.position.y + 0.5);
        if (d.m.position.y < g + 0.18) { d.m.position.y = g + 0.18; d.v.y *= -0.25; d.v.x *= 0.5; d.v.z *= 0.5; d.w.multiplyScalar(0.5); if (Math.abs(d.v.y) < 0.6) d.rest = true; }
      }
      return;
    }
    const P = player.pos;
    const dx = P.x - this.pos.x, dz = P.z - this.pos.z, dist = Math.hypot(dx, dz);
    const sameLevel = Math.abs(P.y - this.pos.y) < 1.5;
    const faceTo = (k) => { const tgt = Math.atan2(dx, dz); let d = tgt - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d)); this.facing += d * Math.min(1, k * dt); };
    let kneel = 0, raise = 0, slam = 0, walk = 0;
    if (this.stagger > 0) {
      this.stagger -= dt;
      if (this.kb) { this.pos.x += this.kb.x * dt; this.pos.z += this.kb.y * dt; this.kb.multiplyScalar(0.85); }
    }
    switch (this.state) {
      case 'dormant':
        kneel = 1; this.eyeMat.color.set(0x5a4a2c);
        if (dist < 6.5 && sameLevel) { this.state = 'wake'; this.t = 0; }
        break;
      case 'wake': {
        const k = Math.min(1, this.t / 1.1); kneel = 1 - k * k * (3 - 2 * k);
        this.eyeMat.color.set(0x5a4a2c).lerp(new THREE.Color(PAL.eye), k);
        faceTo(2);
        if (this.t > 1.1) { this.state = 'chase'; this.t = 0; }
        break;
      }
      case 'chase':
        faceTo(3);
        if (this.stagger <= 0 && sameLevel && dist > 1.9) {
          const sp = 1.7;
          this.pos.x += Math.sin(this.facing) * sp * dt; this.pos.z += Math.cos(this.facing) * sp * dt;
          walk = 1;
        }
        // leash: stays on the courtyard
        this.pos.x = THREE.MathUtils.clamp(this.pos.x, -13.5, 8.5); this.pos.z = THREE.MathUtils.clamp(this.pos.z, -9.2, -1.4);
        if (dist < 2.3 && sameLevel && this.t > 0.5) { this.state = 'windup'; this.t = 0; }
        if (!sameLevel && dist > 9 && this.t > 3) { this.state = 'return'; this.t = 0; }
        break;
      case 'windup': {
        const k = Math.min(1, this.t / 0.75); raise = 1 - (1 - k) * (1 - k);
        faceTo(1.2);
        this.eyeMat.color.set(PAL.eye).lerp(new THREE.Color(0xf3dfa8), k);
        if (this.t > 0.75) { this.state = 'slam'; this.t = 0; this.hitThisSwing = false; }
        break;
      }
      case 'slam': {
        const k = Math.min(1, this.t / 0.13); raise = 1 - k; slam = k;
        if (k >= 1 && !this.hitThisSwing) {
          this.hitThisSwing = true;
          const fx = this.pos.x + Math.sin(this.facing) * 1.3, fz = this.pos.z + Math.cos(this.facing) * 1.3;
          this.fx.shock(new THREE.Vector3(fx, this.pos.y, fz));
          if (Math.hypot(P.x - fx, P.z - fz) < 1.6 && Math.abs(P.y - this.pos.y) < 0.9) player.hurt(this.pos.x, this.pos.z);
        }
        if (this.t > 0.13) { this.state = 'recover'; this.t = 0; }
        break;
      }
      case 'recover':
        slam = Math.max(0, 1 - this.t / 0.9); this.eyeMat.color.set(PAL.eye);
        if (this.t > 1.0) { this.state = 'chase'; this.t = 0; }
        break;
      case 'return': {
        const hx = this.home.x - this.pos.x, hz = this.home.z - this.pos.z, hd = Math.hypot(hx, hz);
        if (hd > 0.2) { this.facing = Math.atan2(hx, hz); this.pos.x += hx / hd * 1.5 * dt; this.pos.z += hz / hd * 1.5 * dt; walk = 1; }
        else { this.state = 'dormant'; this.t = 0; }
        if (dist < 5 && sameLevel) { this.state = 'chase'; this.t = 0; }
        break;
      }
    }
    // walking sway
    const w = Math.sin(this.t * 6) * walk;
    this.pose(kneel, raise, slam);
    this.r.lgL.rotation.x += w * 0.45; this.r.lgR.rotation.x -= w * 0.45;
    this.r.body.rotation.z = w * 0.05; this.r.body.position.y += Math.abs(w) * 0.05;
    this.r.shL.rotation.x -= w * 0.2; this.r.shR.rotation.x += w * 0.2;
    if (this.stagger > 0) this.r.torso.rotation.x -= 0.3 * (this.stagger / 0.32);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
    // body blocks the player
    if (dist < 1.0 && Math.abs(P.y - this.pos.y) < 2) { const l = dist || 1; P.x = this.pos.x + dx / l * 1.0; P.z = this.pos.z + dz / l * 1.0; }
  }
}

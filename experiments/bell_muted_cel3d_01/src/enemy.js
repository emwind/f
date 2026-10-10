import * as THREE from '../vendor/three.module.min.js';
import { PAL, RAMP, addHull, GLOBAL, patchPaintShader } from './materials.js';
import { stoneBlock } from './geom.js';

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

function blk(w, h, d, mat, parent, x, y, z, chip = 0.25) {
  const g = stoneBlock(w, h, d, { jitter: 0.05, chip });
  g.computeVertexNormals();
  // moss baked into vertex colour on up-facing faces (object space, so it never swims)
  const n = g.attributes.position.count, nor = g.attributes.normal, c = new Float32Array(n * 3);
  const base = mat.color, moss = new THREE.Color(PAL.moss);
  const amt = mat.userData.mossAmt ?? 0;
  for (let i = 0; i < n; i++) {
    const up = nor.getY(i) > 0.6 && amt > 0.3;
    c.set(up ? [moss.r / base.r, moss.g / base.g, moss.b / base.b] : [1, 1, 1], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  const m = new THREE.Mesh(g, mat); m.position.set(x, y, z); m.castShadow = m.receiveShadow = true;
  parent.add(m); return m;
}

export class Guardian {
  constructor(scene, col, fx, x, y, z) {
    this.scene = scene; this.col = col; this.fx = fx;
    this.home = new THREE.Vector3(x, y, z);
    this.pos = this.home.clone(); this.facing = 0;
    this.state = 'dormant'; this.t = 0; this.hp = 5; this.stagger = 0; this.flash = 0;
    this.hitThisSwing = false;
    const S = gMat(PAL.guardian), D = gMat(PAL.guardianDark, 0.4), I = gMat(PAL.indigo, 0.1), G = gMat(PAL.bronze, 0);
    this.mats = [S, D, I, G];
    const root = new THREE.Group(); this.root = root;
    const r = {};
    r.body = new THREE.Group(); root.add(r.body);
    r.pelvis = blk(0.95, 0.45, 0.65, D, r.body, 0, 0.95, 0);
    r.torso = new THREE.Group(); r.torso.position.set(0, 1.15, 0); r.body.add(r.torso);
    blk(1.25, 0.95, 0.8, S, r.torso, 0, 0.5, 0, 0.35);
    blk(0.9, 0.4, 0.06, I, r.torso, 0, 0.52, 0.41, 0); // carved indigo chest band
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.05, 8), G); disc.rotation.x = Math.PI / 2; disc.position.set(0, 0.52, 0.45);
    disc.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(disc.geometry.attributes.position.count * 3).fill(1), 3));
    r.torso.add(disc);
    r.head = new THREE.Group(); r.head.position.set(0, 1.05, 0.05); r.torso.add(r.head);
    blk(0.55, 0.5, 0.55, S, r.head, 0, 0.2, 0, 0.3);
    blk(0.68, 0.12, 0.62, D, r.head, 0, 0.47, 0, 0.3); // brow cap
    this.eyeMat = new THREE.MeshBasicMaterial({ color: 0x5a4a2c });
    const eye = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.06, 0.04), this.eyeMat); eye.position.set(0, 0.24, 0.28); r.head.add(eye);
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(s * 0.8, 0.8, 0); r.torso.add(sh);
      blk(0.55, 0.42, 0.7, D, sh, s * 0.05, 0.05, 0, 0.4); // pauldron (mossy top)
      blk(0.36, 0.55, 0.4, S, sh, 0, -0.38, 0);
      const fo = new THREE.Group(); fo.position.set(0, -0.68, 0); sh.add(fo);
      blk(0.32, 0.45, 0.36, S, fo, 0, -0.18, 0);
      blk(0.5, 0.45, 0.5, D, fo, 0, -0.6, 0.02, 0.35); // fist
      r[s < 0 ? 'shL' : 'shR'] = sh; r[s < 0 ? 'foL' : 'foR'] = fo;
    }
    for (const s of [-1, 1]) {
      const lg = new THREE.Group(); lg.position.set(s * 0.32, 0.85, 0); r.body.add(lg);
      blk(0.36, 0.5, 0.42, S, lg, 0, -0.25, 0);
      blk(0.44, 0.38, 0.6, D, lg, 0, -0.66, 0.06);
      r[s < 0 ? 'lgL' : 'lgR'] = lg;
    }
    addHull(root, 1.25);
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

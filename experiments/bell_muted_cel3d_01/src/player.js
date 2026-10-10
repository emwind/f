import * as THREE from '../vendor/three.module.min.js';
import { PAL, paintMat, addHull } from './materials.js';
import { Y } from './level.js';

// Temporary adventurer (not final Bell). Procedural rig of simple primitives:
// restrained ~5-head proportions, readable head/body split, warm scarf as the
// single accent and secondary-motion element.
const CM = (c) => paintMat(c, { noise: 0, moss: 0 });

function part(geom, color, parent, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(geom, CM(color));
  m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true;
  // vertex colour attribute expected by the painted material
  const n = geom.attributes.position.count, arr = new Float32Array(n * 3).fill(1);
  geom.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  parent.add(m);
  return m;
}
const pivot = (parent, x, y, z) => { const g = new THREE.Group(); g.position.set(x, y, z); parent.add(g); return g; };

export function buildAdventurer() {
  const root = new THREE.Group();
  const rig = {};
  rig.hips = pivot(root, 0, 0.8, 0);
  // tunic skirt + belt
  part(new THREE.CylinderGeometry(0.2, 0.29, 0.34, 10), PAL.tunic, rig.hips, 0, -0.1, 0);
  part(new THREE.CylinderGeometry(0.205, 0.205, 0.07, 10), PAL.leather, rig.hips, 0, 0.06, 0);
  part(new THREE.BoxGeometry(0.07, 0.07, 0.03), PAL.bronze, rig.hips, 0, 0.06, 0.205).userData.noHull = true;
  rig.chest = pivot(rig.hips, 0, 0.08, 0);
  part(new THREE.CylinderGeometry(0.205, 0.18, 0.36, 10), PAL.tunic, rig.chest, 0, 0.18, 0);
  // mantle / short cape over the shoulders (cloth colour)
  part(new THREE.CylinderGeometry(0.15, 0.25, 0.16, 10), PAL.cloth, rig.chest, 0, 0.34, -0.01);
  // scarf wrap at the neck
  part(new THREE.TorusGeometry(0.105, 0.05, 6, 12), PAL.scarf, rig.chest, 0, 0.44, 0).rotation.x = Math.PI / 2;
  rig.head = pivot(rig.chest, 0, 0.6, 0);
  const head = part(new THREE.SphereGeometry(0.155, 14, 10), PAL.skin, rig.head, 0, 0, 0.0);
  head.scale.set(0.95, 1.05, 0.98);
  const hair = part(new THREE.SphereGeometry(0.168, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), PAL.hair, rig.head, 0, 0.02, -0.02);
  hair.rotation.x = -0.35;
  part(new THREE.ConeGeometry(0.07, 0.16, 5), PAL.hair, rig.head, 0, -0.02, -0.15).rotation.x = -2.4; // tail of hair
  part(new THREE.BoxGeometry(0.035, 0.05, 0.04), PAL.skin, rig.head, 0, -0.02, 0.15).userData.noHull = true; // nose
  // arms
  for (const s of [-1, 1]) {
    const sh = pivot(rig.chest, s * 0.25, 0.32, 0);
    part(new THREE.CapsuleGeometry(0.058, 0.18, 3, 8), PAL.tunicDark, sh, 0, -0.13, 0);
    const el = pivot(sh, 0, -0.27, 0);
    part(new THREE.CapsuleGeometry(0.05, 0.16, 3, 8), PAL.cloth, el, 0, -0.1, 0);
    part(new THREE.SphereGeometry(0.058, 8, 6), PAL.leather, el, 0, -0.24, 0);
    rig[s < 0 ? 'armL' : 'armR'] = sh; rig[s < 0 ? 'elL' : 'elR'] = el;
  }
  // short blade in the right hand: dull iron, bronze guard
  rig.sword = pivot(rig.elR, 0, -0.24, 0.02);
  part(new THREE.BoxGeometry(0.035, 0.12, 0.035), PAL.leather, rig.sword, 0, 0, 0);
  part(new THREE.BoxGeometry(0.16, 0.03, 0.05), PAL.bronze, rig.sword, 0, -0.07, 0);
  const blade = part(new THREE.BoxGeometry(0.06, 0.62, 0.015), PAL.blade, rig.sword, 0, -0.39, 0);
  blade.userData.noHull = true;
  rig.sword.rotation.x = Math.PI / 2 - 0.2;
  // legs
  for (const s of [-1, 1]) {
    const hp = pivot(rig.hips, s * 0.1, -0.08, 0);
    part(new THREE.CapsuleGeometry(0.075, 0.22, 3, 8), PAL.leather, hp, 0, -0.18, 0);
    const kn = pivot(hp, 0, -0.36, 0);
    part(new THREE.CapsuleGeometry(0.065, 0.2, 3, 8), PAL.tunicDark, kn, 0, -0.14, 0);
    part(new THREE.BoxGeometry(0.13, 0.11, 0.22), PAL.leather, kn, 0, -0.32, 0.03);
    rig[s < 0 ? 'legL' : 'legR'] = hp; rig[s < 0 ? 'knL' : 'knR'] = kn;
  }
  addHull(root, 1);
  return { root, rig };
}

// Scarf tails: verlet rope rendered as a tapered double-sided ribbon
class Scarf {
  constructor(scene, n = 7, seg = 0.11, width = 0.13) {
    this.n = n; this.seg = seg; this.width = width;
    this.p = []; this.o = [];
    for (let i = 0; i < n; i++) { this.p.push(new THREE.Vector3()); this.o.push(new THREE.Vector3()); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(n * 2 * 3).fill(1), 3));
    const idx = [];
    for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.geom = g;
    this.mesh = new THREE.Mesh(g, paintMat(PAL.scarf, { noise: 0, moss: 0, side: THREE.DoubleSide }));
    this.mesh.castShadow = true; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.init = false;
  }
  update(anchor, back, dt) {
    const { p, o, n, seg } = this;
    if (!this.init) { for (let i = 0; i < n; i++) { p[i].copy(anchor).addScaledVector(back, i * seg); o[i].copy(p[i]); } this.init = true; }
    p[0].copy(anchor); o[0].copy(anchor);
    const g = -5.5 * dt * dt;
    for (let i = 1; i < n; i++) {
      const v = p[i].clone().sub(o[i]).multiplyScalar(0.9);
      o[i].copy(p[i]);
      p[i].add(v); p[i].y += g;
      p[i].addScaledVector(back, 0.35 * dt); // a light breeze pushes it behind
    }
    for (let it = 0; it < 4; it++) for (let i = 1; i < n; i++) {
      const d = p[i].clone().sub(p[i - 1]); const l = d.length() || 1e-5;
      p[i].copy(p[i - 1]).addScaledVector(d, seg / l);
    }
    // keep the scarf from swinging through the body
    for (let i = 1; i < n; i++) {
      const rel = p[i].clone().sub(anchor);
      const along = rel.dot(back);
      if (along < 0.06) p[i].addScaledVector(back, 0.06 - along);
    }
    const pos = this.geom.attributes.position;
    const side = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const dir = (i < n - 1 ? p[i + 1].clone().sub(p[i]) : p[i].clone().sub(p[i - 1])).normalize();
      side.crossVectors(dir, new THREE.Vector3(0, 1, 0));
      if (side.lengthSq() < 1e-4) side.set(1, 0, 0);
      side.normalize().multiplyScalar(this.width * (1 - (i / n) * 0.55) * 0.5);
      pos.setXYZ(i * 2, p[i].x - side.x, p[i].y - side.y, p[i].z - side.z);
      pos.setXYZ(i * 2 + 1, p[i].x + side.x, p[i].y + side.y, p[i].z + side.z);
    }
    pos.needsUpdate = true;
    this.geom.computeVertexNormals();
  }
}

const RADIUS = 0.3, HEIGHT = 1.5, STEP = 0.45, GRAV = 26, JUMP = 8.6, SPEED = 5.0;

export class Player {
  constructor(scene, col, fx) {
    this.col = col; this.fx = fx;
    const { root, rig } = buildAdventurer();
    this.root = root; this.rig = rig; scene.add(root);
    this.scarf = new Scarf(scene);
    this.pos = new THREE.Vector3(); this.vel = new THREE.Vector3();
    this.facing = 0; this.grounded = false; this.coyote = 0;
    this.t = 0; this.runPhase = 0;
    this.attackT = -1; this.dashT = -1; this.dashCd = 0; this.hurtT = -1; this.invuln = 0;
    this.hp = 5; this.maxHp = 5;
    this.safe = new THREE.Vector3();
    this.hitList = new Set();
    // slash arc (pale, restrained)
    const arc = new THREE.Mesh(new THREE.RingGeometry(0.55, 1.05, 18, 1, -1.2, 2.4), new THREE.MeshBasicMaterial({ color: 0xe6dcc4, transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }));
    arc.rotation.x = -Math.PI / 2; arc.renderOrder = 5;
    this.arc = new THREE.Group(); this.arc.add(arc); this.arcMesh = arc;
    scene.add(this.arc);
  }
  spawn(x, z) {
    this.pos.set(x, this.col.ground(x, z, 50), z); this.vel.set(0, 0, 0);
    this.safe.copy(this.pos); this.hp = this.maxHp; this.facing = Math.PI;
  }
  get attacking() { return this.attackT >= 0; }
  hurt(fromX, fromZ, dmg = 1) {
    if (this.invuln > 0) return false;
    this.hp -= dmg; this.hurtT = 0; this.invuln = 1.0;
    const dx = this.pos.x - fromX, dz = this.pos.z - fromZ, l = Math.hypot(dx, dz) || 1;
    this.vel.x = dx / l * 7; this.vel.z = dz / l * 7; this.vel.y = 5; this.grounded = false;
    this.attackT = -1;
    if (this.hp <= 0) { this.spawn(-9, 14); this.invuln = 1.5; }
    return true;
  }
  update(dt, inp) {
    this.t += dt;
    const P = this.pos, V = this.vel;
    this.dashCd -= dt; this.invuln -= dt;
    // ----- input → desired velocity (camera looks north, so up = -z)
    let mx = inp.mx, mz = inp.mz; const ml = Math.hypot(mx, mz);
    if (ml > 1) { mx /= ml; mz /= ml; }
    const inWater = P.y < Y.water - 0.12;
    let sp = SPEED * (inWater ? 0.68 : 1);
    if (this.attackT >= 0) sp *= 0.25;
    const hurting = this.hurtT >= 0 && this.hurtT < 0.35;
    if (this.dashT >= 0) {
      this.dashT += dt;
      V.x = Math.sin(this.facing) * 13; V.z = Math.cos(this.facing) * 13;
      if (this.dashT > 0.17) this.dashT = -1;
    } else if (!hurting) {
      const k = this.grounded ? 14 : 5;
      V.x += (mx * sp - V.x) * Math.min(1, k * dt);
      V.z += (mz * sp - V.z) * Math.min(1, k * dt);
      if (ml > 0.1 && this.attackT < 0) {
        const target = Math.atan2(mx, mz);
        let d = target - this.facing; d = Math.atan2(Math.sin(d), Math.cos(d));
        this.facing += d * Math.min(1, 16 * dt);
      }
    }
    if (inp.dash && this.dashCd <= 0 && this.attackT < 0) { this.dashT = 0; this.dashCd = 0.55; this.fx && this.fx.dust(P, 6); }
    if (inp.attack && this.attackT < 0 && this.dashT < 0) { this.attackT = 0; this.hitList.clear(); }
    if (this.grounded) this.coyote = 0.1; else this.coyote -= dt;
    if (inp.jump && this.coyote > 0 && this.attackT < 0) { V.y = JUMP; this.grounded = false; this.coyote = 0; }

    // ----- integrate with substeps
    const N = 4, h = dt / N;
    for (let s = 0; s < N; s++) {
      V.y -= GRAV * h;
      const wasGrounded = this.grounded;
      const p = { x: P.x + V.x * h, y: P.y, z: P.z + V.z * h };
      this.col.resolve(p, RADIUS, HEIGHT, STEP);
      P.x = p.x; P.z = p.z;
      const g = this.col.ground(P.x, P.z, P.y + STEP);
      let ny = P.y + V.y * h;
      if (V.y > 0) { const c = this.col.ceiling(P.x, P.z, P.y + HEIGHT - 0.01); if (ny + HEIGHT > c) { ny = c - HEIGHT; V.y = 0; } }
      if (ny <= g) { ny = g; if (!wasGrounded && V.y < -6) this.fx && this.fx.dust(P, 4); V.y = 0; this.grounded = true; }
      else if (wasGrounded && V.y <= 0 && P.y - g < 0.55) { ny = g; V.y = 0; this.grounded = true; } // stick to stairs going down
      else this.grounded = false;
      P.y = ny;
    }
    if (this.grounded && !inWater && this.dashT < 0) this.safe.copy(P);
    if (P.y < -6) { P.copy(this.safe); V.set(0, 0, 0); this.hurt(P.x, P.z + 1); }

    if (this.attackT >= 0) { this.attackT += dt; if (this.attackT > 0.38) this.attackT = -1; }
    if (this.hurtT >= 0) { this.hurtT += dt; if (this.hurtT > 0.5) this.hurtT = -1; }
    this.animate(dt, ml);
  }
  // world-space hit test for the current swing (active frames only)
  swingHit(x, z, r) {
    if (this.attackT < 0.07 || this.attackT > 0.2) return false;
    const fx = Math.sin(this.facing), fz = Math.cos(this.facing);
    const dx = x - this.pos.x, dz = z - this.pos.z, d = Math.hypot(dx, dz);
    if (d > 1.25 + r) return false;
    return (dx * fx + dz * fz) / (d || 1) > -0.1;
  }
  animate(dt, moveAmt) {
    const R = this.rig, t = this.t;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const run = this.grounded ? Math.min(1, speed / SPEED) : 0;
    this.runPhase += dt * (4 + speed * 1.55);
    const ph = this.runPhase;
    const lerp = (o, k, v) => { o[k] += (v - o[k]) * Math.min(1, dt * 18); };
    // defaults: idle breathing
    let hipsY = 0.8 + Math.sin(t * 2.2) * 0.008, lean = 0.04, twist = 0;
    let lL = 0, lR = 0, kL = 0, kR = 0, aL = 0.08, aR = 0.1, eL = -0.2, eR = -0.35, aLz = 0.1, aRz = -0.1;
    let headX = 0;
    if (run > 0.05) {
      const s = Math.sin(ph), c = Math.cos(ph);
      lL = s * 0.85 * run; lR = -s * 0.85 * run;
      kL = (Math.max(0, -c) * 1.1 + 0.1) * run; kR = (Math.max(0, c) * 1.1 + 0.1) * run;
      aL = -s * 0.6 * run; aR = s * 0.5 * run;
      eL = -0.5 - run * 0.4; eR = -0.6 - run * 0.3;
      hipsY = 0.8 - 0.03 * run + Math.abs(Math.cos(ph)) * 0.06 * run;
      lean = 0.18 * run; twist = s * 0.12 * run;
    }
    if (!this.grounded) {
      const up = this.vel.y > 0;
      lL = up ? -0.7 : -0.3; kL = up ? 1.2 : 0.5; lR = up ? 0.3 : 0.2; kR = up ? 0.4 : 0.6;
      aL = -0.5; aR = -0.4; aLz = 0.5; aRz = -0.5; eL = -0.6; eR = -0.6; lean = 0.1;
    }
    if (this.dashT >= 0) { lean = 0.55; lL = -0.6; lR = 0.8; kL = 0.9; kR = 0.3; aL = 0.9; aR = 0.9; aLz = 0.3; aRz = -0.3; }
    let swordX = Math.PI / 2 - 0.2, swordZ = 0;
    if (this.attackT >= 0) {
      const a = this.attackT;
      // windup → horizontal sweep from right to left → recover
      const w = Math.min(1, a / 0.07), sw = THREE.MathUtils.clamp((a - 0.07) / 0.12, 0, 1), rc = THREE.MathUtils.clamp((a - 0.22) / 0.16, 0, 1);
      const e = 1 - Math.pow(1 - sw, 3);
      twist = (-0.55 * w + 1.25 * e) * (1 - rc);
      aR = (-1.5 * w) * (1 - rc * 0.8); aRz = (-1.1 * w + 2.0 * e) * (1 - rc) - 0.1;
      eR = -0.3; swordX = Math.PI / 2 + 0.25; swordZ = 0;
      lean = 0.2; lL = 0.35; lR = -0.25; kL = 0.3; kR = 0.2; hipsY = 0.76;
      aL = 0.3; aLz = 0.5;
      // slash arc: visible only through the active sweep
      const op = sw > 0 && rc < 1 ? Math.sin(Math.PI * Math.min(1, sw * 1.2)) * (1 - rc) * 0.55 : 0;
      this.arcMesh.material.opacity = op;
      this.arc.position.set(this.pos.x, this.pos.y + 0.9, this.pos.z);
      this.arc.rotation.y = this.facing - 1.0 + e * 1.4;
      this.arcMesh.rotation.z = 0;
    } else this.arcMesh.material.opacity = 0;
    if (this.hurtT >= 0 && this.hurtT < 0.4) { lean = -0.35; aL = -0.8; aR = -0.8; aLz = 0.6; aRz = -0.6; headX = -0.3; }
    R.hips.position.y += (hipsY - R.hips.position.y) * Math.min(1, dt * 20);
    lerp(R.hips.rotation, 'x', lean * 0.5);
    lerp(R.chest.rotation, 'x', lean * 0.6); lerp(R.chest.rotation, 'y', twist);
    lerp(R.head.rotation, 'x', -lean * 0.4 + headX); lerp(R.head.rotation, 'y', -twist * 0.6);
    lerp(R.legL.rotation, 'x', -lL); lerp(R.legR.rotation, 'x', -lR);
    lerp(R.knL.rotation, 'x', kL); lerp(R.knR.rotation, 'x', kR);
    lerp(R.armL.rotation, 'x', -aL); lerp(R.armR.rotation, 'x', -aR);
    lerp(R.armL.rotation, 'z', aLz); lerp(R.armR.rotation, 'z', aRz);
    lerp(R.elL.rotation, 'x', eL); lerp(R.elR.rotation, 'x', eR);
    lerp(R.sword.rotation, 'x', swordX); lerp(R.sword.rotation, 'z', swordZ);
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.facing;
    // hurt flicker
    this.root.visible = !(this.invuln > 0 && Math.floor(this.t * 20) % 2 === 0 && this.hurtT >= 0);
    // scarf anchored at the back of the neck
    this.root.updateMatrixWorld(true);
    const anchor = new THREE.Vector3(0, 0.5, -0.12).applyMatrix4(R.chest.matrixWorld);
    const back = new THREE.Vector3(-Math.sin(this.facing), 0.0, -Math.cos(this.facing));
    this.scarf.update(anchor, back, dt);
    this.scarf.mesh.visible = this.root.visible;
    void moveAmt;
  }
}

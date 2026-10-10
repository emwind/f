import * as THREE from '../vendor/three.module.min.js';
import { paintMat, PAL } from './materials.js';

// Tiny pooled effects: dust puffs, stone chips, water ripples. Restrained.
export class FX {
  constructor(scene, col) {
    this.scene = scene; this.col = col; this.items = [];
    this.puffGeo = new THREE.IcosahedronGeometry(0.16, 0);
    this.puffGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.puffGeo.attributes.position.count * 3).fill(1), 3));
    this.puffMat = new THREE.MeshBasicMaterial({ color: 0xb3a68a, transparent: true, opacity: 0.6, depthWrite: false });
    this.chipGeo = new THREE.BoxGeometry(0.16, 0.12, 0.14);
    this.chipGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(this.chipGeo.attributes.position.count * 3).fill(1), 3));
    this.chipMat = paintMat(PAL.guardian, { noise: 0, moss: 0 });
    this.ringGeo = new THREE.RingGeometry(0.3, 0.38, 16);
    this.ringMat = new THREE.MeshBasicMaterial({ color: 0xb4baa8, transparent: true, opacity: 0.5, depthWrite: false });
  }
  _add(mesh, life, vel, kind) { this.scene.add(mesh); this.items.push({ mesh, life, t: 0, vel, kind }); }
  dust(p, n = 5, color) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.puffGeo, this.puffMat.clone());
      if (color) m.material.color.set(color);
      m.position.set(p.x + (Math.random() - 0.5) * 0.5, p.y + 0.1, p.z + (Math.random() - 0.5) * 0.5);
      const a = Math.random() * Math.PI * 2;
      this._add(m, 0.5 + Math.random() * 0.3, new THREE.Vector3(Math.cos(a) * 1.2, 0.6 + Math.random() * 0.6, Math.sin(a) * 1.2), 'puff');
    }
  }
  chips(p, n = 6, color = PAL.guardian) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(this.chipGeo, this.chipMat);
      m.castShadow = true;
      m.position.set(p.x, p.y, p.z); m.scale.setScalar(0.5 + Math.random() * 0.8);
      m.rotation.set(Math.random() * 3, Math.random() * 3, 0);
      const a = Math.random() * Math.PI * 2;
      this._add(m, 0.9, new THREE.Vector3(Math.cos(a) * 3, 3 + Math.random() * 2.5, Math.sin(a) * 3), 'chip');
    }
    void color;
  }
  ripple(p) {
    const m = new THREE.Mesh(this.ringGeo, this.ringMat.clone());
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, p.y, p.z); m.renderOrder = 4;
    this._add(m, 0.9, null, 'ring');
  }
  shock(p) {
    const m = new THREE.Mesh(new THREE.RingGeometry(0.85, 1.0, 28), new THREE.MeshBasicMaterial({ color: 0xc9bc9c, transparent: true, opacity: 0.6, depthWrite: false, side: THREE.DoubleSide }));
    m.rotation.x = -Math.PI / 2; m.position.set(p.x, p.y + 0.06, p.z); m.renderOrder = 4;
    this._add(m, 0.45, null, 'shock');
    this.dust(p, 10, 0xa89a7c);
  }
  update(dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i]; it.t += dt;
      const k = it.t / it.life, m = it.mesh;
      if (it.kind === 'puff') { m.position.addScaledVector(it.vel, dt); it.vel.multiplyScalar(0.92); m.scale.setScalar(1 + k * 2.2); m.material.opacity = 0.5 * (1 - k); }
      else if (it.kind === 'chip') {
        it.vel.y -= 18 * dt; m.position.addScaledVector(it.vel, dt);
        const g = this.col.ground(m.position.x, m.position.z, m.position.y + 0.3);
        if (m.position.y < g + 0.05) { m.position.y = g + 0.05; it.vel.y *= -0.3; it.vel.x *= 0.6; it.vel.z *= 0.6; }
        m.rotation.x += dt * 8; m.scale.multiplyScalar(k > 0.7 ? 0.9 : 1);
      } else if (it.kind === 'ring') { m.scale.setScalar(1 + k * 3); m.material.opacity = 0.5 * (1 - k); }
      else if (it.kind === 'shock') { m.scale.setScalar(0.6 + k * 2.8); m.material.opacity = 0.6 * (1 - k); }
      if (it.t >= it.life) { this.scene.remove(m); if (m.material !== this.chipMat) m.material.dispose(); this.items.splice(i, 1); }
    }
  }
}

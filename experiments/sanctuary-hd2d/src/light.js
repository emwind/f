// One description of the light, shared by the 3D renderer and the sprite tints.
// Sprites are not lit per pixel; instead each card gets a tint from the same sun
// (with a real occlusion test against terrain, solids and canopies), the same
// sky fill and the same warm local fires. That shared model is what lets a
// painted card sit inside a lit 3D space without looking pasted on.
import * as THREE from '../vendor/three.module.min.js';

export const LIGHT = {
  sunDir: new THREE.Vector3(-0.62, 1.05, -0.42).normalize(), // pointing towards the sun
  sunColor: new THREE.Color('#ffe2b6'),
  sunIntensity: 2.7,
  skyColor: new THREE.Color('#b8c7c8'),
  groundColor: new THREE.Color('#4b3f30'),
  hemiIntensity: 1.25,
  fillColor: new THREE.Color('#9fb0c8'),
  fillIntensity: 0.4,
  // sprite tint model (linear multipliers on the painted colour)
  spriteAmbient: [0.52, 0.56, 0.6],
  spriteSun: [0.62, 0.55, 0.42],
  locals: [], // {x,y,z,r,color:[r,g,b],k}
};

export function setSunFromAngles(azDeg, elDeg) {
  const az = THREE.MathUtils.degToRad(azDeg), el = THREE.MathUtils.degToRad(elDeg);
  LIGHT.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), -Math.cos(el) * Math.cos(az)).normalize();
}

export function sunAngles() {
  const d = LIGHT.sunDir;
  const el = Math.asin(d.y);
  const az = Math.atan2(d.x, -d.z);
  return [((THREE.MathUtils.radToDeg(az) % 360) + 360) % 360, THREE.MathUtils.radToDeg(el)];
}

// sunlit: 0..1 from the collider's occlusion test
export function spriteTint(x, y, z, sunlit, out = [0, 0, 0, 1]) {
  const a = LIGHT.spriteAmbient, s = LIGHT.spriteSun;
  // sheltered low ground gets less sky
  const sky = 0.8 + Math.min(1, Math.max(0, (y + 0.5) / 4)) * 0.2;
  out[0] = a[0] * sky + s[0] * sunlit;
  out[1] = a[1] * sky + s[1] * sunlit;
  out[2] = a[2] * sky + s[2] * sunlit;
  for (const l of LIGHT.locals) {
    const dx = x - l.x, dy = (y - l.y) * 1.5, dz = z - l.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d < l.r) {
      const f = (1 - d / l.r) ** 2 * l.k * (l.flicker ?? 1);
      out[0] += l.color[0] * f;
      out[1] += l.color[1] * f;
      out[2] += l.color[2] * f;
    }
  }
  return out;
}

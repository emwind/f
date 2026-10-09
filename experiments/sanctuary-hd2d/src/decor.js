// Dresses a map: trees (3D trunks and roots carrying painted canopies), plants
// placed by rules about where things plausibly grow, built props, the
// waterfall, local fire light and, in the shrine, the painted vista beyond.
import * as THREE from '../vendor/three.module.min.js';
import { T, WATER_DEPTH, terrainHeight, floorField } from './level.js';
import { mulberry32, fbm2, value2, smoothstep } from './noise.js';
import { patchWorldMaterial, worldUniforms } from './shaderPatch.js';
import { SpriteBatch } from './billboard.js';
import { LIGHT, spriteTint } from './light.js';
import { R, rgbStr, bayer } from './palette.js';

const TEX_SCALE = 0.25;
const lambert = (map) => patchWorldMaterial(new THREE.MeshLambertMaterial({ map, vertexColors: true }));

function shadeColors(g, fn) {
  const p = g.attributes.position;
  const c = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const v = fn(p.getX(i), p.getY(i), p.getZ(i), i);
    c[i * 3] = c[i * 3 + 1] = c[i * 3 + 2] = v;
  }
  g.setAttribute('color', new THREE.BufferAttribute(c, 3));
  return g;
}

export function dressMap(L, ctx) {
  const { atlas, tex, collider, scene } = ctx;
  const group = new THREE.Group();
  const extraSolids = [];
  const pointLights = [];
  LIGHT.locals.length = 0;
  const rnd = mulberry32(L.id === 'shrine' ? 991 : 17);
  const H = (x, z) => terrainHeight(L, x, z);
  const mats = {
    bark: lambert(tex.bark),
    masonry: lambert(tex.masonry),
    flag: lambert(tex.flag),
    relief: lambert(tex.relief),
  };

  const canopyBatch = new SpriteBatch(atlas, 1400, { castShadow: true });
  const plantBatch = new SpriteBatch(atlas, 2600, { castShadow: true });
  const flatBatch = new SpriteBatch(atlas, 9000);
  const canopies = []; // for sprite sun occlusion
  const pending = []; // [batch, spriteDef, lightPoint, factor] — tinted once canopies are known
  const occupied = []; // keep plants off props, creatures, spawns
  const isFree = (x, z, r = 0.8) => occupied.every(([ox, oz, or]) => (ox - x) ** 2 + (oz - z) ** 2 > (r + or) ** 2);
  for (const e of L.entities) occupied.push([e.x, e.z, 0.9]);
  for (const p of L.props) if (p.x !== undefined) occupied.push([p.x, p.z, 0.8]);
  for (const c of L.checkpoints) occupied.push([c.x, c.z, 1.2]);
  occupied.push([L.spawn.x, L.spawn.z, 1.6]);

  const queue = (batch, def, k = 1, lightY = 0.6) => pending.push([batch, def, k, lightY]);

  // ------------------------------------------------------- tree species
  // Forest trees come in three families (see sprites.js): a mature broadleaf
  // with wide flat-bottomed tiers, a tall weeping ravine tree, and young
  // growth with an open twig crown. The crown is a painted piece whose
  // painted bole meets the 3D trunk; collision stays the classic trunk box.
  const paleBark = patchWorldMaterial(new THREE.MeshLambertMaterial({ map: tex.bark, vertexColors: true, color: new THREE.Color(1.55, 1.5, 1.4) }));
  const stem = (x, y, z, h, r0, r1, bendX, bendZ, mat = mats.bark) => {
    const g = new THREE.CylinderGeometry(r1, r0, h, 7, 4, true);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position, uv = g.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const k = Math.max(0, p.getY(i) / h);
      p.setX(i, p.getX(i) + bendX * k * k);
      p.setZ(i, p.getZ(i) + bendZ * k * k);
      uv.setXY(i, uv.getX(i) * r0 * 6.3 * TEX_SCALE * 1.6, p.getY(i) * TEX_SCALE * 0.9);
    }
    g.computeVertexNormals();
    shadeColors(g, (px, py) => 0.55 + 0.45 * smoothstep(-0.3, 1.4, py));
    const m = new THREE.Mesh(g, mat);
    m.position.set(x, y, z);
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  };
  const flare = (t, gy, size, n, r0) => {
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2 + rnd() * 0.6;
      const len = (0.4 + rnd() * 0.5) * size;
      const pts = [];
      for (let s = 0; s <= 5; s++) {
        const f = s / 5;
        const px = t.x + Math.cos(a) * (r0 * 0.7 + len * f), pz = t.z + Math.sin(a) * (r0 * 0.7 + len * f);
        pts.push(new THREE.Vector3(px, Math.max(Math.min(gy, H(px, pz)) - 0.06, gy + 0.32 * Math.pow(1 - f, 1.6) * size - f * 0.12), pz));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const rg = new THREE.TubeGeometry(curve, 10, 0.12 * size + 0.04, 6, false);
      const rp = rg.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const seg = Math.floor(i / 7) / 10;
        const c = curve.getPoint(Math.min(1, seg));
        const tp = Math.pow(1 - seg, 1.3) * 0.85 + 0.15;
        rp.setXYZ(i, c.x + (rp.getX(i) - c.x) * tp, c.y + (rp.getY(i) - c.y) * tp, c.z + (rp.getZ(i) - c.z) * tp);
      }
      rg.computeVertexNormals();
      shadeColors(rg, (x, y) => 0.62 + 0.3 * smoothstep(-0.1, 0.4, y));
      const m = new THREE.Mesh(rg, mats.bark);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
    }
  };
  const crownCard = (t, v, x, yBase, z, w, k, rf = 0.42) => {
    const r = atlas.rects[v];
    const h = (w * r.ph) / r.pw;
    const own = { x, y: yBase + h * 0.62, z, r: w * rf };
    canopies.push(own);
    queue(canopyBatch, { rect: v, x, y: yBase, z, w, h, sway: 0.035, reveal: true, cast: true, flip: rnd() < 0.5, own }, k * (t.frame ? 0.78 : 1), h * 0.6);
    return h;
  };
  function speciesTree(t, size, gy) {
    const rBot = 0.3 * size + 0.1;
    extraSolids.push({ x0: t.x - rBot * 0.8, z0: t.z - rBot * 0.8, x1: t.x + rBot * 0.8, z1: t.z + rBot * 0.8, y0: gy - 1, y1: gy + 2.6 * size + 4, kind: 'trunk' });
    occupied.push([t.x, t.z, rBot + 0.4]);
    const cr = 1.9 * size * (t.crown ?? 1);
    const pick = (name, n) => `${name}.${Math.floor(rnd() * n)}`;
    if (t.species === 'broadleaf') {
      // a short heavy bole; the painted limbs fan out from its top
      const boleH = 2.0 * size;
      stem(t.x, gy - 0.3, t.z, boleH + 0.5, rBot * 1.05, 0.2 * size, 0, 0);
      flare(t, gy, size, 5, rBot);
      crownCard(t, pick('oak', 4), t.x, gy + boleH - 0.25, t.z + 0.05, cr * 2.35, 0.86);
      if (size >= 1.2) {
        // a lower side tier on its own limb, pushed out to the heavy side
        const side = t.heavy ?? (rnd() < 0.5 ? -1 : 1);
        const ex = t.x + side * cr * 0.95, ez = t.z + (rnd() - 0.3) * 0.6, ey = gy + boleH * 0.78;
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(t.x, gy + boleH * 0.55, t.z), new THREE.Vector3((t.x + ex) / 2, ey + 0.1, (t.z + ez) / 2), new THREE.Vector3(ex, ey + 0.25, ez)]);
        const bg = new THREE.TubeGeometry(curve, 8, 0.11 * size, 5, false);
        shadeColors(bg, () => 0.6);
        const limb = new THREE.Mesh(bg, mats.bark);
        limb.castShadow = limb.receiveShadow = true;
        group.add(limb);
        crownCard(t, pick('oak', 4), ex, ey - 0.1, ez + 0.08, cr * 1.3, 0.8);
      }
      if (!t.rim) queue(flatBatch, { rect: `roots.${Math.floor(rnd() * 2)}`, mode: 1, x: t.x, y: gy + 0.02, z: t.z, w: 2.4 * size, h: 1.6 * size, angle: rnd() * 6.28 }, 0.9, 0.1);
    } else if (t.species === 'ravine') {
      // tall and slender, leaning out over the low ground; the painted stem
      // carries the crown, the 3D trunk only its foot
      const footH = 1.3 * size;
      const lean = t.lean ?? (rnd() < 0.5 ? -0.25 : 0.25);
      stem(t.x, gy - 0.3, t.z, footH + 0.5, rBot * 0.8, 0.14 * size, lean, 0);
      flare(t, gy, size * 0.8, 3, rBot * 0.8);
      crownCard(t, pick('alder', 3), t.x + lean, gy + footH - 0.15, t.z + 0.04, cr * 1.5, 0.88, 0.34);
    } else {
      // young growth: two thin pale stems, an open crown of twigs
      const stemH = 0.9 * size;
      stem(t.x - 0.06, gy - 0.2, t.z, stemH + 0.35, 0.09 * size + 0.03, 0.06 * size, -0.05, 0, paleBark);
      stem(t.x + 0.1, gy - 0.2, t.z + 0.05, stemH * 0.8 + 0.3, 0.06 * size + 0.02, 0.04 * size, 0.15, 0, paleBark);
      crownCard(t, pick('young', 3), t.x, gy + stemH - 0.1, t.z + 0.04, cr * 1.5, 0.96, 0.3);
    }
  }

  // ------------------------------------------------------------- trees
  for (const t of L.trees) {
    const size = t.size === 'giant' ? 1.7 : t.size === 'big' ? 1.25 : t.size === 'small' ? 0.75 : 1;
    const gy = H(t.x, t.z);
    if (t.species) {
      speciesTree(t, size, gy);
      continue;
    }
    const trunkH = 2.6 * size + (t.rim ? 0.5 : 0);
    const rBot = 0.3 * size + 0.1, rTop = 0.17 * size;
    const tg = new THREE.CylinderGeometry(rTop, rBot, trunkH + 0.6, 9, 5, true);
    tg.translate(0, trunkH / 2 - 0.3, 0);
    const p = tg.attributes.position, uv = tg.attributes.uv;
    const lean = (rnd() - 0.5) * 0.5;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i);
      const k = Math.max(0, y / trunkH);
      p.setX(i, p.getX(i) + lean * k * k + Math.sin(y * 1.7 + t.x) * 0.06 * size);
      p.setZ(i, p.getZ(i) + Math.cos(y * 1.3 + t.z) * 0.05 * size);
      uv.setXY(i, uv.getX(i) * rBot * 6.3 * TEX_SCALE * 1.6, y * TEX_SCALE * 0.9);
    }
    tg.computeVertexNormals();
    shadeColors(tg, (x, y) => 0.55 + 0.45 * smoothstep(-0.3, 1.6, y));
    const trunk = new THREE.Mesh(tg, mats.bark);
    trunk.position.set(t.x, gy, t.z);
    trunk.castShadow = trunk.receiveShadow = true;
    group.add(trunk);
    extraSolids.push({ x0: t.x - rBot * 0.8, z0: t.z - rBot * 0.8, x1: t.x + rBot * 0.8, z1: t.z + rBot * 0.8, y0: gy - 1, y1: gy + trunkH + 4, kind: 'trunk' });
    occupied.push([t.x, t.z, rBot + 0.4]);

    // buttress roots spreading over the ground (and over ledges, where they find them)
    const nRoots = t.size === 'giant' ? 7 : 4 + Math.floor(rnd() * 2);
    for (let k = 0; k < nRoots; k++) {
      const a = (k / nRoots) * Math.PI * 2 + rnd() * 0.6;
      const len = (0.55 + rnd() * 0.6) * size;
      const pts = [];
      for (let s = 0; s <= 6; s++) {
        const f = s / 6;
        const px = t.x + Math.cos(a) * (rBot * 0.7 + len * f);
        const pz = t.z + Math.sin(a) * (rBot * 0.7 + len * f);
        const ground = Math.min(gy, H(px, pz));
        // flare out of the trunk and dive into the soil rather than arch over it
        pts.push(new THREE.Vector3(px, Math.max(ground - 0.06, gy + 0.4 * Math.pow(1 - f, 1.6) * size - f * 0.12), pz));
      }
      const curve = new THREE.CatmullRomCurve3(pts);
      const rg = new THREE.TubeGeometry(curve, 14, 0.15 * size + 0.05, 6, false);
      // taper
      const rp = rg.attributes.position;
      for (let i = 0; i < rp.count; i++) {
        const seg = Math.floor(i / 7) / 14;
        const c = curve.getPoint(Math.min(1, seg));
        const taper = Math.pow(1 - seg, 1.3) * 0.85 + 0.15;
        rp.setXYZ(i, c.x + (rp.getX(i) - c.x) * taper, c.y + (rp.getY(i) - c.y) * taper, c.z + (rp.getZ(i) - c.z) * taper);
      }
      rg.computeVertexNormals();
      shadeColors(rg, (x, y) => 0.62 + 0.3 * smoothstep(-0.1, 0.4, y));
      const root = new THREE.Mesh(rg, mats.bark);
      root.castShadow = root.receiveShadow = true;
      group.add(root);
    }

    // the roots carry on over the ground as a painted mass, so the trunk
    // grows out of the soil instead of standing on it
    if (!t.rim) queue(flatBatch, { rect: `roots.${Math.floor(rnd() * 2)}`, mode: 1, x: t.x, y: gy + 0.02, z: t.z, w: 2.2 * size, h: 1.5 * size, angle: rnd() * 6.28 }, 0.9, 0.1);

    // painted canopy: a few distinct masses carried on visible limbs, at
    // different heights and reaches, so crowns break into a silhouette with
    // gaps instead of one round dome. Each mass is a tight knot of clumps,
    // big in the middle and small at the rim, lit from the sun side and
    // darker underneath and behind.
    const cr = 1.9 * size;
    const topY = gy + trunkH * (0.85 + rnd() * 0.3);
    const cy = topY + cr * 0.25;
    const own = { x: t.x + lean, y: cy, z: t.z, r: cr * 1.25 };
    canopies.push(own);
    const variants = t.rim ? ['canopyCool.0', 'canopyCool.1', 'canopy.3', 'canopy.4'] : ['canopy.0', 'canopy.1', 'canopy.2', 'canopy.3', 'canopy.4', 'canopy.5'];
    const nMass = t.size === 'small' ? 2 : t.size === 'giant' ? 5 : 3 + (rnd() < 0.4 ? 1 : 0);
    const a0 = rnd() * Math.PI * 2;
    const masses = [];
    for (let m = 0; m < nMass; m++) {
      const crown = m === 0; // one mass rides high over the trunk
      const a = a0 + (m / nMass) * Math.PI * 2 + (rnd() - 0.5) * 0.9;
      const reach = crown ? cr * 0.15 : cr * (0.5 + rnd() * 0.35);
      const mr = cr * (crown ? 0.55 + rnd() * 0.12 : 0.38 + rnd() * 0.2);
      const mx = Math.cos(a) * reach, mz = Math.sin(a) * reach * 0.7;
      const my = crown ? cr * (0.35 + rnd() * 0.2) : cr * (-0.25 + rnd() * 0.45);
      masses.push({ mx, my, mz, mr });
      // the limb that carries it
      if (!crown || nMass < 3) {
        const sx = t.x + lean * 0.8, sz = t.z, sy = topY - (0.5 + rnd() * 0.6) * size;
        const ex = t.x + lean + mx * 0.85, ez = t.z + mz * 0.85, ey = cy + my - mr * 0.45;
        const curve = new THREE.CatmullRomCurve3([
          new THREE.Vector3(sx, sy, sz),
          new THREE.Vector3((sx * 0.55 + ex * 0.45), (sy * 0.3 + ey * 0.7) + 0.15 * size, (sz * 0.55 + ez * 0.45)),
          new THREE.Vector3(ex, ey, ez),
        ]);
        const bg = new THREE.TubeGeometry(curve, 8, rTop * 0.75, 5, false);
        const bp = bg.attributes.position;
        for (let i = 0; i < bp.count; i++) {
          const seg = Math.floor(i / 6) / 8;
          const c = curve.getPoint(Math.min(1, seg));
          const taper = 1 - seg * 0.6;
          bp.setXYZ(i, c.x + (bp.getX(i) - c.x) * taper, c.y + (bp.getY(i) - c.y) * taper, c.z + (bp.getZ(i) - c.z) * taper);
        }
        bg.computeVertexNormals();
        shadeColors(bg, () => 0.62);
        const limb = new THREE.Mesh(bg, mats.bark);
        limb.castShadow = limb.receiveShadow = true;
        group.add(limb);
      }
    }
    const clumps = [];
    for (const M of masses) {
      const n = Math.max(2, Math.round(2 + (M.mr / cr) * 6 * Math.sqrt(size)));
      for (let i = 0; i < n; i++) {
        const a = rnd() * Math.PI * 2, d = i === 0 ? 0 : Math.sqrt(rnd());
        const dx = M.mx + Math.cos(a) * d * M.mr, dz = M.mz + Math.sin(a) * d * M.mr * 0.7;
        const dy = M.my + (rnd() - 0.4) * M.mr * 0.6 + (1 - d) * M.mr * 0.25;
        const w = (1.35 + (1 - d) * 1.1 + rnd() * 0.35) * (M.mr / cr) * 2.2 * size * 0.85;
        clumps.push({ dx, dy, dz, w, d });
      }
    }
    clumps.sort((p1, p2) => p1.dz - p2.dz || p1.dy - p2.dy);
    for (const { dx, dy, dz, w, d } of clumps) {
      const v = variants[Math.floor(rnd() * variants.length)];
      const r = atlas.rects[v];
      const h = (w * r.ph) / r.pw;
      // brighter towards the sun side and the top; underside and back fall off
      const k = 0.74 + (dy / cr) * 0.26 + (-dx / cr) * 0.12 + (dz / cr) * 0.08 - d * 0.05 - (t.rim ? 0.22 : 0);
      queue(canopyBatch, { rect: v, x: t.x + lean + dx, y: cy + dy - h * 0.55, z: t.z + dz, w, h, sway: 0.05, reveal: true, cast: true, flip: rnd() < 0.5, own }, k, h * 0.6);
    }
  }

  // ------------------------------------------------------------- props
  const columnGeo = (h, broken, seed, carved) => {
    const r = mulberry32(seed);
    const g = new THREE.CylinderGeometry(0.33, 0.37, h, 12, Math.max(2, Math.round(h * 2)), false);
    g.translate(0, h / 2, 0);
    const p = g.attributes.position, uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const ang = Math.atan2(z, x);
      // drum joints pinch slightly, the top of a broken shaft is jagged
      const drum = Math.abs(((y / 0.62) % 1) - 0.5) > 0.46 ? 0.94 : 1;
      let yy = y;
      if (broken && y > h - 0.01 && n.getY(i) > -0.5) yy = h - r() * 0.35;
      const flute = carved ? 1 + 0.035 * Math.cos(ang * 12) : 1;
      p.setXYZ(i, x * drum * flute, yy, z * drum * flute);
      if (Math.abs(n.getY(i)) < 0.5) uv.setXY(i, (ang / (Math.PI * 2)) * 2.2 * TEX_SCALE * 4, y * TEX_SCALE * 1.3);
      else uv.setXY(i, x * TEX_SCALE, z * TEX_SCALE);
    }
    g.computeVertexNormals();
    return shadeColors(g, (x, y) => 0.6 + 0.4 * smoothstep(0, 1.8, y));
  };

  for (const pr of L.props) {
    if (pr.type === 'column') {
      const gy = H(pr.x, pr.z);
      const full = pr.h > 2.4;
      const grp = new THREE.Group();
      const base = new THREE.Mesh(shadeColors(new THREE.BoxGeometry(0.95, 0.28, 0.95), () => 0.7), mats.flag);
      base.position.y = 0.14;
      grp.add(base);
      const shaft = new THREE.Mesh(columnGeo(pr.h, !full, Math.floor(pr.x * 31 + pr.z), pr.carved), mats.masonry);
      shaft.position.y = 0.2;
      grp.add(shaft);
      let top = pr.h + 0.2;
      if (full) {
        const cap = new THREE.Mesh(shadeColors(new THREE.BoxGeometry(1.0, 0.32, 1.0), (x, y) => (y > 0 ? 1 : 0.7)), mats.flag);
        cap.position.y = pr.h + 0.2 + 0.16;
        cap.rotation.y = (rnd() - 0.5) * 0.12;
        grp.add(cap);
        top += 0.32;
        // a hanging vine off some capitals
        if (rnd() < 0.6 && L.id !== 'shrine') queue(flatBatch, { rect: `vine.${Math.floor(rnd() * 4)}`, mode: 2, x: pr.x - 0.2, y: gy + top - 0.05, z: pr.z + 0.52, angle: 0, w: 0.55, h: 1.4 + rnd(), sway: 0.03 }, 0.9, -0.6);
      } else if (rnd() < 0.7) {
        queue(plantBatch, { rect: `grass.${Math.floor(rnd() * 6)}`, x: pr.x, y: gy + top - 0.08, z: pr.z, w: 0.7, sway: 0.03 }, 1);
      }
      grp.position.set(pr.x, gy, pr.z);
      grp.traverse((m) => {
        if (m.isMesh) m.castShadow = m.receiveShadow = true;
      });
      group.add(grp);
      extraSolids.push({ x0: pr.x - 0.45, z0: pr.z - 0.45, x1: pr.x + 0.45, z1: pr.z + 0.45, y0: gy - 0.5, y1: gy + top, kind: 'column' });
    } else if (pr.type === 'drum') {
      const gy = H(pr.x, pr.z);
      const g = columnGeo(1.6, false, 5, false);
      g.translate(0, -0.8, 0);
      const m = new THREE.Mesh(g, mats.masonry);
      m.rotation.z = Math.PI / 2;
      m.rotation.y = pr.rot ?? 0.3;
      m.position.set(pr.x, gy + 0.3, pr.z);
      m.castShadow = m.receiveShadow = true;
      group.add(m);
      extraSolids.push({ x0: pr.x - 0.7, z0: pr.z - 0.4, x1: pr.x + 0.7, z1: pr.z + 0.4, y0: gy - 0.5, y1: gy + 0.65, kind: 'drum' });
      queue(flatBatch, { rect: 'grass.1', x: pr.x + 0.5, y: gy, z: pr.z + 0.35, w: 0.8 }, 1);
    } else if (pr.type === 'relief') {
      const w = pr.x1 - pr.x0;
      const g = new THREE.PlaneGeometry(w, pr.h, 1, 1);
      const uv = g.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setXY(i, (uv.getX(i) * w) / (pr.h * 4), uv.getY(i));
      shadeColors(g, () => 0.92);
      const m = new THREE.Mesh(g, mats.relief);
      m.position.set((pr.x0 + pr.x1) / 2, pr.y + pr.h / 2, pr.z + 0.16);
      m.receiveShadow = true;
      group.add(m);
    } else if (pr.type === 'statue') {
      const gy = H(pr.x, pr.z);
      const s = pr.scale ?? 1;
      queue(plantBatch, { rect: pr.broken ? 'statueBroken' : 'statue', x: pr.x, y: gy - 0.05, z: pr.z, w: 1.6 * s, h: 2.93 * s, cast: true }, 1, 1.5);
      extraSolids.push({ x0: pr.x - 0.55 * s, z0: pr.z - 0.35, x1: pr.x + 0.55 * s, z1: pr.z + 0.35, y0: gy - 0.5, y1: gy + 2.6 * s, kind: 'statue' });
    } else if (pr.type === 'stele') {
      const gy = H(pr.x, pr.z);
      queue(plantBatch, { rect: 'stele', x: pr.x, y: gy - 0.05, z: pr.z, w: 0.93, h: 2.0, cast: true }, 1, 1);
      extraSolids.push({ x0: pr.x - 0.35, z0: pr.z - 0.2, x1: pr.x + 0.35, z1: pr.z + 0.2, y0: gy - 0.5, y1: gy + 1.8, kind: 'stele' });
    } else if (pr.type === 'brazier') {
      const gy = H(pr.x, pr.z);
      pr.gy = gy;
      extraSolids.push({ x0: pr.x - 0.3, z0: pr.z - 0.3, x1: pr.x + 0.3, z1: pr.z + 0.3, y0: gy - 0.5, y1: gy + 1.1, kind: 'brazier' });
      const light = new THREE.PointLight(L.id === 'shrine' ? '#ff9a48' : '#ffb15e', L.id === 'shrine' ? 7.5 : 4.5, L.id === 'shrine' ? 9 : 6.5, 1.3);
      light.position.set(pr.x, gy + 1.5, pr.z + 0.2);
      group.add(light);
      pointLights.push({ light, base: light.intensity, prop: pr });
      const local = { x: pr.x, y: gy + 1.2, z: pr.z, r: L.id === 'shrine' ? 7.5 : 5.5, color: L.id === 'shrine' ? [1.0, 0.56, 0.24] : [1.0, 0.62, 0.3], k: L.id === 'shrine' ? 1.2 : 0.75 };
      LIGHT.locals.push(local);
      pr.local = local;
    }
  }

  // ------------------------------------------------------- authored forms
  // Large hand-placed ground forms that give empty stretches a subject:
  // leaf litter drifts, root masses, the sun lily. All visual, no collision.
  for (const f of L.forms ?? []) {
    const gy = H(f.x, f.z);
    const s = f.s ?? 1;
    if (f.kind === 'litter') queue(flatBatch, { rect: `litter.${f.v ?? 0}`, mode: 1, x: f.x, y: gy + 0.012, z: f.z, w: 2.0 * s, h: 1.5 * s, angle: f.angle ?? 0 }, 0.72, 0.1);
    else if (f.kind === 'roots') queue(flatBatch, { rect: `roots.${f.v ?? 0}`, mode: 1, x: f.x, y: gy + 0.02, z: f.z, w: 2.6 * s, h: 1.8 * s, angle: f.angle ?? 0 }, 1, 0.1);
    else if (f.kind === 'moss') queue(flatBatch, { rect: `moss.${f.v ?? 0}`, mode: 1, x: f.x, y: gy + 0.015, z: f.z, w: 2.6 * s, h: 2.0 * s, angle: f.angle ?? 0 }, 1.05, 0.1);
    else if (f.kind === 'lily') {
      queue(plantBatch, { rect: 'sunLily', x: f.x, y: gy - 0.05, z: f.z, w: 1.6 * s, h: 2.5 * s, sway: 0.03, cast: true, flip: !!f.flip }, 1, 1);
      occupied.push([f.x, f.z, 0.7]);
    }
  }

  // ------------------------------------------------------------- plants
  const W = L.W, D = L.D;
  const th = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? 99 : L.H[z * W + x]);
  const ty = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? -1 : L.TY[z * W + x]);
  const nearTree = (x, z, r) => L.trees.some((t) => (t.x - x) ** 2 + (t.z - z) ** 2 < r * r);
  const underSolid = (x, z, y) => collider.solids.some((s) => x > s.x0 && x < s.x1 && z > s.z0 && z < s.z1 && s.y0 > y);
  const shrine = L.id === 'shrine';
  const tileInfo = new Array(W * D);

  for (let tz = 0; tz < D; tz++) {
    for (let tx = 0; tx < W; tx++) {
      const i = tz * W + tx;
      if (L.stairs.has(i)) continue;
      const type = L.TY[i], h = L.H[i];
      if (h >= 9.5) continue;
      let wallBase = false, lipEdge = false, waterEdge = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
        const nh = th(tx + dx, tz + dz);
        if (nh > h + 0.8 && nh < 50) wallBase = true;
        if (Math.abs(dx) + Math.abs(dz) === 1 && nh < h - 0.8) lipEdge = true;
        if (ty(tx + dx, tz + dz) === T.WATER && type !== T.WATER) waterEdge = true;
      }
      const shade = nearTree(tx + 0.5, tz + 0.5, 3.2);
      tileInfo[i] = { tx, tz, type, h, wallBase, lipEdge, waterEdge, shade };

      // --- what hangs from edges: grass lips, vines, ivy
      for (const [dx, dz, ang] of [[0, 1, 0], [1, 0, Math.PI / 2], [-1, 0, -Math.PI / 2]]) {
        const nh = th(tx + dx, tz + dz);
        const drop = h - nh;
        if (drop < 0.8 || nh > 50 || type === T.WATER) continue;
        const ex = tx + 0.5 + dx * 0.5, ez = tz + 0.5 + dz * 0.5;
        const nx = dx * 0.06, nz = dz * 0.06;
        const mas = L.MAS[i];
        const natural = !mas && (type === T.GRASS || type === T.DIRT || type === T.ROOT);
        if (!shrine && (natural || (mas && rnd() < 0.35 && type !== T.FLAG) || (type === T.ROCK && rnd() < 0.4))) {
          queue(flatBatch, { rect: `lip.${Math.floor(rnd() * 4)}`, mode: 2, x: ex + nx * 2, y: h + 0.06, z: ez + nz * 2, angle: ang, w: 1.18, h: 0.42 + rnd() * 0.18, sway: 0.01 }, 0.95, -0.2);
        }
        if (!shrine && drop >= 1.8 && rnd() < (mas ? 0.28 : 0.4)) {
          const vh = Math.min(drop - 0.2, 1.2 + rnd() * 2.2);
          const off = (rnd() - 0.5) * 0.6;
          queue(flatBatch, { rect: `vine.${Math.floor(rnd() * 4)}`, mode: 2, x: ex + nx * 3 + (dz ? off : 0), y: h + 0.02, z: ez + nz * 3 + (dx ? off : 0), angle: ang, w: 0.62, h: vh, sway: 0.03 }, 0.85, -vh * 0.5);
        }
        if (mas && drop >= 1.4 && rnd() < (shrine ? 0.1 : 0.22)) {
          const ih = 0.9 + rnd() * 0.5;
          const iy = nh + ih + rnd() * Math.max(0, drop - ih - 0.4) * 0.4;
          queue(flatBatch, { rect: `ivy.${Math.floor(rnd() * 3)}`, mode: 2, x: ex + nx * 2.5, y: iy, z: ez + nz * 2.5, angle: ang, w: 1.3, h: ih, sway: 0 }, shrine ? 0.6 : 0.85, -ih * 0.5);
        }
      }
    }
  }

  placePlants(L, { tileInfo, queue, plantBatch, flatBatch, rnd, isFree, underSolid, occupied, shrine, collider });

  // ------------------------------------------------------------- dappled light
  // The upper canopy above the frame, present only in the shadow map: a
  // closed roof of leaves over the forest, opened where the floor authoring
  // asks for sun patches and broken by small dapples elsewhere. Shade under
  // it is the cool sky light; the patches get the warm sun.
  if (L.floor?.sun && !shrine) {
    const dl = dappleLayer(L, LIGHT.sunDir, rnd);
    group.add(dl.mesh);
    collider.dapple = dl.lit;
  } else if (L.ceiling) {
    // underground the same layer is the vault: closed, with the few
    // openings the map names letting one cold shaft of daylight in
    const cl = ceilingLayer(L, LIGHT.sunDir, rnd);
    group.add(cl.mesh);
    collider.dapple = cl.lit;
    for (const o of L.ceiling.openings) if (o.beam) group.add(shaftBeam(o, L.ceiling.y, LIGHT.sunDir, rnd));
  } else collider.dapple = null;

  // ------------------------------------------------------------- tint everything
  const tmp = [0, 0, 0, 1];
  const sun = LIGHT.sunDir;
  for (const [batch, def, k, ly] of pending) {
    const lx = def.x, lz = def.z, lyy = def.y + Math.max(0.2, ly);
    // a canopy clump is never shadowed by its own crown, only by neighbours
    const lit = shrine ? 0.25 : collider.sunlit(lx, lyy, lz, sun, def.own ? canopies.filter((c) => c !== def.own) : canopies, !!def.own);
    spriteTint(lx, lyy, lz, lit, tmp);
    def.tint = [tmp[0] * k, tmp[1] * k, tmp[2] * k, 1];
    def.lit = lit;
    def.k = k;
    def.ly = ly;
    batch.add(def);
  }
  for (const b of [canopyBatch, plantBatch, flatBatch]) {
    b.commit();
    group.add(b.mesh);
  }
  canopyBatch.mesh.name = 'canopies';

  // ------------------------------------------------------------- waterfall
  for (const wf of L.waterfalls) group.add(buildWaterfall(wf));

  // ------------------------------------------------------------- shrine vista
  if (L.backdrop) group.add(buildBackdrop(L.backdrop));

  return { group, extraSolids, pointLights, canopyBatch, plantBatch, flatBatch, canopies, pending };
}

function streakTexture() {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 256;
  const g = c.getContext('2d');
  const r = mulberry32(5);
  g.fillStyle = '#000';
  g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 70; i++) {
    const x = Math.floor(r() * 64), y = Math.floor(r() * 256), len = 20 + r() * 70;
    const v = 120 + Math.floor(r() * 135);
    g.fillStyle = `rgb(${v},${v},${v})`;
    g.fillRect(x, y, 1 + Math.floor(r() * 2), len);
    g.fillRect(x, y - 256, 1 + Math.floor(r() * 2), len);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.NearestFilter;
  return t;
}

function buildWaterfall(wf) {
  const w = wf.x1 - wf.x0, h = wf.y1 - wf.y0;
  const g = new THREE.PlaneGeometry(w, h, 6, 12);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i);
    // bulge out a little as it falls
    p.setZ(i, (1 - (y + h / 2) / h) * 0.35 + Math.sin(p.getX(i) * 3) * 0.04);
  }
  const mat = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    uniforms: { ...worldUniforms, uStreak: { value: streakTexture() } },
    vertexShader: /* glsl */ `
      varying vec2 vUv; varying vec3 vWPos2;
      void main() { vUv = uv; vec4 wp = modelMatrix * vec4(position, 1.0); vWPos2 = wp.xyz; gl_Position = projectionMatrix * viewMatrix * wp; }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D uStreak; uniform float uTime;
      varying vec2 vUv; varying vec3 vWPos2;
      void main() {
        float s1 = texture2D(uStreak, vec2(vUv.x * 2.0, vUv.y * 1.5 + uTime * 0.9)).r;
        float s2 = texture2D(uStreak, vec2(vUv.x * 1.3 + 0.3, vUv.y * 1.1 + uTime * 1.3)).r;
        float s = max(s1, s2 * 0.8);
        vec3 deep = vec3(0.12, 0.2, 0.24);
        vec3 lite = vec3(0.72, 0.78, 0.74);
        float edge = smoothstep(0.0, 0.12, vUv.x) * smoothstep(1.0, 0.88, vUv.x);
        float foam = smoothstep(0.12, 0.0, vUv.y);
        vec3 c = mix(deep, lite, clamp(s * 0.9 + foam, 0.0, 1.0));
        float a = (0.45 + s * 0.45 + foam * 0.4) * edge;
        // darker as it falls into the gorge
        c *= mix(0.55, 1.0, vUv.y);
        gl_FragColor = vec4(c, a);
        #include <colorspace_fragment>
      }`,
  });
  const m = new THREE.Mesh(g, mat);
  m.position.set((wf.x0 + wf.x1) / 2, (wf.y0 + wf.y1) / 2, wf.z + 0.08);
  m.renderOrder = 3;
  return m;
}

// Far backdrop for open maps: warm sky, sun glow and layered ridge
// silhouettes with a distant tower, painted with the same ramps and dither
// as everything else. It sits far behind the playfield, facing the camera.
function buildBackdrop(v) {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 512;
  const g = c.getContext('2d');
  const sky = g.createLinearGradient(0, 0, 0, 512);
  sky.addColorStop(0, '#a9b3a6');
  sky.addColorStop(0.5, '#d8cda4');
  sky.addColorStop(1, '#e6d5a6');
  g.fillStyle = sky;
  g.fillRect(0, 0, 1024, 512);
  const glow = g.createRadialGradient(610, 300, 10, 610, 300, 300);
  glow.addColorStop(0, 'rgba(255,240,200,0.9)');
  glow.addColorStop(1, 'rgba(255,240,200,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, 1024, 512);
  const ridge = (y0, amp, col, seed, freq = 0.006) => {
    g.fillStyle = col;
    g.beginPath();
    g.moveTo(0, 512);
    for (let x = 0; x <= 1024; x += 4) g.lineTo(x, y0 - fbm2(x * freq, seed, 4, seed) * amp);
    g.lineTo(1024, 512);
    g.fill();
  };
  ridge(330, 170, '#bdb894', 3);
  // a far, slender tower on the furthest ridge
  const tx = 300;
  g.fillStyle = '#a8a283';
  g.fillRect(tx - 9, 120, 18, 200);
  g.fillRect(tx - 13, 120, 26, 6);
  g.fillRect(tx - 6, 104, 12, 18);
  ridge(380, 150, '#a3a27f', 4);
  ridge(440, 120, '#878d6c', 5, 0.009);
  ridge(500, 90, '#6b7656', 6, 0.012);
  // dither the image onto the ramps so it matches the sprites
  const d = g.getImageData(0, 0, 1024, 512);
  for (let y = 0; y < 512; y++)
    for (let x = 0; x < 1024; x++) {
      const i = (y * 1024 + x) * 4;
      const t = bayer(x, y) * 10;
      for (let k = 0; k < 3; k++) d.data[i + k] = Math.round((d.data[i + k] + t) / 6) * 6;
    }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const m = new THREE.Mesh(new THREE.PlaneGeometry(v.w, v.w / 2), new THREE.MeshBasicMaterial({ map: t, fog: false }));
  m.position.set(v.x, v.y, v.z);
  m.name = 'backdrop';
  m.renderOrder = -1;
  return m;
}

// recompute tints of every static sprite (debug: lighting response toggle)
export function retint(dressing, collider, mode, shrine) {
  const tmp = [0, 0, 0, 1];
  const counters = new Map();
  for (const [batch, def] of dressing.pending) {
    const i = counters.get(batch) ?? 0;
    counters.set(batch, i + 1);
    if (mode === 'flat') def.tint = [1, 1, 1, def.tint[3]];
    else {
      const ly = def.y + Math.max(0.2, def.ly);
      spriteTint(def.x, ly, def.z, shrine ? 0.25 : def.lit, tmp);
      def.tint = [tmp[0] * def.k, tmp[1] * def.k, tmp[2] * def.k, def.tint[3]];
    }
    batch.set(i, def);
  }
  for (const b of counters.keys()) b.commit();
}

// ------------------------------------------------------------------ plants
// Vegetation is composed as clusters, not sprinkled per tile. Each tile is
// read for its ecological niche (water edge, damp wall base, forest floor,
// open meadow, dry stone); clusters seed sparsely by niche, vary strongly in
// size, put their big plants in the middle and small ones at the rim, and
// leave the walked routes, stair mouths, jump edges and interactables clear.
// Authored clusters from the level (L.dressing) are placed first and win.
const NICHES = {
  water: { seed: 0.3, gap: 2.2, r: [0.5, 1.4], dens: 3.6 },
  wall: { seed: 0.26, gap: 2.1, r: [0.5, 1.5], dens: 3.4 },
  forest: { seed: 0.16, gap: 2.6, r: [0.7, 2.0], dens: 3.0 },
  meadow: { seed: 0.2, gap: 2.8, r: [0.7, 2.2], dens: 3.4 },
  stone: { seed: 0.06, gap: 3.0, r: [0.25, 0.6], dens: 3.0 },
  shrine: { seed: 0.14, gap: 2.2, r: [0.3, 0.8], dens: 2.6 },
};

function placePlants(L, ctx) {
  const { tileInfo, queue, plantBatch, flatBatch, rnd, isFree, underSolid, shrine } = ctx;
  const W = L.W, D = L.D;
  const info = (x, z) => (x < 0 || z < 0 || x >= W || z >= D ? null : tileInfo[Math.floor(z) * W + Math.floor(x)]);

  // keep-clear mask: stair mouths and interactables stay readable
  const clear = new Float32Array(W * D);
  const stamp = (cx, cz, r, v) => {
    for (let z = Math.floor(cz - r); z <= cz + r; z++)
      for (let x = Math.floor(cx - r); x <= cx + r; x++) {
        if (x < 0 || z < 0 || x >= W || z >= D) continue;
        const d = Math.hypot(x + 0.5 - cx, z + 0.5 - cz);
        if (d < r) clear[z * W + x] = Math.max(clear[z * W + x], v * (1 - d / r));
      }
  };
  for (const i of L.stairs.keys()) stamp((i % W) + 0.5, Math.floor(i / W) + 0.5, 1.8, 1);
  for (const e of L.entities) if (['sunstone', 'lever', 'chest', 'vessel'].includes(e.type)) stamp(e.x, e.z, 2.0, 1);
  // fights read better on a clean floor: thin the plants where enemies stand
  for (const e of L.entities) if (['sentinel', 'boss'].includes(e.type)) stamp(e.x, e.z, 2.6, 0.9);
  else if (['slime', 'bulb'].includes(e.type)) stamp(e.x, e.z, 1.5, 0.7);
  for (const p of L.props) if (p.type === 'stele') stamp(p.x, p.z, 1.4, 0.8);
  for (const c of L.checkpoints) stamp(c.x, c.z, 1.6, 0.7);
  for (const g of L.gates ?? []) stamp((g.x0 + g.x1) / 2, (g.z0 + g.z1) / 2 + 0.8, 2.2, 1);
  for (const pt of L.portals ?? []) stamp((pt.x0 + pt.x1) / 2, (pt.z0 + pt.z1) / 2, 2.2, 1);

  const nicheOf = (t) => {
    if (!t || t.type === T.WATER) return null;
    if (shrine) return t.wallBase || t.waterEdge ? 'shrine' : null;
    if (t.waterEdge) return 'water';
    if (t.wallBase && t.type !== T.DIRT) return 'wall';
    if (t.type === T.GRASS || t.type === T.ROOT) return t.shade || t.tz > 63 ? 'forest' : 'meadow';
    if (t.type === T.FLAG || t.type === T.ROCK) return 'stone';
    return null; // dirt is the walked ground: it stays bare
  };

  const clusters = [];
  for (const d of L.dressing ?? []) clusters.push({ ...d, authored: true, h: info(d.x, d.z)?.h ?? 0 });
  // authored floor: banks are filled densely as masses; elsewhere the floor
  // stays quiet (paths and clearings bare, the rest only sparsely planted)
  const floorAt = floorField(L);
  const floorHere = (x, z) => (floorAt && z >= L.floor.z0 ? floorAt(x, z) : null);
  if (floorAt)
    for (const b of L.floor.blobs) {
      if (b.kind !== 'bank') continue;
      for (let gz = -b.rz; gz <= b.rz; gz += 1.3)
        for (let gx = -b.rx; gx <= b.rx; gx += 1.5) {
          const x = b.x + gx + (rnd() - 0.5) * 0.8, z = b.z + gz + (rnd() - 0.5) * 0.6;
          const f = floorHere(x, z), t = info(x, z);
          if (!f || f.bank < 0.4 || f.path > 0.2 || !t || !nicheOf(t)) continue;
          if (clear[Math.floor(z) * W + Math.floor(x)] > 0.3) continue;
          clusters.push({ x, z, niche: 'forest', r: 0.9 + rnd() * 0.7, h: t.h, density: 1.5, bank: true });
        }
    }
  const order = [];
  for (let i = 0; i < W * D; i++) if (tileInfo[i]) order.push(i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  for (const i of order) {
    const t = tileInfo[i];
    const niche = nicheOf(t);
    if (!niche || clear[i] > 0.3) continue;
    const N = NICHES[niche];
    // large-scale patchiness: whole regions are lush or bare
    const patch = smoothstep(0.32, 0.68, fbm2(t.tx * 0.09, t.tz * 0.09, 3, 77));
    if (rnd() > N.seed * (0.45 + patch * 1.3)) continue;
    const x = t.tx + 0.2 + rnd() * 0.6, z = t.tz + 0.2 + rnd() * 0.6;
    const fl = floorHere(x, z);
    if (fl && (fl.path > 0.2 || fl.clear > 0.3 || rnd() > 0.3)) continue;
    if (clusters.some((c) => (c.x - x) ** 2 + (c.z - z) ** 2 < (NICHES[c.niche]?.gap ?? 2.5) ** 2 * 0.6)) continue;
    const big = rnd() < 0.18 && !fl;
    const r = N.r[0] + rnd() * (N.r[1] - N.r[0]) * (big ? 1.4 : 0.8);
    clusters.push({ x, z, niche, r, h: t.h });
  }

  // a sparse base layer of lone tufts so the ground is never sterile
  for (const i of order) {
    const t = tileInfo[i];
    if (shrine || !t || clear[i] > 0.2 || rnd() > 0.07) continue;
    if (t.type !== T.GRASS && !(t.type === T.FLAG && t.wallBase)) continue;
    const x = t.tx + 0.15 + rnd() * 0.7, z = t.tz + 0.15 + rnd() * 0.7;
    const fl = floorHere(x, z);
    if (fl && fl.path > 0.3) continue;
    if (!isFree(x, z, 0.3) || underSolid(x, z, t.h + 0.5)) continue;
    queue(flatBatch, { rect: `grass.${Math.floor(rnd() * 6)}`, x, y: t.h - 0.02, z, w: 0.5 + rnd() * 0.2, sway: 0.03, flip: rnd() < 0.5 }, t.shade ? 0.85 : 1);
  }

  const gauss = () => {
    let u = 0;
    for (let k = 0; k < 3; k++) u += rnd();
    return (u - 1.5) / 1.5;
  };
  for (const c of clusters) {
    const N = NICHES[c.niche] ?? NICHES.meadow;
    const count = Math.max(1, Math.round(N.dens * Math.PI * c.r * c.r * (c.density ?? 1)));
    // damp clusters lay a moss patch under themselves
    if ((c.niche === 'wall' || c.niche === 'water' || c.niche === 'forest' || c.niche === 'shrine') && c.r > 0.7 && rnd() < 0.5)
      queue(flatBatch, { rect: `moss.${Math.floor(rnd() * 3)}`, mode: 1, x: c.x, y: c.h + 0.015, z: c.z, w: c.r * 1.7, h: c.r * 1.3, angle: rnd() * 6.28 }, c.niche === 'shrine' ? 0.75 : 1.1, 0.1);
    for (let k = 0; k < count; k++) {
      const x = c.x + gauss() * c.r, z = c.z + gauss() * c.r * 0.8;
      const t = info(x, z);
      if (!t || t.type === T.WATER || Math.abs(t.h - c.h) > 0.05) continue;
      const ci = Math.floor(z) * W + Math.floor(x);
      if (clear[ci] > (c.authored ? 0.6 : 0.25)) continue;
      // keep jump edges clean: nothing within a short step of a drop
      if (t.lipEdge && ((x % 1) < 0.25 || (x % 1) > 0.75 || (z % 1) < 0.25 || (z % 1) > 0.75)) continue;
      if (t.type === T.DIRT && !c.authored) continue;
      if (!isFree(x, z, 0.3) || underSolid(x, z, t.h + 0.5)) continue;
      const core = 1 - Math.min(1, Math.hypot(x - c.x, (z - c.z) / 0.8) / c.r); // 1 centre, 0 rim
      plant(c.niche, core, x, t.h, z, t);
    }
  }

  function plant(niche, core, x, y, z, t) {
    const pick = rnd();
    const flip = rnd() < 0.5;
    const grass = (w = 0.6, k = 1) => queue(flatBatch, { rect: `grass.${Math.floor(rnd() * 6)}`, x, y: y - 0.02, z, w: w + rnd() * 0.3, sway: 0.03, flip }, k);
    if (niche === 'water') {
      if (core > 0.35 && pick < 0.55) queue(plantBatch, { rect: `reeds.${Math.floor(rnd() * 2)}`, x, y, z, w: 0.7 + core * 0.3, h: 1.2 + core * 0.6, sway: 0.07, cast: true, flip }, 1);
      else if (core > 0.5 && pick < 0.75) queue(plantBatch, { rect: `fern.${Math.floor(rnd() * 4)}`, x, y: y - 0.05, z, w: 1.2, sway: 0.035, cast: true, flip }, 0.92);
      else grass(0.5, 0.95);
    } else if (niche === 'wall') {
      if (core > 0.55 && pick < 0.35 && isFree(x, z, 0.7)) {
        queue(plantBatch, { rect: `bush.${Math.floor(rnd() * 5)}`, x, y: y - 0.1, z, w: 1.3 + core * 0.5, sway: 0.02, cast: true, flip, reveal: true }, 0.92);
        ctx.occupied.push([x, z, 0.5]);
      } else if (core > 0.3 && pick < 0.6) queue(plantBatch, { rect: `fern.${Math.floor(rnd() * 4)}`, x, y: y - 0.05, z, w: 1.1 + core * 0.4, sway: 0.035, cast: true, flip }, 0.9);
      else if (pick < 0.75 && t.shade) queue(flatBatch, { rect: `mush.${Math.floor(rnd() * 2)}`, x, y, z, w: 0.5 }, 0.85);
      else grass(0.5, 0.9);
    } else if (niche === 'forest') {
      const fl = floorHere(x, z);
      if (fl && fl.path > 0.35) return;
      if (core > 0.6 && pick < 0.3 && (!fl || fl.bank > 0.3) && isFree(x, z, 0.7)) {
        queue(plantBatch, { rect: `bush.${Math.floor(rnd() * 5)}`, x, y: y - 0.1, z, w: 1.4 + core * 0.5, sway: 0.02, cast: true, flip, reveal: true }, 0.9);
        ctx.occupied.push([x, z, 0.5]);
      } else if (core > 0.25 && pick < 0.6) queue(plantBatch, { rect: `fern.${Math.floor(rnd() * 4)}`, x, y: y - 0.05, z, w: 1.2 + core * 0.4, sway: 0.035, cast: true, flip }, 0.9);
      else if (pick < 0.7 && t.shade) queue(flatBatch, { rect: `mush.${Math.floor(rnd() * 2)}`, x, y, z, w: 0.5 }, 0.85);
      else grass(0.55, 0.9);
    } else if (niche === 'meadow') {
      // flowers drift through the middle band of a clump, one colour per clump
      if (core > 0.3 && core < 0.85 && pick < 0.32) queue(flatBatch, { rect: `flowers.${(Math.floor(x * 0.37 + z * 0.23) & 1) && rnd() < 0.8 ? 1 : 0}`, x, y, z, w: 0.55 + rnd() * 0.15 }, 1);
      else if (core > 0.7 && pick < 0.3) queue(plantBatch, { rect: `bushDry.${Math.floor(rnd() * 2)}`, x, y: y - 0.1, z, w: 1.2, sway: 0.02, cast: true }, 1);
      else grass(0.55 + core * 0.25, 1);
    } else if (niche === 'stone') {
      grass(0.42, 0.95);
    } else if (niche === 'shrine') {
      if (pick < 0.4) queue(flatBatch, { rect: `mush.${Math.floor(rnd() * 2)}`, x, y, z, w: 0.5 }, 0.9);
      else queue(flatBatch, { rect: `grass.${Math.floor(rnd() * 3)}`, x, y, z, w: 0.5, sway: 0.01 }, 0.75);
    }
  }
}

// The shadow-only upper canopy (see "dappled light" in dressMap).
const DAPPLE_Y = 16, DPU = 8;
function dappleLayer(L, sun, rnd) {
  const F = L.floor;
  const X0 = -12, X1 = L.W + 12, Z0 = F.z0 - 14, Z1 = L.D + 6;
  const cw = Math.round((X1 - X0) * DPU), ch = Math.round((Z1 - Z0) * DPU);
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const c = cv.getContext('2d');
  // ground point -> point on the canopy plane along the sun ray -> pixel
  const proj = (x, y, z) => {
    const t = (DAPPLE_Y - y) / sun.y;
    return [(x + sun.x * t - X0) * DPU, (z + sun.z * t - Z0) * DPU];
  };
  const blob = (x, y, z, r, col) => {
    const [px, py] = proj(x, y, z);
    c.fillStyle = col;
    c.beginPath();
    c.ellipse(px, py, r * DPU, r * DPU * 0.85, 0, 0, Math.PI * 2);
    c.fill();
  };
  c.fillStyle = '#000';
  c.fillRect(0, 0, cw, ch);
  // the roof: closed over the forest, with a ragged leafy edge towards the
  // courtyard where the trees stop
  // courtyard where the trees stop. Over the route it thins: pools of light
  // open along the paths and clearings, broken by leafy shadow, while the
  // banks and the edges stay closed.
  const ff = floorField(L);
  for (let z = F.z0 + 1.6; z < L.D + 3; z += 0.5)
    for (let x = -3; x < L.W + 3; x += 0.5) {
      const edge = z < F.z0 + 3.2 ? fbm2(x * 0.7, z * 0.7, 2, 31) > 0.5 - (z - F.z0 - 1.6) * 0.3 : true;
      if (!edge) continue;
      const f = ff(x, z);
      const open = f.path * 0.7 + f.clear * 0.8 - f.bank * 0.9 + (fbm2(x * 0.45, z * 0.45, 3, 57) - 0.5) * 1.3;
      if (open > 0.34) continue;
      blob(x, 5, z, 0.42, '#fff');
    }
  // authored openings, each a cluster of round holes so the rim is leafy
  // (overlapping, rotated ellipses of falling size, so the rim is
  // irregular and leafy rather than a ring of circles)
  for (const [x, z, y, r] of F.sun) {
    const [px, py] = proj(x, y, z);
    c.fillStyle = '#000';
    for (let k = 0; k < 22; k++) {
      const a = rnd() * Math.PI * 2, d = r * Math.pow(rnd(), 0.6) * 0.75;
      const rr = r * (0.18 + rnd() * 0.32) * (1.1 - d / r);
      c.beginPath();
      c.ellipse(px + Math.cos(a) * d * DPU, py + Math.sin(a) * d * 0.8 * DPU, rr * DPU * (1 + rnd() * 0.8), rr * DPU, rnd() * Math.PI, 0, Math.PI * 2);
      c.fill();
    }
  }
  // dapples: flecks of sun, thick around the openings and rare far from
  // them, stretched along the sun's direction like real sun-flecks
  const rot = Math.atan2(sun.z, sun.x);
  for (let i = 0; i < (L.W * (L.D - F.z0)) * 0.3; i++) {
    const x = rnd() * L.W, z = F.z0 + rnd() * (L.D - F.z0);
    let near = 9;
    for (const [sx, sz, , r] of F.sun) near = Math.min(near, Math.hypot(x - sx, z - sz) - r);
    if (rnd() > 0.85 - near * 0.24) continue;
    const r = 0.07 + rnd() * rnd() * 0.22;
    const [px, py] = proj(x, 5.5, z);
    c.fillStyle = '#000';
    c.beginPath();
    c.ellipse(px, py, r * DPU * 1.7, r * DPU, rot + (rnd() - 0.5) * 0.5, 0, Math.PI * 2);
    c.fill();
  }
  return shadowRoof(cv, c, cw, ch, X0, X1, Z0, Z1, proj);
}

function shadowRoof(cv, c, cw, ch, X0, X1, Z0, Z1, proj, Y = DAPPLE_Y) {
  const img = c.getImageData(0, 0, cw, ch).data;
  const tex = new THREE.CanvasTexture(cv);
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute([X0, Y, Z0, X1, Y, Z0, X1, Y, Z1, X0, Y, Z1], 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
  g.setAttribute('normal', new THREE.Float32BufferAttribute([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0], 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  // the shadow pass copies alphaMap/alphaTest from the object's own material
  const mesh = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ alphaMap: tex, alphaTest: 0.5, colorWrite: false, depthWrite: false, side: THREE.DoubleSide }));
  mesh.castShadow = true;
  mesh.receiveShadow = false;
  mesh.customDepthMaterial = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, alphaMap: tex, alphaTest: 0.5, side: THREE.DoubleSide });
  mesh.name = 'dapple';
  mesh.frustumCulled = false;
  const lit = (x, y, z) => {
    if (y > Y) return 1;
    const [px, py] = proj(x, y, z);
    const ix = Math.floor(px), iy = Math.floor(py);
    if (ix < 0 || iy < 0 || ix >= cw || iy >= ch) return 1;
    return img[(iy * cw + ix) * 4 + 1] > 127 ? 0.3 : 1;
  };
  return { mesh, lit };
}

// The shrine vault (see dressMap): a closed roof over the hall with a few
// authored openings, each a quadrilateral on the ground (x, z corners) at a
// ground height, its rim chipped like broken masonry.
function ceilingLayer(L, sun, rnd) {
  const C = L.ceiling, Y = C.y;
  const X0 = -10, X1 = L.W + 10, Z0 = -10, Z1 = L.D + 10;
  const cw = Math.round((X1 - X0) * DPU), ch = Math.round((Z1 - Z0) * DPU);
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const c = cv.getContext('2d');
  const proj = (x, y, z) => {
    const t = (Y - y) / sun.y;
    return [(x + sun.x * t - X0) * DPU, (z + sun.z * t - Z0) * DPU];
  };
  c.fillStyle = '#fff';
  c.fillRect(0, 0, cw, ch);
  c.fillStyle = '#000';
  for (const o of C.openings) {
    c.beginPath();
    o.pts.forEach(([x, z], i) => {
      const [px, py] = proj(x, o.y, z);
      if (i) c.lineTo(px, py);
      else c.moveTo(px, py);
    });
    c.closePath();
    c.fill();
    // chipped rim: bites of shadow taken out of the edges, and a few spills
    // of light past them
    for (let k = 0; k < (o.chips ?? 14); k++) {
      const i = Math.floor(rnd() * o.pts.length), j = (i + 1) % o.pts.length, f = rnd();
      const x = o.pts[i][0] + (o.pts[j][0] - o.pts[i][0]) * f, z = o.pts[i][1] + (o.pts[j][1] - o.pts[i][1]) * f;
      const [px, py] = proj(x, o.y, z);
      c.fillStyle = rnd() < 0.55 ? '#fff' : '#000';
      c.fillRect(px - DPU * (0.1 + rnd() * 0.25), py - DPU * (0.1 + rnd() * 0.25), DPU * (0.2 + rnd() * 0.5), DPU * (0.2 + rnd() * 0.5));
    }
  }
  return shadowRoof(cv, c, cw, ch, X0, X1, Z0, Z1, proj, Y);
}

// The visible part of a shaft: a few faint additive veils hanging from the
// opening along the sun's direction, with dust caught in them. Restrained on
// purpose: the floor pool carries the light, the veils only give it depth.
function shaftBeam(o, Y, sun, rnd) {
  const cv = document.createElement('canvas');
  cv.width = 32;
  cv.height = 128;
  const c = cv.getContext('2d');
  const g = c.createLinearGradient(0, 0, 0, 128);
  g.addColorStop(0, 'rgba(160,190,230,0)');
  g.addColorStop(0.25, 'rgba(160,190,230,0.55)');
  g.addColorStop(0.85, 'rgba(160,190,230,0.8)');
  g.addColorStop(1, 'rgba(160,190,230,0.15)');
  c.fillStyle = g;
  c.fillRect(0, 0, 32, 128);
  // soft side edges
  const e = c.createLinearGradient(0, 0, 32, 0);
  e.addColorStop(0, 'rgba(0,0,0,1)');
  e.addColorStop(0.2, 'rgba(0,0,0,0)');
  e.addColorStop(0.8, 'rgba(0,0,0,0)');
  e.addColorStop(1, 'rgba(0,0,0,1)');
  c.globalCompositeOperation = 'destination-out';
  c.fillStyle = e;
  c.fillRect(0, 0, 32, 128);
  c.globalCompositeOperation = 'source-over';
  for (let i = 0; i < 40; i++) {
    c.fillStyle = `rgba(225,235,250,${0.4 + rnd() * 0.5})`;
    c.fillRect(Math.floor(4 + rnd() * 24), Math.floor(10 + rnd() * 110), 1, 1);
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  const [a, b, cc, d] = o.pts;
  const pos = [], uv = [], idx = [];
  const t = (Y - o.y) / sun.y;
  // veils across the short axis, at a few stations along the long one
  for (const f of [0.15, 0.4, 0.65, 0.88]) {
    const p0 = [a[0] + (d[0] - a[0]) * f, a[1] + (d[1] - a[1]) * f];
    const p1 = [b[0] + (cc[0] - b[0]) * f, b[1] + (cc[1] - b[1]) * f];
    const n = pos.length / 3;
    for (const [p, u] of [[p0, 0], [p1, 1]]) {
      pos.push(p[0], o.y + 0.02, p[1], p[0] + sun.x * t, Y, p[1] + sun.z * t);
      uv.push(u, 0, u, 1);
    }
    idx.push(n, n + 2, n + 1, n + 1, n + 2, n + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx);
  const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
  m.name = 'shaft';
  return m;
}

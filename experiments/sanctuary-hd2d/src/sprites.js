// Illustrated sprites, painted procedurally into one atlas.
// Each sprite is drawn with vector shapes lit from the upper left, then snapped
// to the shared palette, alpha-thresholded and outlined. That last step is what
// makes them read as deliberate pixel-art clusters at a fairly high resolution
// (about 60 texels per world unit, the same density as the terrain textures).
import * as THREE from '../vendor/three.module.min.js';
import { R, rgbStr, bayer } from './palette.js';
import { mulberry32 } from './noise.js';

export const PX_PER_UNIT = 60;

const ATLAS = 2048;
const allColors = Object.values(R).flat();

// ------------------------------------------------------------ drawing kit
function frame(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c.getContext('2d');
}

// Fill a path with a 3-tone cel shade lit from the upper left.
// ramp indices: [shadow, mid, light]
function shade(ctx, path, ramp, [s, m, l] = [1, 3, 4], off = 2.2) {
  ctx.save();
  path(ctx);
  ctx.fillStyle = rgbStr(ramp[s]);
  ctx.fill();
  ctx.clip();
  // mid tone: the shape nudged towards the light, leaving a shadowed lower-right rim
  ctx.translate(-off, -off);
  path(ctx);
  ctx.fillStyle = rgbStr(ramp[m]);
  ctx.fill();
  ctx.translate(off, off);
  // highlight: a sliver along the upper-left rim (shape minus itself shifted down-right)
  ctx.beginPath();
  ctx.rect(-999, -999, 3000, 3000);
  ctx.translate(off * 0.7, off * 0.7);
  path(ctx, true);
  ctx.translate(-off * 0.7, -off * 0.7);
  ctx.fillStyle = rgbStr(ramp[l]);
  ctx.fill('evenodd');
  ctx.restore();
}

const ell = (x, y, rx, ry, rot = 0) => (ctx, noBegin) => {
  if (!noBegin) ctx.beginPath();
  else ctx.moveTo(x + rx * Math.cos(rot), y + rx * Math.sin(rot));
  ctx.ellipse(x, y, Math.max(0.5, rx), Math.max(0.5, ry), rot, 0, Math.PI * 2);
};
const poly = (pts) => (ctx, noBegin) => {
  if (!noBegin) ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
  ctx.closePath();
};
const rrect = (x, y, w, h, r) => (ctx, noBegin) => {
  if (!noBegin) ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

function flat(ctx, path, col) {
  path(ctx);
  ctx.fillStyle = rgbStr(col);
  ctx.fill();
}

// Snap to palette, threshold alpha, add an outline. Returns the canvas.
const nearestCache = new Map();
function nearest(r, g, b) {
  const key = (r >> 2) * 4096 + (g >> 2) * 64 + (b >> 2);
  let c = nearestCache.get(key);
  if (c) return c;
  let best = 1e9;
  for (const p of allColors) {
    const dr = p[0] - r, dg = p[1] - g, db = p[2] - b;
    const d = dr * dr * 0.3 + dg * dg * 0.59 + db * db * 0.11;
    if (d < best) {
      best = d;
      c = p;
    }
  }
  nearestCache.set(key, c);
  return c;
}

function finish(ctx, { outline = [26, 20, 18], inner = true, alphaCut = 110 } = {}) {
  const { width: w, height: h } = ctx.canvas;
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = d[i * 4 + 3];
    if (a >= alphaCut) {
      solid[i] = 1;
      const un = a < 255 ? 255 / a : 1;
      const c = nearest(Math.min(255, d[i * 4] * un), Math.min(255, d[i * 4 + 1] * un), Math.min(255, d[i * 4 + 2] * un));
      d[i * 4] = c[0];
      d[i * 4 + 1] = c[1];
      d[i * 4 + 2] = c[2];
      d[i * 4 + 3] = 255;
    } else d[i * 4 + 3] = 0;
  }
  if (outline) {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (solid[i]) continue;
        if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])) out[i] = 1;
      }
    for (let i = 0; i < w * h; i++)
      if (out[i]) {
        d[i * 4] = outline[0];
        d[i * 4 + 1] = outline[1];
        d[i * 4 + 2] = outline[2];
        d[i * 4 + 3] = 255;
      }
  }
  ctx.putImageData(img, 0, 0);
  return ctx.canvas;
}

// ------------------------------------------------------------ the hero
// A young wanderer: a mop of chestnut hair with a short tied tail, indigo
// tunic over undyed sleeves and trousers, one rust scarf as the accent, worn
// boots, short sword. The head sits on a scarf collar so head and body read
// apart; the hair is a pile of separate locks, never a cap. Hair tail and
// scarf take a sway/wind value per frame for secondary motion.
const HW = 72, HH = 108;

function heroFrame(dir, pose) {
  const ctx = frame(HW, HH);
  const cx = 36, gy = 104;
  const b = pose.bob || 0;
  const side = dir === 'side';
  const back = dir === 'up';
  const lift = pose.lift || [0, 0];
  const swing = pose.swing || 0;
  const stride = pose.stride || 0;
  const lean = pose.lean || 0; // upper body shift (side view: forward +)
  const sway = pose.sway || 0; // hair tail / scarf secondary motion
  const wind = pose.wind || 0; // how far the scarf tail streams
  const sword = pose.sword; // null | {ang, len, behind}
  const ux = side ? lean : 0; // upper-body x offset
  const uy = b + (side ? Math.abs(lean) * 0.3 : 0);

  const drawSword = () => {
    if (!sword) return;
    ctx.save();
    ctx.translate(sword.x, sword.y);
    ctx.rotate(sword.ang);
    shade(ctx, rrect(-2, -3, 6, 6, 1), R.leather, [1, 2, 3], 1);
    shade(ctx, rrect(3, -5, 4, 10, 1), R.gold, [1, 3, 4], 1);
    shade(ctx, poly([[7, -2.5], [7 + sword.len, -1.5], [10 + sword.len, 0], [7 + sword.len, 1.5], [7, 2.5]]), R.steel, [2, 4, 5], 1.2);
    ctx.restore();
  };
  if (sword && sword.behind) drawSword();

  // scarf tail: streams behind, longer and higher with wind
  {
    const sx = side ? cx - 6 + ux : back ? cx + 4 : cx + 7;
    const dirx = side ? -1 : back ? 0.35 : 1;
    const len = 12 + wind * 6;
    const lift2 = wind * 4;
    const ex = sx + dirx * len, ey = 52 + uy - lift2 + sway * 1.5;
    if (!back || wind > 0.5) {
      shade(ctx, poly([[sx, 37 + uy], [sx + dirx * len * 0.5, 44 + uy - lift2 * 0.5 + sway], [ex, ey], [ex + dirx * 2, ey + 6], [sx + dirx * len * 0.4, 50 + uy - lift2 * 0.4 + sway], [sx - dirx * 2, 42 + uy]]), R.rust, [1, 2, 4], 1.4);
    }
  }

  // legs: undyed trousers into worn boots
  const legs = side
    ? [[cx - 4 + stride, lift[0]], [cx - 1 - stride, lift[1]]]
    : [[cx - 7.5, lift[0]], [cx + 0.5, lift[1]]];
  legs.forEach(([lx, ly], k) => {
    const top = 72 + b, bot = gy - 11 - ly;
    shade(ctx, rrect(lx, top, 7.5, bot - top + 3, 3), R.cream, k ? [0, 1, 2] : [1, 2, 3], 1.4);
    shade(ctx, rrect(lx - 0.5, bot - 1, side ? 11 : 8.5, 12, [3, side ? 5 : 3, 2, 2]), R.leather, [0, 1, 3], 1.4);
    // boot cuff
    flat(ctx, rrect(lx - 0.5, bot - 1, side ? 9 : 8.5, 2, 1), R.leather[3]);
  });

  // back arm (side view)
  if (side) {
    shade(ctx, rrect(cx - 5 - swing + ux, 44 + uy, 6.5, 12, 3), R.cloth, [0, 1, 2], 1.2);
    shade(ctx, rrect(cx - 5 - swing * 1.3 + ux, 54 + uy, 6, 10, 3), R.cream, [0, 1, 2], 1.2);
    flat(ctx, ell(cx - 2 - swing * 1.4 + ux, 65 + uy, 3.2, 3.2), R.skin[2]);
  }

  // tunic: narrow shoulders, flared asymmetric hem, side slit
  const tw = side ? 9 : 11;
  const hemBack = side ? -3 : 0;
  shade(
    ctx,
    poly([[cx - tw + ux, 41 + uy], [cx + tw + ux, 41 + uy], [cx + tw + 3 + ux * 0.5, 76 + b], [cx + 4, 79 + b], [cx - 2, 76.5 + b], [cx - tw - 3 + hemBack + ux * 0.5, 77 + b]]),
    R.cloth,
    back ? [1, 2, 3] : [1, 3, 4],
    2.4
  );
  // hem trim and the slit
  ctx.fillStyle = rgbStr(R.cloth[0]);
  if (!side) ctx.fillRect(cx - 1, 66 + b, 1.5, 11);
  // belt with a pouch on the hip
  shade(ctx, rrect(cx - tw - 1 + ux, 59 + uy, tw * 2 + 2, 4.5, 1), R.leather, [1, 2, 4], 1);
  if (!back) flat(ctx, rrect(cx - 1.5 + (side ? 5 : 0) + ux, 59.5 + uy, 3.5, 3.5, 1), R.gold[3]);
  shade(ctx, rrect(side ? cx - 9 + ux : cx + tw - 4, 61 + uy, 6, 7, 2), R.leather, [0, 2, 3], 1);

  // arms: indigo upper arm, undyed rolled sleeve, hand
  if (!side) {
    for (const k of [-1, 1]) {
      const ax = cx + k * (tw + 1.5) - 3.2;
      const sy = k * swing;
      shade(ctx, rrect(ax, 42 + b + Math.min(0, sy) * 0.5, 6.5, 13, 3), R.cloth, k < 0 ? [1, 3, 4] : [1, 2, 3], 1.3);
      shade(ctx, rrect(ax + k * 0.5, 53 + b + sy * 0.4, 6, 10, 3), R.cream, k < 0 ? [1, 3, 4] : [1, 2, 3], 1.3);
      flat(ctx, ell(ax + 3.2 + k * 0.5, 64.5 + b + sy * 0.6, 3.3, 3.3), R.skin[k < 0 ? 3 : 2]);
    }
  } else {
    shade(ctx, rrect(cx - 3 + swing + ux, 43 + uy, 6.5, 12, 3), R.cloth, [1, 3, 4], 1.3);
    shade(ctx, rrect(cx - 3 + swing * 1.3 + ux, 53 + uy, 6, 10, 3), R.cream, [1, 3, 4], 1.3);
    flat(ctx, ell(cx + swing * 1.4 + ux, 64.5 + uy, 3.4, 3.4), R.skin[3]);
  }

  // scarf collar: the break between head and body
  shade(ctx, rrect(cx - 9.5 + ux, 35 + uy, 19, 8, 4), R.rust, [1, 3, 5], 1.4);
  if (!back) flat(ctx, poly([[cx + 1 + ux, 41 + uy], [cx + 5 + ux, 41 + uy], [cx + 4 + ux, 46 + uy]]), R.rust[2]);

  // head
  const hx = cx + ux + (side ? 2 : 0), hy = 24 + uy;
  const H = R.chestnut;
  // tied tail: a short brush behind the head that swings
  const tail = () => {
    const tx = side ? hx - 11 : hx + (back ? 0 : 0), ty = side ? hy - 3 : hy - 2;
    const a = (side ? Math.PI * 0.72 : Math.PI * 0.5) + sway * 0.16 + (side ? wind * 0.12 : 0);
    const L2 = 8.5 + wind * 1.5;
    const ex = tx + Math.cos(a) * L2, ey = ty + Math.sin(a) * L2;
    const px = -Math.sin(a), py = Math.cos(a);
    shade(ctx, poly([[tx + px * 3, ty + py * 3], [ex + px * 2.5, ey + py * 2.5], [ex + Math.cos(a) * 3, ey + Math.sin(a) * 3], [ex - px * 2.5, ey - py * 2.5], [tx - px * 3, ty - py * 3]]), H, [1, 2, 4], 1.2);
    flat(ctx, ell(tx, ty, 2.2, 2.2), R.leather[2]);
  };
  if (side || !back) tail();

  // hair underlayer behind the face (gives the head depth)
  if (!back) {
    const ul = side
      ? [[hx - 12, hy + 10], [hx - 13, hy - 4], [hx - 5, hy - 13], [hx + 6, hy - 12], [hx + 4, hy + 2], [hx - 4, hy + 12]]
      : [[hx - 13, hy + 10], [hx - 14, hy - 5], [hx, hy - 14], [hx + 14, hy - 5], [hx + 13, hy + 10], [hx + 9, hy + 6], [hx - 9, hy + 6]];
    flat(ctx, poly(ul), H[1]);
    // face
    shade(ctx, ell(hx + (side ? 1 : 0), hy + 1, side ? 10 : 11, 11.5), R.skin, [2, 3, 4], 2.2);
    if (side) flat(ctx, poly([[hx + 9, hy + 1], [hx + 13, hy + 4], [hx + 9.5, hy + 5]]), R.skin[3]);
    // ear
    if (side) shade(ctx, ell(hx - 2, hy + 2, 2.4, 3), R.skin, [2, 3, 4], 0.8);
  }

  // hair: a crown of separate locks with a ragged fringe
  const locks = [];
  if (back) {
    // seen from behind: whole head is hair, ending in hanging locks at the nape
    const pts = [];
    for (let k = 0; k <= 10; k++) {
      const a = Math.PI * (1 + k / 10);
      const r = 14 + (k % 2 ? 1.6 : -0.4) + (k === 6 ? 2.5 : 0);
      pts.push([hx + Math.cos(a) * r, hy - 2 + Math.sin(a) * r * 0.95]);
    }
    const nape = [[hx + 14, hy + 2], [hx + 12, hy + 11], [hx + 8, hy + 8], [hx + 5, hy + 13], [hx + 1, hy + 9], [hx - 3, hy + 13], [hx - 7, hy + 8], [hx - 11, hy + 12], [hx - 14, hy + 3]];
    locks.push([...pts, ...nape]);
  } else if (side) {
    // facing right: fringe over the brow, crown sweeping back to a ragged nape
    locks.push([
      [hx + 11, hy - 2], [hx + 8, hy - 1], [hx + 8.5, hy + 2], [hx + 5, hy - 2], [hx + 3, hy + 1], [hx + 1, hy - 3],
      [hx - 1, hy + 4], [hx - 4, hy + 2], [hx - 6, hy + 9], [hx - 9, hy + 6], [hx - 12, hy + 11], [hx - 14, hy + 4],
      [hx - 15, hy - 5], [hx - 10, hy - 13], [hx - 3, hy - 16], [hx + 1, hy - 18.5], [hx + 3, hy - 15], [hx + 9, hy - 13], [hx + 13, hy - 7],
    ]);
  } else {
    // facing the camera: parted fringe, locks falling to the brow and over the ears
    locks.push([
      [hx - 13.5, hy + 9], [hx - 14.5, hy - 3], [hx - 12, hy - 11], [hx - 6, hy - 15.5], [hx - 1, hy - 14], [hx + 2, hy - 17.5],
      [hx + 5, hy - 14.5], [hx + 11, hy - 12], [hx + 14.5, hy - 4], [hx + 13.5, hy + 9],
      [hx + 11, hy + 3], [hx + 10, hy - 1], [hx + 7, hy + 1], [hx + 6, hy - 4], [hx + 3, hy - 0.5], [hx + 1, hy - 6],
      [hx - 2, hy - 1], [hx - 4, hy - 5], [hx - 7, hy + 1.5], [hx - 9, hy - 2], [hx - 11, hy + 3],
    ]);
  }
  for (const l of locks) shade(ctx, poly(l), H, [1, 3, 5], 2.2);
  // a few dark strand lines break the mass into locks
  const strand = (x0, y0, x1, y1) => flat(ctx, poly([[x0, y0], [x0 + 1.3, y0], [x1 + 0.6, y1], [x1, y1]]), H[1]);
  if (back) { strand(hx - 5, hy - 8, hx - 7, hy + 5); strand(hx + 1, hy - 10, hx, hy + 3); strand(hx + 6, hy - 7, hx + 8, hy + 4); }
  else if (side) { strand(hx - 2, hy - 13, hx - 7, hy - 4); strand(hx + 3, hy - 12, hx - 1, hy - 5); }
  else { strand(hx - 3, hy - 13, hx - 7, hy - 5); strand(hx + 4, hy - 13, hx + 7, hy - 6); }
  if (back) tail();

  // face
  if (!back) {
    const shut = pose.wince;
    ctx.fillStyle = rgbStr(R.ink[0]);
    if (side) {
      if (shut) ctx.fillRect(hx + 4.5, hy + 3, 3, 1.4);
      else { ctx.fillRect(hx + 5, hy + 1.5, 2.2, 4); ctx.fillStyle = rgbStr(R.cream[5]); ctx.fillRect(hx + 5.6, hy + 2, 0.9, 0.9); }
    } else {
      if (shut) { ctx.fillRect(hx - 6.5, hy + 3, 3, 1.4); ctx.fillRect(hx + 3.5, hy + 3, 3, 1.4); }
      else {
        ctx.fillRect(hx - 6, hy + 1.5, 2.2, 4.2);
        ctx.fillRect(hx + 4, hy + 1.5, 2.2, 4.2);
        ctx.fillStyle = rgbStr(R.cream[5]);
        ctx.fillRect(hx - 5.6, hy + 2, 0.9, 0.9);
        ctx.fillRect(hx + 4.4, hy + 2, 0.9, 0.9);
      }
      ctx.fillStyle = rgbStr(R.skin[1]);
      ctx.fillRect(hx - 1, hy + 8.5, 3, 1);
    }
  }
  // sword hilt over the shoulder when sheathed
  if (!sword) {
    if (back) shade(ctx, poly([[cx + 5, 40 + b], [cx + 11, 31 + b], [cx + 13.5, 33 + b], [cx + 7.5, 42 + b]]), R.leather, [1, 2, 3], 1);
    else if (side) flat(ctx, rrect(cx - 12 + ux, 33 + uy, 3, 8, 1), R.gold[2]);
  }
  if (sword && !sword.behind) drawSword();
  return finish(ctx, { outline: [30, 22, 20] });
}

function heroFrames() {
  const out = {};
  for (const dir of ['down', 'up', 'side']) {
    const side = dir === 'side';
    const walk = [0, 1, 2, 3].map((f) => {
      const s = [1, 0, -1, 0][f];
      return heroFrame(dir, {
        bob: f % 2 ? -1.5 : 0.5,
        lift: side ? [Math.max(0, s) * 3, Math.max(0, -s) * 3] : [s > 0 ? 4 : 0, s < 0 ? 4 : 0],
        swing: s * 5,
        stride: s * 5,
        lean: side ? 1 : 0,
        sway: [1, 0, -1, 0][(f + 1) % 4] * 1.4,
        wind: 0.5,
      });
    });
    const idle = [0, 1].map((f) => heroFrame(dir, { bob: f ? -1 : 0, sway: f ? 0.6 : -0.4 }));
    // jump: rising (legs tucked, hair and scarf trailing down), falling (legs reaching, hair lifted)
    const jump = [
      heroFrame(dir, { bob: -2, lift: [7, 3], swing: -7, stride: 3, sway: 2, wind: 0.6 }),
      heroFrame(dir, { bob: -1, lift: [2, 4], swing: 4, stride: -2, sway: -2.5, wind: 1 }),
    ];
    // dash: low and leaning hard, scarf and hair stream flat behind
    const dash = [heroFrame(dir, { bob: 2, lift: [4, 0], swing: -6, stride: 6, lean: side ? 4 : 0, sway: side ? -1 : 1, wind: 2 })];
    const hurt = [heroFrame(dir, { bob: 1.5, swing: 7, lift: [3, 0], lean: side ? -3 : 0, sway: 2.5, wind: 1, wince: true })];
    // attack: wind-up, strike, follow-through
    const atk = [0, 1, 2].map((f) => {
      let sword;
      if (dir === 'down') sword = [{ x: 52, y: 44, ang: -2.4, len: 22 }, { x: 46, y: 70, ang: 1.75, len: 26 }, { x: 22, y: 70, ang: 2.3, len: 24 }][f];
      if (dir === 'up') sword = [{ x: 20, y: 50, ang: -0.6, len: 22, behind: true }, { x: 38, y: 30, ang: -1.55, len: 26, behind: true }, { x: 54, y: 40, ang: -1.0, len: 24, behind: true }][f];
      if (side) sword = [{ x: 28, y: 44, ang: -2.0, len: 22, behind: true }, { x: 47, y: 60, ang: -0.1, len: 26 }, { x: 45, y: 70, ang: 0.8, len: 24 }][f];
      return heroFrame(dir, {
        sword,
        bob: [1.5, -0.5, 0.5][f],
        swing: f === 1 ? 6 : -4,
        stride: side ? [-3, 5, 4][f] : 0,
        lift: [0, f === 1 ? 2 : 0],
        lean: side ? [-2, 3, 2][f] : 0,
        sway: [-1.5, 2, 1][f],
        wind: f === 1 ? 1 : 0.3,
      });
    });
    out[dir] = { walk, idle, jump, dash, hurt, atk };
  }
  return out;
}

// ------------------------------------------------------------ moss slime
function slimeFrame(w, h, opts = {}) {
  const ctx = frame(64, 56);
  const cx = 32, gy = 52;
  const top = gy - h;
  shade(ctx, (c, nb) => {
    if (!nb) c.beginPath();
    c.moveTo(cx - w / 2, gy);
    c.bezierCurveTo(cx - w / 2 - 2, top + h * 0.35, cx - w * 0.3, top, cx, top);
    c.bezierCurveTo(cx + w * 0.3, top, cx + w / 2 + 2, top + h * 0.35, cx + w / 2, gy);
    c.closePath();
  }, R.slime, [2, 4, 5], 3.5);
  // inner shimmer and specular, restrained
  flat(ctx, ell(cx - w * 0.18, top + h * 0.28, w * 0.1, h * 0.08, -0.5), R.slime[6]);
  // moss sprout on the crown
  shade(ctx, ell(cx + 3, top + 2, 7, 4, -0.2), R.moss, [2, 4, 5], 1.5);
  shade(ctx, ell(cx - 3, top + 1, 4, 3, 0.4), R.moss, [3, 4, 5], 1);
  // eyes
  if (!opts.closed) {
    for (const k of [-1, 1]) {
      flat(ctx, ell(cx + k * w * 0.17, top + h * 0.5, 2.6, 3.6), R.ink[0]);
      flat(ctx, ell(cx + k * w * 0.17 - 0.8, top + h * 0.5 - 1.2, 0.9, 0.9), R.cream[5]);
    }
  } else {
    ctx.fillStyle = rgbStr(R.ink[0]);
    for (const k of [-1, 1]) ctx.fillRect(cx + k * w * 0.17 - 3, top + h * 0.5, 6, 1.5);
  }
  return finish(ctx, { outline: [12, 20, 22] });
}

function slimeFrames() {
  return {
    idle: [slimeFrame(40, 26), slimeFrame(37, 29)],
    hop: [slimeFrame(46, 21), slimeFrame(30, 38), slimeFrame(42, 25)],
    hurt: [slimeFrame(44, 24, { closed: true })],
  };
}

// ------------------------------------------------------------ foliage
// Leaf masses are built from hundreds of small lit dabs; the lighting comes from
// treating the mass as a lumpy sphere lit from the upper left.
function leafMass(w, h, seed, { ramp = R.leaf, density = 1, lumps = 7, dark = 0 } = {}) {
  const ctx = frame(w, h);
  const r = mulberry32(seed);
  const cx = w / 2, cy = h * 0.54;
  const m = Math.min(w, h);
  // the mass is built from leaf clusters: each a small shaded ball with a
  // scalloped rim, stacked top to bottom so every lower cluster shows a lit
  // upper edge against the shadowed one behind it
  const lobes = [];
  const count = Math.round(lumps * 3.2);
  for (let i = 0; i < count; i++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.7);
    const rad = (0.13 + r() * 0.08) * m * (1.1 - d * 0.3);
    const x = cx + Math.cos(a) * d * (w * 0.5 - rad * 1.05);
    const y = cy + Math.sin(a) * d * (h * 0.46 - rad * 1.0);
    lobes.push([x, y, rad]);
  }
  lobes.sort((p, q) => p[1] - q[1]);
  const pick = (v) => ramp[Math.max(0, Math.min(ramp.length - 1, Math.round(v * (ramp.length - 1))))];
  for (const [lx, ly, rad] of lobes) {
    // where the cluster sits in the crown: top-left catches the sun
    const g = -((ly - cy) / h) * 1.0 - ((lx - cx) / w) * 0.45;
    // scalloped silhouette in the cluster's shadow tone
    const base = 0.2 + g * 0.3 - dark;
    flat(ctx, ell(lx, ly, rad, rad * 0.86), pick(base));
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * Math.PI * 2 + r() * 0.5;
      flat(ctx, ell(lx + Math.cos(a) * rad * 0.92, ly + Math.sin(a) * rad * 0.8, rad * 0.26, rad * 0.22, a), pick(base + (Math.sin(a) < 0 ? 0.05 : -0.05)));
    }
    // leaf dabs, lit by the cluster's own pseudo-normal
    const n = Math.floor(rad * rad * 0.55 * density);
    for (let i = 0; i < n; i++) {
      const a = r() * Math.PI * 2, d = Math.sqrt(r()) * rad;
      const x = lx + Math.cos(a) * d, y = ly + Math.sin(a) * d * 0.86;
      const nx = (x - lx) / rad, ny = (y - ly) / rad;
      const nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lit = -nx * 0.5 - ny * 0.75 + nz * 0.35;
      const v = 0.34 + lit * 0.42 + g * 0.32 + (r() - 0.5) * 0.14 - dark;
      flat(ctx, ell(x, y, 1.6 + r() * 2.4, 1.2 + r() * 1.4, r() * Math.PI), pick(v));
    }
  }
  return ctx;
}

function bush(seed, w = 110, h = 84, opts) {
  const ctx = leafMass(w, h, seed, { lumps: 6, ...opts });
  return finish(ctx, { outline: [12, 20, 15] });
}

function canopy(seed, w = 190, h = 150, opts) {
  const ctx = leafMass(w, h, seed, { lumps: 9, density: 1.1, ...opts });
  return finish(ctx, { outline: [10, 16, 13] });
}

function fern(seed, w = 104, h = 70) {
  const ctx = frame(w, h);
  const r = mulberry32(seed);
  const bx = w / 2, by = h - 3;
  const fronds = 9 + Math.floor(r() * 4);
  const list = [];
  for (let i = 0; i < fronds; i++) list.push(-Math.PI * 0.95 + (i / (fronds - 1)) * Math.PI * 0.9 + (r() - 0.5) * 0.15);
  // draw back fronds first (those pointing up), front ones last
  list.sort((a, b) => Math.abs(b + Math.PI / 2) - Math.abs(a + Math.PI / 2));
  list.reverse();
  for (const ang of list) {
    const len = (0.7 + r() * 0.3) * (Math.abs(ang + Math.PI / 2) < 0.6 ? h * 0.95 : w * 0.48);
    const droop = 0.9 + r() * 0.5;
    const pts = [];
    for (let t = 0; t <= 1.0001; t += 0.06) {
      const x = bx + Math.cos(ang) * len * t;
      const y = by + Math.sin(ang) * len * t + t * t * len * 0.45 * droop;
      pts.push([x, y, t]);
    }
    const facing = Math.cos(ang) < 0 ? 1 : 0; // left side catches more light
    for (let k = 1; k < pts.length; k++) {
      const [x, y, t] = pts[k];
      const [px, py] = pts[k - 1];
      const dx = x - px, dy = y - py, dl = Math.hypot(dx, dy) || 1;
      const nx = -dy / dl, ny = dx / dl;
      const lw = (1 - t) * 7 + 1.5;
      for (const s of [-1, 1]) {
        const lx = x + nx * s * lw, ly = y + ny * s * lw + 1.5;
        const lit = (s * ny < 0 ? 1 : 0) + facing * 0.6 + (1 - t) * 0.3;
        const idx = Math.max(1, Math.min(6, Math.round(2 + lit * 1.6 + r() * 0.8)));
        ctx.strokeStyle = rgbStr(R.leaf[idx]);
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(lx, ly);
        ctx.stroke();
      }
      ctx.strokeStyle = rgbStr(R.leaf[2]);
      ctx.lineWidth = 1.4;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(x, y);
      ctx.stroke();
    }
  }
  return finish(ctx, { outline: [12, 20, 15] });
}

function grassTuft(seed, w = 46, h = 30, ramp = R.grass) {
  const ctx = frame(w, h);
  const r = mulberry32(seed);
  const n = 14 + Math.floor(r() * 8);
  for (let i = 0; i < n; i++) {
    const x = w * 0.2 + r() * w * 0.6, len = h * (0.45 + r() * 0.5);
    const lean = (x - w / 2) * 0.5 + (r() - 0.5) * 8;
    const idx = Math.round(2 + r() * (ramp.length - 3));
    ctx.fillStyle = rgbStr(ramp[idx]);
    ctx.beginPath();
    ctx.moveTo(x - 1.8, h);
    ctx.quadraticCurveTo(x + lean * 0.3, h - len * 0.6, x + lean, h - len);
    ctx.quadraticCurveTo(x + lean * 0.3 + 1, h - len * 0.6, x + 1.8, h);
    ctx.fill();
  }
  return finish(ctx, { outline: [16, 24, 17] });
}

function reeds(seed, w = 44, h = 92) {
  const ctx = frame(w, h);
  const r = mulberry32(seed);
  for (let i = 0; i < 11; i++) {
    const x = 8 + r() * (w - 16), len = h * (0.55 + r() * 0.42);
    const lean = (r() - 0.5) * 12;
    ctx.strokeStyle = rgbStr(R.grassDry[2 + Math.floor(r() * 3)]);
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, h);
    ctx.quadraticCurveTo(x, h - len * 0.5, x + lean, h - len);
    ctx.stroke();
    if (r() < 0.45) shade(ctx, rrect(x + lean - 2.2, h - len - 2, 4.4, 11, 2), R.bark, [2, 3, 4], 1);
  }
  return finish(ctx, { outline: [20, 22, 16] });
}

function flowers(seed, col) {
  const ctx = frame(40, 30);
  const r = mulberry32(seed);
  for (let i = 0; i < 7; i++) {
    const x = 8 + r() * 24, y = 10 + r() * 14;
    ctx.strokeStyle = rgbStr(R.grass[3]);
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(x, 30);
    ctx.lineTo(x + (r() - 0.5) * 4, y);
    ctx.stroke();
    flat(ctx, ell(x, y, 2.6, 2.2), col[4]);
    flat(ctx, ell(x - 0.6, y - 0.6, 1.2, 1), col[5]);
  }
  return finish(ctx, { outline: [18, 24, 18] });
}

function vines(seed, w = 40, h = 150) {
  const ctx = frame(w, h);
  const r = mulberry32(seed);
  for (let s = 0; s < 4; s++) {
    let x = 6 + r() * (w - 12);
    const len = h * (0.4 + r() * 0.58);
    for (let y = 0; y < len; y += 2.5) {
      x += Math.sin(y * 0.08 + s) * 0.5;
      const fade = 1 - y / len;
      if (r() < 0.75) {
        const side = r() < 0.5 ? -1 : 1;
        const idx = Math.max(1, Math.min(6, Math.round(2 + fade * 2.5 + (side < 0 ? 1 : 0) + r())));
        flat(ctx, ell(x + side * 3, y, 3 * (0.6 + fade * 0.5), 1.8, side * 0.6), R.leaf[idx]);
      }
      ctx.fillStyle = rgbStr(R.leaf[1]);
      ctx.fillRect(x - 0.6, y, 1.3, 2.6);
    }
  }
  return finish(ctx, { outline: [10, 16, 13] });
}

// grass hanging over a cliff lip, drawn as a strip to lay along wall tops
function grassLip(seed, w = 128, h = 34) {
  const ctx = frame(w, h);
  const r = mulberry32(seed);
  flat(ctx, rrect(0, 0, w, 6, 0), R.grass[3]);
  for (let i = 0; i < 70; i++) {
    const x = r() * w, len = 6 + r() * (h - 8) * (0.4 + 0.6 * r());
    const idx = Math.round(1 + r() * 4);
    ctx.fillStyle = rgbStr(R.grass[idx]);
    ctx.beginPath();
    ctx.moveTo(x - 2.5, 3);
    ctx.quadraticCurveTo(x + (r() - 0.5) * 3, len * 0.6, x + (r() - 0.5) * 6, len);
    ctx.quadraticCurveTo(x + 1, len * 0.5, x + 2.5, 3);
    ctx.fill();
  }
  return finish(ctx, { outline: [14, 20, 14] });
}

function ivy(seed, w = 96, h = 80) {
  const ctx = leafMass(w, h, seed, { ramp: R.leafCool, lumps: 8, density: 0.8 });
  return finish(ctx, { outline: [10, 16, 15] });
}

function mushrooms(seed) {
  const ctx = frame(36, 26);
  const r = mulberry32(seed);
  for (let i = 0; i < 4; i++) {
    const x = 7 + r() * 22, s = 3 + r() * 3, y = 26 - s * 1.6 - r() * 3;
    flat(ctx, rrect(x - 1.2, y, 2.4, 26 - y, 1), R.cream[3]);
    shade(ctx, ell(x, y, s * 1.3, s * 0.8), R.cream, [2, 4, 5], 1);
  }
  return finish(ctx, { outline: [24, 22, 18] });
}

// ------------------------------------------------------------ props
function statue() {
  const ctx = frame(96, 176);
  const L = R.lime, M = R.moss;
  shade(ctx, rrect(14, 140, 68, 32, 2), L, [2, 4, 5], 2);
  ctx.fillStyle = rgbStr(L[1]);
  ctx.fillRect(14, 150, 68, 2);
  // robed guardian, hands folded on a planted blade
  shade(ctx, poly([[30, 56], [66, 56], [74, 140], [22, 140]]), L, [2, 4, 5], 3.5);
  ctx.fillStyle = rgbStr(L[2]);
  for (const x of [36, 46, 56, 64]) ctx.fillRect(x, 74, 1.6, 64);
  shade(ctx, poly([[28, 60], [48, 42], [68, 60], [64, 74], [32, 74]]), L, [2, 4, 5], 2);
  // hood and shadowed face
  shade(ctx, poly([[34, 46], [36, 22], [48, 12], [60, 22], [62, 46], [56, 54], [40, 54]]), L, [2, 4, 6], 3);
  flat(ctx, ell(48, 38, 9, 11), L[0]);
  flat(ctx, ell(44, 37, 1.6, 1.4), R.indigo[4]);
  flat(ctx, ell(52, 37, 1.6, 1.4), R.indigo[4]);
  // blade
  shade(ctx, poly([[46, 62], [50, 62], [51, 132], [48, 138], [45, 132]]), R.limeCool, [2, 4, 5], 1.5);
  shade(ctx, rrect(39, 60, 18, 6, 2), L, [2, 4, 6], 1.5);
  shade(ctx, ell(48, 70, 11, 6), L, [3, 4, 6], 1.5);
  // chips and moss collected on upward surfaces
  const r = mulberry32(4);
  for (let i = 0; i < 26; i++) flat(ctx, ell(26 + r() * 44, 56 + r() * 84, 1.5 + r() * 3, 1 + r() * 1.5), M[2 + Math.floor(r() * 3)]);
  for (let i = 0; i < 10; i++) flat(ctx, ell(18 + r() * 60, 140 + r() * 3, 2 + r() * 5, 1.5), M[3]);
  flat(ctx, poly([[60, 22], [66, 30], [62, 34]]), L[1]);
  return finish(ctx);
}

function stele() {
  const ctx = frame(56, 120);
  const L = R.lime;
  shade(ctx, rrect(6, 100, 44, 18, 2), L, [2, 3, 5], 2);
  shade(ctx, poly([[12, 102], [14, 18], [28, 6], [42, 18], [44, 102]]), L, [2, 4, 5], 3);
  // indigo-inlaid glyph column
  const g = [[22, 30, 12, 3], [26, 36, 4, 10], [21, 48, 14, 3], [24, 54, 2, 8], [30, 54, 2, 8], [22, 64, 12, 12], [26, 80, 4, 12]];
  for (const [x, y, w, h] of g) {
    flat(ctx, rrect(x, y, w, h, 1), R.indigo[2]);
    flat(ctx, rrect(x, y, w, 1, 0), R.indigo[0]);
  }
  flat(ctx, poly([[40, 20], [44, 30], [41, 34]]), L[1]);
  const r = mulberry32(8);
  for (let i = 0; i < 14; i++) flat(ctx, ell(14 + r() * 28, 70 + r() * 30, 1 + r() * 3, 1 + r()), R.moss[2 + Math.floor(r() * 3)]);
  return finish(ctx);
}

function brazier(f) {
  const ctx = frame(48, 84);
  // three-legged bronze bowl with a small living flame
  for (const [x0, x1] of [[10, 16], [38, 32], [24, 24]]) {
    ctx.strokeStyle = rgbStr(R.gold[1]);
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(x0, 82);
    ctx.lineTo(x1, 52);
    ctx.stroke();
  }
  shade(ctx, poly([[6, 46], [42, 46], [36, 58], [12, 58]]), R.gold, [1, 2, 3], 2);
  flat(ctx, rrect(5, 44, 38, 4, 2), R.gold[3]);
  const fl = [[24, 6 + f * 2, 10], [20, 14 - f, 7], [29, 16 + f, 6]];
  for (const [x, top, wd] of fl) {
    flat(ctx, poly([[x - wd, 46], [x - wd * 0.3, top + 12], [x, top], [x + wd * 0.4, top + 10], [x + wd, 46]]), R.rust[5]);
    flat(ctx, poly([[x - wd * 0.6, 46], [x, top + 10], [x + wd * 0.6, 46]]), R.gold[5]);
  }
  flat(ctx, ell(24, 42, 7, 3), R.cream[5]);
  return finish(ctx, { outline: [30, 18, 12] });
}

function pot(seed, broken = false) {
  const ctx = frame(44, 48);
  if (!broken) {
    shade(ctx, (c, nb) => {
      if (!nb) c.beginPath();
      c.moveTo(14, 8);
      c.lineTo(30, 8);
      c.bezierCurveTo(31, 14, 42, 18, 40, 30);
      c.bezierCurveTo(38, 42, 30, 46, 22, 46);
      c.bezierCurveTo(14, 46, 6, 42, 4, 30);
      c.bezierCurveTo(2, 18, 13, 14, 14, 8);
      c.closePath();
    }, R.rust, [1, 3, 4], 3);
    flat(ctx, rrect(12, 5, 20, 5, 2), R.rust[4]);
    ctx.fillStyle = rgbStr(R.cream[2]);
    ctx.fillRect(6, 24, 33, 2);
    for (let x = 8; x < 38; x += 6) ctx.fillRect(x, 27, 2, 3);
  } else {
    const r = mulberry32(seed);
    for (let i = 0; i < 6; i++) {
      const x = 6 + r() * 30, y = 30 + r() * 14;
      shade(ctx, poly([[x, y], [x + 5 + r() * 4, y + 1], [x + 3, y + 5 + r() * 3]]), R.rust, [1, 3, 4], 1);
    }
  }
  return finish(ctx);
}

function relic(f) {
  const ctx = frame(64, 80);
  // a floating sun-disc seal: gold rim, indigo stone face, slow pulse
  const cy = 34 + Math.sin(f * 1.6) * 2;
  shade(ctx, ell(32, cy, 22, 22), R.gold, [2, 4, 5], 3);
  shade(ctx, ell(32, cy, 15, 15), R.indigo, [1, 3, 4], 2);
  ctx.strokeStyle = rgbStr(R.gold[5]);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(32, cy, 7 + (f % 2), 0, Math.PI * 2);
  ctx.stroke();
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2 + f * 0.2;
    flat(ctx, ell(32 + Math.cos(a) * 19, cy + Math.sin(a) * 19, 1.8, 1.8), R.cream[5]);
  }
  return finish(ctx, { outline: [40, 26, 10] });
}

function heart() {
  const ctx = frame(20, 18);
  shade(ctx, (c, nb) => {
    if (!nb) c.beginPath();
    c.moveTo(10, 16);
    c.bezierCurveTo(-2, 8, 2, 0, 10, 5);
    c.bezierCurveTo(18, 0, 22, 8, 10, 16);
    c.closePath();
  }, R.rust, [2, 4, 5], 1.5);
  return finish(ctx, { outline: [30, 14, 12] });
}

function slash(dir, f) {
  // a pale crescent, not a glowing trail
  const ctx = frame(96, 96);
  ctx.translate(48, 48);
  const base = dir === 'down' ? Math.PI * 0.5 : dir === 'up' ? -Math.PI * 0.5 : 0;
  const a0 = base - 1.2 + f * 0.25, a1 = base + 1.0 + f * 0.25;
  const steps = 18;
  for (let i = 0; i < steps; i++) {
    const t = i / steps;
    const a = a0 + (a1 - a0) * t;
    const w = Math.sin(t * Math.PI) * (7 - f * 2);
    if (w <= 0.4) continue;
    flat(ctx, ell(Math.cos(a) * 34, Math.sin(a) * 34, w, w), t > 0.4 ? R.cream[5] : R.cream[4]);
  }
  return finish(ctx, { outline: null });
}

function puff(f, ramp = R.cream) {
  const ctx = frame(40, 32);
  const r = mulberry32(3);
  for (let i = 0; i < 5; i++) {
    const a = r() * Math.PI * 2, d = 4 + f * 4;
    const rad = 5 - f * 1.4 + r() * 2;
    if (rad > 0.6) flat(ctx, ell(20 + Math.cos(a) * d, 20 + Math.sin(a) * d * 0.5, rad, rad * 0.8), ramp[3 + (i % 2)]);
  }
  return finish(ctx, { outline: null });
}

function splash(f) {
  const ctx = frame(48, 40);
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI * (0.15 + (i / 6) * 0.7);
    const d = 6 + f * 6;
    flat(ctx, ell(24 + Math.cos(a) * d, 34 + Math.sin(a) * d * (1.2 - f * 0.3), 2.4 - f * 0.5, 3 - f * 0.6), R.water[4]);
  }
  flat(ctx, ell(24, 36, 10 + f * 5, 3), R.water[3]);
  return finish(ctx, { outline: null });
}

function butterfly(f) {
  const ctx = frame(16, 12);
  const w = f ? 2 : 6;
  flat(ctx, ell(8 - w / 2, 6, w / 2 + 0.5, 4), R.cream[5]);
  flat(ctx, ell(8 + w / 2, 6, w / 2 + 0.5, 4), R.cream[4]);
  flat(ctx, rrect(7.5, 3, 1, 6, 0), R.ink[0]);
  return finish(ctx, { outline: null });
}

// ------------------------------------------------------------ creatures
// Thornbulb: a rooted seed-spitter. Closed, opening, firing.
function bulbFrame(open, opts = {}) {
  const ctx = frame(72, 80);
  const cx = 36, gy = 76;
  // base leaves
  for (const [a, l] of [[-2.6, 26], [-0.5, 24], [-2.0, 20], [-1.1, 22]]) {
    const ex = cx + Math.cos(a) * l, ey = gy - 4 + Math.sin(a) * l * 0.35;
    shade(ctx, poly([[cx - 3, gy - 2], [ex, ey - 6], [ex + (ex > cx ? 4 : -4), ey], [cx + 3, gy - 1]]), R.leaf, [2, 4, 5], 1.5);
  }
  // stalk
  shade(ctx, rrect(cx - 4, gy - 30, 8, 28, 3), R.moss, [2, 3, 4], 1.5);
  const by = gy - 44 - (opts.lunge ? 4 : 0);
  if (open === 0) {
    shade(ctx, ell(cx, by, 15, 18), R.rust, [1, 3, 4], 3);
    for (const k of [-1, 0, 1]) {
      ctx.strokeStyle = rgbStr(R.rust[1]);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(cx + k * 6, by - 16);
      ctx.quadraticCurveTo(cx + k * 10, by, cx + k * 5, by + 16);
      ctx.stroke();
    }
    // thorns
    for (const [x, y, d] of [[cx - 15, by - 2, -1], [cx + 15, by + 2, 1], [cx - 11, by + 12, -1], [cx + 10, by - 12, 1]])
      flat(ctx, poly([[x, y - 2], [x + d * 6, y], [x, y + 2]]), R.cream[3]);
    flat(ctx, poly([[cx - 4, by - 17], [cx, by - 24], [cx + 4, by - 17]]), R.leaf[4]);
  } else {
    // petals peeled back, a gold seed-core inside
    for (const [a, l] of [[-2.5, 20], [-0.6, 20], [-1.55, 22], [-3.1, 15], [0.0, 15]]) {
      const ex = cx + Math.cos(a) * l, ey = by + Math.sin(a) * l;
      shade(ctx, poly([[cx - 6, by + 4], [ex - 5, ey], [ex, ey - 4], [ex + 5, ey], [cx + 6, by + 4]]), R.rust, [1, 3, 5], 1.5);
    }
    shade(ctx, ell(cx, by + 4, 12, 10), R.rust, [0, 1, 2], 2);
    flat(ctx, ell(cx, by + 3, 7 + open, 6 + open), R.gold[open > 1 ? 5 : 4]);
    flat(ctx, ell(cx - 2, by + 1, 2.5, 2), R.cream[5]);
  }
  return finish(ctx);
}

function seed() {
  const ctx = frame(18, 18);
  shade(ctx, ell(9, 9, 6, 5), R.bark, [1, 3, 5], 1.5);
  flat(ctx, ell(7, 7, 1.6, 1.2), R.gold[5]);
  return finish(ctx, { outline: [20, 12, 8] });
}

// Stone Sentinel: a squat, heavy guardian with a gold mask
function sentinelFrame(pose) {
  const ctx = frame(120, 132);
  const cx = 60, gy = 128;
  const L = R.lime, sq = pose === 'slam' ? 6 : 0, up = pose === 'raise' ? 1 : 0;
  const step = pose === 'walk1' ? 3 : pose === 'walk0' ? -3 : 0;
  // legs: stubby pillars
  shade(ctx, rrect(cx - 26 + step, gy - 30, 18, 30, 4), L, [1, 2, 4], 2);
  shade(ctx, rrect(cx + 8 - step, gy - 30, 18, 30, 4), L, [1, 2, 3], 2);
  // body block, chipped
  const top = 44 + sq;
  shade(ctx, poly([[cx - 34, top + 6], [cx - 26, top - 2], [cx + 28, top - 2], [cx + 36, top + 8], [cx + 32, gy - 24], [cx - 32, gy - 24]]), L, [1, 3, 5], 4);
  ctx.fillStyle = rgbStr(L[1]);
  ctx.fillRect(cx - 30, top + 30, 62, 2);
  ctx.fillRect(cx - 8, top + 2, 2, 28);
  // a carved glyph on the chest
  flat(ctx, rrect(cx - 10, top + 40, 20, 12, 2), R.indigo[1]);
  flat(ctx, rrect(cx - 6, top + 43, 12, 6, 1), R.indigo[up ? 5 : 3]);
  // moss on the shoulders
  const r = mulberry32(7);
  for (let i = 0; i < 18; i++) flat(ctx, ell(cx - 30 + r() * 64, top + r() * 8, 2 + r() * 3, 1.4), R.moss[2 + Math.floor(r() * 3)]);
  // head and mask
  const hy = top - 14 + (up ? -4 : 0);
  shade(ctx, rrect(cx - 16, hy - 14, 32, 26, 5), L, [1, 3, 5], 2.5);
  shade(ctx, poly([[cx - 12, hy - 6], [cx + 12, hy - 6], [cx + 9, hy + 10], [cx, hy + 14], [cx - 9, hy + 10]]), R.gold, [1, 3, 5], 2);
  flat(ctx, rrect(cx - 9, hy - 1, 18, 3, 1), up || pose === 'slam' ? R.cream[5] : R.indigo[1]);
  // arms
  if (up) {
    for (const k of [-1, 1]) {
      shade(ctx, rrect(cx + k * 38 - 9, top - 34, 18, 40, 6), L, k < 0 ? [1, 3, 5] : [1, 2, 4], 2.5);
      shade(ctx, rrect(cx + k * 38 - 12, top - 46, 24, 18, 6), L, [1, 3, 5], 2);
    }
  } else {
    const ay = pose === 'slam' ? 20 : 4;
    for (const k of [-1, 1]) {
      shade(ctx, rrect(cx + k * 40 - 9, top + 2, 18, 40 + ay * 0.5, 6), L, k < 0 ? [1, 3, 5] : [1, 2, 4], 2.5);
      shade(ctx, rrect(cx + k * 40 - 12, top + 38 + ay, 24, 18, 6), L, [1, 3, 5], 2);
    }
  }
  return finish(ctx);
}

function ring() {
  const ctx = frame(128, 128);
  const r = mulberry32(9);
  for (let i = 0; i < 160; i++) {
    const a = r() * Math.PI * 2, d = 50 + r() * 10;
    flat(ctx, ell(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2 + r() * 3, 1.5 + r() * 2), R.cream[3 + Math.floor(r() * 3)]);
  }
  for (let i = 0; i < 60; i++) {
    const a = r() * Math.PI * 2, d = 44 + r() * 6;
    flat(ctx, ell(64 + Math.cos(a) * d, 64 + Math.sin(a) * d, 2, 1.5), R.lime[2]);
  }
  return finish(ctx, { outline: null });
}

// Dusk moth: indigo wings with gold eyespots
function mothFrame(f) {
  const ctx = frame(72, 56);
  const cx = 36, cy = 28;
  const span = [1, 0.62, 0.25][f];
  const lift = [-8, 0, 6][f];
  for (const k of [-1, 1]) {
    shade(ctx, poly([[cx, cy - 2], [cx + k * 32 * span, cy - 16 + lift], [cx + k * 30 * span, cy + 2 + lift * 0.5], [cx + k * 6, cy + 4]]), R.indigo, [1, 3, 4], 2);
    shade(ctx, poly([[cx, cy + 2], [cx + k * 20 * span, cy + 14 + lift * 0.3], [cx + k * 6, cy + 14]]), R.indigo, [0, 2, 3], 1.5);
    if (span > 0.4) {
      flat(ctx, ell(cx + k * 18 * span, cy - 6 + lift * 0.6, 4 * span + 1, 4), R.gold[4]);
      flat(ctx, ell(cx + k * 18 * span, cy - 6 + lift * 0.6, 1.8 * span + 0.6, 2), R.ink[0]);
    }
  }
  shade(ctx, ell(cx, cy + 3, 4, 11), R.bark, [1, 3, 4], 1.5);
  for (const k of [-1, 1]) {
    ctx.strokeStyle = rgbStr(R.bark[2]);
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    ctx.moveTo(cx, cy - 7);
    ctx.quadraticCurveTo(cx + k * 5, cy - 16, cx + k * 9, cy - 15);
    ctx.stroke();
  }
  return finish(ctx, { outline: [14, 14, 26] });
}

// The Root Warden: an antlered guardian of stone and root, gold-masked.
function wardenFrame(pose) {
  const ctx = frame(232, 212);
  const cx = 116, gy = 206;
  const L = R.lime;
  const rear = pose === 'rear', stomp = pose === 'stomp', charge = pose === 'charge';
  const bob = pose === 'idle1' ? 2 : 0;
  const lift = rear ? -22 : stomp ? 8 : 0;
  // hind legs
  shade(ctx, poly([[cx - 52, gy - 70 + bob], [cx - 30, gy - 70 + bob], [cx - 28, gy - 4], [cx - 54, gy - 4]]), R.bark, [1, 2, 3], 3);
  shade(ctx, poly([[cx + 30, gy - 70 + bob], [cx + 52, gy - 70 + bob], [cx + 54, gy - 4], [cx + 28, gy - 4]]), R.bark, [1, 2, 3], 3);
  // body: a mossy stone carapace on a body of roots
  const by = gy - 120 + bob + lift * 0.4;
  shade(ctx, (c, nb) => {
    if (!nb) c.beginPath();
    c.moveTo(cx - 80, by + 60);
    c.bezierCurveTo(cx - 90, by + 10, cx - 50, by - 22, cx, by - 24);
    c.bezierCurveTo(cx + 50, by - 22, cx + 90, by + 10, cx + 80, by + 60);
    c.bezierCurveTo(cx + 60, by + 80, cx - 60, by + 80, cx - 80, by + 60);
    c.closePath();
  }, L, [1, 3, 5], 5);
  // plates of the carapace
  ctx.strokeStyle = rgbStr(L[1]);
  ctx.lineWidth = 2;
  for (const [x0, y0, x1, y1] of [[cx - 60, by + 6, cx - 20, by + 30], [cx + 60, by + 6, cx + 20, by + 30], [cx - 40, by + 44, cx + 40, by + 44], [cx, by - 20, cx, by + 40]]) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  const r = mulberry32(31);
  for (let i = 0; i < 90; i++) {
    const a = r() * Math.PI, d = r();
    flat(ctx, ell(cx + Math.cos(a + Math.PI) * d * 78, by + 8 - Math.sin(a) * d * 26 + r() * 10, 3 + r() * 4, 2 + r() * 2), R.moss[2 + Math.floor(r() * 4)]);
  }
  // roots spilling from under the carapace
  for (let i = 0; i < 9; i++) {
    const x = cx - 70 + i * 17;
    ctx.strokeStyle = rgbStr(R.bark[2 + (i % 2)]);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(x, by + 62);
    ctx.quadraticCurveTo(x + (r() - 0.5) * 20, by + 82, x + (r() - 0.5) * 16, by + 98);
    ctx.stroke();
  }
  // forelegs
  const fl = rear ? -30 : stomp ? 6 : charge ? -8 : 0;
  for (const k of [-1, 1]) {
    shade(ctx, poly([[cx + k * 46 - 12, by + 40], [cx + k * 46 + 12, by + 40], [cx + k * 50 + 12, gy - 6 + fl], [cx + k * 50 - 14, gy - 6 + fl]]), L, k < 0 ? [1, 3, 5] : [1, 2, 4], 3);
    shade(ctx, rrect(cx + k * 50 - 17, gy - 18 + fl, 34, 16, 5), R.bark, [1, 2, 3], 2);
  }
  // head: a long gold mask with indigo eyes, crowned with root-antlers
  const hy = by - 10 + (charge ? 26 : 0) + lift * 0.6;
  for (const k of [-1, 1]) {
    ctx.strokeStyle = rgbStr(R.bark[3]);
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.moveTo(cx + k * 14, hy - 20);
    ctx.quadraticCurveTo(cx + k * 40, hy - 60, cx + k * 70, hy - 66);
    ctx.stroke();
    ctx.lineWidth = 4;
    for (const [t, l] of [[0.45, 22], [0.75, 18]]) {
      const bx = cx + k * (14 + 56 * t), byy = hy - 20 - 46 * t;
      ctx.beginPath();
      ctx.moveTo(bx, byy);
      ctx.lineTo(bx + k * 6, byy - l);
      ctx.stroke();
    }
    flat(ctx, ell(cx + k * 64, hy - 66, 8, 5), R.leaf[4]);
  }
  shade(ctx, poly([[cx - 26, hy - 26], [cx + 26, hy - 26], [cx + 22, hy + 14], [cx, hy + 34], [cx - 22, hy + 14]]), R.gold, [1, 3, 5], 3);
  flat(ctx, poly([[cx - 2, hy - 22], [cx + 2, hy - 22], [cx + 2, hy + 26], [cx - 2, hy + 26]]), R.gold[1]);
  const eye = pose === 'hurt' ? R.cream[5] : rear || charge ? R.cream[4] : R.indigo[4];
  for (const k of [-1, 1]) flat(ctx, poly([[cx + k * 6, hy - 8], [cx + k * 20, hy - 12], [cx + k * 17, hy - 2], [cx + k * 6, hy - 2]]), eye);
  if (stomp) for (let i = 0; i < 8; i++) flat(ctx, ell(cx - 90 + r() * 180, gy - 6 - r() * 10, 4, 3), R.cream[3]);
  return finish(ctx, { outline: [24, 18, 14] });
}

// ------------------------------------------------------------ interactables & fx
function sunstone(lit) {
  const ctx = frame(60, 104);
  const L = R.lime;
  shade(ctx, rrect(8, 86, 44, 16, 2), L, [2, 3, 5], 2);
  shade(ctx, poly([[14, 88], [16, 24], [30, 10], [44, 24], [46, 88]]), L, [2, 4, 5], 3);
  shade(ctx, ell(30, 42, 11, 11), lit ? R.gold : R.indigo, lit ? [3, 4, 5] : [1, 2, 3], 2);
  flat(ctx, ell(30, 42, 5, 5), lit ? R.cream[5] : R.indigo[1]);
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    flat(ctx, rrect(30 + Math.cos(a) * 15 - 1, 42 + Math.sin(a) * 15 - 1, 2.5, 2.5, 0), lit ? R.gold[5] : R.lime[1]);
  }
  const r = mulberry32(4);
  for (let i = 0; i < 10; i++) flat(ctx, ell(18 + r() * 24, 64 + r() * 22, 1.5 + r() * 2, 1), R.moss[3]);
  return finish(ctx);
}

function lever(down) {
  const ctx = frame(44, 60);
  shade(ctx, rrect(8, 40, 28, 18, 3), R.lime, [1, 3, 4], 2);
  ctx.save();
  ctx.translate(22, 44);
  ctx.rotate(down ? 0.9 : -0.9);
  shade(ctx, rrect(-2.5, -30, 5, 30, 2), R.bark, [1, 3, 4], 1);
  shade(ctx, ell(0, -31, 5, 5), R.gold, [2, 4, 5], 1.5);
  ctx.restore();
  return finish(ctx);
}

function chest(open) {
  const ctx = frame(72, 60);
  shade(ctx, rrect(8, 26, 56, 30, 3), R.bark, [1, 3, 4], 2);
  flat(ctx, rrect(8, 36, 56, 4, 0), R.gold[2]);
  if (!open) {
    shade(ctx, (c, nb) => {
      if (!nb) c.beginPath();
      c.moveTo(8, 28);
      c.bezierCurveTo(8, 10, 64, 10, 64, 28);
      c.closePath();
    }, R.bark, [2, 3, 5], 2);
    flat(ctx, rrect(31, 22, 10, 12, 2), R.gold[4]);
  } else {
    shade(ctx, poly([[8, 26], [12, 6], [60, 6], [64, 26]]), R.bark, [1, 2, 3], 2);
    flat(ctx, ell(36, 27, 22, 4), R.gold[5]);
  }
  return finish(ctx);
}

function vessel() {
  const ctx = frame(40, 40);
  shade(ctx, (c, nb) => {
    if (!nb) c.beginPath();
    c.moveTo(20, 35);
    c.bezierCurveTo(0, 22, 4, 4, 20, 12);
    c.bezierCurveTo(36, 4, 40, 22, 20, 35);
    c.closePath();
  }, R.gold, [2, 4, 5], 2);
  shade(ctx, (c, nb) => {
    if (!nb) c.beginPath();
    c.moveTo(20, 29);
    c.bezierCurveTo(8, 21, 10, 10, 20, 16);
    c.bezierCurveTo(30, 10, 32, 21, 20, 29);
    c.closePath();
  }, R.rust, [2, 4, 5], 1.5);
  return finish(ctx, { outline: [40, 24, 10] });
}

function blob() {
  const ctx = frame(64, 32);
  flat(ctx, ell(32, 16, 30, 14), [0, 0, 0]);
  return finish(ctx, { outline: null });
}

function spark(f) {
  const ctx = frame(48, 48);
  const n = 6, l = [14, 20, 12][f];
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + 0.3;
    flat(ctx, poly([[24 + Math.cos(a + 0.25) * 3, 24 + Math.sin(a + 0.25) * 3], [24 + Math.cos(a) * l, 24 + Math.sin(a) * l], [24 + Math.cos(a - 0.25) * 3, 24 + Math.sin(a - 0.25) * 3]]), f === 1 ? R.cream[5] : R.gold[5]);
  }
  flat(ctx, ell(24, 24, 5 - f, 5 - f), R.cream[5]);
  return finish(ctx, { outline: null });
}

function bits(ramp, seed) {
  const ctx = frame(20, 16);
  const r = mulberry32(seed);
  flat(ctx, poly([[4, 8], [10 + r() * 6, 3 + r() * 3], [14, 12]]), ramp[3]);
  flat(ctx, poly([[6, 9], [11, 6], [12, 11]]), ramp[5] ?? ramp[4]);
  return finish(ctx, { outline: null });
}

function glint(f) {
  const ctx = frame(20, 20);
  const l = [4, 8, 5][f];
  flat(ctx, poly([[10, 10 - l], [11, 9], [10 + l, 10], [11, 11], [10, 10 + l], [9, 11], [10 - l, 10], [9, 9]]), R.cream[5]);
  return finish(ctx, { outline: null });
}

function cracks() {
  const ctx = frame(128, 128);
  ctx.strokeStyle = rgbStr(R.ink[0]);
  const r = mulberry32(3);
  const branch = (x, y, a, len, w) => {
    if (len < 6 || w < 0.6) return;
    const ex = x + Math.cos(a) * len, ey = y + Math.sin(a) * len;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(ex, ey);
    ctx.stroke();
    branch(ex, ey, a + (r() - 0.5) * 1.2, len * 0.7, w * 0.75);
    if (r() < 0.6) branch(ex, ey, a + (r() < 0.5 ? 0.9 : -0.9), len * 0.5, w * 0.6);
  };
  for (let k = 0; k < 6; k++) branch(64, 70, (k / 6) * Math.PI * 2, 26, 3);
  return finish(ctx, { outline: null });
}

// a ground moss patch: ragged edge that breaks into dabs, darker where it is
// thickest so it reads as a damp cushion on stone rather than a green decal
function mossPatch(seed, w = 96, h = 72) {
  const ctx = frame(w, h);
  const r = mulberry32(seed);
  const cx = w / 2, cy = h / 2;
  for (let i = 0; i < w * h * 0.16; i++) {
    const a = r() * Math.PI * 2, d = Math.pow(r(), 0.65);
    const wob = 0.75 + 0.25 * Math.sin(a * 3 + seed) + 0.12 * Math.sin(a * 7 + seed * 2);
    const x = cx + Math.cos(a) * d * w * 0.48 * wob, y = cy + Math.sin(a) * d * h * 0.46 * wob;
    if (d > 0.82 && r() < 0.55) continue;
    const v = 0.55 - d * 0.35 + (r() - 0.5) * 0.35 - (y - cy) / h * 0.3;
    const idx = Math.max(0, Math.min(R.moss.length - 1, Math.round(v * (R.moss.length - 1))));
    flat(ctx, ell(x, y, 1.2 + r() * 2.2, 0.9 + r() * 1.4, r() * Math.PI), R.moss[idx]);
  }
  return finish(ctx, { outline: null });
}

// ------------------------------------------------------------ atlas packing
export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const actx = canvas.getContext('2d');
  let x = 2, y = 2, rowH = 0;
  const rects = {};
  const add = (name, c) => {
    if (x + c.width + 2 > ATLAS) {
      x = 2;
      y += rowH + 2;
      rowH = 0;
    }
    actx.drawImage(c, x, y);
    // atlas UVs: v grows upward in GL
    rects[name] = { u: x / ATLAS, v: 1 - (y + c.height) / ATLAS, w: c.width / ATLAS, h: c.height / ATLAS, pw: c.width, ph: c.height };
    x += c.width + 2;
    rowH = Math.max(rowH, c.height);
  };

  const hero = heroFrames();
  for (const dir in hero) for (const anim in hero[dir]) hero[dir][anim].forEach((c, i) => add(`hero.${dir}.${anim}.${i}`, c));
  const slime = slimeFrames();
  for (const anim in slime) slime[anim].forEach((c, i) => add(`slime.${anim}.${i}`, c));
  for (let i = 0; i < 6; i++) add(`canopy.${i}`, canopy(100 + i, 170 + (i % 3) * 20, 136 + (i % 2) * 16));
  for (let i = 0; i < 2; i++) add(`canopyCool.${i}`, canopy(140 + i, 200, 150, { ramp: R.leafCool }));
  for (let i = 0; i < 5; i++) add(`bush.${i}`, bush(200 + i, 96 + (i % 3) * 16, 74 + (i % 2) * 12));
  for (let i = 0; i < 2; i++) add(`bushDry.${i}`, bush(230 + i, 90, 66, { ramp: R.grassDry }));
  for (let i = 0; i < 4; i++) add(`fern.${i}`, fern(300 + i));
  for (let i = 0; i < 6; i++) add(`grass.${i}`, grassTuft(400 + i, 40 + (i % 3) * 8, 26 + (i % 2) * 8, i % 3 === 2 ? R.grassDry : R.grass));
  for (let i = 0; i < 2; i++) add(`reeds.${i}`, reeds(500 + i));
  add('flowers.0', flowers(600, R.cream));
  add('flowers.1', flowers(601, R.indigo));
  for (let i = 0; i < 4; i++) add(`vine.${i}`, vines(700 + i, 40, 110 + i * 25));
  for (let i = 0; i < 4; i++) add(`lip.${i}`, grassLip(800 + i));
  for (let i = 0; i < 3; i++) add(`ivy.${i}`, ivy(900 + i, 90 + i * 14, 70 + i * 10));
  for (let i = 0; i < 2; i++) add(`mush.${i}`, mushrooms(1000 + i));
  add('statue', statue());
  add('stele', stele());
  for (let i = 0; i < 3; i++) add(`brazier.${i}`, brazier(i));
  add('pot', pot(1));
  add('potBroken', pot(2, true));
  for (let i = 0; i < 4; i++) add(`relic.${i}`, relic(i));
  add('heart', heart());
  for (const d of ['down', 'up', 'side']) for (let f = 0; f < 3; f++) add(`slash.${d}.${f}`, slash(d, f));
  for (let f = 0; f < 3; f++) add(`puff.${f}`, puff(f));
  for (let f = 0; f < 3; f++) add(`splash.${f}`, splash(f));
  for (let f = 0; f < 2; f++) add(`fly.${f}`, butterfly(f));
  [0, 1, 2].forEach((o) => add(`bulb.${o}`, bulbFrame(o)));
  add('seed', seed());
  for (const p of ['walk0', 'walk1', 'raise', 'slam', 'idle']) add(`sentinel.${p}`, sentinelFrame(p));
  add('ring', ring());
  for (let f = 0; f < 3; f++) add(`moth.${f}`, mothFrame(f));
  for (const p of ['idle0', 'idle1', 'rear', 'charge', 'stomp', 'hurt']) add(`warden.${p}`, wardenFrame(p));
  add('sunstone.0', sunstone(false));
  add('sunstone.1', sunstone(true));
  add('lever.0', lever(false));
  add('lever.1', lever(true));
  add('chest.0', chest(false));
  add('chest.1', chest(true));
  add('vessel', vessel());
  add('blob', blob());
  for (let f = 0; f < 3; f++) add(`spark.${f}`, spark(f));
  for (let f = 0; f < 3; f++) add(`leaf.${f}`, bits(R.leaf, 50 + f));
  for (let f = 0; f < 3; f++) add(`chip.${f}`, bits(R.lime, 60 + f));
  for (let f = 0; f < 3; f++) add(`glint.${f}`, glint(f));
  add('cracks', cracks());
  for (let i = 0; i < 3; i++) add(`moss.${i}`, mossPatch(700 + i, 88 + i * 12, 66 + i * 8));

  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  return { tex, rects, canvas };
}

export const HERO_SIZE = [HW / PX_PER_UNIT, HH / PX_PER_UNIT];
export { bayer };

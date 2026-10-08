// Hand-picked colour ramps (dark -> light). Every texture and sprite is
// quantised onto these, which is what keeps 2D and 3D surfaces in one family.
// Shadows lean cool, highlights lean warm.

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const ramp = (...hs) => hs.map(hex);

export const R = {
  lime: ramp('#24232a', '#3a3433', '#564a40', '#74634f', '#927d62', '#ad9775', '#c5b08b', '#dccaa3'),
  limeCool: ramp('#1f2128', '#30313a', '#47454a', '#625c58', '#7e7568', '#998d79'),
  rock: ramp('#18191e', '#25262c', '#363537', '#4b4741', '#625b51', '#7a7162', '#938875'),
  moss: ramp('#18221b', '#233021', '#334227', '#47552f', '#5e6a39', '#788046'),
  grass: ramp('#18231c', '#213022', '#2e3f28', '#3e502e', '#526236', '#68733f', '#80864b'),
  grassDry: ramp('#252621', '#363629', '#4b4a33', '#625d3d', '#7b7348', '#958a56'),
  dirt: ramp('#1f1b19', '#2f2823', '#43382e', '#5a4b3b', '#725f49', '#8b7558'),
  bed: ramp('#141c22', '#1d2a31', '#283a40', '#36494c', '#4a5b58', '#5f6c63'),
  bark: ramp('#16130f', '#241e18', '#352b22', '#4a3c2e', '#615040', '#7a6852'),
  leaf: ramp('#101a14', '#18261b', '#223420', '#2f4427', '#40552f', '#556638', '#6c7843', '#878c52'),
  leafCool: ramp('#0e1618', '#15211f', '#1d2e27', '#283c2e', '#364b35', '#485c3e'),
  indigo: ramp('#15162a', '#1f2240', '#2c3359', '#3e4877', '#56629a', '#7682b5'),
  gold: ramp('#3b2a12', '#5c4318', '#82601f', '#a8822c', '#cca447', '#e8c873'),
  skin: ramp('#3a2620', '#5e3d30', '#8a5d45', '#b08060', '#cfa27d', '#e6c19a'),
  hair: ramp('#2a1d12', '#4a3318', '#715022', '#977030', '#b89147', '#d4b267'),
  rust: ramp('#2a1514', '#45201b', '#652e22', '#86402b', '#a45a38', '#bf7a4c'),
  cloth: ramp('#1a1c2a', '#262a40', '#343c58', '#465273', '#5e6b8e', '#7f8aa8'),
  cream: ramp('#3b352c', '#5d5546', '#827860', '#a69b7d', '#c6bb98', '#e0d6b3'),
  leather: ramp('#1e1611', '#33251b', '#4b3626', '#654933', '#7f5e42'),
  steel: ramp('#1c1e24', '#33373f', '#50565f', '#727a82', '#9aa2a6', '#c9cfcc'),
  slime: ramp('#101a1f', '#172a2e', '#1f3d3c', '#2c534c', '#3e6b5a', '#56856a', '#7aa07c'),
  water: ramp('#121c25', '#182834', '#203544', '#2b4653', '#3b5a64'),
  ink: ramp('#120f12', '#1c171a'),
};

const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5].map((v) => v / 16 - 0.5);

export function bayer(x, y) {
  return BAYER[(y & 3) * 4 + (x & 3)];
}

// Pick a ramp colour for value v in [0,1] with ordered dithering between steps.
// `dither` controls how much of each step boundary is dithered (0 = hard bands).
export function rampColor(r, v, x, y, dither = 0.8) {
  const n = r.length;
  let f = v * (n - 1) + bayer(x, y) * dither;
  let i = Math.round(f);
  if (i < 0) i = 0;
  if (i > n - 1) i = n - 1;
  return r[i];
}

export function rgbStr(c, a = 1) {
  return a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`;
}

export function mix(a, b, t) {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

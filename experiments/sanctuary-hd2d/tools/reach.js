// Coarse reachability check for the maps: BFS over tile surfaces with the
// hero's walk/step/jump limits. Run with `node tools/reach.js`.
import { buildOverworld, buildShrine, terrainHeight } from '../src/level.js';

const STEP = 0.36, JUMP = 1.1;

function surfaces(L, solids, x, z) {
  const cx = x + 0.5, cz = z + 0.5;
  const out = [terrainHeight(L, cx, cz)];
  for (const s of solids) if (cx > s.x0 && cx < s.x1 && cz > s.z0 && cz < s.z1 && s.y1 < 50) out.push(s.y1);
  return out;
}
function headBlocked(solids, x, z, y) {
  const cx = x + 0.5, cz = z + 0.5;
  return solids.some((s) => cx > s.x0 && cx < s.x1 && cz > s.z0 && cz < s.z1 && s.y0 < y + 1.35 && s.y1 > y + STEP);
}

function reach(L, start, openGates = []) {
  const solids = L.solids.filter((s) => !openGates.includes(s.id)).concat(L.gates.filter((g) => !openGates.includes(g.id) && !g.open));
  const seen = new Map();
  const key = (x, z, y) => `${x},${z},${y.toFixed(2)}`;
  const q = [];
  const sx = Math.floor(start.x), sz = Math.floor(start.z);
  const y0 = terrainHeight(L, start.x, start.z);
  q.push([sx, sz, y0]);
  seen.set(key(sx, sz, y0), true);
  const visited = new Set();
  while (q.length) {
    const [x, z, y] = q.shift();
    visited.add(`${x},${z}`);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      for (let dist = 1; dist <= 3; dist++) {
        const nx = x + dx * dist, nz = z + dz * dist;
        if (nx < 0 || nz < 0 || nx >= L.W || nz >= L.D) break;
        for (const ny of surfaces(L, solids, nx, nz)) {
          let okMove;
          if (dist === 1) okMove = ny <= y + JUMP;
          else {
            // gap jump: all tiles in between must be lower than both ends
            let lowMid = true;
            for (let k = 1; k < dist; k++) {
              const m = Math.max(...surfaces(L, solids, x + dx * k, z + dz * k));
              if (m > Math.min(y, ny) - 0.5) lowMid = false;
            }
            okMove = lowMid && ny <= y + 0.2 && (dist === 2 || ny <= y - 0.5);
          }
          if (!okMove || headBlocked(solids, nx, nz, ny)) continue;
          const k2 = key(nx, nz, ny);
          if (seen.has(k2)) continue;
          seen.set(k2, true);
          q.push([nx, nz, ny]);
        }
      }
    }
  }
  return visited;
}

function report(L, start, targets, open) {
  const v = reach(L, start, open);
  for (const [name, x, z] of targets) console.log(`${L.id} [${open.join(',') || 'closed'}] ${name.padEnd(18)} ${v.has(`${Math.floor(x)},${Math.floor(z)}`) ? 'ok' : 'UNREACHABLE'}`);
}

const O = buildOverworld();
const ents = (t) => O.entities.filter((e) => e.type === t).map((e) => [t + (e.id ? ':' + e.id : ''), e.x, e.z]);
const targets = [
  ['lookout', 14.5, 67.5], ['courtyard pool', 22, 49], ['west house', 6.5, 48], ['east terrace', 40, 50],
  ['moat', 40, 42.5], ['outskirts', 21, 38], ['ravine', 10, 21], ['upper court', 16, 6], ['pinnacle', 41, 6],
  ...ents('sunstone'), ...ents('lever'), ...ents('vessel'), ['shrine door', 15.5, 2.2],
];
report(O, O.spawn, targets, []);
report(O, O.spawn, targets, ['grate', 'shrineDoor']);
const S = buildShrine();
report(S, S.spawn, [['hall', 14, 22], ['galleryW', 2, 30], ['secret', 2.5, 15.5], ['boss', 15, 7], ['vista', 15, 0.5]], ['crack', 'vistaDoor']);
report(S, S.spawn, [['secret', 2.5, 15.5], ['vista', 15, 0.5]], []);

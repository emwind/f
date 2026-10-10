// Re-captures the documented screenshot set into docs/screenshots/.
// Needs the folder served on :8123 (npx http-server -p 8123 -c-1 .) and Playwright.
//   NODE_PATH=$(npm root -g) node tools/capture.mjs [namePrefix]
import { createRequire } from 'module';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire((process.env.NODE_PATH || '.') + '/x.js')('playwright')); }
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const only = process.argv[2];
const face = 'const fc=()=>{const g=G.guardian,P=G.player;P.facing=Math.atan2(g.pos.x-P.pos.x,g.pos.z-P.pos.z)};';
const shots = [
  ['01-hero-stair-courtyard', '', 'tp(-2.5,2.2); sim({mz:-1},0.5); sim({},0.4)'],
  ['02-start-south-bank', '', 'sim({mz:-1},0.4); sim({},0.3)'],
  ['03-courtyard-tree', '', 'tp(-8,-2.5); sim({mx:-1},0.3); sim({},0.4)'],
  ['04-combat-windup', '', face + 'tp(-3,-2.0); sim({},1.6); fc(); sim({attack:true},0.12)'],
  ['05-bridge-gorge', '', 'tp(12.5,-6); sim({mx:1},0.3); sim({},0.4)'],
  ['06-gorge-wading', '', 'tp(14,-1); sim({mz:-1},0.5); sim({},0.3)'],
  ['07-shrine-destination', '', 'tp(-2,-13); sim({mz:-1},0.3); sim({},0.5)'],
  ['08-promontory-head', '', 'tp(22,-2); sim({mx:1},0.3); sim({},0.4)'],
  ['09-cmp-toon-off', '', 'tp(-2.5,2.2); sim({mz:-1},0.5); sim({},0.4); G.toggle("KeyT")'],
  ['10-cmp-edges-off', '', 'tp(-2.5,2.2); sim({mz:-1},0.5); sim({},0.4); G.toggle("KeyO")'],
  ['11-cmp-shadows-off', '', 'tp(-2.5,2.2); sim({mz:-1},0.5); sim({},0.4); G.toggle("KeyP")'],
  ['12-cmp-pitch-58', '', 'tp(-2.5,2.2); sim({mz:-1},0.5); sim({},0.4); G.toggle("Digit4"); G.snapCam()'],
  ['13-cmp-pitch-35', '', 'tp(-2.5,2.2); sim({mz:-1},0.5); sim({},0.4); G.toggle("Digit1"); G.snapCam()'],
];
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
for (const [name, q, code] of shots) {
  if (only && !name.startsWith(only)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log(name, 'PAGEERROR', e.message));
  await page.goto('http://localhost:8123/index.html?nohelp&capture&' + q);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
  const info = await page.evaluate((code) => { const G = window.__G, sim = G.sim.bind(G), tp = G.tp.bind(G); eval(code); return G.render(); }, code);
  await page.waitForTimeout(200);
  await page.screenshot({ path: OUT + name + '.jpg', quality: 90, timeout: 120000 });
  await page.close();
  console.log('ok', name, info);
}
await browser.close();

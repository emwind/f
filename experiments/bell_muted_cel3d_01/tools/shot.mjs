// Ad-hoc screenshot: node tools/shot.mjs <out.jpg> "<query>" "<js using G, sim, tp>" [waitMs]
// Needs the folder served on :8123 (npx http-server -p 8123 -c-1 .) and Playwright.
import { createRequire } from 'module';
let chromium;
try { ({ chromium } = await import('playwright')); }
catch { ({ chromium } = createRequire((process.env.NODE_PATH || '.') + '/x.js')('playwright')); } // global install fallback
const [out, q = '', code = '', wait = '700'] = process.argv.slice(2);
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on('pageerror', (e) => console.log('PAGEERROR', e.message));
page.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') console.log('console:', m.text()); });
await page.goto('http://localhost:8123/index.html?nohelp&capture&' + q);
await page.waitForFunction(() => window.__ready === true, null, { timeout: 180000 });
const info = await page.evaluate((code) => { const G = window.__G, sim = G.sim.bind(G), tp = G.tp.bind(G); const r = eval(code); const info = G.render(); return (r === undefined ? '' : JSON.stringify(r) + ' ') + info; }, code);
if (info) console.log(info);
await page.waitForTimeout(+wait);
await page.screenshot({ path: out, quality: 90, timeout: 120000 });
await browser.close();

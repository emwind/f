// Re-captures docs/screenshots. Needs the game served on :8123 and Playwright:
//   npx http-server -p 8123 -c-1 . &  node tools/capture.mjs [prefix]
import { chromium } from 'playwright';
const OUT = new URL('../docs/screenshots/', import.meta.url).pathname;
const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const only = process.argv[2];
const shots = [
  ['01-forest-approach', 'notitle', 'tp(9,79.5); sim({mx:1},0.3); sim({},2)'],
  ['02-forest-arch-bridge', 'notitle', 'tp(14.5,75.5); sim({mz:-1},0.2); sim({},2)'],
  ['03-ruined-courtyard', 'notitle', 'tp(26,55.5); sim({},2)'],
  ['04-sanctuary-waterfall', 'notitle&flags=sun:roof,sun:bridge', 'tp(37.5,7.5); sim({mx:-1},0.2); sim({},2)'],
  ['05-ravine-bridge', 'notitle', 'tp(26,29); sim({mz:-1},0.2); sim({},2)'],
  ['06-combat', 'notitle', 'const e=G.entities.find(e=>e.constructor.name==="Sentinel"); e.update=()=>{}; const P=G.player; P.x=e.x+0.3; P.z=e.z+1.2; P.y=e.y; P.fx=0;P.fz=-1; sim({},0.5); sim({attack:true},0.12)', 120],
  ['07-shrine-hall', 'notitle&map=shrine', 'tp(14.5,29); sim({mz:-1},0.2); sim({},2)'],
  ['08-warden-fight', 'notitle&map=shrine&god', 'tp(14.5,15.2); sim({mz:-1},0.5); sim({},2.2); G.state.maxHp=G.state.hp=5'],
  ['09-hidden-vale', 'notitle&map=vista', 'sim({mz:-1},1.6); sim({},4)', 4000],
  ['10-debug-low-camera', 'notitle&pitch=32', 'tp(20,12); sim({},2); document.getElementById("debug").classList.add("on")'],
];
for (const [name, q, code, extra] of shots) {
  if (only && !name.startsWith(only)) continue;
  const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
  page.on('pageerror', (e) => console.log(name, 'PAGEERROR: ' + e.message));
  await page.goto('http://localhost:8123/index.html?' + q);
  await page.waitForFunction(() => window.__ready === true, null, { timeout: 120000 });
  await page.evaluate((code) => {
    const G = window.__G, sim = G.debugApi.sim;
    const tp = (x, z) => { const P = G.player; P.x = x; P.z = z; P.y = G.collider.ground(x, z, 50); P.vy = 0; };
    eval(code);
    document.getElementById('banner').classList.remove('on');
    document.getElementById('msg').classList.remove('on');
    document.getElementById('help').style.display = 'none';
  }, code);
  await page.waitForTimeout(extra ?? 900);
  await page.screenshot({ path: OUT + name + '.jpg', quality: 90 });
  await page.close();
  console.log('ok', name);
}
await browser.close();

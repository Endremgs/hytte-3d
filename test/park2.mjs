import puppeteer from 'puppeteer-core';
import path from 'node:path';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage(); const e = []; pg.on('pageerror', (x) => e.push(x.message));
await pg.setViewport({ width: 1400, height: 900 });
await pg.goto('file://' + path.resolve('dist/index.html')); await new Promise((r) => setTimeout(r, 6000));
const out = await pg.evaluate((name) => {
  const c = document.getElementById('pOn'); c.checked = true; c.dispatchEvent(new Event('input'));
  const h = window.__hytte, i = h.parking.info;
  const pl = i.poly; const cx = pl.reduce((a, p) => a + p[0], 0) / 4, cy = pl.reduce((a, p) => a + p[1], 0) / 4;
  h.camera.position.set(cx + 13, i.top + 5, -(cy - 9)); h.orbit.target.set(cx, i.top, -cy); h.orbit.update();
  // sjekk terrengmesh-høyde midt på plassen via raycast
  const T = h.scene.getObjectByName('terrain');
  const pos = T.geometry.attributes.position; let best = null;
  for (let k = 0; k < pos.count; k++) { const d = Math.hypot(pos.getX(k) - cx, -pos.getZ(k) - cy); if (!best || d < best.d) best = { d, y: pos.getY(k) }; }
  return { top: i.top, road: i.roadH, cut: i.maxCut, meshAtCenter: best.y, poly: pl.map((p) => p.map((v) => +v.toFixed(1))) };
});
console.log(JSON.stringify(out));
await new Promise((r) => setTimeout(r, 2500));
await pg.screenshot({ path: 'test/park2.png' });
console.log(e.join('\n') || 'no errors'); await b.close();

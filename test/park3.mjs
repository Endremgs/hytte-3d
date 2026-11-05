import puppeteer from 'puppeteer-core';
import path from 'node:path';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage();
await pg.setViewport({ width: 1000, height: 650 });
await pg.goto('file://' + path.resolve('dist/index.html')); await new Promise((r) => setTimeout(r, 6000));
const list = await pg.evaluate(() => {
  const c = document.getElementById('pOn'); c.checked = true; c.dispatchEvent(new Event('input'));
  document.body.classList.add('panel-hidden');
  const h = window.__hytte, i = h.parking.info, pl = i.poly;
  const cx = pl.reduce((a, p) => a + p[0], 0) / 4, cy = pl.reduce((a, p) => a + p[1], 0) / 4;
  h.camera.position.set(cx + 13, i.top + 5, -(cy - 9)); h.orbit.target.set(cx, i.top, -cy); h.orbit.update();
  window.__objs = h.scene.children.filter((o) => o.isMesh || o.isGroup);
  // ray straight down at centre: which objects are hit?
  const { Raycaster, Vector3 } = h.camera.constructor.prototype.constructor === undefined ? {} : {};
  return window.__objs.map((o, k) => `${k}:${o.type}:${o.name}:${o.isMesh ? o.geometry.type : o.children.length}`);
});
console.log(list.join('\n'));
for (const k of [-1, ...list.map((_, i) => i)]) {
  await pg.evaluate((k) => { window.__objs.forEach((o, i) => (o.visible = i !== k)); }, k);
  await new Promise((r) => setTimeout(r, 400));
  await pg.screenshot({ path: `test/dbg_${k}.png` });
}
await b.close();

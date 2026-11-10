// Skjermbilder av appen for raske kontroller: node tools/render/app_shots.mjs N1:oversikt "N4:cx,cy,ch,tx,ty,th:noroof"
// (kamera i lokale koordinater [x øst, y nord, moh.]). Bildene havner i test/.
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const specs = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1500, height: 950 });
const errs = [];
page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('PAGEERROR ' + e.message));
await page.goto('file://' + path.resolve('dist/hytte-tjome.html'));
await page.waitForFunction(() => window.__hytte, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 3000));
for (const spec of specs) {
  const [v, view, extra] = spec.split(':');
  await page.evaluate((v, view, extra) => {
    const h = window.__hytte; h.selectVariant(v);
    const t = document.getElementById('tRoofs'); t.checked = extra !== 'noroof'; t.dispatchEvent(new Event('change'));
    if (view.includes(',')) { const [cx, cy, ch, tx, ty, th] = view.split(',').map(Number); h.camera.position.set(cx, ch, -cy); h.orbit.target.set(tx, th, -ty); h.orbit.update(); }
    else h.goView(view, true);
  }, v, view, extra);
  await new Promise((r) => setTimeout(r, 1500));
  await page.screenshot({ path: `test/app_${v}_${view.includes(',') ? 'custom' : view}${extra ? '_' + extra : ''}.png` });
}
console.log(errs.join('\n') || 'ingen feil');
await browser.close();

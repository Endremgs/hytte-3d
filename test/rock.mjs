import puppeteer from 'puppeteer-core';
import path from 'node:path';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const pg = await b.newPage(); const e = []; pg.on('pageerror', (x) => e.push(x.message)); pg.on('console', (m) => { if (m.type() === 'error') e.push(m.text()); });
await pg.setViewport({ width: 1400, height: 900 });
await pg.goto('file://' + path.resolve('dist/index.html')); await new Promise((r) => setTimeout(r, 6000));
const shots = [['bergetSett', 'spise', 'tre'], ['berget', 'spise', 'tre'], ['plen', 'begge', 'glass']];
for (const [view, furn, rail] of shots) {
  const info = await pg.evaluate((view, furn, rail) => {
    document.getElementById('rdFurn').value = furn; document.getElementById('rdRail').value = rail;
    const c = document.getElementById('rdOn'); c.checked = true; c.dispatchEvent(new Event('input'));
    window.__hytte.goView(view, true);
    return document.getElementById('rdInfo').innerText;
  }, view, furn, rail);
  await new Promise((r) => setTimeout(r, 2500));
  await pg.screenshot({ path: `test/rock_${view}.png` });
  if (view === 'bergetSett') console.log(info);
}
const hash = await pg.evaluate(() => window.__hytte.encodeShared());
console.log('hash', hash);
console.log(e.join('\n') || 'no errors'); await b.close();

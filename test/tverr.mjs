// Skjermbilder fra vilkårlige kameraposisjoner i rammen: node test/tverr.mjs "A2003|cx,cy,cz|tx,ty,tz|navn|opts"
import puppeteer from 'puppeteer-core';
import path from 'node:path';
const specs = process.argv.slice(2);
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1400,900'] });
const page = await browser.newPage();
await page.setViewport({ width: 1400, height: 900 });
const errs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await page.goto('file://' + path.resolve('dist/index.html'));
await new Promise((r) => setTimeout(r, 6000));
await page.evaluate(() => document.body.classList.add('panel-hidden'));
for (const spec of specs) {
  const [v, c, t, name, opts = ''] = spec.split('|');
  const info = await page.evaluate((v, c, t, opts) => {
    const h = window.__hytte;
    h.selectVariant(v);
    const set = (id, val) => { const el = document.getElementById(id); if (el.type === 'checkbox') el.checked = val; else el.value = val; el.dispatchEvent(new Event(el.type === 'checkbox' && id.startsWith('t') ? 'change' : 'input')); };
    set('tRoofs', !opts.includes('noroof'));
    set('rdOn', opts.includes('rock'));
    set('time', opts.includes('noon') ? 13 : 19);
    return h.lookFrame(c.split(',').map(Number), t.split(',').map(Number)) || document.getElementById('rdInfo').innerText;
  }, v, c, t, opts);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `test/t_${name}.png` });
  if (info) console.log(name, info);
}
console.log(errs.slice(0, 30).join('\n') || 'no console errors');
await browser.close();

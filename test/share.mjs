import puppeteer from 'puppeteer-core';
import path from 'node:path';
const b = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const url = 'file://' + path.resolve('dist/index.html');
const errs = [];
let pg = await b.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
await pg.setViewport({ width: 1600, height: 1000 });
await pg.goto(url); await new Promise((r) => setTimeout(r, 6000));
const hash = await pg.evaluate(() => {
  const h = window.__hytte; h.selectVariant('V4');
  document.getElementById('clad').value = 'gran'; document.getElementById('clad').dispatchEvent(new Event('change'));
  const c = document.getElementById('pOn'); c.checked = true; c.dispatchEvent(new Event('input'));
  h.goView('knaus', true);
  return h.encodeShared();
});
console.log('hash:', hash);
// åpne lenken i "telefon"
pg = await b.newPage(); pg.on('pageerror', (e) => errs.push(e.message));
await pg.emulate({ viewport: { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' });
await pg.goto(url + '#' + hash); await new Promise((r) => setTimeout(r, 7000));
console.log(await pg.evaluate(() => JSON.stringify({ v: window.__hytte.state.variant, clad: window.__hytte.state.cladding, park: window.__hytte.parking.params.on, hidden: document.body.classList.contains('panel-hidden') })));
await pg.screenshot({ path: 'test/mobile_shared.png' });
console.log(errs.join('\n') || 'no errors');
await b.close();

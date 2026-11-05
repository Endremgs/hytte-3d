import puppeteer from 'puppeteer-core';
import path from 'node:path';
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errs = []; page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errs.push(m.text()); });
await page.goto('file://' + path.resolve('dist/hytte-tjome.html'));
await new Promise((r) => setTimeout(r, 6000));
const info = await page.evaluate(() => {
  const c = document.getElementById('pOn'); c.checked = true; c.dispatchEvent(new Event('input'));
  document.getElementById('pView').click();
  const i = window.__hytte.parking.info; return JSON.stringify({ ...i, poly: i.poly });
});
console.log(info);
await new Promise((r) => setTimeout(r, 2500));
await page.screenshot({ path: 'test/park_view.png' });
console.log(await page.evaluate(() => document.getElementById('parkInfo').innerText));
console.log(errs.join('\n'));
await browser.close();

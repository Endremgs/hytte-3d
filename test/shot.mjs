import puppeteer from 'puppeteer-core';
import path from 'node:path';
const views = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1600,1000'],
});
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
const errs = [];
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) errs.push(m.type() + ': ' + m.text().slice(0, 300)); });
page.on('pageerror', (e) => errs.push('PAGEERROR: ' + e.message));
await page.goto('file://' + path.resolve('dist/hytte-tjome.html'));
await new Promise((r) => setTimeout(r, 6000));
for (const spec of views.length ? views : ['eks:oversikt']) {
  const [variant, view, extra] = spec.split(':');
  await page.evaluate((variant, view, extra) => {
    const h = window.__hytte; if (!h) return;
    h.selectVariant(variant);
    if (extra === 'noroof') { document.getElementById('tRoofs').checked = false; document.getElementById('tRoofs').dispatchEvent(new Event('change')); }
    if (extra === 'park') { const c = document.getElementById('pOn'); c.checked = true; c.dispatchEvent(new Event('input')); }
    h.goView(view, true);
  }, variant, view, extra);
  await new Promise((r) => setTimeout(r, 2500));
  await page.screenshot({ path: `test/${variant}_${view}${extra ? '_' + extra : ''}.png` });
}
console.log(errs.slice(0, 30).join('\n') || 'no console errors');
await browser.close();

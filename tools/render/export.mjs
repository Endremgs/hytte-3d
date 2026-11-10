// Eksporterer hvert alternativ fra den bygde appen (dist/hytte-tjome.html) til GLB + JSON for Blender.
//   node tools/render/export.mjs [variant ...]      (standard: alle)
// Utdata: $HYTTE_RENDER_WORK (standard ~/.cache/hytte3d-render/scenes/<variant>/)
import puppeteer from 'puppeteer-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const OUT = process.env.HYTTE_RENDER_WORK || path.join(os.homedir(), '.cache/hytte3d-render/scenes');
const when = { month: 6, day: 25, hour: +(process.env.HOUR || 18.5) };
const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--window-size=1200,800'],
  protocolTimeout: 600000,
});
const page = await browser.newPage();
await page.setViewport({ width: 1200, height: 800 });
page.on('pageerror', (e) => console.error('PAGEERROR', e.message));
await page.goto('file://' + path.resolve('dist/hytte-tjome.html'));
await page.waitForFunction(() => window.__hytte, { timeout: 60000 });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : await page.evaluate(() => [...document.querySelectorAll('.variant')].map((b) => b.dataset.v));
for (const id of ids) {
  const res = await page.evaluate(async (id, when) => {
    window.__hytte.selectVariant(id);
    await new Promise((r) => setTimeout(r, 300));
    return window.__hytte.exportForRender(when);
  }, id, when);
  const dir = path.join(OUT, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'scene.glb'), Buffer.from(res.glb, 'base64'));
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(res.meta));
  console.log(id, (fs.statSync(path.join(dir, 'scene.glb')).size / 1e6).toFixed(1), 'MB,', res.meta.trees.length, 'trær');
}
await browser.close();

// Bygger én selvstendig HTML-fil (alt innebygd) i dist/hytte-tjome.html
import * as esbuild from 'esbuild';
import fs from 'node:fs';

// fotorealistiske bilder (tools/render): galleriets innhold, og en kortversjon til appen
const renders = fs.existsSync('public/renders/index.json') ? JSON.parse(fs.readFileSync('public/renders/index.json', 'utf8')) : [];
const renderMap = Object.fromEntries(renders.map((v) => [v.id, v.images]));

const res = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  write: false,
  loader: { '.bin': 'binary', '.jpg': 'dataurl', '.png': 'dataurl', '.json': 'json' },
  target: ['es2020'],
  define: { __RENDERS__: JSON.stringify(renderMap) },
  logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const SITE_URL = process.env.SITE_URL || 'https://endremgs.github.io/hytte-3d/';
const html = fs.readFileSync('src/index.html', 'utf8').replace('/*SITE_URL*/', SITE_URL).replace('/*BUNDLE*/', () => js);
fs.mkdirSync('dist', { recursive: true });
// index.html = nettsiden; hytte-tjome.html = samme fil for nedlasting/offline bruk
fs.writeFileSync('dist/index.html', html);
fs.writeFileSync('dist/hytte-tjome.html', html);
fs.copyFileSync('public/preview.jpg', 'dist/preview.jpg');
fs.writeFileSync('dist/robots.txt', 'User-agent: *\nDisallow: /\n');
if (renders.length) {
  fs.cpSync('public/renders', 'dist/renders', { recursive: true });
  const gal = fs.readFileSync('src/galleri.html', 'utf8').replace('/*SITE_URL*/', SITE_URL).replace('/*DATA*/[]', () => JSON.stringify(renders).replace(/</g, '\\u003c'));
  fs.writeFileSync('dist/galleri.html', gal);
  console.log('dist/galleri.html', renders.length, 'alternativer');
}
console.log('dist/hytte-tjome.html', (html.length / 1e6).toFixed(1), 'MB');

// Bygger én selvstendig HTML-fil (alt innebygd) i dist/hytte-tjome.html
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const res = await esbuild.build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'esm',
  write: false,
  loader: { '.bin': 'binary', '.jpg': 'dataurl', '.png': 'dataurl', '.json': 'json' },
  target: ['es2020'],
  logLevel: 'warning',
});
const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
const html = fs.readFileSync('src/index.html', 'utf8').replace('/*BUNDLE*/', () => js);
fs.mkdirSync('dist', { recursive: true });
fs.writeFileSync('dist/hytte-tjome.html', html);
console.log('dist/hytte-tjome.html', (html.length / 1e6).toFixed(1), 'MB');

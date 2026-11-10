// Lager public/renders/index.json (galleriets innhold) og miniatyrer fra rendrede bilder.
//   node tools/render/make_manifest.mjs
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const WORK = process.env.HYTTE_RENDER_WORK || path.join(os.homedir(), '.cache/hytte3d-render/scenes');
const DIR = 'public/renders';
const shots = JSON.parse(fs.readFileSync('tools/render/shots.json', 'utf8'));
const order = ['eks', 'V1', 'V2', 'V3', 'V4', 'A2003', 'A2002', 'N1', 'N2', 'N3', 'N4', 'N5'];
fs.mkdirSync(path.join(DIR, 'thumbs'), { recursive: true });
const out = [];
for (const id of order) {
  const metaPath = path.join(WORK, id, 'meta.json');
  if (!fs.existsSync(metaPath)) continue;
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  const images = [];
  for (const s of shots.sets[id] || shots.sets.default) {
    const file = `${id}_${s}.jpg`;
    if (!fs.existsSync(path.join(DIR, file))) continue;
    const thumb = path.join(DIR, 'thumbs', file);
    if (!fs.existsSync(thumb) || fs.statSync(thumb).mtimeMs < fs.statSync(path.join(DIR, file)).mtimeMs) {
      execFileSync('sips', ['-Z', '720', '-s', 'formatOptions', '80', path.join(DIR, file), '--out', thumb], { stdio: 'ignore' });
    }
    images.push({ file, title: shots.shots[s].title });
  }
  if (images.length) out.push({ id, name: meta.name, desc: meta.desc, idea: id.startsWith('N'), images });
}
fs.writeFileSync(path.join(DIR, 'index.json'), JSON.stringify(out, null, 1));
console.log(out.length, 'alternativer,', out.reduce((a, v) => a + v.images.length, 0), 'bilder');

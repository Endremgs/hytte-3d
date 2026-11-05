// Dagens bebyggelse og arkitektens alternativer (Roots Arkitekter, RA2603).
import * as THREE from 'three';
import walls from '../data/walls.json';
import { AXIS_DEG, fromFrame, toFrame, heightAt, naturalHeight, polyArea } from './geo.js';
import { makeMaterials, volume, deck, stairs, pergola, segBox, Bag, P, prism } from './kit.js';
import { flagTex } from './textures.js';

const FLOOR = 13.3; // gulvhøyde dagens hytte (NN2000), anslått fra laserdata og bilder

// Rammen: gruppe rotert slik at lokal X = x' (SSØ) og -Z = y' (ØNØ)
export function frameGroup() {
  const g = new THREE.Group();
  g.rotation.y = -(AXIS_DEG * Math.PI) / 180;
  return g;
}

// ---------- hjelpere ----------
function inside(x, y, poly) {
  let r = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) r = !r;
  }
  return r;
}
function rectPoly(x0, y0, x1, y1) { return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]]; }
function toLocalPoly(poly) { return poly.map(([x, y]) => fromFrame(x, y)); }
function avgTerrain(x0, y0, x1, y1) {
  let s = 0, n = 0;
  for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
    s += naturalHeight(...fromFrame(x0 + ((x1 - x0) * i) / 6, y0 + ((y1 - y0) * j) / 6)); n++;
  }
  return s / n;
}

// Automatisk vindusplassering for skissevolumer uten detaljert plan
function autoOpenings(def) {
  const out = { x0: [], x1: [], y0: [], y1: [] };
  const len = { y0: def.x1 - def.x0, y1: def.x1 - def.x0, x0: def.y1 - def.y0, x1: def.y1 - def.y0 };
  const style = def.style || {};
  for (const side of ['x0', 'x1', 'y0', 'y1']) {
    const L = len[side], st = style[side] || (L > 7 ? 'bed' : 'gable');
    if (st === 'none') continue;
    if (st === 'gable') {
      out[side].push({ at: L / 2, w: Math.min(1.6, L * 0.3), sill: 0.6, top: 2.2 });
      continue;
    }
    const n = Math.max(1, Math.floor(L / 3.1));
    for (let i = 0; i < n; i++) {
      const at = ((i + 0.5) * L) / n;
      if (st === 'view') out[side].push({ at, w: 2.0, sill: 0.3, top: 2.25, kind: 'slide' });
      else if (st === 'patio') out[side].push(i % 2 === 0 ? { at, w: 2.2, sill: 0, top: 2.2, kind: 'slide' } : { at, w: 1.2, sill: 0.8, top: 2.1 });
      else out[side].push({ at, w: 1.0, sill: 0.9, top: 2.1 });
    }
  }
  return out;
}

// Volum fra arkitektens plantegning: vegger og åpninger hentes fra tegningen
function planVolume(rects, b, floor, roof, m) {
  const sel = rects.filter((r) => r[2] > b[0] - 0.4 && r[0] < b[2] + 0.4 && r[3] > b[1] - 0.4 && r[1] < b[3] + 0.4);
  const x0 = Math.min(...sel.map((r) => r[0])), x1 = Math.max(...sel.map((r) => r[2]));
  const y0 = Math.min(...sel.map((r) => r[1])), y1 = Math.max(...sel.map((r) => r[3]));
  const band = 0.38;
  const sides = {
    y0: { L: x1 - x0, inBand: (r) => r[1] < y0 + band, iv: (r) => [r[0] - x0, r[2] - x0] },
    y1: { L: x1 - x0, inBand: (r) => r[3] > y1 - band, iv: (r) => [x1 - r[2], x1 - r[0]] },
    x1: { L: y1 - y0, inBand: (r) => r[2] > x1 - band, iv: (r) => [r[1] - y0, r[3] - y0] },
    x0: { L: y1 - y0, inBand: (r) => r[0] < x0 + band, iv: (r) => [y1 - r[3], y1 - r[1]] },
  };
  const openings = {};
  const exterior = new Set();
  for (const [k, s] of Object.entries(sides)) {
    const ivs = sel.filter((r) => { const hit = s.inBand(r); if (hit) exterior.add(r); return hit; }).map(s.iv).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const iv of ivs) {
      if (merged.length && iv[0] <= merged[merged.length - 1][1] + 0.12) merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], iv[1]);
      else merged.push([...iv]);
    }
    const ops = [];
    let cur = 0;
    for (const [a, bb] of [...merged, [s.L, s.L]]) {
      const w = a - cur;
      if (w > 0.35) {
        const at = cur + w / 2;
        // dører og vinduer kan ikke skilles sikkert i tegningen: brede åpninger = glassfelt til gulv
        if (w > 1.6) ops.push({ at, w, sill: 0.05, top: 2.2, kind: 'slide' });
        else if (w > 0.8 && w < 1.05 && (k === 'x0' || k === 'x1')) ops.push({ at, w, sill: 0.05, top: 2.1, kind: 'slide' });
        else ops.push({ at, w, sill: 0.8, top: 2.15 });
      }
      cur = Math.max(cur, bb);
    }
    openings[k] = ops;
  }
  const interior = sel.filter((r) => !exterior.has(r));
  return { def: { x0, x1, y0, y1, floor, roof, openings, interior }, group: volume({ x0, x1, y0, y1, floor, roof, openings, interior, plinth: 'concrete' }, m) };
}

function label(text, sub) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0.88)';
  g.beginPath(); g.roundRect(6, 6, 500, 148, 22); g.fill();
  g.fillStyle = '#1d2329'; g.font = '600 58px system-ui, sans-serif'; g.textAlign = 'center';
  g.fillText(text, 256, sub ? 74 : 98);
  if (sub) { g.font = '44px system-ui, sans-serif'; g.fillStyle = '#56606a'; g.fillText(sub, 256, 132); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(1.9, 0.6, 1);
  s.renderOrder = 10;
  return s;
}
const fromPx = (u, v) => [7.16 - (1300 - u) / 43.3, 2.58 + (540 - v) / 43.3];

// ---------- småting ----------
function furniture(bag, m, x, y, z, kind) {
  const wood = m.teak, dark = m.chair;
  if (kind === 'round') {
    bag.add(wood, segBox(x - 0.45, y, x + 0.45, y, z + 0.7, z + 0.74, 0.9));
    bag.add(dark, segBox(x - 0.03, y, x + 0.03, y, z, z + 0.7, 0.06));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4, cx = x + Math.cos(a) * 0.85, cy = y + Math.sin(a) * 0.85;
      const ux = Math.cos(a) * 0.25, uy = Math.sin(a) * 0.25;
      bag.add(dark, segBox(cx - uy, cy + ux, cx + uy, cy - ux, z + 0.42, z + 0.47, 0.48));
      bag.add(dark, segBox(cx + ux - uy, cy + uy + ux, cx + ux + uy, cy + uy - ux, z + 0.45, z + 1.1, 0.05));
    }
  } else {
    bag.add(wood, segBox(x - 0.9, y, x + 0.9, y, z + 0.72, z + 0.76, 0.9));
    for (const [a, b] of [[-0.8, -0.38], [0.8, -0.38], [-0.8, 0.38], [0.8, 0.38]]) bag.add(wood, segBox(x + a - 0.03, y + b, x + a + 0.03, y + b, z, z + 0.72, 0.06));
  }
}

function canoe(color, length) {
  const g = new THREE.SphereGeometry(1, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2);
  g.scale(length / 2, 0.36, 0.42);
  g.rotateX(Math.PI); // opp-ned
  g.translate(0, 0.36, 0);
  return new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color, roughness: 0.4 }));
}

function flagpole(x, y) {
  const grp = new THREE.Group();
  const h = 7.5, gz = heightAt(x, y);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.06, h, 10), new THREE.MeshStandardMaterial({ color: 0xf2f2f0, roughness: 0.4 }));
  pole.position.set(x, gz + h / 2, -y);
  pole.castShadow = true;
  const knob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 8), new THREE.MeshStandardMaterial({ color: 0xd8c27a, metalness: 0.6, roughness: 0.3 }));
  knob.position.set(x, gz + h + 0.05, -y);
  const fg = new THREE.PlaneGeometry(1.6, 1.15, 16, 6);
  fg.translate(0.8, -0.6, 0);
  const flag = new THREE.Mesh(fg, new THREE.MeshStandardMaterial({ map: flagTex(), side: THREE.DoubleSide, roughness: 0.8 }));
  flag.position.set(x + 0.04, gz + h - 0.05, -y);
  flag.castShadow = true;
  grp.add(pole, knob, flag);
  const base = fg.attributes.position.array.slice();
  grp.userData.animate = (t) => {
    const p = fg.attributes.position.array;
    for (let i = 0; i < p.length; i += 3) {
      const u = base[i];
      p[i + 2] = Math.sin(u * 3.2 - t * 5) * 0.12 * u;
      p[i + 1] = base[i + 1] - u * 0.05;
    }
    fg.attributes.position.needsUpdate = true;
    fg.computeVertexNormals();
    flag.rotation.y = 0.9 + Math.sin(t * 0.3) * 0.25;
  };
  return grp;
}

// ---------- dagens bebyggelse ----------
// Mål fra situasjonsplan A10-03 (takfot) og bilder.
const SOUTH = { x0: -3.35, x1: 4.6, y0: -2.22, y1: 2.55 };
const NORTH = { x0: -8.8, x1: -3.35, y0: -2.22, y1: 1.4 };
export const DECK = [[-3.28, -4.86], [-3.28, -2.3], [7.53, -2.3], [7.57, 2.33], [9.41, 1.63], [8.91, -3.26], [7.73, -5.86], [3.33, -6.08], [1.59, -4.81]];
// Anneks «Robua»
const ANNEX_C = [-11.2, 13.6], ANNEX_ANG = Math.atan2(0.309, 0.951);
function annexToLocal(xa, ya) {
  const c = Math.cos(ANNEX_ANG), s = Math.sin(ANNEX_ANG);
  return [ANNEX_C[0] + c * xa - s * ya, ANNEX_C[1] + s * xa + c * ya];
}
const BOD_C = toFrame(9.9, -19.4);

function existingParts(m, mAnnex) {
  const parts = {};
  // Hovedhus sør (stue/kjøkken) med overdekket hjørne mot SSØ
  const sGroup = new THREE.Group();
  sGroup.add(volume({
    ...SOUTH, floor: FLOOR, wallH: 2.35, plinth: 'lattice',
    roof: { axis: 'x', pitch: 19, overhang: 0.42, ext1: 2.55 },
    openings: {
      y0: [{ at: 1.2, w: 1.1, sill: 0.85, top: 2.05 }, { at: 4.9, w: 2.1, sill: 0, top: 2.1, kind: 'slide' }],
      y1: [{ at: 1.7, w: 1.0, sill: 0.9, top: 2.0, shutters: true }, { at: 4.4, w: 1.5, sill: 0.9, top: 2.0, shutters: true }, { at: 7.2, w: 0.95, sill: 0, top: 2.05, kind: 'door' }],
      x1: [{ at: 2.3, w: 0.9, sill: 0, top: 2.05, kind: 'door' }],
    },
  }, m));
  // bod/rom i enden (ØNØ-halvdel)
  sGroup.add(volume({ x0: 4.6, x1: 7.15, y0: 0.3, y1: 2.55, floor: FLOOR, wallH: 2.35, roof: { type: 'none' }, plinth: 'lattice', open: ['x0'],
    openings: { x1: [{ at: 1.2, w: 0.7, sill: 1.0, top: 1.8 }] } }, m));
  const sb = new Bag();
  sb.add(m.trim, segBox(7.1, -2.17, 7.2, -2.17, FLOOR, FLOOR + 2.35, 0.12)); // hjørnestolpe
  // pipe (hvit mur)
  const chg = heightAt(...fromFrame(3.5, -2.6));
  sb.add(m.trim, segBox(3.15, -2.6, 3.85, -2.6, chg, FLOOR + 4.1, 0.7));
  sb.add(m.dark, segBox(3.2, -2.6, 3.8, -2.6, FLOOR + 4.1, FLOOR + 4.25, 0.55));
  furniture(sb, m, 5.9, -0.9, FLOOR, 'table');
  sb.build(sGroup);
  parts.south = sGroup;

  // Hovedhus nord (soverom)
  const nGroup = new THREE.Group();
  nGroup.add(volume({
    ...NORTH, floor: FLOOR + 0.1, wallH: 2.55, plinth: 'lattice', open: ['x1'],
    roof: { axis: 'x', pitch: 23, overhang: 0.42 },
    openings: {
      y1: [{ at: 0.6, w: 0.9, sill: 0, top: 2.05, kind: 'door' }, { at: 2.1, w: 0.9, sill: 0.95, top: 2.0, shutters: true }, { at: 3.5, w: 0.9, sill: 0.95, top: 2.0, shutters: true }, { at: 4.75, w: 0.8, sill: 0.95, top: 2.0, shutters: true }],
      y0: [{ at: 2.6, w: 1.0, sill: 0.95, top: 2.0 }],
      x0: [{ at: 1.8, w: 0.8, sill: 1.0, top: 2.0 }],
    },
  }, m));
  // inngangsparti (trapp + plattform mot veien)
  const porchPoly = [[-4.6, 1.4], [-3.35, 1.4], [-3.35, 2.55], [0.9, 2.55], [0.9, 4.3], [-4.6, 4.3]];
  nGroup.add(deck(porchPoly, FLOOR - 0.5, m));
  nGroup.add(stairs(-4.0, 1.9, 0, 0.01, FLOOR, 1.0, m));
  const pb = new Bag();
  for (const [x, y] of [[-3.75, 1.5], [-3.75, 2.2]]) pb.add(m.deck, segBox(x - 0.3, y, x + 0.3, y, FLOOR - 0.5, FLOOR - 0.25 + (y - 1.5) * 0.2, 0.5));
  furniture(pb, m, -0.6, 3.4, FLOOR - 0.5, 'round');
  // utedusj ved nordgavlen
  for (const [a, b] of [[[-10.1, 0.0], [-10.1, 1.3]], [[-10.1, 1.3], [-8.85, 1.3]]]) pb.add(m.deck, segBox(...a, ...b, heightAt(...fromFrame(-9.5, 0.6)), FLOOR + 1.0, 0.06));
  pb.build(nGroup);
  parts.north = nGroup;

  // Terrasse
  const d = deck(DECK, FLOOR - 0.03, m);
  const fb = new Bag();
  furniture(fb, m, 4.8, -4.3, FLOOR - 0.03, 'round');
  fb.build(d);
  parts.deck = d;

  // Kano (gul) – som på situasjonsplanen
  const k = canoe(0xe6c34b, 3.1);
  const kc = fromFrame(11.95, 3.17);
  k.position.set(0, heightAt(...kc) + 0.02, 0);
  k.rotation.y = Math.PI / 2;
  const kg = new THREE.Group(); kg.position.set(11.95, 0, -3.17); kg.add(k);
  k.position.set(0, heightAt(...kc) - 0.05, 0);
  parts.canoe = kg;

  // Bod ved flaggstanga
  const bod = new THREE.Group();
  const bz = heightAt(9.9, -19.4) + 0.25;
  bod.add(volume({ x0: BOD_C[0] - 1.25, x1: BOD_C[0] + 1.25, y0: BOD_C[1] - 1.0, y1: BOD_C[1] + 1.0, floor: bz, wallH: 2.0, plinth: 'concrete',
    roof: { axis: 'x', pitch: 30, overhang: 0.3 }, openings: { x0: [{ at: 1.0, w: 0.8, sill: 0, top: 1.85, kind: 'door' }] } }, mAnnex));
  parts.bod = bod;
  return parts;
}

function buildAnnex(mAnnex) {
  // eget koordinatsystem langs annekset
  const g = new THREE.Group();
  g.position.set(ANNEX_C[0], 0, -ANNEX_C[1]);
  g.rotation.y = ANNEX_ANG;
  const fl = 13.55;
  g.add(volume({ x0: -4.0, x1: 4.0, y0: -1.6, y1: 1.6, floor: fl, wallH: 2.2, plinth: 'concrete', frameToLocal: annexToLocal,
    roof: { axis: 'x', pitch: 14, overhang: 0.35 },
    openings: { y0: [{ at: 1.3, w: 0.55, sill: 1.1, top: 1.65 }, { at: 4.15, w: 0.85, sill: 0, top: 2.0, kind: 'door' }, { at: 6.45, w: 0.85, sill: 0, top: 2.0, kind: 'door' }],
      x1: [{ at: 1.6, w: 0.7, sill: 1.0, top: 1.7 }] } }, mAnnex));
  g.add(deck([[0.0, -2.7], [4.1, -2.7], [4.1, -1.6], [0.0, -1.6]], fl - 0.05, mAnnex));
  const b = new Bag();
  b.add(mAnnex.dark, segBox(-3.0, 0.4, -2.85, 0.4, fl + 2.2, fl + 3.4, 0.15)); // pipe badstu
  b.build(g);
  // kajakk
  const kj = canoe(0x7ed321, 4.6);
  kj.scale.set(1, 0.7, 0.75);
  kj.position.set(-5.8, heightAt(...annexToLocal(-5.8, -1.0)) - 0.05, 1.0);
  kj.rotation.y = 0.25;
  g.add(kj);
  return g;
}

// ---------- alternativer ----------
// Rammekoordinater for veggliv (takfot fra situasjonsplanene minus ca. 0.35 m utstikk)
export const VARIANTS = [
  {
    id: 'eks', name: 'Dagens hytte', plan: 'eks', bya: 102.5,
    desc: 'Hovedhus 76,1 m² + anneks 26,4 m² (BYA fra situasjonsplan A10-03), i tillegg bod og terrasse.',
    keep: ['south', 'north', 'deck', 'annex', 'bod', 'canoe'],
  },
  {
    id: 'V1', name: 'V1 – tverrfløy 45,5 m²', plan: 'V1', bya: 105.4,
    desc: 'Nordre del av hytta og annekset rives. Ny fløy på tvers i nord (45,5 m²), koblet til eksisterende hoveddel (59,9 m²) via overdekket uteplass.',
    keep: ['south', 'deck', 'bod', 'canoe'],
    build: (m) => {
      const g = new THREE.Group();
      g.add(volume({ x0: -13.39, x1: -8.64, y0: -2.26, y1: 6.88, floor: FLOOR, roof: { axis: 'y', pitch: 22, overhang: 0.35 }, plinth: 'concrete',
        openings: autoOpenings({ x0: -13.39, x1: -8.64, y0: -2.26, y1: 6.88, style: { x1: 'patio', x0: 'bed', y1: 'gable', y0: 'gable' } }) }, m));
      g.add(pergola(-8.64, -3.35, -0.2, 2.55, FLOOR + 2.5, m, true));
      g.add(deck(rectPoly(-8.64, -2.26, -3.35, 2.55), FLOOR - 0.03, m));
      return g;
    },
    footprints: [rectPoly(-13.74, -2.61, -8.29, 7.23)],
  },
  {
    id: 'V2', name: 'V2 – tverrfløy 63,9 m²', plan: 'V2', bya: 123.8,
    desc: 'Som V1, men større og lengre tverrfløy (63,9 m²) som strekker seg både mot veien og mot berget i vest.',
    keep: ['south', 'deck', 'bod', 'canoe'],
    build: (m) => {
      const g = new THREE.Group();
      g.add(volume({ x0: -13.39, x1: -8.64, y0: -6.26, y1: 6.63, floor: FLOOR, roof: { axis: 'y', pitch: 22, overhang: 0.35 }, plinth: 'concrete',
        openings: autoOpenings({ x0: -13.39, x1: -8.64, y0: -6.26, y1: 6.63, style: { x1: 'patio', x0: 'bed', y1: 'gable', y0: 'gable' } }) }, m));
      g.add(pergola(-8.64, -3.35, -0.2, 2.55, FLOOR + 2.5, m, true));
      g.add(deck(rectPoly(-8.64, -2.26, -3.35, 2.55), FLOOR - 0.03, m));
      return g;
    },
    footprints: [rectPoly(-13.74, -6.61, -8.29, 6.98)],
  },
  {
    id: 'V3', name: 'V3 – parallell fløy, 110 m²', plan: 'V3', bya: 110,
    desc: 'Ny langfløy parallelt med hytta, forskjøvet mot veien og nordover. Eksisterende hoveddel beholdes; overdekket inngang mellom fløyene.',
    keep: ['south', 'deck', 'bod', 'canoe'],
    build: (m) => {
      const g = new THREE.Group();
      const fl = FLOOR - 0.45;
      g.add(volume({ x0: -13.26, x1: -3.75, y0: 2.8, y1: 7.53, floor: fl, roof: { axis: 'x', pitch: 22, overhang: 0.35, ext1: 3.2 }, plinth: 'concrete', open: [],
        openings: autoOpenings({ x0: -13.26, x1: -3.75, y0: 2.8, y1: 7.53, style: { y1: 'view', y0: 'patio', x0: 'gable', x1: 'gable' } }) }, m));
      const b = new Bag();
      b.add(m.trim, segBox(-0.62, 7.45, -0.5, 7.45, fl, fl + 2.5, 0.12));
      b.build(g);
      g.add(deck(rectPoly(-3.75, 2.55, -0.55, 7.53), fl - 0.03, m));
      return g;
    },
    footprints: [rectPoly(-13.61, 2.45, -0.21, 7.88)],
  },
  {
    id: 'V4', name: 'V4 – ny L-formet hytte 117,3 m²', plan: 'V4', bya: 117.3,
    desc: 'All eksisterende bebyggelse (unntatt bod) rives. Ny L-formet hytte: tverrfløy i nord og langfløy nærmere veien, med terrasse i le mot vest.',
    keep: ['bod', 'canoe'],
    build: (m) => {
      const g = new THREE.Group();
      g.add(volume({ x0: -12.11, x1: -7.36, y0: -1.01, y1: 9.38, floor: FLOOR + 0.1, roof: { axis: 'y', pitch: 22, overhang: 0.35 }, plinth: 'concrete',
        openings: autoOpenings({ x0: -12.11, x1: -7.36, y0: -1.01, y1: 9.38, style: { x1: 'patio', x0: 'bed', y1: 'gable', y0: 'gable' } }) }, m));
      const flB = FLOOR - 0.7;
      g.add(volume({ x0: -7.36, x1: 5.63, y0: 3.97, y1: 8.87, floor: flB, roof: { axis: 'x', pitch: 22, overhang: 0.35 }, plinth: 'concrete', open: ['x0'],
        openings: autoOpenings({ x0: -7.36, x1: 5.63, y0: 3.97, y1: 8.87, style: { y1: 'view', y0: 'patio', x1: 'gable', x0: 'none' } }) }, m));
      g.add(deck(rectPoly(-7.36, -0.6, 5.63, 3.97), flB - 0.03, m));
      g.add(stairs(-1.0, -0.6, 0, -1, flB - 0.03, 2.4, m));
      return g;
    },
    footprints: [rectPoly(-12.46, -1.36, -7.01, 9.73), rectPoly(-6.96, 3.62, 5.98, 9.22)],
  },
  {
    id: 'A2003', name: 'Skisse A20-03 – 4 soverom', plan: 'V1', bya: 124.1, detailed: true,
    desc: 'Detaljert skisse (02.09.26): hoveddel med kjøkken/stue/spis 27,8 m², bad, soverom og entré. Ny tverrfløy med 4 soverom (bl.a. «fire barn i køyeseng»). Amfitrapp og uteplass med pergola mellom. Skru av taket for å se planløsningen.',
    keep: ['deck', 'bod', 'canoe'],
    build: (m) => {
      const g = new THREE.Group();
      const R = walls.A2003;
      g.add(planVolume(R, [-4.1, -2.6, 7.4, 2.8], FLOOR, { axis: 'x', pitch: 20, overhang: 0.4 }, m).group);
      g.add(planVolume(R, [-13.1, -3.8, -7.7, 6.2], FLOOR, { axis: 'y', pitch: 22, overhang: 0.35 }, m).group);
      g.add(pergola(-7.85, -3.88, -0.6, 2.58, FLOOR + 2.5, m, true));
      g.add(deck(rectPoly(-7.85, -2.32, -3.88, 2.58), FLOOR - 0.03, m));
      // amfitrapp ned mot plenen (ØNØ)
      const b = new Bag();
      for (let i = 0; i < 4; i++) b.add(m.deck, segBox(-7.6, 2.75 + i * 0.4, -4.1, 2.75 + i * 0.4, heightAt(...fromFrame(-6, 3.5)) - 0.3, FLOOR - 0.03 - i * 0.38, 0.4));
      const rows = [['Sov. 1', '9,1 m²', 470, 470], ['Sov. 2', '6,7 m²', 470, 530], ['Sov. 3', '6,9 m²', 470, 660], ['Sov. 4', '9,5 m²', 515, 765],
        ['Bad', '3,2 m²', 870, 625], ['Kjøkken/stue/spis', '27,8 m²', 1035, 680], ['Sov', '6,4 m²', 1215, 600], ['Entré', '3,9 m²', 1200, 690], ['Uteplass', '', 735, 700], ['Amfitrapp', '', 720, 510]];
      b.build(g);
      g.userData.labels = rows.map(([t, s, u, v]) => ({ t, s, p: fromPx(u, v) }));
      return g;
    },
    footprints: [rectPoly(-13.3, -4.0, -7.4, 6.4), rectPoly(-4.3, -2.7, 7.6, 3.0)],
  },
  {
    id: 'A2002', name: 'Skisse A20-02 – L-fløy med stue', plan: 'V1', bya: null, detailed: true,
    desc: 'Detaljert skisse (02.09.26): som A20-03, men ny fløy er L-formet med egen stue 15,5 m², tre soverom, gang og WC. Hoveddel med kjøkken/stue/spis og større soverom 8,1 m².',
    keep: ['deck', 'bod', 'canoe'],
    build: (m) => {
      const g = new THREE.Group();
      const R = walls.A2002;
      g.add(planVolume(R, [-4.1, -2.6, 7.6, 2.8], FLOOR, { axis: 'x', pitch: 20, overhang: 0.4 }, m).group);
      g.add(planVolume(R, [-14.6, 2.4, -9.3, 8.5], FLOOR, { axis: 'y', pitch: 22, overhang: 0.35 }, m).group);
      g.add(planVolume(R, [-15.5, -2.6, -8.5, 2.45], FLOOR, { axis: 'x', pitch: 22, overhang: 0.35 }, m).group);
      g.add(deck(rectPoly(-8.71, -2.32, -3.88, 2.58), FLOOR - 0.03, m));
      g.add(pergola(-8.71, -3.88, -1.0, 2.58, FLOOR + 2.5, m, false));
      const rows = [['Sov', '8,3 m²', 410, 370], ['WC', '1,5 m²', 543, 362], ['Sov', '7,4 m²', 410, 500], ['Gang', '3,8 m²', 540, 470], ['Sov', '6,6 m²', 375, 605],
        ['Stue', '15,5 m²', 520, 640], ['Bad', '3,7 m²', 875, 625], ['Kjøkken/stue/spis', '', 1035, 690], ['Sov', '8,1 m²', 1255, 605], ['Entré', '4,9 m²', 1210, 690], ['Uteplass', '', 715, 640]];
      g.userData.labels = rows.map(([t, s, u, v]) => ({ t, s, p: fromPx(u, v) }));
      return g;
    },
    footprints: [rectPoly(-15.6, -2.7, -8.4, 2.6), rectPoly(-14.7, 2.6, -9.2, 8.6), rectPoly(-4.3, -2.7, 7.8, 3.0)],
  },
];

export const EXISTING_FOOTPRINTS = {
  south: rectPoly(-3.75, -2.62, 7.55, 2.95), north: rectPoly(-9.21, -2.62, -3.75, 1.81),
};

export function buildSite(scene, opts) {
  const root = new THREE.Group();
  scene.add(root);
  const frame = frameGroup();
  root.add(frame);
  let current = null;
  const state = { roofs: true, ghosts: false, labels: true };
  let flag = flagpole(6.0, -16.6);
  root.add(flag);

  function materials() {
    const m = makeMaterials(opts.cladding, opts.roof, opts.vertical);
    m.dark = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.7 });
    m.teak = new THREE.MeshStandardMaterial({ color: 0x9c6b3e, roughness: 0.7 });
    m.chair = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.6 });
    return m;
  }

  function show(variantId) {
    if (current) { root.remove(current.root); current.root.traverse((o) => o.geometry?.dispose()); }
    const v = VARIANTS.find((x) => x.id === variantId);
    const mNew = materials();
    const mAnnex = makeMaterials(opts.cladding, 'shingel', false);
    mAnnex.dark = mNew.dark;
    const parts = existingParts(mNew, mAnnex);
    const vroot = new THREE.Group();
    const vframe = frameGroup();
    vroot.add(vframe);
    for (const k of v.keep) {
      if (k === 'annex') continue;
      if (parts[k]) vframe.add(parts[k]);
    }
    if (v.keep.includes('annex')) vroot.add(buildAnnex(mAnnex));
    let built = null;
    if (v.build) { built = v.build(mNew); vframe.add(built); }
    // rives (spøkelse)
    const ghosts = new THREE.Group();
    const gm = new THREE.MeshBasicMaterial({ color: 0xff3b30, transparent: true, opacity: 0.22, depthWrite: false });
    const gl = new THREE.LineBasicMaterial({ color: 0xff3b30 });
    const addGhost = (parent, x0, y0, x1, y1, z0, z1) => {
      const g = new THREE.BoxGeometry(x1 - x0, z1 - z0, y1 - y0);
      g.translate((x0 + x1) / 2, (z0 + z1) / 2, -(y0 + y1) / 2);
      parent.add(new THREE.Mesh(g, gm));
      parent.add(new THREE.LineSegments(new THREE.EdgesGeometry(g), gl));
    };
    const gf = frameGroup();
    ghosts.add(gf);
    if (!v.keep.includes('south') && !v.detailed) addGhost(gf, SOUTH.x0, SOUTH.y0, 7.15, SOUTH.y1, FLOOR, FLOOR + 3.2);
    if (!v.keep.includes('north')) addGhost(gf, NORTH.x0, NORTH.y0, NORTH.x1, NORTH.y1, FLOOR, FLOOR + 3.4);
    if (!v.keep.includes('annex')) {
      const ag = new THREE.Group(); ag.position.set(ANNEX_C[0], 0, -ANNEX_C[1]); ag.rotation.y = ANNEX_ANG;
      addGhost(ag, -4, -1.6, 4, 1.6, 13.55, 13.55 + 3.0); ghosts.add(ag);
    }
    ghosts.visible = state.ghosts;
    vroot.add(ghosts);
    // romnavn
    const labels = new THREE.Group();
    if (built?.userData.labels) {
      for (const l of built.userData.labels) {
        const s = label(l.t, l.s);
        const [x, y] = fromFrame(l.p[0], l.p[1]);
        s.position.set(x, FLOOR + 1.3, -y);
        labels.add(s);
      }
    }
    labels.visible = !state.roofs && state.labels;
    vroot.add(labels);
    vroot.traverse((o) => { if (o.isMesh && o.material !== gm) { o.castShadow = true; o.receiveShadow = true; } });
    root.add(vroot);
    current = { root: vroot, ghosts, labels, variant: v };
    applyRoofs();
    return describe(v);
  }

  function applyRoofs() {
    if (!current) return;
    current.root.traverse((o) => { if (o.userData?.isRoof) o.visible = state.roofs; });
    current.labels.visible = !state.roofs;
  }

  function describe(v) {
    // forskriftssjekk (utvalgte bestemmelser 10.2 i kommuneplanen, gjengitt på arkitektens tegninger)
    const vols = [];
    current.root.traverse((o) => { if (o.userData?.rect && o.userData.zRidge) vols.push(o.userData); });
    let maxFacade = 0, maxRidge = 0, maxEave = 0, area = 0;
    for (const u of vols) {
      const [x0, y0, x1, y1] = u.rect;
      if (x1 - x0 < 1.5 || y1 - y0 < 1.5) continue;
      const avg = avgTerrain(x0, y0, x1, y1);
      maxFacade = Math.max(maxFacade, x1 - x0, y1 - y0);
      maxRidge = Math.max(maxRidge, u.zRidge - avg);
      maxEave = Math.max(maxEave, u.floor + 2.5 - avg);
      area += (x1 - x0) * (y1 - y0);
    }
    if (v.footprints) {
      // union av fotavtrykk (takflate) på 0.25 m rutenett
      const fp = v.footprints;
      const xs = fp.flat().map((p) => p[0]), ys = fp.flat().map((p) => p[1]);
      let n = 0;
      for (let x = Math.min(...xs); x < Math.max(...xs); x += 0.25) for (let y = Math.min(...ys); y < Math.max(...ys); y += 0.25) {
        if (fp.some((p) => inside(x + 0.125, y + 0.125, p))) n++;
      }
      area = n * 0.0625;
    }
    return { v, maxFacade, maxRidge, maxEave, area };
  }

  function footprints() {
    const v = current?.variant;
    if (!v?.footprints) return [];
    return v.footprints.map(toLocalPoly);
  }

  return {
    root, show, footprints,
    setRoofs(on) { state.roofs = on; applyRoofs(); },
    setGhosts(on) { state.ghosts = on; if (current) current.ghosts.visible = on; },
    animate(t) { flag.userData.animate(t); },
    refreshMaterials() { if (current) return show(current.variant.id); },
    get current() { return current; },
  };
}

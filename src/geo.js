// Geografi: lokalt koordinatsystem med origo i adressepunktet Hellesmoveien 33
// (EUREF89 UTM32 E 580152, N 6549299). x = øst, y = nord, høyder i NN2000.
// I three.js: X = x, Y = høyde, Z = -y.
import terrainIn from '../data/terrain_in.bin';
import terrainFar from '../data/terrain_far.bin';

const toI16 = (u8) => new Int16Array(u8.buffer, u8.byteOffset, u8.byteLength / 2);
export const IN = { data: toI16(terrainIn), n: 257, half: 128, step: 1 };
export const FAR = { data: toI16(terrainFar), n: 513, half: 512, step: 2 };

function sampleGrid(g, x, y) {
  const fx = (x + g.half) / g.step;
  const fy = (g.half - y) / g.step;
  const x0 = Math.max(0, Math.min(g.n - 2, Math.floor(fx)));
  const y0 = Math.max(0, Math.min(g.n - 2, Math.floor(fy)));
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  const d = g.data, n = g.n;
  const a = d[y0 * n + x0], b = d[y0 * n + x0 + 1], c = d[(y0 + 1) * n + x0], e = d[(y0 + 1) * n + x0 + 1];
  return ((a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + e * tx) * ty) / 100;
}

// Bicubisk (Catmull-Rom) for glattere nærterreng
function cubic(p0, p1, p2, p3, t) {
  return p1 + 0.5 * t * (p2 - p0 + t * (2 * p0 - 5 * p1 + 4 * p2 - p3 + t * (3 * (p1 - p2) + p3 - p0)));
}
function sampleCubic(g, x, y) {
  const fx = (x + g.half) / g.step, fy = (g.half - y) / g.step;
  const ix = Math.floor(fx), iy = Math.floor(fy);
  const tx = fx - ix, ty = fy - iy, n = g.n, d = g.data;
  const at = (i, j) => d[Math.max(0, Math.min(n - 1, j)) * n + Math.max(0, Math.min(n - 1, i))] / 100;
  const r = [];
  for (let k = -1; k <= 2; k++) r.push(cubic(at(ix - 1, iy + k), at(ix, iy + k), at(ix + 1, iy + k), at(ix + 2, iy + k), tx));
  return cubic(r[0], r[1], r[2], r[3], ty);
}

// Terrengendringer (parkering m.m.) registreres her og påvirker høydeoppslag.
export const terrainEdits = [];

export function naturalHeight(x, y) {
  if (Math.abs(x) < 127 && Math.abs(y) < 127) return sampleCubic(IN, x, y);
  return sampleGrid(FAR, x, y);
}

export function heightAt(x, y) {
  let h = naturalHeight(x, y);
  for (const e of terrainEdits) {
    const v = e.heightAt(x, y, h);
    if (v !== null) h = v;
  }
  return h;
}

// Arkitektens bygningsakse: x' mot SSØ langs hytta, y' mot ØNØ (mot veien).
export const AXIS_DEG = 70.25;
const t = (AXIS_DEG * Math.PI) / 180;
export const C = Math.cos(t), S = Math.sin(t);
export function fromFrame(xp, yp) {
  return [C * xp + S * yp, -S * xp + C * yp];
}
export function toFrame(x, y) {
  return [C * x - S * y, S * x + C * y];
}

// Hellesmoveien senterlinje (fra situasjonsplan + OSM), lokale koordinater
export const ROAD = [
  [14.0, 37.9], [15.6, 30.0], [17.0, 24], [18.1, 20], [18.75, 16], [19.35, 12], [19.85, 8], [20.2, 4],
  [20.45, 0], [20.85, -4], [21.6, -8], [22.75, -12], [23.6, -16], [24.2, -21], [25.6, -30.5], [27.4, -41.5],
];
export const ROAD_WIDTH = 3.0;

// Registrert naturtype «Hule eiker – Hellesmo 1» (Miljødirektoratet), svært stor verdi
export const OAK = { x: 18.9, y: -14.6, zone: 14.9, tree: [19.5, -15.6] };

export function pointInPoly(x, y, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export function polyArea(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

// Punkt og retning langs veien gitt avstand s (m) fra nordre ende
export function roadAt(s) {
  let acc = 0;
  for (let i = 0; i < ROAD.length - 1; i++) {
    const [x0, y0] = ROAD[i], [x1, y1] = ROAD[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (acc + L >= s || i === ROAD.length - 2) {
      const f = Math.max(0, Math.min(1, (s - acc) / L));
      return { x: x0 + (x1 - x0) * f, y: y0 + (y1 - y0) * f, dx: (x1 - x0) / L, dy: (y1 - y0) / L };
    }
    acc += L;
  }
}
export function roadSOf(y) {
  // finn s for gitt nord-koordinat (veien går omtrent nord–sør)
  let best = 0, bd = 1e9;
  for (let s = 0; s < 80; s += 0.25) {
    const p = roadAt(s);
    const d = Math.abs(p.y - y);
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

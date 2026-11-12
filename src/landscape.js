// Uteanlegg som følger terrenget: trapper, gangvei med heller og utedusj.
// Alt i bygningsrammen (x' mot SSØ, y' mot ØNØ/veien), se geo.js.
import * as THREE from 'three';
import { heightAt, fromFrame } from './geo.js';
import { segBox, P } from './kit.js';
import { rockTex } from './textures.js';

const ground = (x, y) => heightAt(...fromFrame(x, y));

// Punkt og retning langs en polylinje
function along(path) {
  const segs = [];
  let L = 0;
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1], l = Math.hypot(bx - ax, by - ay);
    segs.push({ ax, ay, ux: (bx - ax) / l, uy: (by - ay) / l, s0: L, l });
    L += l;
  }
  const at = (s) => {
    const q = segs.find((g) => s <= g.s0 + g.l) || segs[segs.length - 1];
    const t = Math.max(0, Math.min(q.l, s - q.s0));
    return { x: q.ax + q.ux * t, y: q.ay + q.uy * t, ux: q.ux, uy: q.uy, vx: -q.uy, vy: q.ux };
  };
  return { L, at };
}

// Høyeste og laveste terreng på tvers av gangbanen
function across(p, w) {
  let hi = -1e9, lo = 1e9;
  for (const k of [-0.5, -0.25, 0, 0.25, 0.5]) {
    const g = ground(p.x + p.vx * k * w, p.y + p.vy * k * w);
    hi = Math.max(hi, g); lo = Math.min(lo, g);
  }
  return { hi, lo };
}

// Bjelke mellom to punkter [x', y', z]
export function beam(a, b, w, h = w) {
  const A = P(...a), B = P(...b), d = B.clone().sub(A), L = d.length();
  const g = new THREE.BoxGeometry(L, h, w);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), d.normalize()));
  g.translate(...A.add(B).multiplyScalar(0.5).toArray());
  return g;
}

// Område langs en polylinje (for å fjerne trær/gress), rammekoordinater
export function stripPolys(path, w) {
  const out = [];
  for (let i = 0; i < path.length - 1; i++) {
    const [ax, ay] = path[i], [bx, by] = path[i + 1], l = Math.hypot(bx - ax, by - ay);
    const vx = (-(by - ay) / l) * (w / 2), vy = ((bx - ax) / l) * (w / 2);
    out.push([[ax + vx, ay + vy], [bx + vx, by + vy], [bx - vx, by - vy], [ax - vx, ay - vy]]);
  }
  return out;
}

// Trapp langs en sti fra z0 og nedover: trinnene følger terrenget (repos der det flater ut).
// kind 'wood': trinn på vanger og stolper med håndløper; 'solid': massive trinn (bred trapp).
// Returnerer endepunktet (der trappa når bakken om stopAtGround).
export function terrainStair(bag, m, path, { width = 1.1, z0, tread = 0.3, maxRise = 0.18, kind = 'wood', rail = 'left', stopAtGround = false }) {
  const { L, at } = along(path);
  const treads = [];
  let z = z0;
  for (let s = tread / 2; s < L; s += tread) {
    const p = at(s), { hi, lo } = across(p, width);
    const target = hi + 0.05;
    const prev = z;
    if (target < z - 0.09) z = Math.max(target, z - maxRise);
    else if (target > z + 0.09) z = Math.min(target, z + maxRise);
    if (stopAtGround && treads.length && z === prev && z - hi < 0.2) break;
    treads.push({ ...p, s, z, lo, hi });
  }
  const side = (t, k) => [t.x + t.vx * k * (width / 2 - 0.04), t.y + t.vy * k * (width / 2 - 0.04)];
  treads.forEach((t, i) => {
    const a = [t.x - t.vx * width / 2, t.y - t.vy * width / 2], b = [t.x + t.vx * width / 2, t.y + t.vy * width / 2];
    if (kind === 'solid') { bag.add(m.deck, segBox(...a, ...b, t.lo - 0.15, t.z, tread + 0.02)); return; }
    bag.add(m.deck, segBox(...a, ...b, t.z - 0.045, t.z, tread - 0.025));
    if (t.z - t.lo < 0.3) bag.add(m.dark, segBox(...a, ...b, t.lo - 0.1, t.z - 0.045, tread * 0.5)); // sville
    else if (i % 2 === 0) {
      for (const k of [-1, 1]) { // stolper ned til terrenget
        const [px, py] = side(t, k);
        bag.add(m.dark, segBox(px, py, px + t.ux * 0.09, py + t.uy * 0.09, ground(px, py) - 0.1, t.z - 0.2, 0.09));
      }
    }
    const n = treads[i + 1];
    if (n) for (const k of [-1, 1]) bag.add(m.deck, beam([...side(t, k), t.z - 0.13], [...side(n, k), n.z - 0.13], 0.045, 0.2)); // vanger
  });
  if (kind === 'wood' && rail !== 'none') {
    const ks = rail === 'both' ? [-1, 1] : [rail === 'left' ? 1 : -1];
    for (const k of ks) {
      let last = null;
      treads.forEach((t, i) => {
        if (i % 4 !== 0 && i !== treads.length - 1) return;
        const p = side(t, k);
        bag.add(m.deck, segBox(...p, p[0] + t.ux * 0.08, p[1] + t.uy * 0.08, t.z, t.z + 0.92, 0.08));
        if (last) bag.add(m.deck, beam([...last.p, last.z + 0.92], [...p, t.z + 0.92], 0.07, 0.05));
        last = { p, z: t.z };
      });
    }
  }
  const e = treads[treads.length - 1];
  return { end: e ? [e.x + e.ux * tread / 2, e.y + e.uy * tread / 2] : path[0], z: e?.z ?? z0, steps: treads.length };
}

// Gangvei med heller (granitt) lagt i terrenget. På bratte partier blir hellene smale trappeheller.
let stoneMat = null;
export function stoneMaterial() {
  if (!stoneMat) {
    const t = rockTex(512);
    stoneMat = new THREE.MeshStandardMaterial({ map: t, color: 0xcac6bc, roughness: 0.9 });
    stoneMat.name = 'heller';
  }
  return stoneMat;
}
export function stonePath(bag, path, { width = 1.1, seed = 7 } = {}) {
  let r = seed;
  const rnd = () => ((r = (r * 16807) % 2147483647) / 2147483647);
  const mat = stoneMaterial();
  const { L, at } = along(path);
  let s = 0.05;
  while (s < L - 0.1) {
    const p0 = at(s), p1 = at(Math.min(L, s + 0.8));
    const slope = Math.abs(ground(p1.x, p1.y) - ground(p0.x, p0.y)) / 0.8;
    const len = Math.min(L - s, slope < 0.15 ? 0.7 + rnd() * 0.25 : 0.38);
    const p = at(s + len / 2);
    let { hi, lo } = across(p, width);
    for (const q of [at(s), at(s + len)]) { const g = ground(q.x, q.y); hi = Math.max(hi, g); lo = Math.min(lo, g); }
    const top = hi + 0.035;
    // av og til to heller side om side, litt forskjøvet
    const parts = rnd() < 0.35 ? [[-0.5, -0.02], [0.02, 0.5]] : [[-0.5, 0.5]];
    for (const [a, b] of parts) {
      const j = (rnd() - 0.5) * 0.08, w0 = a * width + j + 0.03, w1 = b * width + j - 0.03;
      bag.add(mat, segBox(p.x + p.vx * w0, p.y + p.vy * w0, p.x + p.vx * w1, p.y + p.vy * w1, lo - 0.1, top + (rnd() - 0.5) * 0.02, len - 0.06 - rnd() * 0.04));
    }
    s += len;
  }
}

// Utedusj med spileskjerm: gulv x0..x1, y0..y1 på høyde z. wall: siden som står mot husveggen (ingen skjerm),
// door: side med åpning (inngang). Dusjhodet monteres på husveggen.
export function outdoorShower(bag, m, { x0, x1, y0, y1, z, wall = 'y1', door = 'x1' }) {
  const steel = m.steel || (m.steel = Object.assign(new THREE.MeshStandardMaterial({ color: 0xb8bcbf, metalness: 0.85, roughness: 0.25 }), { name: 'steel' }));
  // spilegulv
  const n = Math.round((x1 - x0) / 0.1);
  for (let i = 0; i < n; i++) {
    const x = x0 + ((i + 0.5) * (x1 - x0)) / n;
    bag.add(m.deck, segBox(x, y0, x, y1, z - 0.05, z, 0.075));
  }
  bag.add(m.dark, segBox(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, z - 0.25, z - 0.05, y1 - y0)); // bjelkelag/drenering
  // skjermvegger av stående spiler (1,9 m)
  const H = 1.9, sides = { x0: [x0, y0, x0, y1], x1: [x1, y0, x1, y1], y0: [x0, y0, x1, y0], y1: [x0, y1, x1, y1] };
  for (const [k, [ax, ay, bx, by]] of Object.entries(sides)) {
    if (k === wall) continue;
    const Ls = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / Ls, uy = (by - ay) / Ls;
    const open = k === door ? [Ls * 0.15, Ls * 0.85] : null; // døråpning
    const ns = Math.round(Ls / 0.1);
    for (let i = 0; i < ns; i++) {
      const t = ((i + 0.5) * Ls) / ns;
      if (open && t > open[0] && t < open[1]) continue;
      const cx = ax + ux * t, cy = ay + uy * t;
      bag.add(m.deck, segBox(cx - ux * 0.035, cy - uy * 0.035, cx + ux * 0.035, cy + uy * 0.035, z + 0.12, z + H, 0.03));
    }
    bag.add(m.deck, segBox(ax, ay, bx, by, z + H - 0.06, z + H, 0.06)); // toppbord
    for (const [px, py] of [[ax, ay], [bx, by]]) bag.add(m.deck, segBox(px - ux * 0.045, py - uy * 0.045, px + ux * 0.045, py + uy * 0.045, z - 0.25, z + H, 0.09));
  }
  // dusjrør og hode på husveggen
  const wx = wall === 'y1' || wall === 'y0' ? (x0 + x1) / 2 : wall === 'x0' ? x0 + 0.06 : x1 - 0.06;
  const wy = wall === 'y1' ? y1 - 0.06 : wall === 'y0' ? y0 + 0.06 : (y0 + y1) / 2;
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, ix = (cx - wx) * 0.25, iy = (cy - wy) * 0.25;
  bag.add(steel, segBox(wx - 0.015, wy, wx + 0.015, wy, z + 0.9, z + 2.15, 0.03));
  bag.add(steel, beam([wx, wy, z + 2.15], [wx + ix, wy + iy, z + 2.15], 0.025));
  const head = new THREE.CylinderGeometry(0.11, 0.09, 0.03, 20);
  head.translate(...P(wx + ix, wy + iy, z + 2.12).toArray());
  bag.add(steel, head);
  bag.add(steel, segBox(wx - 0.05, wy, wx + 0.05, wy, z + 1.0, z + 1.12, 0.05)); // blandebatteri
}

// Terrasse oppå det lille berget mellom terrassekroken (spisebordet) og flaggstanga.
// Berget er en flat knaus på ca. 14,6 moh. (laserdata), ca. 1 m over dagens terrasse.
// Alt i bygningsrammen (x' mot SSØ, y' mot ØNØ), se geo.js.
import * as THREE from 'three';
import { heightAt, naturalHeight, fromFrame } from './geo.js';
import { makeMaterials, segBox, prism, Bag } from './kit.js';
import { frameGroup, DECK_Z } from './site.js';

const DECK_FLOOR = DECK_Z; // dagens terrasse
export const ROCKDECK = { x0: 11.0, y1: -2.1 }; // kant mot dagens terrasse og kant mot plenen (øst)

export function buildRockDeck(scene) {
  const root = frameGroup();
  scene.add(root);
  const p = { on: false, length: 5.5, depth: 3.0, rail: 'tre', furniture: 'spise' };
  let info = {};
  const mats = makeMaterials('dagens', 'bolge', false);
  const post = new THREE.MeshStandardMaterial({ color: 0x3a2f27, roughness: 0.85 });
  const glass = new THREE.MeshPhysicalMaterial({ color: 0xcfe3e6, roughness: 0.05, transmission: 0.85, transparent: true, opacity: 0.35, thickness: 0.01 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x2b2d2f, metalness: 0.7, roughness: 0.35 });
  const teak = new THREE.MeshStandardMaterial({ color: 0x9c6b3e, roughness: 0.7 });
  const chair = new THREE.MeshStandardMaterial({ color: 0x1e1f21, roughness: 0.6 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0xe9e4d8, roughness: 0.95 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0xf1ede4, roughness: 0.9, side: THREE.DoubleSide });

  const g = (x, y) => naturalHeight(...fromFrame(x, y));

  function rebuild() {
    root.clear();
    if (!p.on) { info = {}; return info; }
    const x0 = ROCKDECK.x0, x1 = x0 + p.length, y1 = ROCKDECK.y1, y0 = y1 - p.depth;
    // dekkehøyde: litt over høyeste punkt på berget under terrassen
    let top = -1e9, low = 1e9;
    for (let i = 0; i <= 12; i++) for (let j = 0; j <= 8; j++) {
      const h = g(x0 + (p.length * i) / 12, y0 + (p.depth * j) / 8);
      top = Math.max(top, h); low = Math.min(low, h);
    }
    const z = Math.round((top + 0.18) * 20) / 20;
    const bag = new Bag();
    // dekke (bord på tvers av lengderetningen) + kantbord
    bag.add(mats.deck, prism([[x0, y0], [x1, y0], [x1, y1], [x0, y1]], z - 0.05, z, 1 / 1.2));
    for (const [ax, ay, bx, by] of [[x0, y0, x1, y0], [x1, y0, x1, y1], [x1, y1, x0, y1], [x0, y1, x0, y0]]) {
      bag.add(mats.deck, segBox(ax, ay, bx, by, z - 0.25, z, 0.03));
    }
    // stolper ned på berget (ca. hver 1,5 m)
    const nx = Math.max(2, Math.ceil(p.length / 1.5) + 1), ny = Math.max(2, Math.ceil(p.depth / 1.5) + 1);
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = x0 + 0.15 + ((p.length - 0.3) * i) / (nx - 1), y = y0 + 0.15 + ((p.depth - 0.3) * j) / (ny - 1);
      const gh = g(x, y);
      if (z - 0.25 - gh > 0.03) bag.add(post, segBox(x - 0.05, y, x + 0.05, y, gh - 0.05, z - 0.25, 0.1));
    }
    // trapp ned til dagens terrasse (i kroken ved spisebordet)
    const rise = z - DECK_FLOOR;
    const n = Math.max(1, Math.round(rise / 0.18));
    const run = 0.27, sw = 1.1, sy0 = -4.55, sy1 = sy0 + sw;
    const sx0 = x0 - n * run;
    for (let k = 0; k < n; k++) {
      const xa = sx0 + k * run, zt = DECK_FLOOR + ((k + 1) * rise) / n;
      // massive trinn (oppbygd trapp) med inntrukket opptrinn
      bag.add(mats.deck, segBox(xa, (sy0 + sy1) / 2, xa + run + 0.03, (sy0 + sy1) / 2, zt - 0.05, zt, sw));
      bag.add(post, segBox(xa + 0.03, (sy0 + sy1) / 2, xa + run, (sy0 + sy1) / 2, DECK_FLOOR, zt - 0.05, sw - 0.06));
    }
    // håndløper på sørsiden av trappa
    for (let k = 0; k <= n; k += Math.max(1, Math.floor(n / 3))) {
      const xa = sx0 + k * run + 0.1, zt = DECK_FLOOR + (k * rise) / n;
      bag.add(mats.deck, segBox(xa - 0.04, sy0 + 0.05, xa + 0.04, sy0 + 0.05, zt, zt + 0.9, 0.08));
    }
    {
      const L = Math.hypot(n * run, rise);
      const rail = new THREE.BoxGeometry(L, 0.05, 0.08);
      rail.rotateZ(Math.atan2(rise, n * run));
      rail.translate(sx0 + (n * run) / 2 + 0.1, DECK_FLOOR + rise / 2 + 0.9, -(sy0 + 0.05));
      bag.add(mats.deck, rail);
    }

    // rekkverk der fallhøyden er stor (kant mot plenen, enden mot flaggstanga og mot dagens terrasse)
    let railLen = 0;
    if (p.rail !== 'ingen') {
      const edges = [[x0, y1, x1, y1], [x1, y1, x1, y0], [x0, y0, x0, y1]];
      for (const [ax, ay, bx, by] of edges) {
        const L = Math.hypot(bx - ax, by - ay), m = Math.ceil(L / 0.5);
        for (let k = 0; k < m; k++) {
          const t0 = k / m, t1 = (k + 1) / m;
          const px0 = ax + (bx - ax) * t0, py0 = ay + (by - ay) * t0, px1 = ax + (bx - ax) * t1, py1 = ay + (by - ay) * t1;
          const mx = (px0 + px1) / 2, my = (py0 + py1) / 2;
          if (ax === x0 && bx === x0 && my > sy0 - 0.05 && my < sy1 + 0.05) continue; // trappeåpning
          // sjekk fall like utenfor kanten
          const ox = ax === bx ? Math.sign(ax - (x0 + x1) / 2) * 0.6 : 0, oy = ay === by ? Math.sign(ay - (y0 + y1) / 2) * 0.6 : 0;
          const drop = z - g(mx + ox, my + oy);
          if (drop < 0.5 && !(ax === x0 && bx === x0)) continue;
          railLen += L / m;
          if (p.rail === 'tre') {
            bag.add(mats.deck, segBox(px0, py0, px1, py1, z + 0.95, z + 1.0, 0.12));
            for (let b = 0; b < 4; b++) {
              const f = (b + 0.5) / 4, bx_ = px0 + (px1 - px0) * f, by_ = py0 + (py1 - py0) * f;
              bag.add(mats.deck, segBox(bx_ - 0.02, by_, bx_ + 0.02, by_, z, z + 0.95, 0.045));
            }
          } else {
            bag.add(glass, segBox(px0, py0, px1, py1, z + 0.05, z + 1.0, 0.012));
            bag.add(steel, segBox(px0, py0, px1, py1, z + 1.0, z + 1.04, 0.05));
          }
          if (k % 3 === 0) bag.add(p.rail === 'tre' ? mats.deck : steel, segBox(px0 - 0.04, py0, px0 + 0.04, py0, z, z + 1.02, 0.08));
        }
      }
    }

    // møbler
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    if (p.furniture === 'spise' || p.furniture === 'begge') {
      const tx = p.furniture === 'begge' ? x0 + 1.6 : cx;
      bag.add(teak, segBox(tx - 0.9, cy, tx + 0.9, cy, z + 0.72, z + 0.76, 0.9));
      for (const [a, b] of [[-0.8, -0.35], [0.8, -0.35], [-0.8, 0.35], [0.8, 0.35]]) bag.add(teak, segBox(tx + a - 0.03, cy + b, tx + a + 0.03, cy + b, z, z + 0.72, 0.06));
      const seats = [[-0.55, -0.75], [0.0, -0.75], [0.55, -0.75], [-0.55, 0.75], [0.0, 0.75], [0.55, 0.75]];
      for (const [a, b] of seats) {
        const sx = tx + a, sy = cy + b, back = Math.sign(b) * 0.22;
        bag.add(chair, segBox(sx - 0.22, sy, sx + 0.22, sy, z + 0.42, z + 0.46, 0.44));
        bag.add(chair, segBox(sx - 0.22, sy + back, sx + 0.22, sy + back, z + 0.46, z + 1.0, 0.04));
        for (const [u, v] of [[-0.19, -0.19], [0.19, -0.19], [-0.19, 0.19], [0.19, 0.19]]) bag.add(chair, segBox(sx + u - 0.015, sy + v, sx + u + 0.015, sy + v, z, z + 0.42, 0.03));
      }
      // parasoll
      if (p.length >= 4.5) {
        bag.add(steel, segBox(tx - 0.02, cy, tx + 0.02, cy, z, z + 2.3, 0.04));
        const umb = new THREE.ConeGeometry(1.4, 0.45, 8, 1, true).translate(0, z + 2.35, 0).rotateY(Math.PI / 8);
        umb.translate(tx, 0, -cy);
        bag.add(canvas, umb);
      }
    }
    if (p.furniture === 'lounge' || p.furniture === 'begge') {
      const lx0 = p.furniture === 'begge' ? x1 - 2.2 : cx - 1.0;
      for (const dy of [-0.75, 0.75]) {
        const ly = cy + dy * (p.depth > 3 ? 1 : 0.7);
        // solseng: liggeflate + hevet ryggstø mot vest (sol om kvelden)
        bag.add(steel, segBox(lx0, ly, lx0 + 1.95, ly, z + 0.28, z + 0.32, 0.65));
        bag.add(cushion, segBox(lx0 + 0.55, ly, lx0 + 1.95, ly, z + 0.32, z + 0.4, 0.6));
        const back = new THREE.BoxGeometry(0.6, 0.07, 0.6);
        back.rotateZ(-0.7); back.translate(lx0 + 0.3, z + 0.55, -ly);
        bag.add(cushion, back);
        for (const u of [0.05, 1.9]) for (const v of [-0.28, 0.28]) bag.add(steel, segBox(lx0 + u - 0.02, ly + v, lx0 + u + 0.02, ly + v, z, z + 0.3, 0.04));
      }
      bag.add(teak, segBox(lx0 + 0.6, cy, lx0 + 1.1, cy, z + 0.42, z + 0.45, 0.5));
      bag.add(teak, segBox(lx0 + 0.83, cy, lx0 + 0.87, cy, z, z + 0.42, 0.04));
    }
    bag.build(root);
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });

    const area = p.length * p.depth;
    info = { area, z, overDeck: z - DECK_FLOOR, maxDrop: z - low, steps: n, railLen,
      poly: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]].map(([x, y]) => fromFrame(x, y)), center: fromFrame(cx, cy) };
    return info;
  }
  return { root, params: p, rebuild, get info() { return info; } };
}

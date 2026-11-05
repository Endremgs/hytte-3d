// Parkeringsplass mot Hellesmoveien med støttemur, rampe og biler.
import * as THREE from 'three';
import { naturalHeight, roadAt, terrainEdits, OAK, pointInPoly, ROAD_WIDTH } from './geo.js';
import { segBox, Bag, prism } from './kit.js';
import { gravelTex, pavingTex, grassGridTex, stoneWallTex, concreteTex, deckTex } from './textures.js';

export const SURFACES = {
  grus: { name: 'Grus', make: () => gravelTex(512, [30, 8, 52]) },
  asfalt: { name: 'Asfalt', make: () => gravelTex(512, [210, 4, 22]) },
  belegg: { name: 'Belegningsstein', make: () => pavingTex(512) },
  gress: { name: 'Gressarmering', make: () => grassGridTex(512) },
};
export const WALLS = {
  stein: { name: 'Naturstein (tørrmur)', make: () => stoneWallTex(512), tile: 2.2 },
  betong: { name: 'Betong', make: () => concreteTex(256), tile: 2.4 },
  tre: { name: 'Tre (sviller/kledning)', make: () => deckTex(512, 5), tile: 1.6 },
  gabion: { name: 'Gabioner', make: () => stoneWallTex(512), tile: 1.0 },
};
const texCache = {};
const tex = (set, k) => texCache[set + k] || (texCache[set + k] = set === 's' ? SURFACES[k].make() : WALLS[k].make());

function car(color) {
  const g = new THREE.Group();
  const L = 4.47, W = 1.8;
  // sideprofil (Subaru XV-aktig crossover)
  const s = new THREE.Shape();
  const prof = [[0, 0.38], [0.05, 0.75], [0.35, 0.92], [1.05, 1.0], [1.75, 1.52], [3.2, 1.58], [3.95, 1.45], [4.42, 1.05], [4.47, 0.5], [4.4, 0.38]];
  s.moveTo(prof[0][0], prof[0][1]);
  for (const [x, y] of prof.slice(1)) s.lineTo(x, y);
  const body = new THREE.ExtrudeGeometry(s, { depth: W - 0.16, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 3 });
  body.translate(-L / 2, 0, -(W - 0.16) / 2);
  const paint = new THREE.MeshPhysicalMaterial({ color, metalness: 0.6, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.08 });
  const bm = new THREE.Mesh(body, paint);
  g.add(bm);
  // vinduer
  const w = new THREE.Shape();
  const wp = [[1.18, 1.03], [1.8, 1.48], [3.15, 1.53], [3.85, 1.42], [4.2, 1.06]];
  w.moveTo(wp[0][0], wp[0][1]);
  for (const [x, y] of wp.slice(1)) w.lineTo(x, y);
  const win = new THREE.ExtrudeGeometry(w, { depth: W + 0.01, bevelEnabled: false });
  win.translate(-L / 2, 0, -(W + 0.01) / 2);
  g.add(new THREE.Mesh(win, new THREE.MeshStandardMaterial({ color: 0x14191d, roughness: 0.05, metalness: 0.5 })));
  // plastkant nederst
  const cl = new THREE.Mesh(new THREE.BoxGeometry(L - 0.1, 0.22, W + 0.02), new THREE.MeshStandardMaterial({ color: 0x1a1a1a, roughness: 0.8 }));
  cl.position.y = 0.48; g.add(cl);
  // hjul
  const wheelG = new THREE.CylinderGeometry(0.34, 0.34, 0.24, 20).rotateX(Math.PI / 2);
  const tyre = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.9 });
  const rim = new THREE.MeshStandardMaterial({ color: 0x8a8d90, metalness: 0.8, roughness: 0.3 });
  for (const x of [-1.4, 1.25]) for (const z of [-W / 2 + 0.1, W / 2 - 0.1]) {
    const t = new THREE.Mesh(wheelG, tyre); t.position.set(x, 0.34, z); g.add(t);
    const r = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.25, 12).rotateX(Math.PI / 2), rim); r.position.set(x, 0.34, z); g.add(r);
  }
  // lykter
  const lm = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0x333333 });
  for (const z of [-0.6, 0.6]) {
    const h = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.35), lm); h.position.set(L / 2 - 0.02, 0.92, z); g.add(h);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), new THREE.MeshStandardMaterial({ color: 0x8a0f0f })); t.position.set(-L / 2 + 0.04, 1.05, z); g.add(t);
  }
  // takrails
  for (const z of [-0.65, 0.65]) { const rr = new THREE.Mesh(new THREE.BoxGeometry(1.7, 0.05, 0.05), tyre); rr.position.set(0.15, 1.62, z); g.add(rr); }
  g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
  return g;
}

export function buildParking(scene, onTerrainChange) {
  const group = new THREE.Group();
  scene.add(group);
  const p = { on: false, s: 0, cars: 2, depth: 5.0, ramp: 3.5, level: 0.5, surface: 'grus', wall: 'stein', showCars: true, rail: true };
  let edit = null, info = {};
  const cars = [car(0xb9bcbf), car(0x2a3440)];

  function frame() {
    const r = roadAt(p.s);
    const nx = r.dy, ny = -r.dx; // normal mot vest (inn på tomta)
    const roadH = naturalHeight(r.x + nx * (ROAD_WIDTH / 2), r.y + ny * (ROAD_WIDTH / 2));
    const W = p.cars === 2 ? 5.0 : 3.0;
    const f0 = ROAD_WIDTH / 2 + 0.1, f1 = f0 + p.ramp + p.depth;
    const top = roadH + p.level;
    const toLocal = (a, f) => [r.x + r.dx * a + nx * f, r.y + r.dy * a + ny * f];
    const surf = (f) => (f < f0 + p.ramp ? roadH + (p.level * (f - f0)) / Math.max(0.01, p.ramp) : top);
    return { r, nx, ny, roadH, W, f0, f1, top, toLocal, surf };
  }

  function rebuild() {
    // fjern gammelt
    const old = edit;
    group.clear();
    if (old) terrainEdits.splice(terrainEdits.indexOf(old), 1);
    edit = null;
    if (!p.on) { onTerrainChange(null, old); info = {}; return info; }
    const F = frame();
    const { r, W, f0, f1, toLocal, surf, nx, ny } = F;
    const poly = [toLocal(-W / 2, f0), toLocal(W / 2, f0), toLocal(W / 2, f1), toLocal(-W / 2, f1)];
    // terrengendring
    edit = {
      poly,
      heightAt(x, y) {
        const dx = x - r.x, dy = y - r.y;
        const a = dx * r.dx + dy * r.dy, f = dx * nx + dy * ny;
        if (Math.abs(a) <= W / 2 + 0.05 && f >= f0 - 0.2 && f <= f1 + 0.05) return surf(Math.max(f0, f)) - 0.08;
        return null;
      },
    };
    terrainEdits.push(edit);
    onTerrainChange(edit, old);

    // dekke: rutenett i (a,f)
    const na = Math.ceil(W / 0.5), nf = Math.ceil((f1 - f0) / 0.5);
    const pos = [], uv = [], idx = [];
    for (let j = 0; j <= nf; j++) for (let i = 0; i <= na; i++) {
      const a = -W / 2 + (W * i) / na, f = f0 + ((f1 - f0) * j) / nf;
      const [x, y] = toLocal(a, f);
      pos.push(x, surf(f) + 0.02, -y);
      uv.push(a / 2, f / 2);
    }
    for (let j = 0; j < nf; j++) for (let i = 0; i < na; i++) {
      const k = j * (na + 1) + i;
      idx.push(k, k + 1, k + na + 1, k + 1, k + na + 2, k + na + 1);
    }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    sg.setIndex(idx);
    sg.computeVertexNormals();
    const st = tex('s', p.surface);
    const surfMesh = new THREE.Mesh(sg, new THREE.MeshStandardMaterial({ map: st, roughness: p.surface === 'asfalt' ? 0.75 : 0.95, side: THREE.DoubleSide }));
    surfMesh.receiveShadow = true;
    group.add(surfMesh);

    // murer langs sidene og bak
    const wt = tex('w', p.wall);
    const wallMat = new THREE.MeshStandardMaterial({ map: wt, roughness: 0.95, color: p.wall === 'gabion' ? 0xb8b8b0 : 0xffffff });
    const capMat = new THREE.MeshStandardMaterial({ color: p.wall === 'tre' ? 0x5a4632 : 0x8f8d88, roughness: 0.8 });
    const railMat = new THREE.MeshStandardMaterial({ color: 0x3b3027, roughness: 0.8 });
    const bag = new Bag();
    let maxCut = 0, maxFill = 0, maxWall = 0;
    const edges = [
      [[-W / 2, f0], [-W / 2, f1]],
      [[-W / 2, f1], [W / 2, f1]],
      [[W / 2, f1], [W / 2, f0]],
    ];
    const T = 0.35;
    for (const [[a0, fa0], [a1, fa1]] of edges) {
      const L = Math.hypot(a1 - a0, fa1 - fa0), n = Math.max(1, Math.ceil(L / 0.5));
      // flytt muren litt utenfor kanten
      const oa = a0 === a1 ? Math.sign(a0) * T / 2 : 0, of = fa0 === fa1 ? T / 2 : 0;
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const A0 = a0 + (a1 - a0) * t0 + oa, F0 = fa0 + (fa1 - fa0) * t0 + of;
        const A1 = a0 + (a1 - a0) * t1 + oa, F1 = fa0 + (fa1 - fa0) * t1 + of;
        const [x0, y0] = toLocal(A0, F0), [x1, y1] = toLocal(A1, F1);
        const hn = Math.min(naturalHeight(x0, y0), naturalHeight(x1, y1));
        const hnMax = Math.max(naturalHeight(x0, y0), naturalHeight(x1, y1));
        const hs = Math.max(surf(Math.max(f0, F0 - of)), surf(Math.max(f0, F1 - of)));
        const bottom = Math.min(hn, hs) - 0.35;
        const topW = Math.max(hnMax + 0.05, hs + 0.12);
        bag.add(wallMat, segBox(x0, y0, x1, y1, bottom, topW, T, 1 / (WALLS[p.wall].tile)));
        bag.add(capMat, segBox(x0, y0, x1, y1, topW, topW + 0.06, T + 0.06));
        maxCut = Math.max(maxCut, hnMax - hs);
        maxFill = Math.max(maxFill, hs - hn);
        maxWall = Math.max(maxWall, topW - Math.min(hn, hs));
        if (p.rail && hs - hn > 1.0) {
          // rekkverk der fyllingen er høyere enn 1 m
          const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
          bag.add(railMat, segBox(mx - 0.04, my, mx + 0.04, my, topW, topW + 1.0, 0.08));
          bag.add(railMat, segBox(x0, y0, x1, y1, topW + 0.95, topW + 1.02, 0.06));
        }
      }
    }
    // terrengendring inne på flaten (skjæring/fylling)
    for (let j = 0; j <= 8; j++) for (let i = 0; i <= 8; i++) {
      const a = -W / 2 + (W * i) / 8, f = f0 + ((f1 - f0) * j) / 8;
      const [x, y] = toLocal(a, f);
      const d = surf(f) - naturalHeight(x, y);
      maxCut = Math.max(maxCut, -d); maxFill = Math.max(maxFill, d);
    }
    bag.build(group);
    // biler
    if (p.showCars) {
      const n = p.cars;
      for (let i = 0; i < n; i++) {
        const a = n === 2 ? (i ? 1.25 : -1.25) : 0;
        const f = f0 + p.ramp + p.depth / 2;
        const [x, y] = toLocal(a, f);
        const c = cars[i];
        c.position.set(x, F.top + 0.02, -y);
        c.rotation.set(0, Math.atan2(ny, nx), 0);
        // bilens +X peker inn mot tomta: retning (nx,ny) -> three (nx, -ny)
        group.add(c);
      }
    }
    // nøkkeltall
    const area = W * (p.ramp + p.depth);
    const corners = [];
    for (let i = 0; i <= 10; i++) for (let j = 0; j <= 10; j++) corners.push(toLocal(-W / 2 + (W * i) / 10, f0 + ((f1 - f0) * j) / 10));
    const dOak = Math.min(...corners.map(([x, y]) => Math.hypot(x - OAK.tree[0], y - OAK.tree[1])));
    const inZone = corners.some(([x, y]) => Math.hypot(x - OAK.x, y - OAK.y) < OAK.zone);
    info = { area, maxCut, maxFill, maxWall, slope: p.ramp > 0 ? (p.level / p.ramp) * 100 : 0, dOak, inZone, top: F.top, roadH: F.roadH, poly };
    return info;
  }

  // Velger plattformhøyde og rampe som gir minst skjæring/fylling, med rampe på maks ca. 15 %
  function fitToTerrain() {
    const save = { level: p.level, ramp: p.ramp };
    let best = null;
    for (let ramp = 1.5; ramp <= 6.01; ramp += 0.5) for (let level = -0.5; level <= 2.001; level += 0.05) {
      p.ramp = ramp; p.level = level;
      const F = frame();
      let dev = 0;
      for (let j = 0; j <= 12; j++) for (let i = 0; i <= 6; i++) {
        const f = F.f0 + ((F.f1 - F.f0) * j) / 12, a = -F.W / 2 + (F.W * i) / 6;
        dev = Math.max(dev, Math.abs(F.surf(f) - naturalHeight(...F.toLocal(a, f))));
      }
      const slope = Math.abs(level) / ramp;
      const cost = dev + Math.max(0, slope - 0.15) * 20 + ramp * 0.03;
      if (!best || cost < best.cost) best = { cost, ramp, level };
    }
    p.ramp = best ? best.ramp : save.ramp;
    p.level = best ? Math.round(best.level * 20) / 20 : save.level;
  }

  return { group, params: p, rebuild, fitToTerrain, get info() { return info; }, get poly() { return edit?.poly; } };
}

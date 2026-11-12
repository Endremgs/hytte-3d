// Byggesett for hytter: vegger med åpninger, saltak, vinduer, terrasser.
// Alt bygges i "rammen" (x' langs hytta mot SSØ, y' mot ØNØ); P() gir three.js-koordinater i en
// gruppe som er rotert inn i verden (se site.js).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { claddingTex, corrugatedTex, seamTex, shingleTex, deckTex, latticeTex, concreteTex, grassTex } from './textures.js';
import { heightAt, fromFrame } from './geo.js';

// ---------- materialer ----------
const T = {};
function tex(key, fn) { return T[key] || (T[key] = fn()); }

export const CLADDING = {
  dagens: { name: 'Mørk blågrå (som i dag)', color: 0x2b313a },
  sort: { name: 'Sort', color: 0x1b1c1e },
  gran: { name: 'Ubehandlet/grånet tre', color: 0x9a948a },
  hvit: { name: 'Hvit', color: 0xe9e9e4 },
  rod: { name: 'Rødbrun', color: 0x6b2a22 },
  oliven: { name: 'Mørk grønn', color: 0x2f3a2c },
};
export const ROOFS = {
  bolge: { name: 'Bølgeplater mørk grå (som i dag)', color: 0x55585b },
  falset: { name: 'Falsede stålplater sort', color: 0x232527 },
  shingel: { name: 'Shingel', color: 0x3a3b3e },
  torv: { name: 'Sedum/torvtak', color: 0x6f7d3a },
};

export function makeMaterials(cladKey = 'dagens', roofKey = 'bolge', vertical = false) {
  const clad = tex(vertical ? 'cladV' : 'cladH', () => claddingTex(512, !vertical, vertical ? 6 : 8));
  const roofKind = roofKey;
  const m = {};
  m.clad = new THREE.MeshStandardMaterial({ map: clad, bumpMap: clad, bumpScale: 1.2, color: CLADDING[cladKey].color, roughness: 0.82 });
  m.trim = new THREE.MeshStandardMaterial({ color: 0xf1f1ed, roughness: 0.6 });
  m.glass = new THREE.MeshStandardMaterial({ color: 0x0c1418, roughness: 0.06, metalness: 0.0, envMapIntensity: 0.8 });
  m.frame = new THREE.MeshStandardMaterial({ color: cladKey === 'hvit' ? 0x2a2c2e : 0xf1f1ed, roughness: 0.55 });
  let rtex;
  if (roofKind === 'bolge') rtex = tex('corr', () => corrugatedTex(256, 6));
  else if (roofKind === 'falset') rtex = tex('seam', () => seamTex(256, 2));
  else if (roofKind === 'shingel') rtex = tex('shingle', () => shingleTex(256));
  else rtex = tex('sedum', () => grassTex(256, false));
  m.roof = new THREE.MeshStandardMaterial({
    map: rtex, bumpMap: roofKind === 'torv' ? null : rtex, bumpScale: 2, color: ROOFS[roofKey].color,
    roughness: roofKind === 'falset' ? 0.45 : 0.85, metalness: roofKind === 'falset' ? 0.35 : 0,
  });
  m.roofEdge = new THREE.MeshStandardMaterial({ color: roofKind === 'torv' ? 0x3a2e22 : 0xf1f1ed, roughness: 0.6 });
  m.found = new THREE.MeshStandardMaterial({ map: tex('conc', () => concreteTex()), color: 0xb0aea8, roughness: 0.95 });
  m.lattice = new THREE.MeshStandardMaterial({ map: tex('lat', () => latticeTex()), alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.8 });
  m.deck = new THREE.MeshStandardMaterial({ map: tex('deck', () => deckTex()), roughness: 0.88 });
  m.floor = new THREE.MeshStandardMaterial({ color: 0xc9a77c, roughness: 0.7 });
  m.inner = new THREE.MeshStandardMaterial({ color: 0xf3f0ea, roughness: 0.9 });
  m.door = new THREE.MeshStandardMaterial({ color: 0xf3f3ef, roughness: 0.6 });
  nameMaterials(m);
  m.clad.userData.cladding = cladKey; m.clad.userData.vertical = vertical;
  return m;
}

// Navn følger med i glTF-eksporten slik at fotorealistisk rendering (tools/render) kan bytte materialer
export function nameMaterials(m) {
  for (const [k, v] of Object.entries(m)) if (v?.isMaterial) v.name = k;
  return m;
}

// ---------- geometri-hjelpere ----------
export const P = (x, y, h) => new THREE.Vector3(x, h, -y);

// Boks langs et segment (a->b i rammen) med UV i meter
export function segBox(ax, ay, bx, by, z0, z1, thick, uvScale = 1) {
  const L = Math.hypot(bx - ax, by - ay), H = z1 - z0;
  if (L < 0.01 || H < 0.01) return null;
  const g = new THREE.BoxGeometry(L, H, thick);
  const uv = g.attributes.uv;
  const dims = [[thick, H], [thick, H], [L, thick], [L, thick], [L, H], [L, H]];
  for (let f = 0; f < 6; f++) for (let k = 0; k < 4; k++) {
    const i = f * 4 + k;
    uv.setXY(i, uv.getX(i) * dims[f][0] * uvScale, uv.getY(i) * dims[f][1] * uvScale);
  }
  const ang = Math.atan2(by - ay, bx - ax);
  g.rotateY(ang); // rammens y' er -Z
  g.translate((ax + bx) / 2, (z0 + z1) / 2, -(ay + by) / 2);
  return g;
}

// Prisme fra 2D-polygon (rammen) mellom høyder
export function prism(poly, z0, z1, uvScale = 1) {
  const shape = new THREE.Shape(poly.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth: z1 - z0, bevelEnabled: false });
  // ExtrudeGeometry: xy-plan, dybde langs +z  -> roter slik at dybde = høyde
  g.rotateX(-Math.PI / 2);
  g.translate(0, z0, 0);
  const uv = g.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * uvScale, uv.getY(i) * uvScale);
  return g;
}

// Trekantet gavlfelt i et vertikalt plan
function gableTri(ax, ay, bx, by, zBase, zTop, thick) {
  const L = Math.hypot(bx - ax, by - ay);
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(L, 0), new THREE.Vector2(L / 2, zTop - zBase)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.atan2(by - ay, bx - ax));
  g.translate(ax, zBase, -ay);
  return g;
}

// Trapes i et vertikalt plan (gavl under pulttak): bunn zBase, topp zA ved a og zB ved b
function slopedWall(ax, ay, bx, by, zBase, zA, zB, thick) {
  const L = Math.hypot(bx - ax, by - ay);
  const shape = new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(L, 0), new THREE.Vector2(L, zB - zBase), new THREE.Vector2(0, zA - zBase)]);
  const g = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false });
  g.translate(0, 0, -thick / 2);
  g.rotateY(Math.atan2(by - ay, bx - ax));
  g.translate(ax, zBase, -ay);
  return g;
}

// Skrå plate (pulttak) gitt fire hjørner i rammen [x, y, z] på oversiden; u langs a->b i meter
function slab(c, th) {
  const top = c.map(([x, y, z]) => P(x, y, z));
  const bot = c.map(([x, y, z]) => P(x, y, z - th));
  const L = Math.hypot(c[1][0] - c[0][0], c[1][1] - c[0][1]);
  const W = Math.hypot(c[3][0] - c[0][0], c[3][1] - c[0][1], c[3][2] - c[0][2]);
  const pos = [], uv = [];
  const quad = (a, b, cc, d, ua = [0, 0], ub = [L, 0], uc = [L, W], ud = [0, W]) => {
    for (const [v, t] of [[a, ua], [b, ub], [cc, uc], [a, ua], [cc, uc], [d, ud]]) { pos.push(...v.toArray()); uv.push(...t); }
  };
  quad(top[0], top[1], top[2], top[3]);
  quad(bot[0], bot[3], bot[2], bot[1]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(bot[i], bot[j], top[j], top[i], [0, 0], [1, 0], [1, th], [0, th]); }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.computeVertexNormals();
  return g;
}

class Bag {
  constructor() { this.parts = new Map(); }
  add(mat, g) { if (!g) return; if (!this.parts.has(mat)) this.parts.set(mat, []); this.parts.get(mat).push(g.index ? g.toNonIndexed() : g); }
  build(group, { cast = true, receive = true, tag } = {}) {
    for (const [mat, list] of this.parts) {
      const geo = mergeGeometries(list, false);
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = cast; mesh.receiveShadow = receive;
      if (tag) mesh.userData.tag = tag;
      group.add(mesh);
    }
    return group;
  }
}

// ---------- vindu/dør ----------
function opening(bag, m, side, o, z0, wallT, { shutters = false } = {}) {
  // side: {ax,ay,bx,by,nx,ny}; o: {at, w, sill, top, kind}
  const { ax, ay, bx, by, nx, ny } = side;
  const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
  const c0 = o.at - o.w / 2, c1 = o.at + o.w / 2;
  const sx = ax + ux * c0, sy = ay + uy * c0, ex = ax + ux * c1, ey = ay + uy * c1;
  const zs = z0 + o.sill, zt = z0 + o.top;
  const off = wallT * 0.15;
  const fx = nx * off, fy = ny * off;
  const fw = 0.07;
  // karm
  bag.add(m.frame, segBox(sx + fx, sy + fy, ex + fx, ey + fy, zt - fw, zt, wallT * 0.9));
  bag.add(m.frame, segBox(sx + fx, sy + fy, ex + fx, ey + fy, zs, zs + fw, wallT * 0.9));
  bag.add(m.frame, segBox(sx + fx, sy + fy, sx + ux * fw + fx, sy + uy * fw + fy, zs, zt, wallT * 0.9));
  bag.add(m.frame, segBox(ex - ux * fw + fx, ey - uy * fw + fy, ex + fx, ey + fy, zs, zt, wallT * 0.9));
  if (o.kind === 'door') {
    bag.add(m.door, segBox(sx + ux * fw, sy + uy * fw, ex - ux * fw, ey - uy * fw, zs, zt - fw, 0.05));
  } else {
    bag.add(m.glass, segBox(sx, sy, ex, ey, zs + fw, zt - fw, 0.03));
    // sprosser for store felt
    const nPanes = o.panes ?? Math.max(1, Math.round(o.w / (o.kind === 'slide' ? 1.0 : 0.9)));
    for (let k = 1; k < nPanes; k++) {
      const t = c0 + (o.w * k) / nPanes;
      const px = ax + ux * t + fx, py = ay + uy * t + fy;
      bag.add(m.frame, segBox(px - ux * 0.03, py - uy * 0.03, px + ux * 0.03, py + uy * 0.03, zs, zt, wallT * 0.6));
    }
    if (o.sill > 0.3) {
      // vannbrett
      bag.add(m.frame, segBox(sx + nx * 0.08, sy + ny * 0.08, ex + nx * 0.08, ey + ny * 0.08, zs - 0.05, zs, 0.14));
    }
  }
  if (shutters) {
    const sw = o.w * 0.48;
    for (const [p0, dir] of [[c0, -1], [c1, 1]]) {
      const q0 = p0, q1 = p0 + dir * sw;
      bag.add(m.trim, segBox(ax + ux * Math.min(q0, q1) + nx * 0.12, ay + uy * Math.min(q0, q1) + ny * 0.12,
        ax + ux * Math.max(q0, q1) + nx * 0.12, ay + uy * Math.max(q0, q1) + ny * 0.12, zs - 0.05, zt + 0.05, 0.035));
    }
  }
}

// Vegg med åpninger langs en side
function wallWithOpenings(bag, m, side, z0, zEave, openings, wallT = 0.22) {
  const { ax, ay, bx, by } = side;
  const L = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / L, uy = (by - ay) / L;
  const os = [...openings].filter((o) => o.at - o.w / 2 > 0.05 && o.at + o.w / 2 < L - 0.05).sort((a, b) => a.at - b.at);
  let cur = 0;
  const pt = (t) => [ax + ux * t, ay + uy * t];
  for (const o of os) {
    const c0 = o.at - o.w / 2, c1 = o.at + o.w / 2;
    if (c0 > cur) bag.add(m.clad, segBox(...pt(cur), ...pt(c0), z0, zEave, wallT, 1 / 1.2));
    if (o.sill > 0.01) bag.add(m.clad, segBox(...pt(c0), ...pt(c1), z0, z0 + o.sill, wallT, 1 / 1.2));
    if (z0 + o.top < zEave) bag.add(m.clad, segBox(...pt(c0), ...pt(c1), z0 + o.top, zEave, wallT, 1 / 1.2));
    opening(bag, m, side, o, z0, wallT, { shutters: o.shutters });
    cur = Math.max(cur, c1);
  }
  if (cur < L) bag.add(m.clad, segBox(...pt(cur), bx, by, z0, zEave, wallT, 1 / 1.2));
  // hjørnekasser (hvite) som på dagens hytte
  bag.add(m.trim, segBox(ax - ux * 0.02, ay - uy * 0.02, ax + ux * 0.12, ay + uy * 0.12, z0, zEave, wallT + 0.04));
  bag.add(m.trim, segBox(bx - ux * 0.12, by - uy * 0.12, bx + ux * 0.02, by + uy * 0.02, z0, zEave, wallT + 0.04));
}

// ---------- tak ----------
function gableRoof(bag, m, r, zEave, ax) {
  // r: {x0,x1,y0,y1} vegglinjer; ax: 'x' => møne langs x'
  const ov = r.overhang ?? 0.45, pitch = ((r.pitch ?? 22) * Math.PI) / 180;
  const along0 = ax === 'x' ? r.x0 - (r.ovEnd ?? ov) : r.y0 - (r.ovEnd ?? ov);
  const along1 = ax === 'x' ? r.x1 + (r.ovEnd ?? ov) : r.y1 + (r.ovEnd ?? ov);
  const a0 = ax === 'x' ? r.y0 : r.x0, a1 = ax === 'x' ? r.y1 : r.x1;
  const half = (a1 - a0) / 2, mid = (a0 + a1) / 2;
  const rise = half * Math.tan(pitch);
  const zRidge = zEave + rise;
  const run = half + ov, slopeLen = run / Math.cos(pitch);
  const th = 0.14;
  const len = along1 - along0;
  const mk = (sign) => {
    const g = new THREE.BoxGeometry(len, th, slopeLen);
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * len / 1.0, uv.getY(i) * slopeLen / 1.0);
    // plassering: senter av takflaten
    const cAcross = mid + sign * (run / 2);
    const cz = zRidge - (run / 2) * Math.tan(pitch) + th / 2;
    if (ax === 'x') { g.rotateX(-sign * pitch); g.translate((along0 + along1) / 2, cz, -cAcross); }
    else { g.rotateX(sign * pitch); g.rotateY(Math.PI / 2); g.translate(cAcross, cz, -(along0 + along1) / 2); }
    return g;
  };
  bag.add(m.roof, mk(1));
  bag.add(m.roof, mk(-1));
  // vindskier (hvite) langs gavlene + mønebeslag
  const eaveZ = zEave - ov * Math.tan(pitch);
  for (const al of [along0, along1]) {
    for (const sign of [1, -1]) {
      const p0 = ax === 'x' ? [al, mid] : [mid, al];
      const p1 = ax === 'x' ? [al, mid + sign * run] : [mid + sign * run, al];
      const g = new THREE.BufferGeometry();
      const v = [P(p0[0], p0[1], zRidge + th), P(p1[0], p1[1], eaveZ + th), P(p1[0], p1[1], eaveZ - 0.12), P(p0[0], p0[1], zRidge - 0.12)];
      const pos = [];
      for (const [i, j, k] of [[0, 1, 2], [0, 2, 3]]) pos.push(...v[i].toArray(), ...v[j].toArray(), ...v[k].toArray());
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(12).fill(0), 2));
      g.computeVertexNormals();
      bag.add(m.roofEdge, g);
    }
  }
  // takrenner langs langsidene
  for (const sign of [1, -1]) {
    const ac = mid + sign * (run + 0.06);
    const s = ax === 'x' ? segBox(along0, ac, along1, ac, eaveZ - 0.16, eaveZ, 0.12) : segBox(ac, along0, ac, along1, eaveZ - 0.16, eaveZ, 0.12);
    bag.add(m.trim, s);
  }
  return { zRidge, eaveZ };
}

// ---------- volum ----------
// def: {x0,x1,y0,y1, floor, wallH, roof:{axis,pitch,overhang}, openings:{x0:[],x1:[],y0:[],y1:[]}, plinth:'lattice'|'concrete', interior: [rects]}
export function volume(def, m) {
  const group = new THREE.Group();
  const bag = new Bag(), roofBag = new Bag();
  const { x0, x1, y0, y1, floor } = def;
  const wallH = def.wallH ?? 2.5;
  const zE = floor + wallH;
  const sides = {
    y0: { ax: x0, ay: y0, bx: x1, by: y0, nx: 0, ny: -1 },
    x1: { ax: x1, ay: y0, bx: x1, by: y1, nx: 1, ny: 0 },
    y1: { ax: x1, ay: y1, bx: x0, by: y1, nx: 0, ny: 1 },
    x0: { ax: x0, ay: y1, bx: x0, by: y0, nx: -1, ny: 0 },
  };
  // pulttak: høy side får høyere vegg, sideveggene får skrå topp
  const shed = def.roof?.type === 'shed';
  const hi = def.roof?.high ?? 'y0';
  const span = hi[0] === 'y' ? y1 - y0 : x1 - x0;
  const zHi = shed ? zE + span * Math.tan(((def.roof.pitch ?? 8) * Math.PI) / 180) : zE;
  const lo = { x0: 'x1', x1: 'x0', y0: 'y1', y1: 'y0' }[hi];
  for (const k of Object.keys(sides)) {
    if (def.open?.includes(k)) continue;
    wallWithOpenings(bag, m, sides[k], floor, shed && k === hi ? zHi : zE, def.openings?.[k] || []);
    if (shed && k !== hi && k !== lo) {
      const sd = sides[k];
      // høyde i hvert endepunkt avhenger av avstanden fra lav side
      const zAt = (x, y) => { const d = { x0: x - x0, x1: x1 - x, y0: y - y0, y1: y1 - y }[lo]; return zE + (d / span) * (zHi - zE); };
      bag.add(m.clad, slopedWall(sd.ax, sd.ay, sd.bx, sd.by, zE, zAt(sd.ax, sd.ay), zAt(sd.bx, sd.by), 0.22));
    }
  }
  // gulv
  bag.add(m.floor, segBox(x0, (y0 + y1) / 2, x1, (y0 + y1) / 2, floor - 0.25, floor + 0.02, y1 - y0));
  // innervegger fra plan
  for (const r of def.interior || []) bag.add(m.inner, segBox(r[0], (r[1] + r[3]) / 2, r[2], (r[1] + r[3]) / 2, floor, floor + 2.4, r[3] - r[1]));
  // tak
  let roofInfo = { zRidge: zE };
  const ax = def.roof?.axis ?? 'x';
  if ((def.roof?.type ?? 'gable') === 'gable') {
    // ext0/ext1: taket forlenges forbi gavlen (f.eks. over et mellombygg inn mot en annen fløy)
    const x1r = x1 + (def.roof?.ext1 ?? 0), x0r = x0 - (def.roof?.ext0 ?? 0);
    roofInfo = gableRoof(roofBag, m, { x0: x0r, x1: x1r, y0, y1, ...def.roof }, zE, ax);
    // gavltrekanter
    if (ax === 'x') {
      if (!def.open?.includes('x0')) bag.add(m.clad, gableTri(x0, y1, x0, y0, zE, roofInfo.zRidge, 0.22));
      // tett gavlfelt der det forlengede taket møter veggen på nabofløyen
      if (def.roof?.gable0At != null) bag.add(m.clad, gableTri(def.roof.gable0At, y1, def.roof.gable0At, y0, zE, roofInfo.zRidge, 0.22));
      if (!def.open?.includes('x1') || def.roof?.ext1) bag.add(m.clad, gableTri(x1r, y0, x1r, y1, zE, roofInfo.zRidge, 0.22));
    } else {
      bag.add(m.clad, gableTri(x0, y0, x1, y0, zE, roofInfo.zRidge, 0.22));
      bag.add(m.clad, gableTri(x1, y1, x0, y1, zE, roofInfo.zRidge, 0.22));
    }
  } else if (def.roof.type === 'flat') {
    // flatt tak: beslag/gesimskasse rundt og taktekking (f.eks. sedum) på toppen
    const ov = def.roof.overhang ?? 0.3, t = def.roof.thick ?? 0.32, my = (y0 + y1) / 2;
    roofBag.add(m.roofEdge, segBox(x0 - ov, my, x1 + ov, my, zE, zE + t, y1 - y0 + 2 * ov));
    roofBag.add(m.roof, segBox(x0 - ov + 0.08, my, x1 + ov - 0.08, my, zE + t, zE + t + 0.07, y1 - y0 + 2 * ov - 0.16));
    roofInfo = { zRidge: zE + t + 0.07 };
  } else if (shed) {
    const ov = def.roof.overhang ?? 0.4, th = 0.16, tp = (zHi - zE) / span;
    // hjørner: lav side -> høy side, utvidet med takutstikk (stiger videre ut over høy side)
    const e = { x0: x0 - ov, x1: x1 + ov, y0: y0 - ov, y1: y1 + ov };
    const zLo = zE + 0.12 - ov * tp, zTop = zHi + 0.12 + ov * tp;
    const c = hi[0] === 'y'
      ? [[e.x0, e[lo], zLo], [e.x1, e[lo], zLo], [e.x1, e[hi], zTop], [e.x0, e[hi], zTop]]
      : [[e[lo], e.y0, zLo], [e[lo], e.y1, zLo], [e[hi], e.y1, zTop], [e[hi], e.y0, zTop]];
    roofBag.add(m.roofEdge, slab(c.map(([x, y, z]) => [x, y, z - 0.04]), 0.3));
    roofBag.add(m.roof, slab(c, th - 0.1));
    roofInfo = { zRidge: zTop };
  }
  // sokkel / grunnmur ned til terreng
  if (def.plinth === 'posts') posts(bag, m.dark || m.found, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], floor - 0.25, def.frameToLocal);
  else if (def.plinth !== 'none') plinth(bag, def.plinth === 'lattice' ? m.lattice : m.found, [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], floor - 0.25, def.frameToLocal);
  bag.build(group, { tag: 'body' });
  const roofGroup = new THREE.Group();
  roofBag.build(roofGroup, { tag: 'roof' });
  roofGroup.userData.isRoof = true;
  group.add(roofGroup);
  group.userData = { zRidge: roofInfo.zRidge, zEave: Math.max(zE, zHi), floor, rect: [x0, y0, x1, y1], ignoreHeight: !!def.ignoreHeight };
  return group;
}

// Skjørt fra underkant gulv ned til terrenget langs polygon (rammekoordinater)
export function plinth(bag, mat, poly, zTop, frameToLocal = fromFrame) {
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 0.6));
    for (let k = 0; k < n; k++) {
      const t0 = k / n, t1 = (k + 1) / n;
      const px0 = ax + (bx - ax) * t0, py0 = ay + (by - ay) * t0, px1 = ax + (bx - ax) * t1, py1 = ay + (by - ay) * t1;
      const g0 = heightAt(...frameToLocal(px0, py0)), g1 = heightAt(...frameToLocal(px1, py1));
      const zb = Math.min(g0, g1) - 0.3;
      if (zTop - zb > 0.05) bag.add(mat, segBox(px0, py0, px1, py1, zb, zTop, 0.08, 1 / 0.6));
    }
  }
}

// Stålsøyler ned til berget (bygg som «svever» over terrenget) og en bærebjelke rundt
export function posts(bag, mat, poly, zTop, frameToLocal = fromFrame) {
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 2.4));
    for (let k = 0; k < n; k++) {
      const px = ax + ((bx - ax) * k) / n, py = ay + ((by - ay) * k) / n;
      const ux = (bx - ax) / L, uy = (by - ay) / L, ix = -uy * 0.25, iy = ux * 0.25;
      const g = heightAt(...frameToLocal(px + ux * 0.25 + ix, py + uy * 0.25 + iy));
      bag.add(mat, segBox(px + ux * 0.2 + ix, py + uy * 0.2 + iy, px + ux * 0.32 + ix, py + uy * 0.32 + iy, g - 0.1, zTop, 0.12));
    }
    bag.add(mat, segBox(ax, ay, bx, by, zTop - 0.22, zTop, 0.16));
  }
}

// Terrasse fra polygon (rammen)
export function deck(poly, z, m, frameToLocal = fromFrame) {
  const group = new THREE.Group();
  const bag = new Bag();
  const g = prism(poly, z - 0.12, z, 1 / 1.2);
  bag.add(m.deck, g);
  plinth(bag, m.deck, poly, z - 0.12, frameToLocal);
  bag.build(group);
  return group;
}

// Enkel trapp: fra (x,y) i retning (dx,dy) ned til terreng
export function stairs(x, y, dx, dy, zTop, width, m, frameToLocal = fromFrame) {
  const group = new THREE.Group();
  const bag = new Bag();
  const L = Math.hypot(dx, dy), ux = dx / L, uy = dy / L, vx = -uy, vy = ux;
  const ground = heightAt(...frameToLocal(x + ux * 1.5, y + uy * 1.5));
  const n = Math.max(1, Math.round((zTop - ground) / 0.18));
  const rise = (zTop - ground) / n;
  for (let i = 0; i < n; i++) {
    const t = (i + 1) * 0.28;
    const cx = x + ux * t, cy = y + uy * t;
    bag.add(m.deck, segBox(cx - vx * width / 2, cy - vy * width / 2, cx + vx * width / 2, cy + vy * width / 2, ground, zTop - rise * (i + 1) + 0.04, 0.3));
  }
  bag.build(group);
  return group;
}

// Pergola / overdekning mellom volumer
export function pergola(x0, x1, y0, y1, z, m, slats = true) {
  const group = new THREE.Group();
  const bag = new Bag();
  const posts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  for (const [x, y] of posts) bag.add(m.trim, segBox(x - 0.06, y, x + 0.06, y, z - 2.5, z, 0.12));
  bag.add(m.trim, segBox(x0, y0, x1, y0, z - 0.2, z, 0.12));
  bag.add(m.trim, segBox(x0, y1, x1, y1, z - 0.2, z, 0.12));
  if (slats) {
    const n = Math.round((x1 - x0) / 0.3);
    for (let i = 0; i <= n; i++) {
      const x = x0 + ((x1 - x0) * i) / n;
      bag.add(m.trim, segBox(x, y0 - 0.2, x, y1 + 0.2, z, z + 0.18, 0.05));
    }
  } else {
    bag.add(m.roof, segBox(x0 - 0.2, (y0 + y1) / 2, x1 + 0.2, (y0 + y1) / 2, z, z + 0.15, y1 - y0 + 0.4));
  }
  bag.build(group);
  return group;
}

export { Bag };

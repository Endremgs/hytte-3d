// Nabolaget: bygg fra OpenStreetMap med høyder fra laserdata, sjø og himmel.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import buildings from '../data/buildings.json';
import { windowGridTex, waterNormalTex } from './textures.js';

function minRect(p) {
  let best = null;
  for (let i = 0; i < p.length; i++) {
    const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
    const L = Math.hypot(x1 - x0, y1 - y0);
    if (L < 0.5) continue;
    const ux = (x1 - x0) / L, uy = (y1 - y0) / L;
    let a0 = 1e9, a1 = -1e9, b0 = 1e9, b1 = -1e9;
    for (const [x, y] of p) {
      const a = x * ux + y * uy, b = -x * uy + y * ux;
      a0 = Math.min(a0, a); a1 = Math.max(a1, a); b0 = Math.min(b0, b); b1 = Math.max(b1, b);
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ux, uy, a0, a1, b0, b1 };
  }
  return best;
}
function area(p) {
  let a = 0;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) a += (p[j][0] + p[i][0]) * (p[j][1] - p[i][1]);
  return Math.abs(a / 2);
}

export function buildNeighbours(scene) {
  const walls = [], roofs = [], gables = [];
  const colTmp = new THREE.Color();
  const pushQuad = (arr, a, b, c, d, uv, col) => {
    const pos = [...a, ...b, ...c, ...a, ...c, ...d];
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([uv[0], uv[1], uv[2], uv[1], uv[2], uv[3], uv[0], uv[1], uv[2], uv[3], uv[0], uv[3]], 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(6).fill(col).flat(), 3));
    g.computeVertexNormals();
    arr.push(g);
  };
  const pushTri = (arr, a, b, c, col) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([...a, ...b, ...c], 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 1, 0, 0.5, 1], 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute([...col, ...col, ...col], 3));
    g.computeVertexNormals();
    arr.push(g);
  };
  const V = (x, y, z) => [x, z, -y];

  for (const b of buildings) {
    let p = b.p.slice();
    if (p.length > 2 && p[0][0] === p[p.length - 1][0] && p[0][1] === p[p.length - 1][1]) p.pop();
    if (p.length < 3) continue;
    // sørg for mot klokka
    let s = 0;
    for (let i = 0; i < p.length; i++) { const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length]; s += (x1 - x0) * (y1 + y0); }
    if (s > 0) p.reverse();
    const A = area(p);
    const r = minRect(p);
    if (!r) continue;
    const H = Math.max(2.4, b.top - b.g);
    const small = A < 18;
    const gable = r && A / r.area > 0.8;
    const eave = b.g + (small ? Math.min(2.3, H * 0.75) : Math.max(2.5, Math.min(H - 1.6, H * 0.62)));
    const ridge = Math.max(eave + 0.6, b.top);
    const wc = b.wall, rc = b.roof;
    const base = b.g - 0.8;
    // vegger med u = løpemeter/3, v = høyde/2.7
    let run = 0;
    const wallTop = gable ? eave : eave;
    for (let i = 0; i < p.length; i++) {
      const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
      const L = Math.hypot(x1 - x0, y1 - y0);
      pushQuad(walls, V(x0, y0, base), V(x1, y1, base), V(x1, y1, wallTop), V(x0, y0, wallTop),
        [run / 3, (base - b.g) / 2.7, (run + L) / 3, (wallTop - b.g) / 2.7], small ? wc.map((c) => c * 0.92) : wc);
      run += L;
    }
    if (gable) {
      // saltak over minste omsluttende rektangel
      const ov = 0.4;
      const along = r.a1 - r.a0 >= r.b1 - r.b0;
      const [ux, uy] = [r.ux, r.uy], [vx, vy] = [-r.uy, r.ux];
      const P = (a, bb) => [a * ux + bb * vx, a * uy + bb * vy];
      let a0 = r.a0 - ov, a1 = r.a1 + ov, b0 = r.b0 - ov, b1 = r.b1 + ov;
      if (!along) { [a0, a1, b0, b1] = [b0, b1, a0, a1]; }
      const Q = along ? P : (a, bb) => P(bb, a);
      const mid = (b0 + b1) / 2;
      const drop = ov * (ridge - eave) / ((b1 - b0) / 2 - ov);
      const ez = eave - drop;
      pushQuad(roofs, V(...Q(a0, b0), ez), V(...Q(a1, b0), ez), V(...Q(a1, mid), ridge), V(...Q(a0, mid), ridge), [0, 0, 1, 1], rc);
      pushQuad(roofs, V(...Q(a1, b1), ez), V(...Q(a0, b1), ez), V(...Q(a0, mid), ridge), V(...Q(a1, mid), ridge), [0, 0, 1, 1], rc);
      // gavler
      const g0 = a0 + ov, g1 = a1 - ov;
      pushTri(gables, V(...Q(g0, b1 - ov), eave), V(...Q(g0, b0 + ov), eave), V(...Q(g0, mid), ridge), wc);
      pushTri(gables, V(...Q(g1, b0 + ov), eave), V(...Q(g1, b1 - ov), eave), V(...Q(g1, mid), ridge), wc);
    } else {
      // flatt/valmet tak forenklet: polygon i takhøyde
      const shape = new THREE.Shape(p.map(([x, y]) => new THREE.Vector2(x, y)));
      const g = new THREE.ShapeGeometry(shape);
      g.rotateX(-Math.PI / 2);
      g.translate(0, (eave + ridge) / 2 - 0.4, 0);
      const n = g.attributes.position.count;
      g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(n).fill(rc).flat(), 3));
      // forlenger vegger opp til taket
      run = 0;
      for (let i = 0; i < p.length; i++) {
        const [x0, y0] = p[i], [x1, y1] = p[(i + 1) % p.length];
        pushQuad(gables, V(x0, y0, wallTop), V(x1, y1, wallTop), V(x1, y1, (eave + ridge) / 2 - 0.4), V(x0, y0, (eave + ridge) / 2 - 0.4), [0, 0, 1, 1], wc);
      }
      roofs.push(g.toNonIndexed());
    }
  }
  const strip = (arr) => arr.map((g) => { const o = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(o.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) o.deleteAttribute(k); if (!o.attributes.uv) o.setAttribute('uv', new THREE.Float32BufferAttribute(new Array(o.attributes.position.count * 2).fill(0), 2)); return o; });
  const group = new THREE.Group();
  const wtex = windowGridTex('#ffffff');
  const wm = new THREE.Mesh(mergeGeometries(strip(walls)), new THREE.MeshStandardMaterial({ map: wtex, vertexColors: true, roughness: 0.85 }));
  const rm = new THREE.Mesh(mergeGeometries(strip(roofs)), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, side: THREE.DoubleSide }));
  const gm = new THREE.Mesh(mergeGeometries(strip(gables)), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
  for (const m of [wm, rm, gm]) { m.castShadow = true; m.receiveShadow = true; group.add(m); }
  scene.add(group);
  return group;
}

export function buildWater(scene) {
  const nt = waterNormalTex(256);
  nt.repeat.set(90, 90);
  const mat = new THREE.MeshStandardMaterial({
    color: 0x1b3946, roughness: 0.08, metalness: 0.1, normalMap: nt, normalScale: new THREE.Vector2(0.18, 0.18), envMapIntensity: 1.2,
  });
  const water = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000).rotateX(-Math.PI / 2), mat);
  water.position.y = 0.05;
  water.receiveShadow = true;
  scene.add(water);
  water.userData.animate = (t) => { nt.offset.set(t * 0.002, t * 0.0013); };
  return water;
}

// Trær og busker plassert der laserdata (DOM - DTM) viser vegetasjon.
import * as THREE from 'three';
import veg from '../data/vegetation.json';
import splatUrl from '../data/splat.png';
import { heightAt, pointInPoly, OAK } from './geo.js';
import { leafTex, barkTex } from './textures.js';

let s0 = 1;
const rand = () => ((s0 = (s0 * 16807) % 2147483647) - 1) / 2147483646;
const RR = (a, b) => a + (b - a) * rand();

export const windUniform = { value: 0 };

function addCard(arr, cx, cy, cz, size, center, colorJitter, upBias = 0.35) {
  // tilfeldig orientert kvadrat
  const ax = new THREE.Vector3(RR(-1, 1), RR(-0.4, 0.4), RR(-1, 1)).normalize();
  const tmp = new THREE.Vector3(RR(-1, 1), RR(-1, 1), RR(-1, 1));
  const ay = new THREE.Vector3().crossVectors(ax, tmp).normalize();
  const hs = size / 2;
  const nrm = new THREE.Vector3(cx - center.x, (cy - center.y) * 0.8, cz - center.z).normalize();
  nrm.y += upBias; nrm.normalize();
  const corners = [[-1, -1, 0, 0], [1, -1, 1, 0], [1, 1, 1, 1], [-1, 1, 0, 1]];
  const base = arr.pos.length / 3;
  for (const [a, b, u, v] of corners) {
    arr.pos.push(cx + (ax.x * a + ay.x * b) * hs, cy + (ax.y * a + ay.y * b) * hs, cz + (ax.z * a + ay.z * b) * hs);
    arr.nor.push(nrm.x, nrm.y, nrm.z);
    arr.uv.push(u, v);
    arr.col.push(colorJitter[0], colorJitter[1], colorJitter[2]);
  }
  arr.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
}

function geoFrom(arr) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr.pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(arr.nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(arr.uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(arr.col, 3));
  g.setIndex(arr.idx);
  return g;
}

function branch(geos, from, to, r0, r1) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const L = dir.length();
  const g = new THREE.CylinderGeometry(r1, r0, L, 6, 1, true);
  g.translate(0, L / 2, 0);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  g.applyQuaternion(q);
  g.translate(from.x, from.y, from.z);
  geos.push(g);
}

function mergeGeos(list) {
  // enkel sammenslåing (alle har position/normal/uv, ikke-indeksert -> indeksert)
  let n = 0, m = 0;
  for (const g of list) { n += g.attributes.position.count; m += g.index ? g.index.count : g.attributes.position.count; }
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx = new Uint32Array(m);
  let o = 0, oi = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    uv.set(g.attributes.uv.array, o * 2);
    if (g.index) for (let i = 0; i < g.index.count; i++) idx[oi++] = g.index.array[i] + o;
    else for (let i = 0; i < g.attributes.position.count; i++) idx[oi++] = i + o;
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

// Referansetre: høyde 10 m, kronradius 4 m
function template(type, detail, variant) {
  s0 = 1000 + variant * 77 + type.length * 13 + detail;
  const H = 10, Rr = 4;
  const trunk = [];
  const leaves = { pos: [], nor: [], uv: [], col: [], idx: [] };
  let crownC, crownR, crownH, clusters, cardsPer, cardSize;
  if (type === 'oak') {
    crownC = new THREE.Vector3(0, H * 0.6, 0); crownR = Rr; crownH = H * 0.4;
    clusters = detail ? 46 : 12; cardsPer = detail ? 6 : 5; cardSize = detail ? 2.5 : 3.6;
    const top = new THREE.Vector3(RR(-0.3, 0.3), H * 0.38, RR(-0.3, 0.3));
    branch(trunk, new THREE.Vector3(0, -0.3, 0), top, 0.42, 0.3);
    for (let i = 0; i < (detail ? 6 : 3); i++) {
      const a = (i / 6) * Math.PI * 2 + RR(0, 0.8);
      const end = new THREE.Vector3(Math.cos(a) * Rr * 0.55, H * RR(0.55, 0.75), Math.sin(a) * Rr * 0.55);
      branch(trunk, top, end, 0.14, 0.04);
    }
  } else if (type === 'pine') {
    crownC = new THREE.Vector3(0, H * 0.78, 0); crownR = Rr * 0.95; crownH = H * 0.24;
    clusters = detail ? 30 : 9; cardsPer = detail ? 7 : 5; cardSize = detail ? 2.4 : 3.4;
    const lean = new THREE.Vector3(RR(-0.8, 0.8), H * 0.8, RR(-0.8, 0.8));
    branch(trunk, new THREE.Vector3(0, -0.3, 0), lean, 0.3, 0.15);
    for (let i = 0; i < (detail ? 5 : 2); i++) {
      const a = RR(0, 6.28);
      branch(trunk, lean.clone().multiplyScalar(RR(0.75, 0.95)), new THREE.Vector3(Math.cos(a) * Rr * 0.7, H * RR(0.75, 0.9), Math.sin(a) * Rr * 0.7), 0.1, 0.04);
    }
  } else if (type === 'birch') {
    crownC = new THREE.Vector3(0, H * 0.62, 0); crownR = Rr * 0.7; crownH = H * 0.42;
    clusters = detail ? 40 : 10; cardsPer = detail ? 6 : 5; cardSize = detail ? 2.0 : 3.0;
    branch(trunk, new THREE.Vector3(0, -0.3, 0), new THREE.Vector3(RR(-0.3, 0.3), H * 0.95, RR(-0.3, 0.3)), 0.2, 0.05);
  } else {
    // busk / kratt
    crownC = new THREE.Vector3(0, H * 0.45, 0); crownR = Rr; crownH = H * 0.5;
    clusters = detail ? 30 : 10; cardsPer = 6; cardSize = detail ? 3.6 : 4.8;
  }
  for (let c = 0; c < clusters; c++) {
    // klynger mot overflaten av kronen
    const u = RR(0, Math.PI * 2), v = Math.acos(RR(type === 'bush' ? 0 : -0.6, 1)), rr = Math.pow(RR(0.45, 1), 0.5);
    const px = Math.cos(u) * Math.sin(v) * crownR * rr;
    const pz = Math.sin(u) * Math.sin(v) * crownR * rr;
    const py = crownC.y + Math.cos(v) * crownH * rr * (type === 'pine' ? 0.8 : 1);
    const tone = RR(0.78, 1.12);
    const hueShift = RR(-0.06, 0.06);
    for (let k = 0; k < cardsPer; k++) {
      addCard(leaves, px + RR(-0.8, 0.8), py + RR(-0.6, 0.6), pz + RR(-0.8, 0.8), cardSize * RR(0.8, 1.2), crownC,
        [tone * (1 + hueShift), tone, tone * (1 - hueShift)]);
    }
  }
  return { trunk: trunk.length ? mergeGeos(trunk) : null, leaves: geoFrom(leaves), H, Rr };
}

function leafMaterial(tex, tint) {
  const m = new THREE.MeshStandardMaterial({
    map: tex, alphaTest: 0.38, alphaToCoverage: true, side: THREE.DoubleSide, vertexColors: true, color: tint, roughness: 0.85, metalness: 0,
  });
  m.envMapIntensity = 0.6;
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    // kompenser for at alfa blir svakere i mipmaps (ellers blir trær «tynne» på avstand)
    sh.fragmentShader = sh.fragmentShader.replace('#include <alphatest_fragment>',
      'diffuseColor.a = clamp(diffuseColor.a * (1.0 + 2.5 * clamp(length(fwidth(vMapUv)) * 256.0 - 0.5, 0.0, 2.0)), 0.0, 1.0);\n#include <alphatest_fragment>');
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = instanceMatrix[3].xyz;
          float ph = ip.x * 0.37 + ip.z * 0.21;
          float sway = max(0.0, transformed.y - 3.0) * 0.012;
          transformed.x += sin(uWind * 1.7 + ph + transformed.y * 0.3) * sway;
          transformed.z += cos(uWind * 1.3 + ph * 1.3) * sway * 0.7;
        #endif`);
  };
  return m;
}

function distToPoly(x, y, poly) {
  let d = 1e9;
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2));
    d = Math.min(d, Math.hypot(x - ax - dx * t, y - ay - dy * t));
  }
  return d;
}

function hash(n) {
  const x = Math.sin(n * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

export function buildVegetation(scene) {
  const group = new THREE.Group();
  scene.add(group);
  const texOak = leafTex('oak'), texBirch = leafTex('birch'), texPine = leafTex('pine'), texBush = leafTex('bush');
  const barkMat = new THREE.MeshStandardMaterial({ map: barkTex(128), roughness: 1 });
  const birchBark = new THREE.MeshStandardMaterial({ map: barkTex(128, true), roughness: 0.9 });
  const mats = {
    oak: leafMaterial(texOak, new THREE.Color(0.62, 0.72, 0.42)),
    birch: leafMaterial(texBirch, new THREE.Color(0.75, 0.85, 0.45)),
    pine: leafMaterial(texPine, new THREE.Color(0.7, 0.78, 0.6)),
    bush: leafMaterial(texBush, new THREE.Color(0.62, 0.74, 0.42)),
  };

  // kategoriser trær
  const items = [];
  for (const [x, y, g, h, r, seed] of veg.trees) {
    const hr = hash(seed + 1);
    let type = hr < 0.55 ? 'oak' : hr < 0.78 ? 'pine' : hr < 0.92 ? 'birch' : 'bush';
    if (h < 4.5 && type === 'pine') type = 'bush';
    if (Math.hypot(x - OAK.tree[0], y - OAK.tree[1]) < 3) type = 'oak';
    const near = Math.hypot(x, y) < 170;
    items.push({ x, y, h, r: Math.max(r * 0.85, h * 0.26), type, near, v: seed % 3 });
  }
  for (const [x, y, g, h] of veg.shrubs) items.push({ x, y, h: Math.max(0.9, h), r: Math.max(0.9, h * 0.9), type: 'bush', near: true, v: Math.floor(hash(x * 7 + y) * 3), shrub: true });

  const buckets = new Map();
  for (const it of items) {
    const key = `${it.type}|${it.near ? 1 : 0}|${it.v}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(it);
  }
  const meshes = [];
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), ps = new THREE.Vector3();
  for (const [key, list] of buckets) {
    const [type, near, v] = key.split('|');
    const t = template(type, near === '1' ? 1 : 0, +v);
    const leafMesh = new THREE.InstancedMesh(t.leaves, mats[type], list.length);
    const trunkMesh = t.trunk ? new THREE.InstancedMesh(t.trunk, type === 'birch' ? birchBark : barkMat, list.length) : null;
    list.forEach((it, i) => {
      it.mesh = leafMesh; it.trunk = trunkMesh; it.index = i;
      const gh = heightAt(it.x, it.y);
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), hash(it.x * 3.1 + it.y) * Math.PI * 2);
      sc.set(it.r / t.Rr, it.h / t.H, it.r / t.Rr);
      ps.set(it.x, gh, -it.y);
      m4.compose(ps, q, sc);
      it.matrix = m4.clone();
      leafMesh.setMatrixAt(i, m4);
      if (trunkMesh) trunkMesh.setMatrixAt(i, m4);
    });
    leafMesh.castShadow = near === '1';
    leafMesh.receiveShadow = true;
    group.add(leafMesh);
    meshes.push(leafMesh);
    if (trunkMesh) { trunkMesh.castShadow = near === '1'; group.add(trunkMesh); meshes.push(trunkMesh); }
  }

  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  function setExclusions(polys) {
    // skjul trær som står der nye bygg/parkering skal ligge
    for (const it of items) {
      if (Math.hypot(it.x, it.y) > 60) continue;
      const hidden = polys.some((p) => pointInPoly(it.x, it.y, p) || distToPoly(it.x, it.y, p) < Math.min(2.5, it.r * 0.5));
      const m = hidden ? zero : it.matrix;
      it.mesh.setMatrixAt(it.index, m);
      if (it.trunk) it.trunk.setMatrixAt(it.index, m);
      it.mesh.instanceMatrix.needsUpdate = true;
      if (it.trunk) it.trunk.instanceMatrix.needsUpdate = true;
    }
  }

  const grass = buildGrassTufts(group);
  return { group, setExclusions, items, grass };
}

// Høyt gress / urter i kantsoner (der det ikke er klipt plen, berg eller vei)
function buildGrassTufts(group) {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const g = c.getContext('2d');
  for (let i = 0; i < 70; i++) {
    const x = 10 + Math.random() * 108, h = 50 + Math.random() * 75, bend = (Math.random() - 0.5) * 30;
    const dry = Math.random() < 0.35;
    g.strokeStyle = dry ? `hsl(${45 + Math.random() * 10},${35 + Math.random() * 20}%,${55 + Math.random() * 15}%)` : `hsl(${75 + Math.random() * 30},${35 + Math.random() * 25}%,${28 + Math.random() * 18}%)`;
    g.lineWidth = 1 + Math.random() * 1.5;
    g.beginPath(); g.moveTo(x, 128); g.quadraticCurveTo(x + bend * 0.3, 128 - h * 0.6, x + bend, 128 - h); g.stroke();
    if (dry && Math.random() < 0.5) { g.fillStyle = g.strokeStyle; g.beginPath(); g.ellipse(x + bend, 128 - h, 2, 6, 0, 0, 7); g.fill(); }
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const quad = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
  const q2 = quad.clone().rotateY(Math.PI / 2);
  const q3 = quad.clone().rotateY(Math.PI / 4);
  const geo = mergeGeos([quad, q2, q3]);
  // normaler opp for mykere lys
  const nr = geo.attributes.normal;
  for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
  const mat = new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: 0xc8d0b0 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uWind = windUniform;
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nuniform float uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec3 ip = instanceMatrix[3].xyz;
        transformed.x += sin(uWind * 2.3 + ip.x * 0.5 + ip.z * 0.3) * 0.12 * transformed.y;
        #endif`);
  };
  const max = 26000;
  const mesh = new THREE.InstancedMesh(geo, mat, max);
  mesh.count = 0;
  mesh.receiveShadow = true;
  group.add(mesh);

  const img = new Image();
  const pts = [];
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 1024;
    const cg = cv.getContext('2d');
    cg.drawImage(img, 0, 0);
    const d = cg.getImageData(0, 0, 1024, 1024).data;
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
    let n = 0, tries = 0;
    while (n < max && tries < 400000) {
      tries++;
      const r = Math.sqrt(Math.random()) * 75, a = Math.random() * Math.PI * 2;
      const x = Math.cos(a) * r, y = Math.sin(a) * r;
      const i = Math.floor((128 - y) / 0.25), j = Math.floor((x + 128) / 0.25);
      const k = (i * 1024 + j) * 4;
      const rock = d[k], lawn = d[k + 1], road = d[k + 2];
      if (lawn > 60 || road > 40) continue;
      if (rock > 120 && Math.random() < 0.85) continue;
      // jordet (øst for veien): færre, lavere
      const field = x > 22 && y < 30;
      if (field && Math.random() < 0.55) continue;
      const hgt = field ? 0.25 + Math.random() * 0.35 : 0.35 + Math.random() * 0.7;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI);
      s.set(hgt * 1.4, hgt, hgt * 1.4);
      p.set(x, heightAt(x, y) - 0.03, -y);
      m4.compose(p, q, s);
      mesh.setMatrixAt(n, m4);
      pts.push([x, y, n]);
      n++;
    }
    mesh.count = n;
    mesh.instanceMatrix.needsUpdate = true;
  };
  img.src = splatUrl;
  const zero = new THREE.Matrix4().makeScale(0, 0, 0);
  return {
    mesh,
    hideIn(polys) {
      // gress forsvinner under parkering/bygg
      const m4 = new THREE.Matrix4();
      for (const [x, y, n] of pts) {
        if (polys.some((p) => pointInPoly(x, y, p))) mesh.setMatrixAt(n, zero);
        else {
          mesh.getMatrixAt(n, m4);
          if (m4.elements[0] === 0) {
            const hgt = 0.5;
            m4.compose(new THREE.Vector3(x, heightAt(x, y) - 0.03, -y), new THREE.Quaternion(), new THREE.Vector3(hgt * 1.4, hgt, hgt * 1.4));
            mesh.setMatrixAt(n, m4);
          }
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}

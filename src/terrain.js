import * as THREE from 'three';
import { heightAt, naturalHeight, FAR } from './geo.js';
import { grassTex, rockTex, gravelTex } from './textures.js';
import orthoIn from '../data/ortho_in.jpg';
import orthoFar from '../data/ortho_far.jpg';
import ortho4k from '../data/ortho_4k.jpg';
import terrain4k from '../data/terrain_4k.bin';
import splatUrl from '../data/splat.png';
import fieldUrl from '../data/field.png';
import planEks from '../data/plan_eks.jpg';
import planV1 from '../data/plan_V1.jpg';
import planV2 from '../data/plan_V2.jpg';
import planV3 from '../data/plan_V3.jpg';
import planV4 from '../data/plan_V4.jpg';

const loader = new THREE.TextureLoader();
function load(url, srgb = true) {
  const t = loader.load(url);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = 8;
  return t;
}

export const PLANS = { eks: planEks, V1: planV1, V2: planV2, V3: planV3, V4: planV4 };
const planTex = {};
export function planTexture(key) {
  if (!planTex[key]) planTex[key] = load(PLANS[key]);
  return planTex[key];
}

const STEP = 0.5, HALF = 128;
const N = HALF * 2 / STEP + 1;

export const terrainUniforms = {
  tOrtho: { value: null }, tSplat: { value: null }, tField: { value: null },
  tGrass: { value: null }, tMeadow: { value: null }, tRock: { value: null }, tGravel: { value: null },
  tPlan: { value: null }, planOpacity: { value: 0 },
  tOrthoFar: { value: null }, tOrtho4k: { value: null }, uSummer: { value: 1 },
};

const COMMON = /* glsl */ `
uniform sampler2D tOrtho, tSplat, tField, tGrass, tMeadow, tRock, tGravel, tPlan, tOrthoFar, tOrtho4k;
uniform float planOpacity, uSummer;
varying vec3 vWorldP;
vec3 summerize(vec3 c) {
  float l = dot(c, vec3(0.3, 0.59, 0.11));
  // vinterbildet fra satellitt -> sommergrønt (beholder lys/mørke-variasjon)
  vec3 green = vec3(0.20, 0.30, 0.10) * (0.55 + 1.6 * l);
  float isRock = smoothstep(0.30, 0.42, l) * (1.0 - smoothstep(0.02, 0.07, c.g - c.b));
  vec3 rock = vec3(0.45, 0.44, 0.42) * (0.6 + l);
  vec3 s = mix(green, rock, isRock);
  float water = smoothstep(0.02, 0.0, c.r - c.b + 0.02) * smoothstep(0.25, 0.12, l);
  s = mix(s, c, water);
  return mix(c, s, uSummer);
}
vec3 tri(sampler2D t, vec2 p) {
  // to skalaer for å skjule repetisjon
  vec3 a = texture2D(t, p).rgb;
  vec3 b = texture2D(t, p * 0.137 + 0.31).rgb;
  return a * (0.75 + 0.5 * dot(b, vec3(0.33)));
}
`;

function patchShader(mat, inner, horizon = false) {
  // Egen cache-nøkkel per variant: ellers deler three.js programmet (samme onBeforeCompile-kildekode)
  // og horisontmeshen tegnes uten discard – synlig over nedgravde flater som parkeringen.
  mat.customProgramCacheKey = () => `terrain-${horizon ? 'horizon' : inner ? 'inner' : 'far'}`;
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, terrainUniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldP;')
      .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvWorldP = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    let frag = sh.fragmentShader.replace('#include <common>', '#include <common>\n' + COMMON);
    if (horizon) {
      frag = frag.replace('#include <map_fragment>', /* glsl */ `
        vec2 lp = vec2(vWorldP.x, -vWorldP.z);
        if (max(abs(lp.x), abs(lp.y)) < 509.0) discard;
        vec3 col = summerize(texture2D(tOrtho4k, (lp + 2048.0) / 4096.0).rgb) * 1.1;
        diffuseColor.rgb *= col;
      `);
    } else if (inner) {
      frag = frag.replace('#include <map_fragment>', /* glsl */ `
        vec2 lp = vec2(vWorldP.x, -vWorldP.z);
        vec2 ouv = (lp + 128.0) / 256.0;
        vec3 ortho = texture2D(tOrtho, ouv).rgb;
        vec3 spl = texture2D(tSplat, ouv).rgb;
        float field = texture2D(tField, ouv).r;
        float ol = dot(ortho, vec3(0.3, 0.59, 0.11));
        float macro = clamp(ol / 0.30, 0.65, 1.3);
        vec3 lawn = tri(tGrass, lp * 0.55);
        vec3 meadow = tri(tMeadow, lp * 0.42);
        vec3 rock = tri(tRock, lp * 0.33) * vec3(1.08, 1.0, 0.9);
        vec3 gravel = tri(tGravel, lp * 0.6);
        vec3 natural = meadow * mix(1.0, macro, 0.6);
        natural = mix(natural, summerize(ortho) * 1.15, 0.25);
        vec3 col = mix(natural, lawn * mix(1.0, macro, 0.25), smoothstep(0.2, 0.8, spl.g));
        vec3 fieldCol = mix(meadow * vec3(1.05, 1.08, 0.82), lawn * vec3(1.1, 1.08, 0.75), 0.5) * mix(1.0, macro, 0.35);
        col = mix(col, fieldCol, field);
        // bratt terreng uten vegetasjon -> berg
        float slope = 1.0 - normalize(vNormal).y;
        float rk = max(smoothstep(0.25, 0.75, spl.r), 0.0);
        col = mix(col, rock * mix(1.0, macro, 0.3), rk);
        col = mix(col, gravel, smoothstep(0.3, 0.7, spl.b));
        // fade til ortofoto-basert farge mot kanten
        float edge = smoothstep(105.0, 126.0, max(abs(lp.x), abs(lp.y)));
        col = mix(col, summerize(texture2D(tOrthoFar, (lp + 512.0) / 1024.0).rgb), edge);
        vec2 puv = vec2((lp.x + 40.0) / 88.0, (lp.y + 48.0) / 88.0);
        if (planOpacity > 0.0 && puv.x > 0.0 && puv.x < 1.0 && puv.y > 0.0 && puv.y < 1.0) {
          vec3 pc = texture2D(tPlan, puv).rgb;
          col = mix(col, pc, planOpacity * (1.0 - step(2.95, pc.r + pc.g + pc.b) * 0.7));
        }
        diffuseColor.rgb *= col;
        float rough = mix(0.96, 0.82, rk);
      `).replace('#include <roughnessmap_fragment>', 'float roughnessFactor = rough;');
    } else {
      frag = frag.replace('#include <map_fragment>', /* glsl */ `
        vec2 lp = vec2(vWorldP.x, -vWorldP.z);
        if (max(abs(lp.x), abs(lp.y)) < 126.5) discard;
        vec3 col = summerize(texture2D(tOrthoFar, (lp + 512.0) / 1024.0).rgb) * 1.1;
        float fade = smoothstep(420.0, 512.0, max(abs(lp.x), abs(lp.y)));
        col = mix(col, vec3(0.28, 0.34, 0.22), fade * 0.6);
        diffuseColor.rgb *= col;
      `);
    }
    sh.fragmentShader = frag;
  };
}

export function buildTerrain(scene) {
  terrainUniforms.tOrtho.value = load(orthoIn);
  terrainUniforms.tOrthoFar.value = load(orthoFar);
  terrainUniforms.tSplat.value = load(splatUrl, false);
  terrainUniforms.tField.value = load(fieldUrl, false);
  terrainUniforms.tGrass.value = grassTex(512, true);
  terrainUniforms.tMeadow.value = grassTex(512, false);
  terrainUniforms.tRock.value = rockTex(512);
  terrainUniforms.tGravel.value = gravelTex(512);
  terrainUniforms.tPlan.value = planTexture('eks');

  // --- nærterreng 0.5 m ---
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * N * 3);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = -HALF + i * STEP, y = HALF - j * STEP, k = (j * N + i) * 3;
    pos[k] = x; pos[k + 1] = heightAt(x, y); pos[k + 2] = -y;
  }
  const idx = new Uint32Array((N - 1) * (N - 1) * 6);
  let p = 0;
  for (let j = 0; j < N - 1; j++) for (let i = 0; i < N - 1; i++) {
    const a = j * N + i, b = a + 1, c = a + N, d = c + 1;
    idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
  }
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, metalness: 0 });
  patchShader(mat, true);
  const inner = new THREE.Mesh(geo, mat);
  inner.receiveShadow = true;
  inner.name = 'terrain';
  scene.add(inner);

  // --- fjernterreng 2 m ---
  const n = FAR.n;
  const g2 = new THREE.BufferGeometry();
  const p2 = new Float32Array(n * n * 3);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const x = -FAR.half + i * FAR.step, y = FAR.half - j * FAR.step, k = (j * n + i) * 3;
    p2[k] = x; p2[k + 1] = FAR.data[j * n + i] / 100 - 0.03; p2[k + 2] = -y;
  }
  const i2 = new Uint32Array((n - 1) * (n - 1) * 6);
  p = 0;
  for (let j = 0; j < n - 1; j++) for (let i = 0; i < n - 1; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    i2[p++] = a; i2[p++] = c; i2[p++] = b; i2[p++] = b; i2[p++] = c; i2[p++] = d;
  }
  g2.setAttribute('position', new THREE.BufferAttribute(p2, 3));
  g2.setIndex(new THREE.BufferAttribute(i2, 1));
  g2.computeVertexNormals();
  const m2 = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.97 });
  patchShader(m2, false);
  const far = new THREE.Mesh(g2, m2);
  far.receiveShadow = true;
  scene.add(far);

  // horisont: 4 x 4 km, 8 m rutenett
  terrainUniforms.tOrtho4k.value = load(ortho4k);
  const h4 = new Int16Array(terrain4k.buffer, terrain4k.byteOffset, terrain4k.byteLength / 2);
  const n4 = 512;
  const g4 = new THREE.BufferGeometry();
  const p4 = new Float32Array(n4 * n4 * 3);
  for (let j = 0; j < n4; j++) for (let i = 0; i < n4; i++) {
    const k = (j * n4 + i) * 3;
    p4[k] = -2044 + i * 8; p4[k + 1] = h4[j * n4 + i] / 100 - 0.25; p4[k + 2] = -(2044 - j * 8);
  }
  const i4 = new Uint32Array((n4 - 1) * (n4 - 1) * 6);
  p = 0;
  for (let j = 0; j < n4 - 1; j++) for (let i = 0; i < n4 - 1; i++) {
    const a = j * n4 + i, b = a + 1, c = a + n4, d = c + 1;
    i4[p++] = a; i4[p++] = c; i4[p++] = b; i4[p++] = b; i4[p++] = c; i4[p++] = d;
  }
  g4.setAttribute('position', new THREE.BufferAttribute(p4, 3));
  g4.setIndex(new THREE.BufferAttribute(i4, 1));
  g4.computeVertexNormals();
  const m4 = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 });
  patchShader(m4, false, true);
  scene.add(new THREE.Mesh(g4, m4));
  const ring = new THREE.Mesh(new THREE.RingGeometry(1900, 9000, 64, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x1b3946 }));
  ring.position.y = -1.5;
  scene.add(ring);
  for (const mm of [mat, m2, m4]) mm.envMapIntensity = 0.45;

  function refresh(minx, maxx, miny, maxy) {
    const i0 = Math.max(0, Math.floor((minx + HALF) / STEP)), i1 = Math.min(N - 1, Math.ceil((maxx + HALF) / STEP));
    const j0 = Math.max(0, Math.floor((HALF - maxy) / STEP)), j1 = Math.min(N - 1, Math.ceil((HALF - miny) / STEP));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = (j * N + i) * 3;
      pos[k + 1] = heightAt(pos[k], -pos[k + 2]);
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeVertexNormals();
  }
  return { mesh: inner, far, refresh };
}

// Linje draperet på terrenget
export function drapeLine(points, color, { closed = true, lift = 0.08, dashed = false, width = 1 } = {}) {
  const pts = [];
  const P = closed ? [...points, points[0]] : points;
  for (let i = 0; i < P.length - 1; i++) {
    const [x0, y0] = P[i], [x1, y1] = P[i + 1];
    const L = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.ceil(L / 0.5));
    for (let k = 0; k < n; k++) {
      const f = k / n, x = x0 + (x1 - x0) * f, y = y0 + (y1 - y0) * f;
      pts.push(new THREE.Vector3(x, naturalHeight(x, y) + lift, -y));
    }
  }
  const [xl, yl] = P[P.length - 1];
  pts.push(new THREE.Vector3(xl, naturalHeight(xl, yl) + lift, -yl));
  const g = new THREE.BufferGeometry().setFromPoints(pts);
  const m = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.8, gapSize: 0.5, depthTest: true, transparent: true, opacity: 0.95 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const line = new THREE.Line(g, m);
  if (dashed) line.computeLineDistances();
  line.renderOrder = 5;
  return line;
}

// Fyllt flate draperet på terrenget (sone)
export function drapeDisk(cx, cy, r, color, opacity = 0.25) {
  const seg = 64, rings = 12;
  const pos = [], idx = [];
  pos.push(cx, naturalHeight(cx, cy) + 0.1, -cy);
  for (let k = 1; k <= rings; k++) for (let s = 0; s < seg; s++) {
    const a = (s / seg) * Math.PI * 2, rr = (r * k) / rings;
    const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr;
    pos.push(x, naturalHeight(x, y) + 0.1, -y);
  }
  for (let s = 0; s < seg; s++) idx.push(0, 1 + s, 1 + ((s + 1) % seg));
  for (let k = 1; k < rings; k++) for (let s = 0; s < seg; s++) {
    const a = 1 + (k - 1) * seg + s, b = 1 + (k - 1) * seg + ((s + 1) % seg), c = a + seg, d = b + seg;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  const m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(g, m);
  mesh.renderOrder = 4;
  return mesh;
}

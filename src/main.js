import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';
import { Sky } from 'three/addons/objects/Sky.js';
import parcels from '../data/parcels.json';
import { heightAt, naturalHeight, fromFrame, OAK, roadSOf, polyArea } from './geo.js';
import { buildTerrain, drapeLine, drapeDisk, terrainUniforms, planTexture } from './terrain.js';
import { buildVegetation, windUniform } from './vegetation.js';
import { buildNeighbours, buildWater } from './context.js';
import { buildSite, VARIANTS } from './site.js';
import { buildParking, SURFACES, WALLS } from './parking.js';
import { buildRockDeck } from './rockdeck.js';
import { DECK } from './site.js';
import { CLADDING, ROOFS } from './kit.js';
import { sunVector, sunTimes } from './sun.js';

const app = document.getElementById('app');
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(app.clientWidth, app.clientHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 0.72;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
app.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xb9cbe0, 900, 6500);
const camera = new THREE.PerspectiveCamera(55, app.clientWidth / app.clientHeight, 0.1, 9000);

// ---------- himmel og sol ----------
const sky = new Sky();
sky.scale.setScalar(8000);
const su = sky.material.uniforms;
su.turbidity.value = 4; su.rayleigh.value = 1.2; su.mieCoefficient.value = 0.004; su.mieDirectionalG.value = 0.8;
scene.add(sky);
const sun = new THREE.DirectionalLight(0xfff1dc, 3.2);
sun.castShadow = true;
const TOUCH = matchMedia('(pointer: coarse)').matches;
sun.shadow.mapSize.set(TOUCH ? 2048 : 4096, TOUCH ? 2048 : 4096);
const SC = sun.shadow.camera;
SC.left = -75; SC.right = 75; SC.top = 75; SC.bottom = -75; SC.near = 1; SC.far = 600;
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
scene.add(sun, sun.target);
sun.target.position.set(0, 12, 0);
const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x6a7448, 0.5);
scene.add(hemi);
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene();
const skyClone = new Sky(); skyClone.scale.setScalar(1000); skyScene.add(skyClone);
let envRT = null;

const state = {
  variant: 'eks', month: 7, day: 15, hour: 19.0,
  cladding: 'dagens', roof: 'bolge', vertical: false,
  roofs: true, ghosts: true, propLines: true, plan: false, oak: true, mode: 'orbit',
};

function updateSun() {
  const v = sunVector(state.month, state.day, state.hour);
  const dir = new THREE.Vector3(v.x, v.y, v.z);
  su.sunPosition.value.copy(dir);
  skyClone.material.uniforms.sunPosition.value.copy(dir);
  for (const k of ['turbidity', 'rayleigh', 'mieCoefficient', 'mieDirectionalG']) skyClone.material.uniforms[k].value = su[k].value;
  sun.position.copy(dir).multiplyScalar(300).add(sun.target.position);
  const e = Math.max(0, v.elevation);
  sun.intensity = v.elevation > 0 ? 3.4 * Math.min(1, e / 12 + 0.15) : 0;
  sun.color.setHSL(0.09, 0.8, 0.5 + Math.min(0.42, e / 60));
  hemi.intensity = 0.2 + Math.min(0.45, Math.max(0, (v.elevation + 6) / 35));
  renderer.toneMappingExposure = v.elevation > 5 ? 0.72 : 0.72 + (5 - Math.max(-8, v.elevation)) * 0.05;
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(skyScene, 0, 0.1, 2000);
  scene.environment = envRT.texture;
  scene.environmentIntensity = 0.55;
  const fogC = new THREE.Color().setHSL(0.58, 0.35, 0.55 + Math.min(0.25, e / 100));
  if (v.elevation < 4) fogC.lerp(new THREE.Color(0xe0b48a), (4 - Math.max(-4, v.elevation)) / 10);
  scene.fog.color.copy(fogC);
  document.getElementById('sunInfo').textContent = `Solhøyde ${v.elevation.toFixed(0)}°, retning ${v.azimuth.toFixed(0)}° (${compass(v.azimuth)})`;
}
const compass = (a) => ['N', 'NØ', 'Ø', 'SØ', 'S', 'SV', 'V', 'NV'][Math.round(a / 45) % 8];

// ---------- verden ----------
const terrain = buildTerrain(scene);
const veg = buildVegetation(scene);
buildNeighbours(scene);
const water = buildWater(scene);
const site = buildSite(scene, state);

const overlays = new THREE.Group();
scene.add(overlays);
const prop = parcels.prop;
overlays.add(drapeLine(prop, 0xff3b8d, { lift: 0.12 }));
// 4 m og 1 m fra eiendomsgrensen (byggegrense i arkitektens plan)
function offsetPoly(poly, d) {
  const n = poly.length - (poly[0][0] === poly[poly.length - 1][0] ? 1 : 0);
  const P = poly.slice(0, n);
  const sgn = polyArea(P) && (() => { let s = 0; for (let i = 0; i < n; i++) { const [a, b] = P[i], [c, e] = P[(i + 1) % n]; s += (c - a) * (e + b); } return s > 0 ? 1 : -1; })();
  const lines = P.map((p, i) => {
    const q = P[(i + 1) % n], dx = q[0] - p[0], dy = q[1] - p[1], L = Math.hypot(dx, dy);
    const nx = (sgn * dy) / L, ny = (-sgn * dx) / L; // innover
    return [p[0] - nx * d, p[1] - ny * d, dx, dy];
  });
  const out = [];
  for (let i = 0; i < n; i++) {
    const [x1, y1, dx1, dy1] = lines[(i + n - 1) % n], [x2, y2, dx2, dy2] = lines[i];
    const den = dx1 * dy2 - dy1 * dx2;
    if (Math.abs(den) < 1e-6) { out.push([x2, y2]); continue; }
    const t = ((x2 - x1) * dy2 - (y2 - y1) * dx2) / den;
    out.push([x1 + dx1 * t, y1 + dy1 * t]);
  }
  return out;
}
const set4 = offsetPoly(prop, 4.0);
const area4 = Math.abs(polyArea(set4));
const area4b = Math.abs(polyArea(offsetPoly(prop, -4.0)));
const setback = area4 < area4b ? set4 : offsetPoly(prop, -4.0);
overlays.add(drapeLine(setback, 0x1fb5a8, { dashed: true, lift: 0.1 }));
const nb = new THREE.Group();
for (const rings of Object.values(parcels.neighbours)) for (const r of rings) nb.add(drapeLine(r, 0xffd36b, { lift: 0.09 }));
nb.children.forEach((l) => { l.material.opacity = 0.45; });
overlays.add(nb);
const oakGroup = new THREE.Group();
oakGroup.add(drapeDisk(OAK.x, OAK.y, OAK.zone, 0xff8a00, 0.16));
oakGroup.add(drapeLine(Array.from({ length: 64 }, (_, i) => [OAK.x + Math.cos((i / 64) * Math.PI * 2) * OAK.zone, OAK.y + Math.sin((i / 64) * Math.PI * 2) * OAK.zone]), 0xff8a00, { lift: 0.14 }));
{
  const c = document.createElement('canvas'); c.width = 640; c.height = 150;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,138,0,0.92)'; g.beginPath(); g.roundRect(4, 4, 632, 142, 24); g.fill();
  g.fillStyle = '#fff'; g.font = '600 50px system-ui'; g.textAlign = 'center';
  g.fillText('Hule eik «Hellesmo 1»', 320, 66); g.font = '38px system-ui'; g.fillText('naturtype – svært stor verdi', 320, 118);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthTest: false, transparent: true }));
  s.scale.set(4.3, 1.0, 1); s.position.set(OAK.tree[0], naturalHeight(...OAK.tree) + 13.5, -OAK.tree[1]); s.renderOrder = 10;
  oakGroup.add(s);
}
overlays.add(oakGroup);

// ---------- parkering ----------
let pendingRefresh = null;
const parking = buildParking(scene, (edit, old) => {
  const polys = [edit?.poly, old?.poly].filter(Boolean);
  if (!polys.length) return;
  const xs = polys.flat().map((p) => p[0]), ys = polys.flat().map((p) => p[1]);
  terrain.refresh(Math.min(...xs) - 1, Math.max(...xs) + 1, Math.min(...ys) - 1, Math.max(...ys) + 1);
});
parking.params.s = roadSOf(3.5);
let fitted = false; // parkeringshøyde tilpasses terrenget første gang den slås på

const rockDeck = buildRockDeck(scene);
const DECK_AREA = Math.round(polyArea(DECK));
function updateExclusions() {
  const polys = [...site.footprints()];
  if (parking.poly) polys.push(parking.poly);
  if (rockDeck.info.poly) polys.push(rockDeck.info.poly);
  veg.setExclusions(polys);
  veg.grass.hideIn(polys);
}

// ---------- kamera og navigasjon ----------
const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.maxPolarAngle = Math.PI * 0.495;
orbit.minDistance = 2; orbit.maxDistance = 1500;
const walk = new PointerLockControls(camera, document.body);
const keys = {};
addEventListener('keydown', (e) => { keys[e.code] = true; if (e.code === 'Escape' && state.mode === 'walk') setMode('orbit'); });
addEventListener('keyup', (e) => { keys[e.code] = false; });
walk.addEventListener('unlock', () => { if (state.mode === 'walk') setMode('orbit'); });

const L2W = (x, y, h) => new THREE.Vector3(x, h, -y);
const VIEWS = {
  oversikt: { name: 'Oversikt', cam: [52, -48, 42], tgt: [0, 0, 12] },
  knaus: { name: 'Fra fjellknausen', cam: [-6.5, -14, 19.6], tgt: [2, 6, 12.5], eye: true },
  plen: { name: 'Fra plenen (sør)', cam: [13, -13, 13.8], tgt: [-3, 16, 13.3], eye: true },
  terrasse: { name: 'Fra terrassen', cam: () => { const [x, y] = fromFrame(7.0, -5.3); return [x, y, 14.9]; }, tgt: () => { const [x, y] = fromFrame(-8, -3.2); return [x, y, 14.2]; }, eye: true },
  inngang: { name: 'Langs inngangssiden', cam: () => { const [x, y] = fromFrame(3.0, 6.0); return [x, y, heightAt(...fromFrame(3.0, 6.0)) + 1.65]; }, tgt: () => { const [x, y] = fromFrame(-14, 3.0); return [x, y, 13.8]; }, eye: true },
  veien: { name: 'Fra veien (nord)', cam: [17.5, 26, 10.3], tgt: [6, 0, 12.5], eye: true },
  jordet: { name: 'Fra jordet', cam: [62, -6, 9.6], tgt: [0, 0, 13.5], eye: true },
  berget: { name: 'Fra terrassen på berget', cam: () => { const [x, y] = fromFrame(11.6, -4.7); return [x, y, 16.55]; }, tgt: () => { const [x, y] = fromFrame(20, 12); return [x, y, 12.5]; }, eye: true },
  bergetSett: { name: 'Se på bergterrassen', cam: () => { const [x, y] = fromFrame(6, 9); return [x, y, 18.5]; }, tgt: () => { const [x, y] = fromFrame(13, -3.6); return [x, y, 14.6]; } },
  ovenfra: { name: 'Rett ovenfra (plan)', cam: [0.01, -0.5, 95], tgt: [0, 0, 12] },
};
let tween = null;
function goView(key, instant = false) {
  const v = VIEWS[key];
  const c = typeof v.cam === 'function' ? v.cam() : v.cam;
  const t = typeof v.tgt === 'function' ? v.tgt() : v.tgt;
  const to = L2W(...c), tt = L2W(...t);
  if (state.mode === 'walk') setMode('orbit');
  if (instant) { camera.position.copy(to); orbit.target.copy(tt); orbit.update(); return; }
  tween = { from: camera.position.clone(), fromT: orbit.target.clone(), to, tt, t0: performance.now(), dur: 1400 };
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode));
  if (mode === 'walk') {
    orbit.enabled = false;
    const p = camera.position;
    p.y = groundAt(p.x, -p.z) + 1.65;
    const dir = new THREE.Vector3().subVectors(orbit.target, p); dir.y = 0;
    if (dir.length() > 0.01) camera.lookAt(p.clone().add(dir));
    walk.lock();
    document.getElementById('walkHelp').style.display = 'block';
  } else {
    orbit.enabled = true;
    if (walk.isLocked) walk.unlock();
    const dir = new THREE.Vector3(); camera.getWorldDirection(dir);
    orbit.target.copy(camera.position).add(dir.multiplyScalar(10));
    document.getElementById('walkHelp').style.display = 'none';
  }
}

// bakkehøyde inkl. terrasser/gulv (stråle ned mot bygg)
const ray = new THREE.Raycaster();
function groundAt(x, y, fromH = 60) {
  let h = heightAt(x, y);
  ray.set(new THREE.Vector3(x, fromH, -y), new THREE.Vector3(0, -1, 0));
  ray.far = 200;
  const hits = ray.intersectObjects([site.root, parking.group], true).filter((i) => i.object.visible && i.face && i.face.normal.y > 0.5 && !(i.object.parent?.userData?.isRoof));
  for (const hit of hits) if (hit.point.y < fromH && hit.point.y > h - 0.01) { h = hit.point.y; break; }
  return h;
}

const vel = new THREE.Vector3();
function updateWalk(dt) {
  const speed = keys.ShiftLeft || keys.ShiftRight ? 6 : 2.4;
  const f = (keys.KeyW || keys.ArrowUp ? 1 : 0) - (keys.KeyS || keys.ArrowDown ? 1 : 0);
  const r = (keys.KeyD || keys.ArrowRight ? 1 : 0) - (keys.KeyA || keys.ArrowLeft ? 1 : 0);
  vel.set(r, 0, f).normalize().multiplyScalar(speed * dt);
  walk.moveRight(vel.x); walk.moveForward(vel.z);
  const p = camera.position;
  const g = groundAt(p.x, -p.z, p.y + 0.3) + 1.65;
  p.y += (g - p.y) * Math.min(1, dt * 10);
}

// ---------- UI ----------
const $ = (id) => document.getElementById(id);
function opt(sel, obj, cur) { sel.innerHTML = Object.entries(obj).map(([k, v]) => `<option value="${k}" ${k === cur ? 'selected' : ''}>${v.name}</option>`).join(''); }

function renderVariants() {
  $('variants').innerHTML = VARIANTS.map((v) => `<button class="variant ${v.id === state.variant ? 'on' : ''}" data-v="${v.id}">
      <b>${v.name}</b><span>${v.bya ? `BYA ${v.bya.toLocaleString('nb-NO')} m²` : 'BYA ikke oppgitt'}</span></button>`).join('');
  document.querySelectorAll('.variant').forEach((b) => b.onclick = () => selectVariant(b.dataset.v));
}

function selectVariant(id) {
  state.variant = id;
  const d = site.show(id);
  renderVariants();
  const v = d.v;
  const ok = (c) => (c ? '<i class="ok">✓</i>' : '<i class="bad">!</i>');
  const bya = v.bya ?? Math.round(d.area / 5) * 5;
  $('variantInfo').innerHTML = `<p>${v.desc}</p>
    <table>
      <tr><td>BYA ${v.bya ? '(arkitekt)' : '(ca., målt i modellen)'}</td><td>${bya.toLocaleString('nb-NO')} m² ${ok(bya <= 130)}</td><td class="lim">maks 130 m²</td></tr>
      <tr><td>Lengste fasade</td><td>${d.maxFacade.toFixed(1)} m ${ok(d.maxFacade < 15)}</td><td class="lim">under 15 m</td></tr>
      <tr><td>Mønehøyde (snitt terreng)</td><td>${d.maxRidge.toFixed(1)} m ${ok(d.maxRidge < 6.5)}</td><td class="lim">under 6,5 m</td></tr>
      <tr><td>Gesimshøyde (snitt terreng)</td><td>${d.maxEave.toFixed(1)} m ${ok(d.maxEave < 4.0)}</td><td class="lim">under 4,0 m</td></tr>
    </table>
    <p class="note">Høyder er beregnet i modellen fra laserdata og antatte gulvhøyder – kun veiledende.</p>`;
  if (v.plan) terrainUniforms.tPlan.value = planTexture(v.plan);
  site.setRoofs(state.roofs);
  site.setGhosts(state.ghosts);
  $('roofsTip').style.display = v.detailed ? 'block' : 'none';
  updateExclusions();
}

function updateRockDeckUI() {
  const i = rockDeck.rebuild();
  updateExclusions();
  const box = $('rdInfo');
  if (!rockDeck.params.on) { box.innerHTML = ''; return; }
  const ok = (c) => (c ? '<i class="ok">✓</i>' : '<i class="bad">!</i>');
  const total = i.area + DECK_AREA;
  box.innerHTML = `<table>
    <tr><td>Areal ny terrasse</td><td>${i.area.toFixed(1)} m²</td><td></td></tr>
    <tr><td>Sammen med dagens terrasse (ca. ${DECK_AREA} m²)</td><td>${total.toFixed(0)} m² ${ok(total <= 40)}</td><td class="lim">uteareal m/fast dekke maks 40 m²*</td></tr>
    ${DECK_AREA > 40 ? `<tr><td colspan="3" class="lim">Dagens terrasse er alene over 40 m², så en ny terrasse må trolig avklares med kommunen (ev. dispensasjon) – eller kombineres med at dagens terrasse gjøres mindre.</td></tr>` : ''}
    <tr><td>Høyde over dagens terrasse</td><td>${i.overDeck.toFixed(2)} m</td><td class="lim">${i.steps} trinn</td></tr>
    <tr><td>Største fallhøyde</td><td>${i.maxDrop.toFixed(1)} m</td><td class="lim">${i.maxDrop > 0.5 ? 'rekkverk påkrevd (TEK17)' : ''}</td></tr>
  </table><p class="note">*Bestemmelsen gjelder opparbeidede uteareal tilknyttet bebyggelsen. Terrassen ligger på stolper over berget uten terrenginngrep.</p>`;
}

function updateParkingUI() {
  const i = parking.rebuild();
  updateExclusions();
  const box = $('parkInfo');
  if (!parking.params.on) { box.innerHTML = ''; return; }
  const ok = (c) => (c ? '<i class="ok">✓</i>' : '<i class="bad">!</i>');
  const terr = Math.max(i.maxCut, i.maxFill);
  box.innerHTML = `<table>
    <tr><td>Areal (flate + rampe)</td><td>${i.area.toFixed(0)} m² ${ok(i.area <= 40)}</td><td class="lim">uteareal m/fast dekke maks 40 m²*</td></tr>
    <tr><td>Maks skjæring / fylling</td><td>${i.maxCut.toFixed(1)} / ${i.maxFill.toFixed(1)} m ${ok(terr <= 1.0)}</td><td class="lim">maks 1,0 m terrenginngrep</td></tr>
    <tr><td>Høyeste mur</td><td>${i.maxWall.toFixed(1)} m</td><td></td></tr>
    <tr><td>Rampestigning</td><td>${i.slope.toFixed(0)} % ${ok(i.slope <= 15)}</td><td class="lim">helst under ca. 12–15 %</td></tr>
    <tr><td>Avstand til hul eik</td><td>${i.dOak.toFixed(1)} m ${ok(!i.inZone)}</td><td class="lim">${i.inZone ? 'innenfor registrert naturtypeområde' : 'utenfor registrert område'}</td></tr>
    <tr><td>Plattformhøyde</td><td>${i.top.toFixed(2)} moh.</td><td class="lim">veikant ${i.roadH.toFixed(2)} moh.</td></tr>
  </table><p class="note">*Bestemmelsen om 40 m² gjelder opparbeidede uteareal – avklar med kommunen om parkering regnes med.</p>`;
}

function bindUI() {
  renderVariants();
  // sol
  const monthNames = ['jan', 'feb', 'mar', 'apr', 'mai', 'jun', 'jul', 'aug', 'sep', 'okt', 'nov', 'des'];
  const dateEl = $('date'), timeEl = $('time');
  const doy = (m, d) => Math.round((Date.UTC(2026, m, d) - Date.UTC(2026, 0, 1)) / 864e5);
  dateEl.value = doy(state.month, state.day);
  timeEl.value = state.hour;
  const sunUI = () => {
    const dt = new Date(Date.UTC(2026, 0, 1) + (+dateEl.value) * 864e5);
    state.month = dt.getUTCMonth(); state.day = dt.getUTCDate(); state.hour = +timeEl.value;
    const hh = Math.floor(state.hour), mm = Math.round((state.hour - hh) * 60);
    const st = sunTimes(state.month, state.day);
    const fmt = (h) => (h == null ? '–' : `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60) % 60).padStart(2, '0')}`);
    $('dateLbl').textContent = `${state.day}. ${monthNames[state.month]}`;
    $('timeLbl').textContent = `kl. ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
    $('sunTimes').textContent = `Soloppgang ${fmt(st.rise)} · solnedgang ${fmt(st.set)}`;
    updateSun();
  };
  dateEl.oninput = sunUI; timeEl.oninput = sunUI;
  let playing = null;
  $('play').onclick = () => {
    if (playing) { clearInterval(playing); playing = null; $('play').textContent = '▶ Spill av dagen'; return; }
    $('play').textContent = '■ Stopp';
    playing = setInterval(() => { let h = +timeEl.value + 0.1; if (h > 23.5) h = 4; timeEl.value = h; sunUI(); }, 60);
  };
  sunUI();

  // materialer
  opt($('clad'), CLADDING, state.cladding);
  opt($('roof'), ROOFS, state.roof);
  $('clad').onchange = (e) => { state.cladding = e.target.value; selectVariant(state.variant); };
  $('roof').onchange = (e) => { state.roof = e.target.value; selectVariant(state.variant); };
  $('vert').onchange = (e) => { state.vertical = e.target.checked; selectVariant(state.variant); };

  // visning
  const tog = (id, fn) => { const el = $(id); el.onchange = () => fn(el.checked); };
  tog('tRoofs', (v) => { state.roofs = v; site.setRoofs(v); });
  tog('tGhosts', (v) => { state.ghosts = v; site.setGhosts(v); });
  tog('tProp', (v) => { overlays.children.slice(0, 3).forEach((o) => (o.visible = v)); });
  tog('tOak', (v) => { oakGroup.visible = v; });
  tog('tPlan', (v) => { terrainUniforms.planOpacity.value = v ? 0.85 : 0; });
  tog('tTrees', (v) => { veg.group.visible = v; });

  // parkering
  const pp = parking.params;
  opt($('pSurf'), SURFACES, pp.surface);
  opt($('pWall'), WALLS, pp.wall);
  const syncParkInputs = () => { $('pLevel').value = pp.level; $('pRamp').value = pp.ramp; };
  const pUI = (ev) => {
    if (ev?.target?.id === 'pOn' && $('pOn').checked && !fitted) {
      // første gang: tilpass til terrenget
      pp.s = +$('pPos').value; pp.cars = +$('pCars').value; pp.depth = +$('pDepth').value;
      parking.fitToTerrain(); syncParkInputs(); fitted = true;
    }
    pp.on = $('pOn').checked;
    pp.s = +$('pPos').value; pp.cars = +$('pCars').value; pp.level = +$('pLevel').value; pp.ramp = +$('pRamp').value; pp.depth = +$('pDepth').value;
    pp.surface = $('pSurf').value; pp.wall = $('pWall').value; pp.showCars = $('pShowCars').checked; pp.rail = $('pRail').checked;
    $('pLevelLbl').textContent = `${pp.level.toFixed(1)} m over veien`;
    $('pRampLbl').textContent = `${pp.ramp.toFixed(1)} m`;
    $('pDepthLbl').textContent = `${pp.depth.toFixed(1)} m`;
    $('parkCtl').classList.toggle('dim', !pp.on);
    updateParkingUI();
  };
  $('pPos').value = pp.s;
  for (const id of ['pOn', 'pPos', 'pCars', 'pLevel', 'pRamp', 'pDepth', 'pSurf', 'pWall', 'pShowCars', 'pRail']) $(id).addEventListener('input', pUI);
  $('pFit').onclick = () => {
    if (!$('pOn').checked) $('pOn').checked = true;
    pp.s = +$('pPos').value; pp.cars = +$('pCars').value; pp.depth = +$('pDepth').value;
    parking.fitToTerrain(); syncParkInputs(); fitted = true; pUI();
  };
  $('pView').onclick = () => {
    pp.on || ($('pOn').checked = true, pUI());
    const pl = parking.info.poly; if (!pl) return;
    const cx = pl.reduce((a, p) => a + p[0], 0) / 4, cy = pl.reduce((a, p) => a + p[1], 0) / 4;
    const h = naturalHeight(cx, cy);
    tween = { from: camera.position.clone(), fromT: orbit.target.clone(), to: L2W(cx + 16, cy - 12, h + 6), tt: L2W(cx, cy, h + 0.5), t0: performance.now(), dur: 1400 };
  };
  pUI();

  // utsiktspunkter
  $('views').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<button data-view="${k}">${v.name}</button>`).join('');
  document.querySelectorAll('[data-view]').forEach((b) => b.onclick = () => goView(b.dataset.view));
  document.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => setMode(b.dataset.mode));
  $('shot').onclick = () => {
    renderer.render(scene, camera);
    const a = document.createElement('a');
    a.download = `hytte-${state.variant}.png`; a.href = renderer.domElement.toDataURL('image/png'); a.click();
  };
  // terrasse på berget
  const rp = rockDeck.params;
  const rdUI = () => {
    rp.on = $('rdOn').checked; rp.length = +$('rdLen').value; rp.depth = +$('rdDep').value;
    rp.rail = $('rdRail').value; rp.furniture = $('rdFurn').value;
    $('rdLenLbl').textContent = `${rp.length.toFixed(1)} m`; $('rdDepLbl').textContent = `${rp.depth.toFixed(1)} m`;
    $('rdCtl').classList.toggle('dim', !rp.on);
    updateRockDeckUI();
  };
  for (const id of ['rdOn', 'rdLen', 'rdDep', 'rdRail', 'rdFurn']) $(id).addEventListener('input', rdUI);
  $('rdView').onclick = () => { if (!$('rdOn').checked) { $('rdOn').checked = true; rdUI(); } goView('bergetSett'); };
  $('rdSit').onclick = () => { if (!$('rdOn').checked) { $('rdOn').checked = true; rdUI(); } goView('berget'); };
  rdUI();
  $('share').onclick = share;
  $('shareTop').onclick = share;
  if (TOUCH) document.querySelector('[data-mode="walk"]').style.display = 'none';
  $('collapse').onclick = () => document.body.classList.toggle('panel-hidden');
  document.querySelectorAll('.sec h3').forEach((h) => h.onclick = () => h.parentElement.classList.toggle('closed'));
}

// ---------- deling via lenke ----------
// Lenken inneholder alternativ, kamera, sol, materialer og parkering, slik at mottakeren ser det samme.
const DOY0 = Date.UTC(2026, 0, 1);
function encodeShared() {
  const t = state.mode === 'walk' ? camera.position.clone().add(camera.getWorldDirection(new THREE.Vector3()).multiplyScalar(10)) : orbit.target;
  const p = camera.position, pp = parking.params, q = new URLSearchParams();
  q.set('v', state.variant);
  q.set('c', [p.x, p.y, p.z, t.x, t.y, t.z].map((n) => n.toFixed(1)).join('_'));
  q.set('t', `${Math.round((Date.UTC(2026, state.month, state.day) - DOY0) / 864e5)}_${state.hour.toFixed(2)}`);
  if (pp.on) q.set('p', [pp.s, pp.cars, pp.level, pp.ramp, pp.depth, pp.surface, pp.wall, pp.showCars ? 1 : 0].join('_'));
  if (state.cladding !== 'dagens') q.set('k', state.cladding);
  if (state.roof !== 'bolge') q.set('r', state.roof);
  if (state.vertical) q.set('sk', '1');
  if (!state.roofs) q.set('utentak', '1');
  const rp = rockDeck.params;
  if (rp.on) q.set('bt', [rp.length, rp.depth, rp.rail, rp.furniture].join('_'));
  return q.toString();
}
function applyShared(hash) {
  if (!hash) return;
  const q = new URLSearchParams(hash);
  const set = (id, val, ev = 'input') => { const el = $(id); if (el.type === 'checkbox') el.checked = !!val; else el.value = val; el.dispatchEvent(new Event(ev)); };
  try {
    if (q.has('k') && CLADDING[q.get('k')]) { $('clad').value = state.cladding = q.get('k'); }
    if (q.has('r') && ROOFS[q.get('r')]) { $('roof').value = state.roof = q.get('r'); }
    if (q.has('sk')) { $('vert').checked = state.vertical = true; }
    if (q.has('t')) { const [d, h] = q.get('t').split('_'); $('date').value = d; set('time', h); }
    if (q.has('utentak')) set('tRoofs', false, 'change');
    if (q.has('bt')) {
      const [len, dep, rail, furn] = q.get('bt').split('_');
      $('rdLen').value = len; $('rdDep').value = dep;
      if (['tre', 'glass', 'ingen'].includes(rail)) $('rdRail').value = rail;
      if (['spise', 'lounge', 'begge', 'ingen'].includes(furn)) $('rdFurn').value = furn;
      set('rdOn', true);
    }
    if (q.has('p')) {
      const [s, cars, level, ramp, depth, surf, wall, showCars] = q.get('p').split('_');
      $('pPos').value = s; $('pCars').value = cars; $('pLevel').value = level; $('pRamp').value = ramp; $('pDepth').value = depth;
      if (SURFACES[surf]) $('pSurf').value = surf; if (WALLS[wall]) $('pWall').value = wall;
      $('pShowCars').checked = showCars !== '0';
      fitted = true; // behold høydene fra lenken
      set('pOn', true);
    }
    const v = q.get('v');
    selectVariant(VARIANTS.some((x) => x.id === v) ? v : state.variant);
    if (q.has('c')) {
      const c = q.get('c').split('_').map(Number);
      if (c.length === 6 && c.every(Number.isFinite)) { camera.position.set(c[0], c[1], c[2]); orbit.target.set(c[3], c[4], c[5]); orbit.update(); }
    }
  } catch (e) { console.warn('Kunne ikke lese delt lenke', e); }
}
function toast(msg) {
  const el = $('toast'); el.textContent = msg; el.classList.add('show');
  clearTimeout(toast.t); toast.t = setTimeout(() => el.classList.remove('show'), 3500);
}
async function share() {
  const url = location.href.split('#')[0] + '#' + encodeShared();
  history.replaceState(null, '', url);
  if (navigator.share && TOUCH) {
    try { await navigator.share({ title: 'Hytta på Tjøme – 3D', text: 'Se hvordan hytta kan bli:', url }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(url); toast('Lenke kopiert – lim den inn i en melding eller e-post'); }
  catch { prompt('Kopier lenken:', url); }
}

// ---------- løkke ----------
const clock = new THREE.Clock();
function frame() {
  const dt = Math.min(0.05, clock.getDelta()), t = clock.elapsedTime;
  windUniform.value = t;
  site.animate(t);
  water.userData.animate(t);
  if (tween) {
    const k = Math.min(1, (performance.now() - tween.t0) / tween.dur), e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(tween.from, tween.to, e);
    orbit.target.lerpVectors(tween.fromT, tween.tt, e);
    if (k >= 1) tween = null;
  }
  if (state.mode === 'walk') updateWalk(dt);
  else {
    orbit.update();
    // ikke under bakken
    const gh = heightAt(camera.position.x, -camera.position.z) + 0.4;
    if (camera.position.y < gh) camera.position.y = gh;
  }
  // skyggekamera følger fokuspunktet
  const focus = state.mode === 'walk' ? camera.position : orbit.target;
  const fx = Math.max(-90, Math.min(90, focus.x)), fz = Math.max(-90, Math.min(90, focus.z));
  sun.target.position.set(Math.round(fx / 4) * 4, 12, Math.round(fz / 4) * 4);
  const sv = su.sunPosition.value;
  sun.position.copy(sv).multiplyScalar(300).add(sun.target.position);
  renderer.render(scene, camera);
  requestAnimationFrame(frame);
}

addEventListener('resize', () => {
  camera.aspect = app.clientWidth / app.clientHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(app.clientWidth, app.clientHeight);
});

bindUI();
selectVariant(state.variant);
goView('oversikt', true);
if (TOUCH || innerWidth < 800) document.body.classList.add('panel-hidden');
applyShared(location.hash.slice(1));
document.getElementById('loading').remove();
frame();
window.__hytte = { encodeShared, scene, camera, orbit, goView, selectVariant, state, parking, site, renderer, updateParkingUI };

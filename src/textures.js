// Prosedyriske, sømløse teksturer laget i canvas ved oppstart.
import * as THREE from 'three';

let seed = 12345;
export function rnd() {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
}
const R = (a, b) => a + (b - a) * rnd();

function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

// Tegner en figur på alle 9 posisjoner slik at teksturen blir sømløs
function wrap(size, fn) {
  for (const dx of [-size, 0, size]) for (const dy of [-size, 0, size]) fn(dx, dy);
}

function toTex(c, { repeat = true, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  return t;
}

const hsl = (h, s, l, a = 1) => `hsla(${h},${s}%,${l}%,${a})`;

export function grassTex(size = 512, mown = true) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = mown ? hsl(86, 36, 36) : hsl(68, 30, 40);
  g.fillRect(0, 0, size, size);
  // flekker
  for (let i = 0; i < 70; i++) {
    const x = R(0, size), y = R(0, size), r = R(20, 90);
    wrap(size, (dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, mown ? hsl(R(70, 100), R(30, 50), R(24, 40), 0.35) : hsl(R(45, 85), R(30, 50), R(30, 48), 0.4));
      gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    });
  }
  // gresstrå
  const n = mown ? 9000 : 6000;
  for (let i = 0; i < n; i++) {
    const x = R(0, size), y = R(0, size), L = mown ? R(3, 8) : R(6, 18), a = R(-0.6, 0.6) - Math.PI / 2;
    const col = mown
      ? hsl(R(72, 100), R(32, 55), R(30, 55), 0.85)
      : rnd() < 0.3 ? hsl(R(40, 55), R(30, 50), R(55, 70), 0.85) : hsl(R(62, 92), R(28, 50), R(32, 50), 0.85);
    g.strokeStyle = col; g.lineWidth = R(0.8, 1.8);
    wrap(size, (dx, dy) => {
      g.beginPath(); g.moveTo(x + dx, y + dy); g.lineTo(x + dx + Math.cos(a) * L, y + dy + Math.sin(a) * L); g.stroke();
    });
  }
  if (mown) {
    // små hvite blomster (kløver/tusenfryd) som på bildene
    for (let i = 0; i < 40; i++) {
      const x = R(0, size), y = R(0, size);
      g.fillStyle = rnd() < 0.7 ? 'rgba(245,245,235,0.9)' : 'rgba(170,160,230,0.9)';
      wrap(size, (dx, dy) => { g.beginPath(); g.arc(x + dx, y + dy, R(1.2, 2.2), 0, 7); g.fill(); });
    }
  }
  return toTex(c);
}

export function rockTex(size = 512) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = hsl(25, 6, 60); g.fillRect(0, 0, size, size);
  for (let i = 0; i < 40; i++) {
    const x = R(0, size), y = R(0, size), r = R(40, 140);
    wrap(size, (dx, dy) => {
      const gr = g.createRadialGradient(x + dx, y + dy, 0, x + dx, y + dy, r);
      gr.addColorStop(0, hsl(R(15, 40), R(4, 12), R(48, 68), 0.35)); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x + dx - r, y + dy - r, 2 * r, 2 * r);
    });
  }
  // granittkorn
  const img = g.getImageData(0, 0, size, size), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const r = rnd();
    let v = 0;
    if (r < 0.08) v = -45; else if (r < 0.18) v = 30; else if (r < 0.22) v = -20;
    v += R(-10, 10);
    d[i] += v + (r > 0.95 ? 18 : 0); d[i + 1] += v; d[i + 2] += v - (r > 0.95 ? 8 : 0);
  }
  g.putImageData(img, 0, 0);
  // flekker av lav (lys grå/hvit, grønnlig, oransje) og mose
  const blobs = [
    [70, 8, 80, 0.28, 30], [75, 14, 68, 0.25, 30], [65, 35, 45, 0.25, 10], [80, 40, 30, 0.4, 12], [35, 60, 55, 0.25, 4], [0, 0, 25, 0.2, 10],
  ];
  for (const [h, s, l, a, count] of blobs) {
    for (let i = 0; i < count; i++) {
      const x = R(0, size), y = R(0, size), r = R(6, 46);
      wrap(size, (dx, dy) => {
        g.fillStyle = hsl(h + R(-8, 8), s, l + R(-6, 6), a * R(0.5, 1));
        g.beginPath();
        for (let k = 0; k < 14; k++) {
          const an = (k / 14) * Math.PI * 2, rr = r * R(0.55, 1.1);
          const px = x + dx + Math.cos(an) * rr, py = y + dy + Math.sin(an) * rr;
          k ? g.lineTo(px, py) : g.moveTo(px, py);
        }
        g.closePath(); g.fill();
      });
    }
  }
  // sprekker
  g.strokeStyle = 'rgba(40,38,36,0.5)';
  for (let i = 0; i < 5; i++) {
    let x = R(0, size), y = R(0, size);
    g.lineWidth = R(0.8, 2);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 18; k++) { x += R(-14, 14); y += R(2, 14); g.lineTo(x, y); }
    g.stroke();
  }
  return toTex(c);
}

export function gravelTex(size = 512, base = [24, 22, 44]) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = hsl(base[0], base[1], base[2]); g.fillRect(0, 0, size, size);
  for (let i = 0; i < 14000; i++) {
    const x = R(0, size), y = R(0, size), r = R(0.6, 2.6);
    g.fillStyle = hsl(base[0] + R(-12, 12), base[1] + R(-12, 8), base[2] + R(-18, 22), R(0.6, 1));
    wrap(size, (dx, dy) => { g.beginPath(); g.arc(x + dx, y + dy, r, 0, 7); g.fill(); });
  }
  return toTex(c);
}

// Fargeskala for kledning/tak – gråtoner, fargen settes på materialet
export function claddingTex(size = 512, horizontal = true, boards = 8) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = '#dcdcdc'; g.fillRect(0, 0, size, size);
  const w = size / boards;
  for (let i = 0; i < boards; i++) {
    const v = 205 + R(-14, 14);
    g.fillStyle = `rgb(${v},${v},${v})`;
    if (horizontal) g.fillRect(0, i * w, size, w); else g.fillRect(i * w, 0, w, size);
    // trefiber
    g.strokeStyle = 'rgba(0,0,0,0.05)';
    for (let k = 0; k < 10; k++) {
      g.beginPath();
      if (horizontal) { const y = i * w + R(0, w); g.moveTo(0, y); g.bezierCurveTo(size / 3, y + R(-3, 3), (2 * size) / 3, y + R(-3, 3), size, y); }
      else { const x = i * w + R(0, w); g.moveTo(x, 0); g.bezierCurveTo(x + R(-3, 3), size / 3, x + R(-3, 3), (2 * size) / 3, x, size); }
      g.stroke();
    }
    // skyggefuge
    g.fillStyle = 'rgba(0,0,0,0.55)';
    if (horizontal) g.fillRect(0, i * w + w - 3, size, 3); else g.fillRect(i * w + w - 4, 0, 4, size);
    g.fillStyle = 'rgba(255,255,255,0.25)';
    if (horizontal) g.fillRect(0, i * w, size, 2); else g.fillRect(i * w, 0, 2, size);
  }
  return toTex(c);
}

export function corrugatedTex(size = 256, waves = 8) {
  const c = canvas(size), g = c.getContext('2d');
  for (let x = 0; x < size; x++) {
    const v = 150 + 70 * Math.sin((x / size) * waves * Math.PI * 2);
    g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, size);
  }
  // overlapp mellom plater
  g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(0, size - 4, size, 4);
  return toTex(c, { srgb: false });
}

export function seamTex(size = 256, seams = 4) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = '#909090'; g.fillRect(0, 0, size, size);
  const w = size / seams;
  for (let i = 0; i < seams; i++) {
    g.fillStyle = '#e8e8e8'; g.fillRect(i * w, 0, 5, size);
    g.fillStyle = '#505050'; g.fillRect(i * w + 5, 0, 3, size);
  }
  return toTex(c, { srgb: false });
}

export function shingleTex(size = 256) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = '#2a2b2e'; g.fillRect(0, 0, size, size);
  const rows = 8, h = size / rows, w = size / 6;
  for (let r = 0; r < rows; r++) {
    for (let k = -1; k < 7; k++) {
      const x = k * w + (r % 2 ? w / 2 : 0), y = r * h;
      const v = R(32, 52);
      g.fillStyle = `rgb(${v},${v},${v + 2})`;
      g.beginPath();
      // sekskantshingel som på anneks/bod
      g.moveTo(x + 2, y); g.lineTo(x + w - 2, y); g.lineTo(x + w - 2, y + h * 0.7); g.lineTo(x + w / 2, y + h - 1); g.lineTo(x + 2, y + h * 0.7);
      g.closePath(); g.fill();
    }
  }
  return toTex(c);
}

export function deckTex(size = 512, boards = 8) {
  const c = canvas(size), g = c.getContext('2d');
  const w = size / boards;
  for (let i = 0; i < boards; i++) {
    const l = R(20, 28);
    g.fillStyle = hsl(15, R(18, 28), l); g.fillRect(0, i * w, size, w);
    g.strokeStyle = 'rgba(0,0,0,0.12)';
    for (let k = 0; k < 14; k++) {
      const y = i * w + R(0, w);
      g.beginPath(); g.moveTo(0, y); g.lineTo(size, y + R(-2, 2)); g.stroke();
    }
    g.fillStyle = 'rgba(0,0,0,0.6)'; g.fillRect(0, i * w + w - 3, size, 3);
    // skjøter
    const jx = R(0, size);
    g.fillRect(jx, i * w, 2, w);
  }
  return toTex(c);
}

export function latticeTex(size = 256) {
  const c = canvas(size), g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  g.strokeStyle = '#f2f2ef'; g.lineWidth = size / 14;
  for (let k = -2; k < 4; k++) {
    g.beginPath(); g.moveTo(k * size / 2, 0); g.lineTo(k * size / 2 + size, size); g.stroke();
    g.beginPath(); g.moveTo(k * size / 2 + size, 0); g.lineTo(k * size / 2, size); g.stroke();
  }
  return toTex(c);
}

export function stoneWallTex(size = 512) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = '#3c3a37'; g.fillRect(0, 0, size, size);
  // tørrmur av naturstein (granitt)
  let y = 0;
  while (y < size) {
    const h = R(38, 70);
    let x = R(-40, 0);
    while (x < size) {
      const w = R(60, 130), l = R(42, 66);
      g.fillStyle = hsl(R(15, 35), R(3, 10), l);
      g.beginPath();
      const pts = [[x + R(2, 8), y + R(2, 6)], [x + w - R(2, 8), y + R(2, 6)], [x + w - R(1, 5), y + h - R(2, 7)], [x + R(1, 5), y + h - R(2, 7)]];
      wrap(size, (dx, dy) => {
        if (dx || dy) return;
        g.moveTo(pts[0][0], pts[0][1]); for (const p of pts) g.lineTo(p[0], p[1]); g.closePath();
      });
      g.fill();
      // korn
      for (let k = 0; k < 60; k++) {
        g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${R(0.05, 0.18)})`;
        g.fillRect(x + R(4, w - 4), y + R(4, h - 4), 2, 2);
      }
      x += w;
    }
    y += h;
  }
  return toTex(c);
}

export function concreteTex(size = 256) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = '#a7a6a2'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 4000; i++) {
    g.fillStyle = `rgba(${rnd() < 0.5 ? '0,0,0' : '255,255,255'},${R(0.03, 0.1)})`;
    g.fillRect(R(0, size), R(0, size), R(1, 3), R(1, 3));
  }
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, 0, size, 2); g.fillRect(0, 0, 2, size);
  return toTex(c);
}

export function pavingTex(size = 512) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = '#4a4744'; g.fillRect(0, 0, size, size);
  const n = 8, w = size / n, h = size / (n * 2);
  for (let r = 0; r < n * 2; r++) for (let k = -1; k < n + 1; k++) {
    const x = k * w + (r % 2 ? w / 2 : 0);
    g.fillStyle = hsl(20, R(2, 8), R(45, 58));
    g.fillRect(x + 1.5, r * h + 1.5, w - 3, h - 3);
  }
  return toTex(c);
}

export function grassGridTex(size = 512) {
  const c = canvas(size), g = c.getContext('2d');
  const grass = grassTex(256, true).image;
  g.drawImage(grass, 0, 0, size, size);
  g.fillStyle = 'rgba(150,150,145,0.9)';
  const n = 10, w = size / n;
  for (let r = 0; r < n; r++) for (let k = 0; k < n; k++) {
    g.beginPath(); g.arc(k * w + w / 2, r * w + w / 2, w * 0.32, 0, 7); g.lineWidth = w * 0.12; g.strokeStyle = 'rgba(150,150,145,0.95)'; g.stroke();
  }
  return toTex(c);
}

// Bladkort for trær (RGBA). type: 'oak' | 'birch' | 'pine' | 'bush'
export function leafTex(type, size = 256) {
  const c = canvas(size), g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const n = type === 'pine' ? 0 : type === 'birch' ? 650 : 560;
  const cx = size / 2, cy = size / 2;
  if (type !== 'pine') {
    // tett underlag så kronen ikke blir gjennomsiktig på avstand
    for (let i = 0; i < 26; i++) {
      const r = Math.sqrt(rnd()) * size * 0.3, a = R(0, 6.28);
      g.fillStyle = hsl(R(80, 100), R(30, 45), R(14, 22));
      g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, R(14, 30), 0, 7); g.fill();
    }
  }
  if (type === 'pine') {
    // furubar: kvister med nåler
    for (let b = 0; b < 16; b++) {
      const a0 = R(0, Math.PI * 2), L = R(size * 0.25, size * 0.45);
      const x0 = cx + R(-20, 20), y0 = cy + R(-20, 20);
      for (let k = 0; k < 70; k++) {
        const f = k / 70, x = x0 + Math.cos(a0) * L * f, y = y0 + Math.sin(a0) * L * f;
        g.strokeStyle = hsl(R(95, 125), R(25, 45), R(16, 30));
        g.lineWidth = 1.4;
        for (const s of [-1, 1]) {
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a0 + s * 0.9) * 10, y + Math.sin(a0 + s * 0.9) * 10); g.stroke();
        }
      }
    }
    return toTex(c, { repeat: false });
  }
  for (let i = 0; i < n; i++) {
    const r = Math.pow(rnd(), 0.65) * size * 0.45, a = R(0, Math.PI * 2);
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    const L = type === 'birch' ? R(9, 14) : type === 'bush' ? R(10, 16) : R(13, 21);
    const W = L * (type === 'oak' ? 0.55 : 0.6);
    const hue = type === 'birch' ? R(72, 95) : type === 'bush' ? R(80, 110) : R(80, 105);
    const lt = R(20, 42);
    g.save(); g.translate(x, y); g.rotate(R(0, Math.PI * 2));
    g.fillStyle = hsl(hue, R(35, 60), lt);
    g.beginPath();
    if (type === 'oak') {
      // lappete eikeblad
      for (let k = 0; k <= 10; k++) {
        const t = k / 10, yy = -L / 2 + t * L, ww = W * Math.sin(t * Math.PI) * (k % 2 ? 1.1 : 0.7);
        g.lineTo(ww / 2, yy);
      }
      for (let k = 10; k >= 0; k--) {
        const t = k / 10, yy = -L / 2 + t * L, ww = W * Math.sin(t * Math.PI) * (k % 2 ? 1.1 : 0.7);
        g.lineTo(-ww / 2, yy);
      }
    } else {
      g.ellipse(0, 0, W / 2, L / 2, 0, 0, Math.PI * 2);
    }
    g.fill();
    g.fillStyle = 'rgba(255,255,230,0.12)';
    g.fillRect(-0.5, -L / 2, 1, L);
    g.restore();
  }
  // små kvister
  g.strokeStyle = 'rgba(60,45,30,0.8)'; g.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) {
    g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + R(-90, 90), cy + R(-90, 90)); g.stroke();
  }
  return toTex(c, { repeat: false });
}

export function barkTex(size = 128, birch = false) {
  const c = canvas(size), g = c.getContext('2d');
  g.fillStyle = birch ? '#e6e3dc' : '#3d342c'; g.fillRect(0, 0, size, size);
  for (let i = 0; i < 300; i++) {
    g.fillStyle = birch ? `rgba(20,20,20,${R(0.2, 0.8)})` : `rgba(${rnd() < 0.5 ? '0,0,0' : '120,110,95'},${R(0.2, 0.5)})`;
    const w = birch ? R(4, 18) : R(1, 3), h = birch ? R(1, 3) : R(6, 30);
    g.fillRect(R(0, size), R(0, size), w, h);
  }
  return toTex(c);
}

export function windowGridTex(wall = '#eeeeea') {
  // generisk fasade for nabohus: én etasje (2.7 m) x 3 m med vindu
  const c = canvas(256), g = c.getContext('2d');
  g.fillStyle = wall; g.fillRect(0, 0, 256, 256);
  g.fillStyle = 'rgba(0,0,0,0.06)';
  for (let x = 0; x < 256; x += 16) g.fillRect(x, 0, 2, 256);
  g.fillStyle = '#f4f4f2'; g.fillRect(84, 70, 92, 104);
  g.fillStyle = '#2b3239'; g.fillRect(92, 78, 76, 88);
  g.fillStyle = '#f4f4f2'; g.fillRect(127, 78, 6, 88);
  return toTex(c);
}

export function flagTex() {
  const c = canvas(256), g = c.getContext('2d');
  c.height = 184;
  g.fillStyle = '#ba0c2f'; g.fillRect(0, 0, 256, 184);
  g.fillStyle = '#fff'; g.fillRect(70, 0, 46, 184); g.fillRect(0, 69, 256, 46);
  g.fillStyle = '#00205b'; g.fillRect(81, 0, 24, 184); g.fillRect(0, 80, 256, 24);
  return toTex(c, { repeat: false });
}

export function waterNormalTex(size = 256) {
  const c = canvas(size), g = c.getContext('2d');
  const img = g.createImageData(size, size), d = img.data;
  const waves = [];
  for (let i = 0; i < 12; i++) waves.push([Math.round(R(1, 6)) * (rnd() < 0.5 ? -1 : 1), Math.round(R(1, 6)) * (rnd() < 0.5 ? -1 : 1), R(0, 6.28), R(0.3, 1)]);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let nx = 0, ny = 0;
    for (const [kx, ky, p, a] of waves) {
      const ph = ((kx * x + ky * y) / size) * Math.PI * 2 + p;
      const cc = Math.cos(ph) * a;
      nx += cc * kx * 0.05; ny += cc * ky * 0.05;
    }
    const i = (y * size + x) * 4;
    d[i] = 128 + nx * 127; d[i + 1] = 128 + ny * 127; d[i + 2] = 255; d[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return toTex(c, { srgb: false });
}

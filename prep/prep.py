"""Bygger datafiler for 3D-modellen fra nedlastede geodata.

Input (GEO-mappe, lastet ned separat):
  dtm1k.tif / dom1k.tif   Kartverket NHM DTM/DOM, 1 m, E0±512, N0±512 (EPSG:25832)
  ortho_in.jpg            Esri World Imagery reprojisert, E0±128 (2048²)
  ortho_far.jpg           Esri World Imagery reprojisert, E0±512 (2048²)
  osm_local.json          OSM-bygg/veier i lokale koordinater (prep/osm.py)
  teig.json               Matrikkel-teiger (EPSG:25832)
  s150-{1..5}.png         Arkitektens situasjonsplaner rendret i 150 dpi

Lokalt koordinatsystem: origo i adressepunktet Hellesmoveien 33 (E0,N0),
x = øst, y = nord, høyder i NN2000.
"""
import json, sys, os, numpy as np, tifffile
from PIL import Image, ImageDraw, ImageFilter
from matplotlib.path import Path

GEO, PDF, OUT = sys.argv[1], sys.argv[2], sys.argv[3]
E0, N0 = 580152, 6549299
os.makedirs(OUT, exist_ok=True)

dtm = tifffile.imread(f'{GEO}/dtm1k.tif').astype(np.float64)
dom = tifffile.imread(f'{GEO}/dom1k.tif').astype(np.float64)
chm = np.clip(dom - dtm, 0, 40)


def bilinear(a, x, y):
    """Sample 1 m grid (cell centres at -511.5..511.5) at local x,y."""
    fx = x + 511.5
    fy = 511.5 - y
    x0 = np.clip(np.floor(fx).astype(int), 0, 1022)
    y0 = np.clip(np.floor(fy).astype(int), 0, 1022)
    tx = np.clip(fx - x0, 0, 1)
    ty = np.clip(fy - y0, 0, 1)
    return (a[y0, x0] * (1 - tx) * (1 - ty) + a[y0, x0 + 1] * tx * (1 - ty)
            + a[y0 + 1, x0] * (1 - tx) * ty + a[y0 + 1, x0 + 1] * tx * ty)


# ---------- terreng ----------
def grid(half, step):
    v = np.arange(-half, half + step / 2, step)
    X, Y = np.meshgrid(v, v[::-1])  # rad 0 = nord
    return X, Y

sea = dtm < 0.35
dtm_w = np.where(sea, -1.6, dtm)
# glatt overgang mot sjø
for _ in range(3):
    s = (np.roll(dtm_w, 1, 0) + np.roll(dtm_w, -1, 0) + np.roll(dtm_w, 1, 1) + np.roll(dtm_w, -1, 1)) / 4
    dtm_w = np.where(sea | (dtm < 1.0), np.minimum(dtm_w, s), dtm_w)

X, Y = grid(128, 1.0)
inner = bilinear(dtm_w, X, Y)
X, Y = grid(512, 2.0)
X = np.clip(X, -511, 511); Y = np.clip(Y, -511, 511)
far = bilinear(dtm_w, X, Y)
np.round(inner * 100).astype('<i2').tofile(f'{OUT}/terrain_in.bin')
np.round(far * 100).astype('<i2').tofile(f'{OUT}/terrain_far.bin')
print('terrain', inner.shape, far.shape, inner.min(), inner.max())

# ---------- eiendom ----------
teig = json.load(open(f'{GEO}/teig.json'))
prop = np.array(teig['243/71'][0][0]) - [E0, N0]
neighbours = {k: [(np.array(r) - [E0, N0]).round(2).tolist() for r in v[0]] for k, v in teig.items() if k != '243/71'}
json.dump({'prop': prop.round(2).tolist(), 'neighbours': neighbours}, open(f'{OUT}/parcels.json', 'w'))
propPath = Path(prop)

# ---------- arkitektplan (georeferert) ----------
S = 29.53; U0, V0 = 580, 317; X0, Y0 = -17.7, 15.5
def plan_uv(x, y):
    return U0 + (x - X0) * S, V0 - (y - Y0) * S

def plan_valid(u, v):
    inside = (u > 8) & (u < 2040) & (v > 8) & (v < 1745)
    legend = (u > 60) & (u < 570) & (v > 1170)
    return inside & ~legend

# ---------- OSM ----------
osm = json.load(open(f'{GEO}/osm_local.json'))

# ---------- splat (R=berg, G=plen, B=grusvei) 0.25 m ----------
N = 1024
v = (np.arange(N) + 0.5) * 0.25 - 128
SX, SY = np.meshgrid(v, v[::-1])
plan = np.asarray(Image.open(f'{PDF}/s150-1.png').convert('RGB')).astype(int)
u, vv = plan_uv(SX, SY)
valid = plan_valid(u, vv)
ui = np.clip(u.astype(int), 0, plan.shape[1] - 1); vi = np.clip(vv.astype(int), 0, plan.shape[0] - 1)
pr, pg, pb = plan[vi, ui, 0], plan[vi, ui, 1], plan[vi, ui, 2]
plan_rock = valid & (np.abs(pr - 242) < 5) & (np.abs(pg - 242) < 5) & (np.abs(pb - 242) < 5)
plan_road = valid & (pr > 205) & (pr < 232) & (np.abs(pr - pg) < 6) & (np.abs(pr - pb) < 6)

h = bilinear(dtm, SX, SY)
c = bilinear(chm, SX, SY)
# TPI-basert berg utenfor planen
def box_blur(a, r):
    k = 2 * r + 1
    p = np.pad(a, r, mode='edge')
    c = np.cumsum(np.cumsum(p, 0), 1)
    c = np.pad(c, ((1, 0), (1, 0)))
    return (c[k:, k:] - c[:-k, k:] - c[k:, :-k] + c[:-k, :-k]) / (k * k)
blur = box_blur(dtm, 9)
tpi = dtm - blur
gy, gx = np.gradient(dtm)
slope = np.hypot(gx, gy)
tpi_s = bilinear(tpi, SX, SY); slope_s = bilinear(slope, SX, SY)
heur_rock = (c < 1.2) & (((tpi_s > 0.45) & (slope_s > 0.12)) | (slope_s > 0.7))
rock = np.where(valid, plan_rock, heur_rock)

road_img = Image.new('L', (N, N), 0); d = ImageDraw.Draw(road_img)
def to_px(p): return ((p[0] + 128) / 0.25, (128 - p[1]) / 0.25)
for r in osm['roads']:
    if r['t'] in ('path', 'footway', 'steps'): w = 1.2
    elif r['t'] in ('track', 'service'): w = 3.0
    else: w = 4.5
    if r['n'] == 'Hellesmoveien': continue
    d.line([to_px(p) for p in r['p']], fill=255, width=int(w / 0.25))
osm_road = np.asarray(road_img) > 0
# Hellesmoveien: fra planen innenfor planområdet, ellers OSM-linja
hroad = Image.new('L', (N, N), 0); d = ImageDraw.Draw(hroad)
for r in osm['roads']:
    if r['n'] == 'Hellesmoveien':
        d.line([to_px(p) for p in r['p']], fill=255, width=int(3.4 / 0.25))
road = np.where(valid, plan_road, osm_road | (np.asarray(hroad) > 0))

pts = np.stack([SX.ravel(), SY.ravel()], 1)
inprop = propPath.contains_points(pts).reshape(N, N)
lawn = inprop & ~rock & ~road & (c < 0.8)
field = (~inprop) & (h < 8.6) & (slope_s < 0.06) & (c < 0.5) & (SX > 10)

spl = np.zeros((N, N, 3), np.uint8)
spl[..., 0] = rock * 255
spl[..., 1] = lawn * 255
spl[..., 2] = road * 255
im = Image.fromarray(spl).filter(ImageFilter.GaussianBlur(1.6))
# åker/eng kodes i en egen kanal-fil (luminans)
im.save(f'{OUT}/splat.png')
Image.fromarray((field * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(3)).resize((512, 512)).save(f'{OUT}/field.png')

# ---------- bygg (OSM), unntatt egne ----------
pal_wall = [(0.93, 0.93, 0.9)] * 6 + [(0.85, 0.86, 0.84), (0.86, 0.72, 0.38), (0.55, 0.16, 0.12), (0.2, 0.22, 0.25), (0.3, 0.33, 0.35)]
ortho_far = np.asarray(Image.open(f'{GEO}/ortho_far.jpg').convert('RGB')).astype(float) / 255
blds = []
rng = np.random.default_rng(7)
for b in osm['buildings']:
    p = np.array(b['p'])
    cen = p.mean(0)
    if propPath.contains_point(cen):
        continue
    oi = int((512 - cen[1]) / 1024 * 2048); oj = int((cen[0] + 512) / 1024 * 2048)
    oi = np.clip(oi, 3, 2044); oj = np.clip(oj, 3, 2044)
    rc = ortho_far[oi - 3:oi + 4, oj - 3:oj + 4].reshape(-1, 3).mean(0) * 0.8
    wall = pal_wall[rng.integers(len(pal_wall))]
    blds.append(dict(p=b['p'], g=b['g'], top=b['top'], wall=[round(x, 2) for x in wall], roof=[round(x, 2) for x in rc]))
json.dump(blds, open(f'{OUT}/buildings.json', 'w'))
print('buildings', len(blds))

# ---------- trær og busker ----------
from numpy.lib.stride_tricks import sliding_window_view
bmask = Image.new('L', (1024, 1024), 0); d = ImageDraw.Draw(bmask)
for b in osm['buildings']:
    d.polygon([(x + 512, 512 - y) for x, y in b['p']], fill=255)
bm = np.asarray(bmask.filter(ImageFilter.MaxFilter(5))) > 0
pad = np.pad(chm, 3, mode='edge')
mx = sliding_window_view(pad, (7, 7)).max(axis=(2, 3))
peaks = (chm >= mx - 1e-6) & (chm > 2.4) & ~bm & ~sea
ys, xs = np.nonzero(peaks)
trees = []
taken = set()
for y, x in zip(ys, xs):
    key = (y // 3, x // 3)
    if key in taken:
        continue
    taken.add(key)
    hh = float(chm[y, x])
    if hh > 28:
        continue
    win = chm[max(0, y - 6):y + 7, max(0, x - 6):x + 7]
    area = (win > hh * 0.45).sum()
    r = float(np.clip(np.sqrt(area / np.pi), 1.0, 7.0))
    X_, Y_ = x - 511.5, 511.5 - y
    seed = int((int(x) * 73856093 ^ int(y) * 19349663) & 0xffff)
    trees.append([round(X_, 1), round(Y_, 1), round(float(dtm[y, x]), 2), round(hh, 1), round(r, 1), seed])
# busker (lav vegetasjon) innenfor 120 m
pad = np.pad(chm, 2, mode='edge')
mx = sliding_window_view(pad, (5, 5)).max(axis=(2, 3))
sp = (chm >= mx - 1e-6) & (chm > 0.6) & (chm <= 2.4) & ~bm & ~sea
ys, xs = np.nonzero(sp)
shrubs = []
for y, x in zip(ys, xs):
    X_, Y_ = x - 511.5, 511.5 - y
    if abs(X_) < 140 and abs(Y_) < 140:
        shrubs.append([round(X_, 1), round(Y_, 1), round(float(dtm[y, x]), 2), round(float(chm[y, x]), 1)])
json.dump({'trees': trees, 'shrubs': shrubs}, open(f'{OUT}/vegetation.json', 'w'))
print('trees', len(trees), 'shrubs', len(shrubs))

# ---------- planer drapert på terrenget ----------
D = 880
v = (np.arange(D) + 0.5) * 0.1
PX, PY = np.meshgrid(v - 40, 40 - v)
u, vv = plan_uv(PX, PY)
ui = np.clip(u.astype(int), 0, 2480); vi = np.clip(vv.astype(int), 0, 1753)
ok = plan_valid(u, vv)
for page, name in ((1, 'eks'), (3, 'V1'), (4, 'V2'), (5, 'V3'), (2, 'V4')):
    a = np.asarray(Image.open(f'{PDF}/s150-{page}.png').convert('RGB'))
    out = a[vi, ui].copy()
    out[~ok] = 255
    Image.fromarray(out).save(f'{OUT}/plan_{name}.jpg', quality=82)

# ---------- ortofoto ----------
Image.open(f'{GEO}/ortho_in.jpg').save(f'{OUT}/ortho_in.jpg', quality=80)
Image.open(f'{GEO}/ortho_far.jpg').save(f'{OUT}/ortho_far.jpg', quality=78)
print('done')

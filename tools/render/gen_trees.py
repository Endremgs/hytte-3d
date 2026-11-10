"""Lager trær for kystskogen på Tjøme (eik, furu, bjørk, kratt) med fotografiske blad- og barteksturer
fra Poly Haven (CC0). Resultat: trees.blend i cachen med objekter gen_<art>_<n> (høyde/radius som egenskaper).

    blender -b --factory-startup -P tools/render/gen_trees.py

Treet bygges som stamme + hovedgreiner + sidegreiner (koniske rør) og bladklynger ytterst i et
kroneellipsoide – omtrent slik kronene ser ut på laserdata (DOM) og flyfoto.
"""
import bpy, os, math
import numpy as np

CACHE = os.environ.get('HYTTE_RENDER_CACHE', os.path.expanduser('~/.cache/hytte3d-render'))
A = os.path.join(CACHE, 'assets')
TEX = {
    'leaf_diff': f'{A}/island_tree_01/textures/island_tree_01_leaves_diff_1k.png',
    'leaf_alpha': f'{A}/island_tree_01/textures/island_tree_01_leaves_alpha_1k.png',
    'leaf_nor': f'{A}/island_tree_01/textures/island_tree_01_leaves_nor_gl_1k.png',
    'twig_diff': f'{A}/pine_tree_01/textures/pine_tree_01_twig_diff_1k.png',
    'twig_alpha': f'{A}/pine_tree_01/textures/pine_tree_01_twig_alpha_1k.png',
    'twig_nor': f'{A}/pine_tree_01/textures/pine_tree_01_twig_nor_gl_1k.png',
    'bark_diff': f'{A}/pine_tree_01/textures/pine_tree_01_bark_diff_1k.png',
    'bark_nor': f'{A}/pine_tree_01/textures/pine_tree_01_bark_nor_gl_1k.png',
}
TWIG_RECT = (0.045, 0.555, 0.265, 0.96)  # nålekvist øverst til venstre i atlaset (stilk nederst)


def load(path, srgb=True):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    return im


def leaf_rects():
    """Finn de enkelte bladene i atlaset fra alfakanalen (rader, så kolonner)."""
    im = load(TEX['leaf_alpha'], False)
    w, h = im.size
    a = np.array(im.pixels[:], dtype=np.float32).reshape(h, w, im.channels)[..., 0] > 0.5
    rects = []

    def runs(mask):
        out, start = [], None
        for i, v in enumerate(mask):
            if v and start is None:
                start = i
            if not v and start is not None:
                out.append((start, i)); start = None
        if start is not None:
            out.append((start, len(mask)))
        return out

    for r0, r1 in runs(a.any(axis=1)):
        band = a[r0:r1]
        for c0, c1 in runs(band.any(axis=0)):
            if c1 - c0 < 20:
                continue
            rows = np.nonzero(band[:, c0:c1].any(axis=1))[0]
            rects.append((c0 / w, (r0 + rows.min()) / h, c1 / w, (r0 + rows.max() + 1) / h))
    # pixels[] har rad 0 nederst => v går oppover; bladstilken ligger nederst i bildet (lav v)
    return [r for r in rects if (r[3] - r[1]) > 0.1]


class Builder:
    def __init__(self):
        self.v, self.f, self.uv, self.col, self.mat = [], [], [], [], []
        self.nv = 0

    def quad_batch(self, P, uv, col, mat):
        """P: (n,4,3) hjørner, uv: (n,4,2), col: (n,3)."""
        n = len(P)
        self.v.append(P.reshape(-1, 3))
        idx = self.nv + np.arange(n * 4).reshape(n, 4)
        self.f.append(idx)
        self.uv.append(uv.reshape(-1, 2))
        self.col.append(np.repeat(col, 4, axis=0))
        self.mat.append(np.full(n, mat))
        self.nv += n * 4

    def tube(self, pts, rad, mat=0, sides=7, col=(1, 1, 1)):
        pts = np.asarray(pts, dtype=np.float64); rad = np.asarray(rad, dtype=np.float64)
        n = len(pts)
        t = np.gradient(pts, axis=0); t /= np.linalg.norm(t, axis=1, keepdims=True) + 1e-9
        ref = np.array([0.0, 0.0, 1.0]) if abs(t[0, 2]) < 0.9 else np.array([1.0, 0.0, 0.0])
        nrm = np.cross(t, ref); nrm /= np.linalg.norm(nrm, axis=1, keepdims=True) + 1e-9
        bin_ = np.cross(t, nrm)
        ang = np.linspace(0, 2 * np.pi, sides + 1)
        ring = (np.cos(ang)[None, :, None] * nrm[:, None, :] + np.sin(ang)[None, :, None] * bin_[:, None, :]) * rad[:, None, None] + pts[:, None, :]
        seg = np.concatenate([[0], np.cumsum(np.linalg.norm(np.diff(pts, axis=0), axis=1))])
        circ = max(2 * np.pi * rad.max(), 0.05)
        P = np.stack([ring[:-1, :-1], ring[:-1, 1:], ring[1:, 1:], ring[1:, :-1]], axis=2).reshape(-1, 4, 3)
        u = ang / (2 * np.pi) * circ / 0.6
        vv = seg / 0.6
        U = np.stack([np.broadcast_to(u[None, :-1], (n - 1, sides)), np.broadcast_to(u[None, 1:], (n - 1, sides)),
                      np.broadcast_to(u[None, 1:], (n - 1, sides)), np.broadcast_to(u[None, :-1], (n - 1, sides))], axis=2)
        V = np.stack([np.broadcast_to(vv[:-1, None], (n - 1, sides)), np.broadcast_to(vv[:-1, None], (n - 1, sides)),
                      np.broadcast_to(vv[1:, None], (n - 1, sides)), np.broadcast_to(vv[1:, None], (n - 1, sides))], axis=2)
        uv = np.stack([U, V], axis=-1).reshape(-1, 4, 2)
        self.quad_batch(P, uv, np.tile(np.asarray(col, dtype=np.float64), (len(P), 1)), mat)

    def cards(self, base, axis, normal, w, h, rect, col, mat):
        """Kort med stilken i base, langs axis (lengde h), bredde w. rect = (u0,v0,u1,v1)."""
        side = np.cross(axis, normal); side /= np.linalg.norm(side, axis=1, keepdims=True) + 1e-9
        hw = (w / 2)[:, None] * side
        tip = base + axis * h[:, None]
        P = np.stack([base - hw, base + hw, tip + hw, tip - hw], axis=1)
        r = np.asarray(rect)
        if r.ndim == 1:
            r = np.tile(r, (len(base), 1))
        uv = np.stack([np.stack([r[:, 0], r[:, 1]], 1), np.stack([r[:, 2], r[:, 1]], 1),
                       np.stack([r[:, 2], r[:, 3]], 1), np.stack([r[:, 0], r[:, 3]], 1)], axis=1)
        self.quad_batch(P, uv, col, mat)

    def mesh(self, name, mats):
        V = np.concatenate(self.v).astype(np.float32)
        F = np.concatenate(self.f)
        UV = np.concatenate(self.uv).astype(np.float32)
        C = np.concatenate(self.col).astype(np.float32)
        M = np.concatenate(self.mat).astype(np.int32)
        me = bpy.data.meshes.new(name)
        me.vertices.add(len(V)); me.vertices.foreach_set('co', V.ravel())
        me.loops.add(F.size); me.loops.foreach_set('vertex_index', F.ravel().astype(np.int32))
        me.polygons.add(len(F))
        me.polygons.foreach_set('loop_start', (np.arange(len(F)) * 4).astype(np.int32))
        me.polygons.foreach_set('material_index', M)
        me.polygons.foreach_set('use_smooth', np.ones(len(F), dtype=bool))
        uvl = me.uv_layers.new(name='UVMap'); uvl.data.foreach_set('uv', UV.ravel())
        ca = me.color_attributes.new('tint', 'FLOAT_COLOR', 'CORNER')
        ca.data.foreach_set('color', np.concatenate([C, np.ones((len(C), 1), np.float32)], 1).ravel())
        me.validate(); me.update()
        for m in mats:
            me.materials.append(m)
        ob = bpy.data.objects.new(name, me)
        return ob


def bezier(p0, p1, p2, n=8):
    t = np.linspace(0, 1, n)[:, None]
    return (1 - t) ** 2 * p0 + 2 * (1 - t) * t * p1 + t ** 2 * p2


def unit(v):
    return v / (np.linalg.norm(v, axis=-1, keepdims=True) + 1e-9)


# ---------------------------------------------------------------- materialer
def mat_bark(name, tint, white=False):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    b = N['Principled BSDF']
    tx = N.new('ShaderNodeTexImage'); tx.image = load(TEX['bark_diff'])
    nm = N.new('ShaderNodeTexImage'); nm.image = load(TEX['bark_nor'], False)
    nmap = N.new('ShaderNodeNormalMap'); L.new(nm.outputs[0], nmap.inputs['Color']); L.new(nmap.outputs[0], b.inputs['Normal'])
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    L.new(tx.outputs[0], mix.inputs[6]); mix.inputs[7].default_value = (*tint, 1)
    if white:  # bjørk: hvit med mørke striper
        hsv = N.new('ShaderNodeHueSaturation'); hsv.inputs['Saturation'].default_value = 0.1; hsv.inputs['Value'].default_value = 2.6
        L.new(tx.outputs[0], hsv.inputs['Color'])
        mix2 = N.new('ShaderNodeMix'); mix2.data_type = 'RGBA'; mix2.inputs[0].default_value = 0.0
        L.new(hsv.outputs[0], b.inputs['Base Color'])
    else:
        L.new(mix.outputs[2], b.inputs['Base Color'])
    b.inputs['Roughness'].default_value = 0.85
    return m


def mat_foliage(name, diff, alpha, nor, tint, trans=0.35):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree; N = nt.nodes; L = nt.links
    out = N['Material Output']; b = N['Principled BSDF']
    tx = N.new('ShaderNodeTexImage'); tx.image = load(diff)
    al = N.new('ShaderNodeTexImage'); al.image = load(alpha, False)
    nm = N.new('ShaderNodeTexImage'); nm.image = load(nor, False)
    ca = N.new('ShaderNodeVertexColor'); ca.layer_name = 'tint'
    mix = N.new('ShaderNodeMix'); mix.data_type = 'RGBA'; mix.blend_type = 'MULTIPLY'; mix.inputs[0].default_value = 1
    L.new(tx.outputs[0], mix.inputs[6]); L.new(ca.outputs[0], mix.inputs[7])
    t2 = N.new('ShaderNodeMix'); t2.data_type = 'RGBA'; t2.blend_type = 'MULTIPLY'; t2.inputs[0].default_value = 1
    L.new(mix.outputs[2], t2.inputs[6]); t2.inputs[7].default_value = (*tint, 1)
    L.new(t2.outputs[2], b.inputs['Base Color'])
    nmap = N.new('ShaderNodeNormalMap'); nmap.inputs['Strength'].default_value = 0.6
    L.new(nm.outputs[0], nmap.inputs['Color']); L.new(nmap.outputs[0], b.inputs['Normal'])
    b.inputs['Roughness'].default_value = 0.55
    tr = N.new('ShaderNodeBsdfTranslucent'); L.new(t2.outputs[2], tr.inputs['Color'])
    ms = N.new('ShaderNodeMixShader'); ms.inputs[0].default_value = trans
    L.new(b.outputs[0], ms.inputs[1]); L.new(tr.outputs[0], ms.inputs[2])
    tp = N.new('ShaderNodeBsdfTransparent')
    ma = N.new('ShaderNodeMixShader')
    L.new(al.outputs[0], ma.inputs[0]); L.new(tp.outputs[0], ma.inputs[1]); L.new(ms.outputs[0], ma.inputs[2])
    L.new(ma.outputs[0], out.inputs['Surface'])
    return m


# ---------------------------------------------------------------- arter
def leaf_colors(rng, n, base, jitter=0.18):
    c = np.asarray(base)[None, :] * rng.uniform(1 - jitter, 1 + jitter, (n, 1))
    c[:, 0] *= rng.uniform(0.85, 1.15, n)  # litt gul/rødvariasjon
    return np.clip(c, 0, 2)


def broadleaf(seed, H, crown_c, crown_r, trunk_r, n_limbs, n_clusters, leaves_per, leaf_len, rects, color, white=False, bush=False):
    rng = np.random.default_rng(seed)
    b = Builder()
    cc = np.array(crown_c, dtype=np.float64); cr = np.array(crown_r, dtype=np.float64)
    branch_pts = []
    if bush:
        fork = np.array([0, 0, 0.05])
    else:
        fork = np.array([rng.uniform(-0.3, 0.3), rng.uniform(-0.3, 0.3), cc[2] - cr[2] * rng.uniform(0.55, 0.8)])
        trunk = bezier(np.array([0, 0, -0.4]), np.array([fork[0] * 0.2, fork[1] * 0.2, fork[2] * 0.5]), fork, 10)
        b.tube(trunk, np.linspace(trunk_r * 1.25, trunk_r * 0.75, 10), 0, 9)
        branch_pts.append(trunk)
    limbs = []
    for i in range(n_limbs):
        a = 2 * np.pi * i / n_limbs + rng.uniform(-0.4, 0.4)
        el = rng.uniform(-0.15, 0.55) if not bush else rng.uniform(0.0, 0.7)
        end = cc + np.array([np.cos(a) * cr[0] * 0.62, np.sin(a) * cr[1] * 0.62, el * cr[2]])
        mid = fork + (end - fork) * 0.45 + np.array([0, 0, cr[2] * rng.uniform(0.05, 0.3)])
        pts = bezier(fork, mid, end, 9)
        r0 = trunk_r * (0.75 if not bush else 0.6)
        b.tube(pts, np.linspace(r0, r0 * 0.25, 9), 0, 7)
        limbs.append(pts); branch_pts.append(pts)
    # sidegreiner mot kroneskallet og bladklynger i endene
    cl = []
    per = max(2, n_clusters // (n_limbs * 3))
    for pts in limbs:
        for k in range(per):
            t = rng.uniform(0.35, 1.0)
            p0 = pts[min(len(pts) - 1, int(t * (len(pts) - 1)))]
            d = unit((p0 - cc) / cr + rng.normal(0, 0.5, 3))
            end = cc + d * cr * rng.uniform(0.8, 1.0)
            mid = (p0 + end) / 2 + np.array([0, 0, rng.uniform(0.0, 0.4)])
            sp = bezier(p0, mid, end, 5)
            b.tube(sp, np.linspace(trunk_r * 0.22, trunk_r * 0.05, 5), 0, 5)
            cl.append(end)
            cl.append(sp[2] + rng.normal(0, 0.15, 3))
    # ekstra klynger jevnt over skallet så kronen blir tett (som på flyfoto)
    extra = n_clusters - len(cl)
    if extra > 0:
        d = unit(rng.normal(0, 1, (extra, 3)))
        d[:, 2] = np.abs(d[:, 2]) * 0.8 + d[:, 2] * 0.2 if not bush else d[:, 2]
        rr = rng.uniform(0.5, 1.0, (extra, 1)) ** 0.5 * rng.uniform(0.92, 1.08, (extra, 1))
        cl.extend(cc + unit(d) * cr * rr)
    cl = np.array(cl)
    # blader
    n = len(cl) * leaves_per
    centers = np.repeat(cl, leaves_per, axis=0)
    out = unit((centers - cc) / cr)
    # flate «dusker» av blad rundt hver klynge
    off = rng.normal(0, 1, (n, 3)) * 0.5 * (np.min(cr) / 3.5) ** 0.5 * np.array([1.0, 1.0, 0.6])
    base = centers + off
    up = np.array([0, 0, 1.0])
    nrm = unit(rng.normal(0, 1, (n, 3)) + out * 0.9 + up * 0.6)
    axis = unit(np.cross(nrm, rng.normal(0, 1, (n, 3))))
    axis = unit(axis + out * 0.5)
    ri = rng.integers(0, len(rects), n)
    R = np.array(rects)[ri]
    asp = (R[:, 2] - R[:, 0]) / (R[:, 3] - R[:, 1])
    L_ = leaf_len * rng.uniform(0.75, 1.25, n)
    b.cards(base, axis, nrm, L_ * asp * 1.0, L_, R, leaf_colors(rng, n, color), 1)
    return b, n


def pine(seed, H, color):
    rng = np.random.default_rng(seed)
    b = Builder()
    lean = rng.normal(0, 0.35, 2)
    top = np.array([lean[0], lean[1], H])
    trunk = bezier(np.array([0, 0, -0.4]), np.array([lean[0] * 0.2 + rng.normal(0, 0.2), lean[1] * 0.2, H * 0.5]), top, 14)
    b.tube(trunk, np.linspace(0.3, 0.03, 14), 0, 9, col=(1.05, 0.8, 0.62))
    z0 = H * rng.uniform(0.45, 0.6)
    cards_base, cards_axis, cards_n = [], [], []
    z = z0
    while z < H * 0.97:
        f = (z - z0) / (H - z0)
        Lb = (H * 0.33) * (1 - f) ** 0.6 + 0.4
        k = rng.integers(3, 6)
        t = np.interp(z, trunk[:, 2], np.arange(len(trunk))) / (len(trunk) - 1)
        p0 = trunk[min(len(trunk) - 1, int(round(t * (len(trunk) - 1))))]
        for i in range(k):
            a = 2 * np.pi * i / k + rng.uniform(-0.5, 0.5)
            d = np.array([np.cos(a), np.sin(a), rng.uniform(-0.15, 0.35)])
            end = p0 + unit(d) * Lb
            mid = p0 + unit(d) * Lb * 0.5 + np.array([0, 0, Lb * 0.12])
            bp = bezier(p0, mid, end, 6)
            b.tube(bp, np.linspace(0.06 * (1 - f) + 0.02, 0.012, 6), 0, 5, col=(0.9, 0.75, 0.62))
            # nålekvister langs ytterste 2/3 av greina, i vifter
            m = int(18 + Lb * 22)
            ts = rng.uniform(0.3, 1.0, m)
            idx = np.clip((ts * (len(bp) - 1)).round().astype(int), 0, len(bp) - 1)
            base = bp[idx] + rng.normal(0, 0.08, (m, 3))
            ax = unit(unit(d)[None, :] * 0.8 + rng.normal(0, 0.55, (m, 3)) + np.array([0, 0, 0.25]))
            cards_base.append(base); cards_axis.append(ax)
            cards_n.append(unit(rng.normal(0, 1, (m, 3)) + np.array([0, 0, 1.2])))
        z += rng.uniform(0.35, 0.6)
    base = np.concatenate(cards_base); ax = np.concatenate(cards_axis); nn = np.concatenate(cards_n)
    n = len(base)
    L_ = rng.uniform(0.45, 0.75, n)
    asp = (TWIG_RECT[2] - TWIG_RECT[0]) / (TWIG_RECT[3] - TWIG_RECT[1])
    b.cards(base, ax, nn, L_ * asp * 1.6, L_, TWIG_RECT, leaf_colors(rng, n, color, 0.12), 1)
    return b, n


bpy.ops.wm.read_factory_settings(use_empty=True)
rects = leaf_rects()
print('bladrektangler:', len(rects))
M = {
    'bark_oak': mat_bark('bark_oak', (0.55, 0.52, 0.48)),
    'bark_pine': mat_bark('bark_pine', (1.0, 0.72, 0.52)),
    'bark_birch': mat_bark('bark_birch', (1, 1, 1), white=True),
    'leaf_oak': mat_foliage('leaf_oak', TEX['leaf_diff'], TEX['leaf_alpha'], TEX['leaf_nor'], (0.62, 0.78, 0.42), 0.3),
    'leaf_birch': mat_foliage('leaf_birch', TEX['leaf_diff'], TEX['leaf_alpha'], TEX['leaf_nor'], (0.85, 1.0, 0.5), 0.4),
    'leaf_bush': mat_foliage('leaf_bush', TEX['leaf_diff'], TEX['leaf_alpha'], TEX['leaf_nor'], (0.6, 0.75, 0.4), 0.3),
    'needles': mat_foliage('needles', TEX['twig_diff'], TEX['twig_alpha'], TEX['twig_nor'], (0.8, 0.9, 0.75), 0.2),
}
col = bpy.data.collections.new('trees'); bpy.context.scene.collection.children.link(col)
specs = []
for i in range(3):  # eik: bred, rund krone (H 10, radius 4)
    specs.append((f'gen_oak_{i}', lambda s=i: broadleaf(100 + s, 10, (0, 0, 5.9), (4.5, 4.2, 3.6), 0.34, 5, 170, 300, 0.19, rects, (1.0, 1.0, 1.0)), 'bark_oak', 'leaf_oak', 10, 4.2))
for i in range(2):  # bjørk: smal, høy krone
    specs.append((f'gen_birch_{i}', lambda s=i: broadleaf(200 + s, 10, (0, 0, 6.6), (2.4, 2.3, 3.3), 0.16, 4, 170, 190, 0.11, rects, (1.0, 1.0, 1.0)), 'bark_birch', 'leaf_birch', 10, 2.4))
for i in range(3):  # kratt/busker (H 2, radius 1,6)
    specs.append((f'gen_bush_{i}', lambda s=i: broadleaf(300 + s, 2, (0, 0, 1.0), (1.6, 1.5, 1.0), 0.05, 6, 70, 170, 0.1, rects, (0.95, 1.0, 0.95), bush=True), 'bark_oak', 'leaf_bush', 2, 1.6))
for i in range(2):  # furu
    specs.append((f'gen_pine_{i}', lambda s=i: pine(400 + s, 12, (1.0, 1.0, 1.0)), 'bark_pine', 'needles', 12, 4.0))
for name, fn, bark, leaf, H, R in specs:
    b, n = fn()
    ob = b.mesh(name, [M[bark], M[leaf]])
    ob['height'] = H; ob['radius'] = R
    col.objects.link(ob)
    print(name, len(ob.data.polygons), 'flater,', n, 'blad/kvister', flush=True)
bpy.ops.file.pack_all()
out = os.path.join(CACHE, 'trees.blend')
bpy.ops.wm.save_as_mainfile(filepath=out, compress=True)
print('lagret', out)

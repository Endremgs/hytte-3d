"""Fotorealistisk rendering av ett alternativ med Blender Cycles.

    blender -b --factory-startup -P tools/render/render.py -- \
        --scene ~/.cache/hytte3d-render/scenes/V4 --shot plen --out public/renders/V4_plen.png

Scenen (bygg, terreng, naboer) kommer fra appen via tools/render/export.mjs. Her byttes materialene
etter navn (kit.js), terrenget får foto-teksturer styrt av flyfoto/splat-kart, gress strøs ut med
geometrinoder nær kamera, trærne erstattes av skannede modeller og himmel/sol beregnes for Tjøme.
Lokale koordinater: x = øst, y = nord, z = moh. (NN2000) – samme som i appen.
"""
import bpy, bmesh, json, math, os, sys, argparse, time
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(os.path.dirname(HERE))
CACHE = os.environ.get('HYTTE_RENDER_CACHE', os.path.expanduser('~/.cache/hytte3d-render'))
ASSETS = os.path.join(CACHE, 'assets')
DATA = os.path.join(REPO, 'data')

ap = argparse.ArgumentParser()
ap.add_argument('--scene', required=True)
ap.add_argument('--shot', required=True, help='navn i shots.json')
ap.add_argument('--out', required=True)
ap.add_argument('--samples', type=int, default=256)
ap.add_argument('--res', default='2400x1350')
ap.add_argument('--preview', action='store_true', help='rask prøve: lav oppløsning, lite gress')
ap.add_argument('--save-blend', default=None)
args = ap.parse_args(sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else [])

T0 = time.time()


def stamp(msg):
    print(f'[{time.time() - T0:6.1f}s] {msg}', flush=True)


meta = json.load(open(os.path.join(args.scene, 'meta.json')))
SHOTS = json.load(open(os.path.join(HERE, 'shots.json')))
shot = SHOTS['shots'][args.shot]
variant = meta['variant']
shot = {**shot, **shot.get('per_variant', {}).get(variant, {})}

# ---------------------------------------------------------------- sol (samme modell som src/sun.js)
LAT, LON = 59.0655, 10.4046


def sun_position(month, day, hour, year=2026):
    import datetime as dt
    def last_sunday(m):
        d = dt.date(year, m + 2, 1) - dt.timedelta(days=1) if m < 11 else dt.date(year, 12, 31)
        return d - dt.timedelta(days=(d.weekday() + 1) % 7)
    date = dt.date(year, month + 1, day)
    offset = 2 if last_sunday(2) <= date < last_sunday(9) else 1
    utc = hour - offset
    doy = (date - dt.date(year, 1, 1)).days + 1
    g = 2 * math.pi / 365 * (doy - 1 + (utc - 12) / 24)
    eqt = 229.18 * (0.000075 + 0.001868 * math.cos(g) - 0.032077 * math.sin(g) - 0.014615 * math.cos(2 * g) - 0.040849 * math.sin(2 * g))
    decl = 0.006918 - 0.399912 * math.cos(g) + 0.070257 * math.sin(g) - 0.006758 * math.cos(2 * g) + 0.000907 * math.sin(2 * g) - 0.002697 * math.cos(3 * g) + 0.00148 * math.sin(3 * g)
    tst = utc * 60 + eqt + 4 * LON
    ha = math.radians(tst / 4 - 180)
    lat = math.radians(LAT)
    cz = math.sin(lat) * math.sin(decl) + math.cos(lat) * math.cos(decl) * math.cos(ha)
    zen = math.acos(max(-1, min(1, cz)))
    az = math.degrees(math.acos(max(-1, min(1, (math.sin(lat) * math.cos(zen) - math.sin(decl)) / (math.cos(lat) * math.sin(zen))))))
    az = (az + 180) % 360 if ha > 0 else (540 - az) % 360
    return 90 - math.degrees(zen), az


month, day, hour = shot.get('month', 6), shot.get('day', 25), shot.get('hour', 19.0)
SUN_EL, SUN_AZ = sun_position(month, day, hour)
SUN_DIR = Vector((math.cos(math.radians(SUN_EL)) * math.sin(math.radians(SUN_AZ)),
                  math.cos(math.radians(SUN_EL)) * math.cos(math.radians(SUN_AZ)),
                  math.sin(math.radians(SUN_EL))))
print(f'sol: høyde {SUN_EL:.1f}°, asimut {SUN_AZ:.0f}°', flush=True)

# ---------------------------------------------------------------- scene
bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
bpy.ops.import_scene.gltf(filepath=os.path.join(args.scene, 'scene.glb'))
CAM = Vector(shot['cam'])
TGT = Vector(shot['tgt'])


def img(path, srgb=True, ext='REPEAT'):
    im = bpy.data.images.load(path, check_existing=True)
    im.colorspace_settings.name = 'sRGB' if srgb else 'Non-Color'
    return im, ext


class NB:
    """Liten hjelper for å bygge nodetrær kompakt."""

    def __init__(self, mat):
        mat.use_nodes = True
        self.nt = mat.node_tree
        self.nt.nodes.clear()
        self.out = self.n('ShaderNodeOutputMaterial')

    def n(self, kind, **props):
        node = self.nt.nodes.new(kind)
        for k, v in props.items():
            setattr(node, k, v)
        return node

    def link(self, a, b):
        self.nt.links.new(a, b)

    def val(self, sock, v):
        if isinstance(sock, bpy.types.NodeSocket) and not sock.is_linked:
            sock.default_value = v

    def math(self, op, a, b=None, clamp=False):
        m = self.n('ShaderNodeMath', operation=op, use_clamp=clamp)
        for i, x in enumerate([a, b]):
            if x is None:
                continue
            if isinstance(x, bpy.types.NodeSocket):
                self.link(x, m.inputs[i])
            else:
                m.inputs[i].default_value = x
        return m.outputs[0]

    def vmath(self, op, a, b=None):
        m = self.n('ShaderNodeVectorMath', operation=op)
        for i, x in enumerate([a, b]):
            if x is None:
                continue
            if isinstance(x, bpy.types.NodeSocket):
                self.link(x, m.inputs[i])
            else:
                m.inputs[i].default_value = x
        return m.outputs[1] if op in ('DOT_PRODUCT', 'LENGTH', 'DISTANCE') else m.outputs[0]

    def mix(self, a, b, f, blend='MIX'):
        m = self.n('ShaderNodeMix', data_type='RGBA', blend_type=blend)
        for sock, x in [(m.inputs[0], f), (m.inputs[6], a), (m.inputs[7], b)]:
            if isinstance(x, bpy.types.NodeSocket):
                self.link(x, sock)
            elif isinstance(x, (int, float)):
                sock.default_value = x
            else:
                sock.default_value = (*x, 1) if len(x) == 3 else x
        return m.outputs[2]

    def smooth(self, x, lo, hi):
        m = self.n('ShaderNodeMapRange', interpolation_type='SMOOTHSTEP')
        self.link(x, m.inputs[0])
        m.inputs[1].default_value, m.inputs[2].default_value = lo, hi
        return m.outputs[0]

    def tex(self, path, vec, srgb=True, ext='REPEAT', proj='FLAT', blend=0.0):
        t = self.n('ShaderNodeTexImage', projection=proj, extension=ext, interpolation='Cubic' if ext == 'EXTEND' else 'Linear')
        t.projection_blend = blend
        t.image = img(path, srgb)[0]
        if vec is not None:
            self.link(vec, t.inputs[0])
        return t

    def bsdf(self, color=None, rough=0.6, **kw):
        b = self.n('ShaderNodeBsdfPrincipled')
        if isinstance(color, bpy.types.NodeSocket):
            self.link(color, b.inputs['Base Color'])
        elif color is not None:
            b.inputs['Base Color'].default_value = (*color, 1)
        if isinstance(rough, bpy.types.NodeSocket):
            self.link(rough, b.inputs['Roughness'])
        else:
            b.inputs['Roughness'].default_value = rough
        for k, v in kw.items():
            if isinstance(v, bpy.types.NodeSocket):
                self.link(v, b.inputs[k])
            else:
                b.inputs[k].default_value = v
        self.link(b.outputs[0], self.out.inputs[0])
        return b

    def world_xy(self):
        g = self.n('ShaderNodeNewGeometry')
        return g.outputs['Position']

    def bump(self, height, strength=0.3, dist=0.01, normal=None):
        b = self.n('ShaderNodeBump')
        b.inputs['Strength'].default_value = strength
        b.inputs['Distance'].default_value = dist
        self.link(height, b.inputs['Height'])
        if normal is not None:
            self.link(normal, b.inputs['Normal'])
        return b.outputs[0]

    def normal_map(self, path, vec, strength=1.0, proj='FLAT', blend=0.0):
        t = self.tex(path, vec, srgb=False, proj=proj, blend=blend)
        nm = self.n('ShaderNodeNormalMap')
        nm.inputs['Strength'].default_value = strength
        self.link(t.outputs[0], nm.inputs['Color'])
        return nm.outputs[0]


def srgb(hexv):
    """Hex (sRGB) -> lineær RGB."""
    c = [((hexv >> s) & 255) / 255 for s in (16, 8, 0)]
    return tuple(x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c)


def base_color(mat, fallback=(0.8, 0.8, 0.8)):
    if mat and 'hex' in mat:  # fra appen (main.js exportForRender)
        return srgb(int(mat['hex']))
    if mat and mat.node_tree:
        for n in mat.node_tree.nodes:
            if n.type == 'BSDF_PRINCIPLED':
                return tuple(n.inputs['Base Color'].default_value[:3])
    return fallback


def asset(name, kind):
    return os.path.join(ASSETS, name, f'{kind}.jpg') if os.path.exists(os.path.join(ASSETS, name, f'{kind}.jpg')) else os.path.join(ASSETS, name, f'{kind}.png')


# ---------------------------------------------------------------- byggematerialer
CLADDING = {'dagens': 0x2b313a, 'sort': 0x1b1c1e, 'gran': 0x9a948a, 'hvit': 0xe9e9e4, 'rod': 0x6b2a22, 'oliven': 0x2f3a2c}


def mat_cladding(mat, color, vertical):
    nb = NB(mat)
    uv = nb.n('ShaderNodeUVMap').outputs[0]
    sep = nb.n('ShaderNodeSeparateXYZ'); nb.link(uv, sep.inputs[0])
    # UV i kit.js er i enheter av 1,2 m; liggende kledning 19 cm, stående 15 cm + lekter
    along, across = (sep.outputs[1], sep.outputs[0]) if not vertical else (sep.outputs[0], sep.outputs[1])
    pitch = 0.19 / 1.2 if not vertical else 0.15 / 1.2
    t = nb.math('DIVIDE', along, pitch)
    board = nb.math('FLOOR', t)
    fr = nb.math('FRACT', t)
    # skyggefuge i overkant av hvert bord (overlapp), avrundet profil
    groove = nb.smooth(fr, 0.0, 0.08)
    shade = nb.math('POWER', nb.math('SUBTRACT', 1.0, fr), 0.35)
    height = nb.math('MULTIPLY', groove, nb.math('ADD', 0.6, nb.math('MULTIPLY', shade, 0.4)))
    # fargevariasjon per bord + fin trestruktur
    wn = nb.n('ShaderNodeTexWhiteNoise', noise_dimensions='1D'); nb.link(board, wn.inputs['W'])
    noise = nb.n('ShaderNodeTexNoise', noise_dimensions='3D'); noise.inputs['Scale'].default_value = 3.0; noise.inputs['Detail'].default_value = 8
    co = nb.n('ShaderNodeTexCoord'); nb.link(co.outputs['Object'], noise.inputs['Vector'])
    grain = nb.n('ShaderNodeTexWave', wave_type='BANDS', bands_direction='X' if not vertical else 'Y')
    grain.inputs['Scale'].default_value = 40; grain.inputs['Distortion'].default_value = 6; grain.inputs['Detail'].default_value = 4
    nb.link(uv, grain.inputs['Vector'])
    base = Vector(color)
    var = nb.math('ADD', 0.9, nb.math('MULTIPLY', wn.outputs[0], 0.2))
    var = nb.math('MULTIPLY', var, nb.math('ADD', 0.92, nb.math('MULTIPLY', noise.outputs[0], 0.16)))
    col = nb.n('ShaderNodeVectorMath', operation='SCALE'); col.inputs[0].default_value = base[:]; nb.link(var, col.inputs['Scale'])
    dark = nb.mix(col.outputs[0], (0.0, 0.0, 0.0), nb.math('MULTIPLY', nb.math('SUBTRACT', 1.0, groove), 0.55))
    rough = nb.math('ADD', 0.55, nb.math('MULTIPLY', grain.outputs[1], 0.15))
    n1 = nb.bump(height, 0.55, 0.012)
    n2 = nb.bump(grain.outputs[1], 0.05, 0.002, n1)
    nb.bsdf(dark, rough, Normal=n2)


def mat_paint(mat, color, rough=0.45):
    nb = NB(mat)
    noise = nb.n('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 60
    r = nb.math('ADD', rough - 0.05, nb.math('MULTIPLY', noise.outputs[0], 0.1))
    nb.bsdf(color, r, Normal=nb.bump(noise.outputs[0], 0.03, 0.002))


def mat_glass(mat):
    nb = NB(mat)
    b = nb.bsdf((0.9, 0.95, 0.94), 0.0, **{'Transmission Weight': 1.0, 'IOR': 1.52})
    # tynt glass: lys passerer uten brytning (raskere og riktigere for vindusruter)
    lp = nb.n('ShaderNodeLightPath')
    tr = nb.n('ShaderNodeBsdfTransparent'); tr.inputs[0].default_value = (0.93, 0.97, 0.96, 1)
    mixs = nb.n('ShaderNodeMixShader')
    nb.link(lp.outputs['Is Shadow Ray'], mixs.inputs[0])
    nb.link(b.outputs[0], mixs.inputs[1]); nb.link(tr.outputs[0], mixs.inputs[2])
    nb.link(mixs.outputs[0], nb.out.inputs[0])


def mat_roof(mat, kind, color):
    nb = NB(mat)
    uv = nb.n('ShaderNodeUVMap').outputs[0]
    sep = nb.n('ShaderNodeSeparateXYZ'); nb.link(uv, sep.inputs[0])
    noise = nb.n('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 1.5; noise.inputs['Detail'].default_value = 6
    if kind == 'bolge':  # bølgeplater, 16 cm bølge langs takflaten
        w = nb.math('COSINE', nb.math('MULTIPLY', sep.outputs[0], 2 * math.pi / 0.16))
        nb.bsdf(color, nb.math('ADD', 0.5, nb.math('MULTIPLY', noise.outputs[0], 0.15)), Metallic=0.05, Normal=nb.bump(w, 1.0, 0.02))
    elif kind == 'falset':  # falsede plater, 50 cm mellom falsene
        fr = nb.math('FRACT', nb.math('DIVIDE', sep.outputs[0], 0.5))
        seam = nb.math('SUBTRACT', 1.0, nb.smooth(nb.math('ABSOLUTE', nb.math('SUBTRACT', fr, 0.5)), 0.0, 0.03))
        seam = nb.math('SUBTRACT', 1.0, seam)
        nb.bsdf(color, nb.math('ADD', 0.4, nb.math('MULTIPLY', noise.outputs[0], 0.12)), Metallic=0.1, Normal=nb.bump(seam, 1.0, 0.03))
    elif kind == 'torv':  # sedum/torv
        n2 = nb.n('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 25; n2.inputs['Detail'].default_value = 10
        vor = nb.n('ShaderNodeTexVoronoi'); vor.inputs['Scale'].default_value = 60
        col = nb.mix((0.06, 0.09, 0.02), (0.20, 0.17, 0.04), n2.outputs[0])
        col = nb.mix(col, (0.24, 0.05, 0.03), nb.smooth(noise.outputs[0], 0.62, 0.7))
        nb.bsdf(col, 0.9, Normal=nb.bump(vor.outputs[0], 0.8, 0.03))
    else:  # shingel
        t = nb.math('DIVIDE', sep.outputs[1], 0.2)
        row = nb.math('FLOOR', t)
        fr = nb.math('FRACT', t)
        tab = nb.math('FRACT', nb.math('ADD', nb.math('DIVIDE', sep.outputs[0], 0.33), nb.math('MULTIPLY', row, 0.5)))
        edge = nb.math('MULTIPLY', nb.smooth(fr, 0.0, 0.1), nb.smooth(nb.math('ABSOLUTE', nb.math('SUBTRACT', tab, 0.5)), 0.49, 0.45))
        n2 = nb.n('ShaderNodeTexNoise'); n2.inputs['Scale'].default_value = 200
        col = nb.mix(color, tuple(c * 0.6 for c in color), n2.outputs[0])
        nb.bsdf(col, 0.85, Normal=nb.bump(nb.math('ADD', edge, nb.math('MULTIPLY', n2.outputs[0], 0.2)), 0.6, 0.01))


def mat_scan(mat, name, scale=1.0, tint=None, rough=None, normal=0.8, box=True):
    nb = NB(mat)
    co = nb.n('ShaderNodeTexCoord')
    mp = nb.n('ShaderNodeMapping'); mp.inputs['Scale'].default_value = (scale, scale, scale)
    nb.link(co.outputs['Object' if box else 'UV'], mp.inputs[0])
    proj = 'BOX' if box else 'FLAT'
    d = nb.tex(asset(name, 'diff'), mp.outputs[0], proj=proj, blend=0.2)
    col = d.outputs[0] if tint is None else nb.mix(d.outputs[0], tint, 1.0, 'MULTIPLY')
    kw = {}
    if os.path.exists(asset(name, 'nor')):
        kw['Normal'] = nb.normal_map(asset(name, 'nor'), mp.outputs[0], normal, proj, 0.2)
    r = rough
    if r is None and os.path.exists(asset(name, 'rough')):
        r = nb.tex(asset(name, 'rough'), mp.outputs[0], srgb=False, proj=proj, blend=0.2).outputs[0]
    nb.bsdf(col, r if r is not None else 0.8, **kw)


def mat_wood(mat, color, rough=0.5, scale=8):
    nb = NB(mat)
    co = nb.n('ShaderNodeTexCoord')
    w = nb.n('ShaderNodeTexWave', wave_type='RINGS'); w.inputs['Scale'].default_value = scale; w.inputs['Distortion'].default_value = 8; w.inputs['Detail'].default_value = 3
    nb.link(co.outputs['Object'], w.inputs['Vector'])
    col = nb.mix(color, tuple(c * 0.7 for c in color), w.outputs[1])
    nb.bsdf(col, rough, Normal=nb.bump(w.outputs[1], 0.05, 0.002))


done = set()
for ob in list(bpy.data.objects):
    for slot in ob.material_slots:
        m = slot.material
        if not m or m.name in done:
            continue
        done.add(m.name)
        key = m.name.split('.')[0]
        col = base_color(m)
        if key == 'clad':
            mat_cladding(m, srgb(CLADDING.get(m.get('cladding', meta.get('cladding', 'dagens')), 0x2b313a)), bool(m.get('vertical', meta.get('vertical', False))))
        elif key in ('trim', 'door', 'roofEdge', 'frame'):
            mat_paint(m, col, 0.42)
        elif key == 'glass':
            mat_glass(m)
        elif key == 'roof':
            mat_roof(m, m.get('profile', meta.get('roof', 'bolge')), col)
        elif key == 'deck':
            mat_scan(m, 'weathered_planks', scale=1.2 / 1.2, tint=(0.62, 0.6, 0.56), box=False, normal=1.0)
        elif key == 'found':
            mat_scan(m, 'concrete_wall_008', scale=0.5, tint=(0.85, 0.85, 0.83))
        elif key == 'floor':
            mat_wood(m, (0.45, 0.30, 0.17), 0.35)
        elif key == 'inner':
            mat_paint(m, (0.75, 0.73, 0.69), 0.8)
        elif key == 'teak':
            mat_wood(m, (0.32, 0.17, 0.08), 0.55, 20)
        elif key in ('dark', 'chair'):
            mat_paint(m, col, 0.55)
        elif key.startswith('nb_'):
            win = next((n.image for n in m.node_tree.nodes if n.type == 'TEX_IMAGE'), None) if m.node_tree else None
            nb = NB(m)
            c = nb.n('ShaderNodeVertexColor').outputs[0]
            if win is not None:  # vindusrutenett fra appen (windowGridTex)
                wt = nb.n('ShaderNodeTexImage'); wt.image = win
                c = nb.mix(c, wt.outputs[0], 1.0, 'MULTIPLY')
            noise = nb.n('ShaderNodeTexNoise'); noise.inputs['Scale'].default_value = 0.3
            c = nb.mix(c, (0.0, 0.0, 0.0), nb.math('ADD', 0.25, nb.math('MULTIPLY', noise.outputs[0], 0.25)))
            nb.bsdf(c, 0.75 if key != 'nb_roof' else 0.5)

stamp('materialer klare')
# ---------------------------------------------------------------- terreng
terrain = bpy.data.objects.get('terrain')
far = bpy.data.objects.get('terrain_far')
horizon = bpy.data.objects.get('terrain_horizon')


def trim_inside(ob, half):
    """Fjern flater som overlapper det finere terrenget innenfor (som discard i shaderen)."""
    bm = bmesh.new(); bm.from_mesh(ob.data)
    kill = [f for f in bm.faces if max(abs(f.calc_center_median().x), abs(f.calc_center_median().y)) < half]
    bmesh.ops.delete(bm, geom=kill, context='FACES')
    bm.to_mesh(ob.data); bm.free()


for ob, half in [(far, 126), (horizon, 508)]:
    if ob:
        ob.data.transform(ob.matrix_world); ob.matrix_world.identity()
        trim_inside(ob, half)
        ob.data.shade_smooth() if hasattr(ob.data, 'shade_smooth') else None
if terrain:
    terrain.data.transform(terrain.matrix_world); terrain.matrix_world.identity()
    for p in terrain.data.polygons:
        p.use_smooth = True


def summerize(nb, c):
    """Vinterflyfoto -> sommerfarger (som summerize() i terrain.js)."""
    l = nb.vmath('DOT_PRODUCT', c, (0.3, 0.59, 0.11))
    green = nb.n('ShaderNodeVectorMath', operation='SCALE'); green.inputs[0].default_value = (0.20, 0.30, 0.10)
    nb.link(nb.math('ADD', 0.55, nb.math('MULTIPLY', l, 1.6)), green.inputs['Scale'])
    sepc = nb.n('ShaderNodeSeparateColor'); nb.link(c, sepc.inputs[0])
    gb = nb.math('SUBTRACT', sepc.outputs[1], sepc.outputs[2])
    is_rock = nb.math('MULTIPLY', nb.smooth(l, 0.30, 0.42), nb.math('SUBTRACT', 1.0, nb.smooth(gb, 0.02, 0.07)))
    rock = nb.n('ShaderNodeVectorMath', operation='SCALE'); rock.inputs[0].default_value = (0.45, 0.44, 0.42)
    nb.link(nb.math('ADD', 0.6, l), rock.inputs['Scale'])
    s = nb.mix(green.outputs[0], rock.outputs[0], is_rock)
    water = nb.math('MULTIPLY', nb.smooth(nb.math('ADD', nb.math('SUBTRACT', sepc.outputs[0], sepc.outputs[2]), 0.02), 0.02, 0.0),
                    nb.smooth(l, 0.25, 0.12))
    return nb.mix(s, c, water), l


def ortho_uv(nb, half):
    pos = nb.world_xy()
    m = nb.n('ShaderNodeMapping')
    m.inputs['Location'].default_value = (0.5, 0.5, 0)
    m.inputs['Scale'].default_value = (1 / (2 * half), 1 / (2 * half), 1)
    nb.link(pos, m.inputs[0])
    return m.outputs[0]


def mat_terrain_far(ob, path, half):
    m = bpy.data.materials.new(ob.name)
    ob.data.materials.clear(); ob.data.materials.append(m)
    nb = NB(m)
    t = nb.tex(path, ortho_uv(nb, half), ext='EXTEND')
    c, lum = summerize(nb, t.outputs[0])
    # skog sett ovenfra er mørk; flyfotoets lyse partier (åker/berg) beholdes lysere
    dark = nb.mix(c, (0.0, 0.0, 0.0), nb.math('SUBTRACT', 0.62, nb.math('MULTIPLY', nb.smooth(lum, 0.08, 0.3), 0.3)))
    dark = nb.mix(dark, (0.55, 0.7, 0.4), 1.0, 'MULTIPLY')
    hs = nb.n('ShaderNodeHueSaturation'); hs.inputs['Saturation'].default_value = 1.0; hs.inputs['Value'].default_value = 0.85
    nb.link(dark, hs.inputs['Color'])
    nb.bsdf(hs.outputs[0], 0.95, **{'Specular IOR Level': 0.1})


if far:
    mat_terrain_far(far, os.path.join(DATA, 'ortho_far.jpg'), 512)
if horizon:
    mat_terrain_far(horizon, os.path.join(DATA, 'ortho_4k.jpg'), 2048)

if terrain:
    m = bpy.data.materials.new('terrain_inner')
    terrain.data.materials.clear(); terrain.data.materials.append(m)
    nb = NB(m)
    ouv = ortho_uv(nb, 128)
    ortho = nb.tex(os.path.join(DATA, 'ortho_in.jpg'), ouv, ext='EXTEND').outputs[0]
    spl = nb.n('ShaderNodeSeparateColor'); nb.link(nb.tex(os.path.join(DATA, 'splat.png'), ouv, srgb=False, ext='EXTEND').outputs[0], spl.inputs[0])
    field = nb.tex(os.path.join(DATA, 'field.png'), ouv, srgb=False, ext='EXTEND').outputs[0]
    summer, lum = summerize(nb, ortho)
    macro = nb.n('ShaderNodeMapRange', clamp=True); nb.link(lum, macro.inputs[0])
    macro.inputs[1].default_value, macro.inputs[2].default_value, macro.inputs[3].default_value, macro.inputs[4].default_value = 0.0, 0.3, 0.0, 1.0
    mac = nb.math('MAXIMUM', 0.7, nb.math('MINIMUM', 1.25, nb.math('DIVIDE', lum, 0.3)))
    co = nb.n('ShaderNodeTexCoord')
    # gressbunn (jord + gress sett ovenfra), berg og grus fra skann
    gmap = nb.n('ShaderNodeMapping'); gmap.inputs['Scale'].default_value = (0.25, 0.25, 0.25); nb.link(co.outputs['Object'], gmap.inputs[0])
    grass = nb.tex(asset('aerial_grass_rock', 'diff'), gmap.outputs[0], proj='BOX', blend=0.3).outputs[0]
    rmap = nb.n('ShaderNodeMapping'); rmap.inputs['Scale'].default_value = (0.5, 0.5, 0.5); nb.link(co.outputs['Object'], rmap.inputs[0])
    rock = nb.tex(asset('rock_boulder_dry', 'diff'), rmap.outputs[0], proj='BOX', blend=0.3).outputs[0]
    rock = nb.mix(rock, (0.56, 0.51, 0.47), 1.0, 'MULTIPLY')
    big = nb.n('ShaderNodeTexNoise'); big.inputs['Scale'].default_value = 0.12; big.inputs['Detail'].default_value = 4
    nb.link(co.outputs['Object'], big.inputs['Vector'])
    rock = nb.mix(rock, (0.0, 0.0, 0.0), nb.math('MULTIPLY', nb.smooth(big.outputs[0], 0.35, 0.65), 0.45))
    # enkelte sprekker (forvrengt voronoi, bare der støyen tillater det)
    warp = nb.n('ShaderNodeTexNoise'); warp.inputs['Scale'].default_value = 0.6; warp.inputs['Detail'].default_value = 3
    nb.link(co.outputs['Object'], warp.inputs['Vector'])
    sc = nb.n('ShaderNodeVectorMath', operation='SCALE'); nb.link(warp.outputs['Color'], sc.inputs[0]); sc.inputs['Scale'].default_value = 1.6
    wv = nb.vmath('ADD', co.outputs['Object'], sc.outputs[0])
    crack = nb.n('ShaderNodeTexVoronoi', feature='DISTANCE_TO_EDGE'); crack.inputs['Scale'].default_value = 0.25
    nb.link(wv, crack.inputs['Vector'])
    rock = nb.mix(rock, (0.05, 0.05, 0.045), nb.math('MULTIPLY', nb.smooth(crack.outputs[0], 0.012, 0.0), nb.smooth(big.outputs[0], 0.45, 0.6)))
    # lav/mose i flekker på svaberget
    lich = nb.n('ShaderNodeTexNoise'); lich.inputs['Scale'].default_value = 0.9; lich.inputs['Detail'].default_value = 10
    nb.link(co.outputs['Object'], lich.inputs['Vector'])
    rock = nb.mix(rock, (0.09, 0.09, 0.075), nb.math('MULTIPLY', nb.smooth(lich.outputs[0], 0.5, 0.68), 0.75))
    rock = nb.mix(rock, (0.32, 0.31, 0.22), nb.math('MULTIPLY', nb.smooth(lich.outputs[0], 0.36, 0.3), 0.5))
    lawn = nb.mix(grass, (0.55, 0.72, 0.38), 1.0, 'MULTIPLY')
    meadow = nb.mix(grass, (0.72, 0.74, 0.40), 1.0, 'MULTIPLY')
    natural = nb.mix(meadow, summer, 0.3)
    col = nb.mix(natural, lawn, nb.smooth(spl.outputs[1], 0.2, 0.8))
    col = nb.mix(col, nb.mix(meadow, lawn, 0.5), field)
    # berg der splat sier berg, eller der terrenget er bratt
    geo = nb.n('ShaderNodeNewGeometry')
    nz = nb.n('ShaderNodeSeparateXYZ'); nb.link(geo.outputs['Normal'], nz.inputs[0])
    steep = nb.smooth(nz.outputs[2], 0.82, 0.62)
    rk = nb.math('MAXIMUM', nb.smooth(spl.outputs[0], 0.25, 0.7), nb.math('MULTIPLY', steep, 0.8))
    col = nb.mix(col, nb.mix(rock, (0, 0, 0), 0.0), rk)
    gnoise = nb.n('ShaderNodeTexNoise'); gnoise.inputs['Scale'].default_value = 40; gnoise.inputs['Detail'].default_value = 6
    nb.link(co.outputs['Object'], gnoise.inputs['Vector'])
    gravel = nb.mix((0.16, 0.145, 0.12), (0.27, 0.25, 0.22), gnoise.outputs[0])
    col = nb.mix(col, gravel, nb.smooth(spl.outputs[2], 0.3, 0.7))
    col = nb.mix(col, (0, 0, 0), 0.0)
    shade = nb.n('ShaderNodeVectorMath', operation='SCALE'); nb.link(col, shade.inputs[0]); nb.link(mac, shade.inputs['Scale'])
    rn = nb.normal_map(asset('rock_boulder_dry', 'nor'), rmap.outputs[0], 1.4, 'BOX', 0.3)
    gn = nb.normal_map(asset('aerial_grass_rock', 'nor'), gmap.outputs[0], 0.6, 'BOX', 0.3)
    mixn = nb.n('ShaderNodeMix', data_type='VECTOR'); nb.link(rk, mixn.inputs[0]); nb.link(gn, mixn.inputs[4]); nb.link(rn, mixn.inputs[5])
    rough = nb.math('ADD', 0.95, nb.math('MULTIPLY', rk, -0.2))
    nb.bsdf(shade.outputs[0], rough, Normal=mixn.outputs[1], **{'Specular IOR Level': 0.3})

stamp('terreng klart')
# ---------------------------------------------------------------- sjø
bpy.ops.mesh.primitive_plane_add(size=9000, location=(0, 0, 0.0))
sea = bpy.context.active_object; sea.name = 'sea'
m = bpy.data.materials.new('sea'); sea.data.materials.append(m)
nb = NB(m)
co = nb.n('ShaderNodeTexCoord')
wv = nb.n('ShaderNodeTexNoise'); wv.inputs['Scale'].default_value = 0.35; wv.inputs['Detail'].default_value = 12; wv.inputs['Roughness'].default_value = 0.62
nb.link(co.outputs['Object'], wv.inputs['Vector'])
nb.bsdf((0.012, 0.03, 0.035), 0.04, IOR=1.33, Normal=nb.bump(wv.outputs[0], 0.25, 0.1))

# ---------------------------------------------------------------- bibliotek: trær (gen_trees.py), gress og busker (prep_library.py)
LIB = {}
for fname, link in (('trees.blend', True), ('library.blend', False)):
    # gress/busker hentes inn som lokale kopier så fargene kan justeres
    with bpy.data.libraries.load(os.path.join(CACHE, fname), link=link) as (src, dst):
        dst.objects = [n for n in src.objects if n.startswith(('gen_', 'lib_grass', 'lib_shrub'))]
    LIB.update({o.name: o for o in dst.objects if o})
for o in LIB.values():
    if not o.name.startswith('lib_grass'):
        continue
    for m in o.data.materials:
        if not m or m.get('_tuned'):
            continue
        m['_tuned'] = 1
        bs = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
        if bs and bs.inputs['Base Color'].is_linked:
            src_sock = bs.inputs['Base Color'].links[0].from_socket
            hs = m.node_tree.nodes.new('ShaderNodeHueSaturation')
            hs.inputs['Hue'].default_value = 0.47  # litt gulere, lysere sommergress
            hs.inputs['Saturation'].default_value = 0.95
            hs.inputs['Value'].default_value = shot.get('grass_value', 1.45)
            m.node_tree.links.new(src_sock, hs.inputs['Color'])
            m.node_tree.links.new(hs.outputs[0], bs.inputs['Base Color'])
libcol = bpy.data.collections.new('lib'); scene.collection.children.link(libcol)
for o in LIB.values():
    libcol.objects.link(o)
libcol.hide_render = True
libcol.hide_viewport = True


def lib(prefix):
    return sorted([o for n, o in LIB.items() if n.startswith(prefix)], key=lambda o: o.name)


TREES = {'oak': lib('gen_oak_'), 'pine': lib('gen_pine_'), 'birch': lib('gen_birch_'), 'bush': lib('gen_bush_')}
trees_col = bpy.data.collections.new('trees'); scene.collection.children.link(trees_col)


def hsh(v):
    x = math.sin(v * 12.9898) * 43758.5453
    return x - math.floor(x)


fwd = (TGT - CAM); fwd.z = 0; fwd.normalize()
n_trees = 0
for x, y, g, h, r, typ, shrub in meta['trees']:
    d = math.hypot(x - CAM.x, y - CAM.y)
    # bak kamera og langt unna: ikke synlig
    to = Vector((x - CAM.x, y - CAM.y, 0))
    if d > 30 and to.normalized().dot(fwd) < -0.2 and d > h * 3:
        continue
    if d > 1400:
        continue
    if d < shot.get('clear_radius', 0):
        continue
    if d < 45:
        c = Vector((x, y, g + h * 0.6)); seg = TGT - CAM
        t = max(0.0, min(1.0, (c - CAM).dot(seg) / seg.length_squared))
        if t < 0.95 and (CAM + seg * t - c).length < r * 1.05 + 0.5:
            continue
    models = TREES.get(typ) or TREES['oak']
    src_ob = models[int(hsh(x * 3.1 + y) * len(models)) % len(models)]
    H, R = src_ob['height'], src_ob['radius']
    sz = h / H
    sxy = max(sz * 0.7, min(sz * 1.5, r / R))
    inst = bpy.data.objects.new(f'tree_{n_trees}', None)
    inst.instance_type = 'COLLECTION'
    if 'col_' + src_ob.name not in bpy.data.collections:
        c = bpy.data.collections.new('col_' + src_ob.name)
        c.objects.link(src_ob)
    inst.instance_collection = bpy.data.collections['col_' + src_ob.name]
    inst.location = (x, y, g - 0.15)
    inst.rotation_euler = (0, 0, hsh(x + y * 7.3) * 6.283)
    inst.scale = (sxy, sxy, sz)
    trees_col.objects.link(inst)
    n_trees += 1
print('trær:', n_trees, flush=True)

# skog i fjernsonen (utenfor laserdata-trærne): tetthet fra mørke partier i flyfotoet
if far and not args.preview:
    ofar = bpy.data.images.load(os.path.join(DATA, 'ortho_far.jpg'), check_existing=True)
    W_, H_ = ofar.size
    op = np.array(ofar.pixels[:], dtype=np.float32).reshape(H_, W_, ofar.channels)[..., :3]
    me = far.data
    nfv = len(me.vertices)
    fco = np.empty(nfv * 3, dtype=np.float32); me.vertices.foreach_get('co', fco); fco = fco.reshape(-1, 3)
    u = np.clip(((fco[:, 0] + 512) / 1024 * W_).astype(int), 0, W_ - 1)
    v = np.clip(((fco[:, 1] + 512) / 1024 * H_).astype(int), 0, H_ - 1)
    px = op[v, u]
    lum = px @ np.array([0.3, 0.59, 0.11], dtype=np.float32)
    forest = np.clip((0.26 - lum) / 0.1, 0, 1) * (px[:, 2] < px[:, 0] * 1.15)  # mørkt og ikke vann
    dd = np.hypot(fco[:, 0] - CAM.x, fco[:, 1] - CAM.y)
    ahead = ((fco[:, 0] - CAM.x) * fwd.x + (fco[:, 1] - CAM.y) * fwd.y) > 0
    dens = forest * ahead * (dd < 700) * (fco[:, 2] > 0.6)
    at = me.attributes.get('fdens') or me.attributes.new('fdens', 'FLOAT', 'POINT')
    at.data.foreach_set('value', dens.astype(np.float32))
    fcol = bpy.data.collections.new('far_trees')
    for o in TREES['oak'] + TREES['pine'] + TREES['oak']:
        if o.name not in fcol.objects:
            fcol.objects.link(o)
    ng = bpy.data.node_groups.new('far_forest', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N = ng.nodes; L = ng.links
    gi = N.new('NodeGroupInput'); go = N.new('NodeGroupOutput')
    da = N.new('GeometryNodeInputNamedAttribute'); da.data_type = 'FLOAT'; da.inputs['Name'].default_value = 'fdens'
    mul = N.new('ShaderNodeMath'); mul.operation = 'MULTIPLY'; mul.inputs[1].default_value = 1 / 18
    L.new(da.outputs['Attribute'], mul.inputs[0])
    dist = N.new('GeometryNodeDistributePointsOnFaces'); dist.distribute_method = 'RANDOM'
    L.new(gi.outputs[0], dist.inputs['Mesh']); L.new(mul.outputs[0], dist.inputs['Density'])
    ci = N.new('GeometryNodeCollectionInfo'); ci.inputs['Collection'].default_value = fcol
    ci.inputs['Separate Children'].default_value = True; ci.inputs['Reset Children'].default_value = True
    iop = N.new('GeometryNodeInstanceOnPoints')
    L.new(dist.outputs['Points'], iop.inputs['Points']); L.new(ci.outputs[0], iop.inputs['Instance'])
    iop.inputs['Pick Instance'].default_value = True
    ri = N.new('FunctionNodeRandomValue'); ri.data_type = 'INT'; ri.inputs['Min'].default_value = 0; ri.inputs['Max'].default_value = 99
    L.new(ri.outputs['Value'], iop.inputs['Instance Index'])
    rr = N.new('FunctionNodeRandomValue'); rr.data_type = 'FLOAT_VECTOR'
    rr.inputs['Min'].default_value = (0, 0, 0); rr.inputs['Max'].default_value = (0, 0, 6.283)
    L.new(rr.outputs['Value'], iop.inputs['Rotation'])
    rs = N.new('FunctionNodeRandomValue'); rs.data_type = 'FLOAT'; rs.inputs['Min'].default_value = 0.6; rs.inputs['Max'].default_value = 1.15
    L.new(rs.outputs[0], iop.inputs['Scale'])
    join = N.new('GeometryNodeJoinGeometry')
    L.new(gi.outputs[0], join.inputs[0]); L.new(iop.outputs[0], join.inputs[0])
    L.new(join.outputs[0], go.inputs[0])
    far.modifiers.new('forest', 'NODES').node_group = ng
    print('fjernskog: tetthet klar', flush=True)

# ---------------------------------------------------------------- gress (geometrinoder)
SITE_OBJS = [o for o in bpy.data.objects if o.type == 'MESH' and o.name not in ('terrain', 'terrain_far', 'terrain_horizon', 'sea')
             and not o.name.startswith(('tree_', 'lib_')) and o.users_collection and o.users_collection[0].name not in ('lib',)]


def site_bvh():
    verts, polys = [], []
    dg = bpy.context.evaluated_depsgraph_get()
    for o in SITE_OBJS:
        oe = o.evaluated_get(dg)
        me = oe.to_mesh()
        off = len(verts)
        mw = o.matrix_world
        verts += [mw @ v.co for v in me.vertices]
        polys += [[off + i for i in p.vertices] for p in me.polygons]
        oe.to_mesh_clear()
    return BVHTree.FromPolygons(verts, polys) if polys else None


def image_array(path):
    im = bpy.data.images.load(path, check_existing=True)
    a = np.array(im.pixels[:], dtype=np.float32).reshape(im.size[1], im.size[0], im.channels)
    return a  # rad 0 = nederst i bildet


if terrain and not shot.get('no_grass'):
    me = terrain.data
    n = len(me.vertices)
    co = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('co', co); co = co.reshape(-1, 3)
    nrm = np.empty(n * 3, dtype=np.float32); me.vertices.foreach_get('normal', nrm); nrm = nrm.reshape(-1, 3)
    spl = image_array(os.path.join(DATA, 'splat.png'))
    fld = image_array(os.path.join(DATA, 'field.png'))

    def sample(a, xy):
        hgt, wid = a.shape[:2]
        u = np.clip(((xy[:, 0] + 128) / 256 * wid).astype(int), 0, wid - 1)
        v = np.clip(((xy[:, 1] + 128) / 256 * hgt).astype(int), 0, hgt - 1)
        return a[v, u]

    s = sample(spl, co[:, :2]); f = sample(fld, co[:, :2])[:, 0]
    rockw, lawnw, gravw = s[:, 0], s[:, 1], s[:, 2]
    d = np.hypot(co[:, 0] - CAM.x, co[:, 1] - CAM.y)
    R0, R1 = shot.get('grass_near', 55), shot.get('grass_far', 85)
    if args.preview:
        R0, R1 = R0 * 0.6, R1 * 0.6
    fall = np.clip((R1 - d) / (R1 - R0), 0, 1)
    vis = ((co[:, 0] - CAM.x) * fwd.x + (co[:, 1] - CAM.y) * fwd.y) > -6
    sm = lambda x, a, b: np.clip((x - a) / (b - a), 0, 1) ** 2 * (3 - 2 * np.clip((x - a) / (b - a), 0, 1))
    steep = sm(nrm[:, 2], 0.85, 0.65)
    bare = np.maximum(sm(rockw, 0.2, 0.55), steep)
    dens = fall * vis * (1 - bare) * (1 - sm(gravw, 0.2, 0.5))
    lawn = np.clip(sm(lawnw, 0.2, 0.7) + f * 0.5, 0, 1)
    height = 0.55 * (1 - lawn) + 0.12 * lawn  # plen er klipt, ellers eng
    # fjern gress under bygg, terrasser og parkering (stråle opp fra bakken)
    bvh = site_bvh()
    if bvh:
        idx = np.nonzero(dens > 0)[0]
        for i in idx:
            p = Vector(co[i]); p.z -= 0.3
            hit = bvh.ray_cast(p, Vector((0, 0, 1)), 8.0)
            if hit[0] is not None:
                dens[i] = 0
    for name, arr in [('gdens', dens), ('gheight', height), ('glawn', lawn)]:
        at = me.attributes.get(name) or me.attributes.new(name, 'FLOAT', 'POINT')
        at.data.foreach_set('value', arr.astype(np.float32))
    print('gress: tetthetskart klart', flush=True)

    lawn_col = bpy.data.collections.new('lawn_clumps')
    for o in lib('lib_grass_medium_01_'):
        if len(o.data.polygons) > 600:  # bare de tette tustene
            lawn_col.objects.link(o)
    meadow_col = bpy.data.collections.new('meadow_clumps')
    for o in lib('lib_grass_medium_02_') + lib('lib_grass_medium_02_') + lib('lib_shrub_01_') + lib('lib_shrub_03_') + lib('lib_shrub_04_'):
        if o.name != 'lib_grass_medium_02_0' and o.name not in meadow_col.objects:  # _0 inneholder en hjelpekule
            meadow_col.objects.link(o)

    ng = bpy.data.node_groups.new('grass', 'GeometryNodeTree')
    ng.interface.new_socket('Geometry', in_out='INPUT', socket_type='NodeSocketGeometry')
    ng.interface.new_socket('Geometry', in_out='OUTPUT', socket_type='NodeSocketGeometry')
    N = ng.nodes; L = ng.links
    gi = N.new('NodeGroupInput'); go = N.new('NodeGroupOutput')
    join = N.new('GeometryNodeJoinGeometry')
    L.new(gi.outputs[0], join.inputs[0])
    dmax = shot.get('grass_density', 260)
    for kind, col, dens_mul, sc in [('lawn', lawn_col, 1.0, 1.0), ('meadow', meadow_col, 0.22, 1.0)]:
        da = N.new('GeometryNodeInputNamedAttribute'); da.data_type = 'FLOAT'; da.inputs['Name'].default_value = 'gdens'
        la = N.new('GeometryNodeInputNamedAttribute'); la.data_type = 'FLOAT'; la.inputs['Name'].default_value = 'glawn'
        mm = N.new('ShaderNodeMath'); mm.operation = 'MULTIPLY'
        L.new(da.outputs['Attribute'], mm.inputs[0])
        if kind == 'lawn':
            L.new(la.outputs['Attribute'], mm.inputs[1])
        else:
            inv = N.new('ShaderNodeMath'); inv.operation = 'MULTIPLY_ADD'; inv.inputs[1].default_value = -0.93; inv.inputs[2].default_value = 1.0
            L.new(la.outputs['Attribute'], inv.inputs[0]); L.new(inv.outputs[0], mm.inputs[1])
        dist = N.new('GeometryNodeDistributePointsOnFaces'); dist.distribute_method = 'RANDOM'
        L.new(gi.outputs[0], dist.inputs['Mesh'])
        dd = N.new('ShaderNodeMath'); dd.operation = 'MULTIPLY'; dd.inputs[1].default_value = dmax * dens_mul
        L.new(mm.outputs[0], dd.inputs[0]); L.new(dd.outputs[0], dist.inputs['Density'])
        dist.inputs['Seed'].default_value = 7 if kind == 'lawn' else 11
        ci = N.new('GeometryNodeCollectionInfo'); ci.inputs['Collection'].default_value = col
        ci.inputs['Separate Children'].default_value = True; ci.inputs['Reset Children'].default_value = True
        iop = N.new('GeometryNodeInstanceOnPoints')
        L.new(dist.outputs['Points'], iop.inputs['Points']); L.new(ci.outputs[0], iop.inputs['Instance'])
        iop.inputs['Pick Instance'].default_value = True
        ri = N.new('FunctionNodeRandomValue'); ri.data_type = 'INT'; ri.inputs['Min'].default_value = 0; ri.inputs['Max'].default_value = 999
        L.new(ri.outputs['Value'], iop.inputs['Instance Index'])
        rr = N.new('FunctionNodeRandomValue'); rr.data_type = 'FLOAT_VECTOR'
        rr.inputs['Min'].default_value = (-0.15, -0.15, 0); rr.inputs['Max'].default_value = (0.15, 0.15, 6.283)
        L.new(rr.outputs['Value'], iop.inputs['Rotation'])
        rs = N.new('FunctionNodeRandomValue'); rs.data_type = 'FLOAT'; rs.inputs['Min'].default_value = 0.7; rs.inputs['Max'].default_value = 1.4
        ha = N.new('GeometryNodeInputNamedAttribute'); ha.data_type = 'FLOAT'; ha.inputs['Name'].default_value = 'gheight'
        # gresstustene er 0,1–0,3 m; eng skaleres opp, plen ned
        hs = N.new('ShaderNodeMath'); hs.operation = 'MULTIPLY'; hs.inputs[1].default_value = (5.0 if kind == 'lawn' else 1.6) * sc
        L.new(ha.outputs['Attribute'], hs.inputs[0])
        s2 = N.new('ShaderNodeMath'); s2.operation = 'MULTIPLY'
        L.new(rs.outputs[0], s2.inputs[0]); L.new(hs.outputs[0], s2.inputs[1])
        L.new(s2.outputs[0], iop.inputs['Scale'])
        L.new(iop.outputs[0], join.inputs[0])
    L.new(join.outputs[0], go.inputs[0])
    mod = terrain.modifiers.new('grass', 'NODES'); mod.node_group = ng

stamp('gress satt opp')
# ---------------------------------------------------------------- himmel og sol
world = bpy.data.worlds.new('sky'); scene.world = world
world.use_nodes = True
wn = world.node_tree; wn.nodes.clear()
sky = wn.nodes.new('ShaderNodeTexSky')
for t in ('MULTIPLE_SCATTERING', 'NISHITA'):
    try:
        sky.sky_type = t
        break
    except TypeError:
        pass
sky.sun_disc = False
sky.sun_elevation = math.radians(max(SUN_EL, 0.5))
# Cycles: solretning = sfærisk(zenit, rotasjon + 90°) målt fra +X mot klokka
sky.sun_rotation = math.atan2(SUN_DIR.y, SUN_DIR.x) - math.pi / 2
for k, v in {'altitude': 30.0, 'air_density': 1.0, 'aerosol_density': 1.3, 'dust_density': 1.3, 'ozone_density': 1.0}.items():
    if hasattr(sky, k):
        setattr(sky, k, v)
bg = wn.nodes.new('ShaderNodeBackground'); bg.inputs['Strength'].default_value = shot.get('sky_strength', 0.22)
wo = wn.nodes.new('ShaderNodeOutputWorld')
wn.links.new(sky.outputs[0], bg.inputs[0])
hdri_name = shot.get('hdri', 'kloppenheim_05_puresky')
hdri_path = os.path.join(ASSETS, hdri_name, f'{hdri_name}.hdr')
if os.path.exists(hdri_path):
    him = bpy.data.images.load(hdri_path, check_existing=True)
    W_, H_ = him.size
    px = np.array(him.pixels[:], dtype=np.float32).reshape(H_, W_, 4)
    lum = px[H_ // 2:, :, :3].sum(axis=2)  # øvre halvdel (rad 0 nederst)
    j, i = np.unravel_index(np.argmax(lum), lum.shape)
    del px, lum
    phi_hdri = (i / W_ - 0.5) * 2 * math.pi
    phi_sun = math.atan2(SUN_DIR.y, -SUN_DIR.x)
    tc = wn.nodes.new('ShaderNodeTexCoord')
    mp = wn.nodes.new('ShaderNodeMapping'); mp.inputs['Rotation'].default_value = (0, 0, phi_sun - phi_hdri)
    env = wn.nodes.new('ShaderNodeTexEnvironment'); env.image = him
    wn.links.new(tc.outputs['Generated'], mp.inputs[0]); wn.links.new(mp.outputs[0], env.inputs[0])
    bg2 = wn.nodes.new('ShaderNodeBackground'); bg2.inputs['Strength'].default_value = shot.get('hdri_strength', 0.6)
    wn.links.new(env.outputs[0], bg2.inputs[0])
    lp = wn.nodes.new('ShaderNodeLightPath')
    mx = wn.nodes.new('ShaderNodeMath'); mx.operation = 'MAXIMUM'
    wn.links.new(lp.outputs['Is Camera Ray'], mx.inputs[0]); wn.links.new(lp.outputs['Is Glossy Ray'], mx.inputs[1])
    ms = wn.nodes.new('ShaderNodeMixShader')
    wn.links.new(mx.outputs[0], ms.inputs[0]); wn.links.new(bg.outputs[0], ms.inputs[1]); wn.links.new(bg2.outputs[0], ms.inputs[2])
    wn.links.new(ms.outputs[0], wo.inputs[0])
else:
    wn.links.new(bg.outputs[0], wo.inputs[0])

sun = bpy.data.lights.new('sun', 'SUN')
sun.energy = shot.get('sun_strength', 4.2)
sun.angle = math.radians(0.6)
# varmere lys når sola står lavt
warm = max(0.0, min(1.0, (18 - SUN_EL) / 18))
sun.color = (1.0, 0.93 - 0.12 * warm, 0.84 - 0.28 * warm)
sun_ob = bpy.data.objects.new('sun', sun)
# lampen lyser langs lokal -Z, så +Z skal peke mot sola
sun_ob.rotation_euler = SUN_DIR.to_track_quat('Z', 'Y').to_euler()
scene.collection.objects.link(sun_ob)

# ---------------------------------------------------------------- kamera
cam = bpy.data.cameras.new('cam')
cam.lens = shot.get('lens', 24)
cam.sensor_width = 36
cam.clip_start = 0.1; cam.clip_end = 12000
if shot.get('dof'):
    cam.dof.use_dof = True
    cam.dof.focus_distance = (TGT - CAM).length
    cam.dof.aperture_fstop = shot['dof']
cam_ob = bpy.data.objects.new('cam', cam)
cam_ob.location = CAM
cam_ob.rotation_euler = (TGT - CAM).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(cam_ob)
scene.camera = cam_ob

# ---------------------------------------------------------------- render
w, h = map(int, args.res.split('x'))
if args.preview:
    w, h = w // 3, h // 3
r = scene.render
r.engine = 'CYCLES'
r.resolution_x, r.resolution_y = w, h
r.resolution_percentage = 100
r.film_transparent = False
r.image_settings.file_format = 'PNG'
r.image_settings.color_mode = 'RGB'
c = scene.cycles
prefs = bpy.context.preferences.addons['cycles'].preferences
try:
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for dev in prefs.devices:
        dev.use = True
    c.device = 'GPU'
except Exception as e:
    print('GPU ikke tilgjengelig:', e)
c.samples = args.samples if not args.preview else min(args.samples, 48)
c.use_adaptive_sampling = True
c.adaptive_threshold = 0.015
c.use_denoising = True
try:
    c.denoiser = 'OPENIMAGEDENOISE'
except TypeError:
    pass
c.max_bounces = 8
c.diffuse_bounces = 3
c.glossy_bounces = 4
c.transmission_bounces = 8
c.transparent_max_bounces = 24
c.sample_clamp_indirect = 8
c.caustics_reflective = False
c.caustics_refractive = False
c.blur_glossy = 1.0
vs = scene.view_settings
vs.view_transform = 'AgX'
for look in ('AgX - Medium High Contrast', 'Medium High Contrast', 'AgX - Base Contrast'):
    try:
        vs.look = look
        break
    except TypeError:
        pass
vs.exposure = shot.get('exposure', 0.0)
r.filepath = os.path.abspath(args.out)
os.makedirs(os.path.dirname(r.filepath), exist_ok=True)
if args.save_blend:
    bpy.ops.wm.save_as_mainfile(filepath=os.path.abspath(args.save_blend))
stamp('rendrer')
bpy.ops.render.render(write_still=True)
print('lagret', r.filepath, flush=True)

"""Samler gress- og buskmodellene fra Poly Haven i ett bibliotek (library.blend), ett objekt per tust/busk:
origo midt i bunnen og transformer brukt. Kjøres én gang:

    blender -b --factory-startup -P tools/render/prep_library.py
"""
import bpy, os, glob

CACHE = os.environ.get('HYTTE_ASSETS', os.path.expanduser('~/.cache/hytte3d-render/assets'))
OUT = os.path.join(os.path.dirname(CACHE), 'library.blend')

bpy.ops.wm.read_factory_settings(use_empty=True)
lib = bpy.data.collections.new('library')
bpy.context.scene.collection.children.link(lib)

for d in sorted(glob.glob(os.path.join(CACHE, '*'))):
    name = os.path.basename(d)
    blends = glob.glob(os.path.join(d, '*.blend'))
    if not blends or not name.startswith(('grass', 'shrub')):
        continue
    with bpy.data.libraries.load(blends[0], link=False) as (src, dst):
        dst.objects = list(src.objects)
    objs = [o for o in dst.objects if o and o.type == 'MESH' and len(o.data.polygons)]
    lod0 = [o for o in objs if o.name.endswith('_LOD0')]
    # trær: «<navn>_LOD0» er hele treet; ellers alle mesh (gress/busker har flere varianter)
    whole = [o for o in lod0 if o.name == f'{name}_LOD0']
    parts = whole or lod0 or [o for o in objs if 'LOD1' not in o.name and 'LOD2' not in o.name]
    variants = [parts] if whole else [[o] for o in parts]
    for vi, group in enumerate(variants):
        for o in group:
            bpy.context.scene.collection.objects.link(o)
        bpy.ops.object.select_all(action='DESELECT')
        for o in group:
            o.select_set(True)
        bpy.context.view_layer.objects.active = group[0]
        bpy.ops.object.make_single_user(object=True, obdata=True)
        bpy.ops.object.transform_apply(location=True, rotation=True, scale=True)
        if len(group) > 1:
            bpy.ops.object.join()
        ob = bpy.context.view_layer.objects.active
        # origo i bunnen, midt i kronen
        xs = [v.co.x for v in ob.data.vertices]; ys = [v.co.y for v in ob.data.vertices]; zs = [v.co.z for v in ob.data.vertices]
        cx, cy, z0 = (min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2, min(zs)
        for v in ob.data.vertices:
            v.co.x -= cx; v.co.y -= cy; v.co.z -= z0
        ob.location = (0, 0, 0)
        ob.name = f'lib_{name}' + (f'_{vi}' if len(variants) > 1 else '')
        ob['height'] = max(zs) - z0
        ob['radius'] = max(max(xs) - min(xs), max(ys) - min(ys)) / 2
        for c in list(ob.users_collection):
            c.objects.unlink(ob)
        lib.objects.link(ob)
        ob.hide_render = False
        print(ob.name, len(ob.data.polygons), 'polys', round(ob['height'], 2), 'm høy', round(ob['radius'], 2), 'm radius', flush=True)
    # rydd bort det som ikke ble brukt
    for o in [o for o in bpy.data.objects if not o.name.startswith('lib_')]:
        bpy.data.objects.remove(o)

for c in list(bpy.data.collections):
    if c != lib:
        bpy.data.collections.remove(c)
bpy.ops.file.pack_all()
bpy.ops.outliner.orphans_purge(do_recursive=True)
bpy.ops.wm.save_as_mainfile(filepath=OUT, compress=True)
print('lagret', OUT)

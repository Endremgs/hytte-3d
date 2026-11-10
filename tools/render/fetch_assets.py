"""Laster ned CC0-modeller og -teksturer fra Poly Haven til en lokal cache (ikke i git).

    python3 tools/render/fetch_assets.py            # -> ~/.cache/hytte3d-render/assets
"""
import json, os, subprocess, urllib.request

CACHE = os.environ.get('HYTTE_ASSETS', os.path.expanduser('~/.cache/hytte3d-render/assets'))
MODELS = ['shrub_01', 'shrub_02', 'shrub_03', 'shrub_04', 'grass_medium_01', 'grass_medium_02']
# bare blad-/nåle-/barkteksturene trengs fra trærne (gen_trees.py bygger selve trærne)
TREE_MAPS = {'island_tree_01': ['leaves_diff', 'leaves_alpha', 'leaves_nor_gl'],
             'pine_tree_01': ['twig_diff', 'twig_alpha', 'twig_nor_gl', 'bark_diff', 'bark_nor_gl']}
HDRIS = {'kloppenheim_05_puresky': '4k', 'kloofendal_48d_partly_cloudy_puresky': '4k'}
TEXTURES = {'rock_boulder_dry': '2k', 'weathered_planks': '2k', 'aerial_grass_rock': '2k', 'concrete_wall_008': '1k'}


def get(url, dest):
    if os.path.exists(dest) and os.path.getsize(dest) > 0:
        return
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    # curl med gjenopptak: modellene er opptil ~600 MB
    subprocess.run(['curl', '-sfL', '--retry', '5', '-C', '-', '-A', 'hytte3d-render', '-o', dest + '.part', url], check=True)
    os.replace(dest + '.part', dest)


def files(asset):
    req = urllib.request.Request(f'https://api.polyhaven.com/files/{asset}', headers={'User-Agent': 'hytte3d-render'})
    return json.load(urllib.request.urlopen(req))


for m in MODELS:
    b = files(m)['blend']['1k']['blend']
    d = os.path.join(CACHE, m)
    get(b['url'], os.path.join(d, os.path.basename(b['url'])))
    for rel, inc in b.get('include', {}).items():
        get(inc['url'], os.path.join(d, rel))
    print('model', m, flush=True)

for a, maps in TREE_MAPS.items():
    f = files(a)
    for k in maps:
        get(f[k]['1k']['png']['url'], os.path.join(CACHE, a, 'textures', f'{a}_{k}_1k.png'))
    print('treteksturer', a, flush=True)

for t, res in TEXTURES.items():
    f = files(t)
    d = os.path.join(CACHE, t)
    for key, fname in [('Diffuse', 'diff'), ('nor_gl', 'nor'), ('Rough', 'rough'), ('Displacement', 'disp')]:
        if key not in f:
            continue
        fmts = f[key][res]
        fmt = 'jpg' if 'jpg' in fmts else 'png'
        get(fmts[fmt]['url'], os.path.join(d, f'{fname}.{fmt}'))
    print('texture', t, flush=True)
for h, res in HDRIS.items():
    f = files(h)['hdri'][res]['hdr']
    get(f['url'], os.path.join(CACHE, h, f'{h}.hdr'))
    print('hdri', h, flush=True)
print('ok', CACHE)

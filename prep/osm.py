import xml.etree.ElementTree as ET, json, numpy as np, tifffile
from pyproj import Transformer
from PIL import Image, ImageDraw
E0,N0=580152,6549299
T=Transformer.from_crs(4326,25832,always_xy=True)
r=ET.parse('/tmp/hytte/geo/osm.xml').getroot()
nodes={n.get('id'):(float(n.get('lon')),float(n.get('lat'))) for n in r.iter('node')}
dtm=tifffile.imread('/tmp/hytte/geo/dtm1k.tif').astype(float); dom=tifffile.imread('/tmp/hytte/geo/dom1k.tif').astype(float)
def samp(a,x,y):
    i=np.clip((512-y).astype(int),0,1023); j=np.clip((x+512).astype(int),0,1023); return a[i,j]
blds=[];roads=[];waters=[]
for w in r.iter('way'):
    tags={t.get('k'):t.get('v') for t in w.iter('tag')}
    ll=[nodes[n.get('ref')] for n in w.iter('nd') if n.get('ref') in nodes]
    if len(ll)<2: continue
    xy=np.array([T.transform(lo,la) for lo,la in ll])-[E0,N0]
    if 'building' in tags:
        if np.abs(xy).max()>520: continue
        # sample heights inside polygon via grid points
        mn=xy.min(0); mx=xy.max(0)
        gx,gy=np.meshgrid(np.arange(mn[0],mx[0],0.7),np.arange(mn[1],mx[1],0.7))
        from matplotlib.path import Path as P
        pts=np.stack([gx.ravel(),gy.ravel()],1)
        inside=P(xy).contains_points(pts) if len(pts) else []
        pin=pts[inside] if len(pts) else pts
        if len(pin)<3: pin=np.array([xy.mean(0)])
        hd=samp(dom,pin[:,0],pin[:,1]); hg=samp(dtm,xy[:,0],xy[:,1])
        g=float(np.percentile(hg,30)); top=float(np.percentile(hd,95)); 
        blds.append(dict(p=np.round(xy,2).tolist(),g=round(g,2),top=round(max(top,g+2.6),2),t=tags.get('building'),lv=tags.get('building:levels')))
    elif 'highway' in tags:
        if np.abs(xy).max()>2000: continue
        roads.append(dict(p=np.round(xy,1).tolist(),t=tags.get('highway'),s=tags.get('surface'),n=tags.get('name')))
    elif tags.get('natural') in ('water','coastline') or 'water' in tags:
        waters.append(dict(p=np.round(xy,1).tolist(),t=tags.get('natural')))
print(len(blds),len(roads),len(waters))
json.dump(dict(buildings=blds,roads=roads,waters=waters),open('/tmp/hytte/geo/osm_local.json','w'))
im=Image.open('/tmp/hytte/geo/ortho_far.jpg').resize((1024,1024)); dr=ImageDraw.Draw(im)
for b in blds: dr.polygon([(x+512,512-y) for x,y in b['p']],outline=(255,0,0))
for rd in roads: dr.line([(x+512,512-y) for x,y in rd['p']],fill=(255,255,0),width=1)
im.crop((320,320,704,704)).resize((1152,1152)).save('/tmp/hytte/geo/osm_check.png')
for rd in roads:
    if rd['n']: print(rd['n'],rd['t'],rd['s'])
for b in blds:
    c=np.mean(b['p'],0)
    if np.hypot(*c)<40: print('near',np.round(c,1),b['t'],b['g'],b['top'],len(b['p']))

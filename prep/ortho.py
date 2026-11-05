import sys, math, io, urllib.request, numpy as np
from PIL import Image
from pyproj import Transformer
out = sys.argv[1]
x0,y0,x1,y1 = map(float,sys.argv[3].split(","))
N=int(sys.argv[4]); Z=int(sys.argv[2])
t = Transformer.from_crs(25832, 4326, always_xy=True)
def tile_xy(lon,lat,z):
    n=2**z; x=(lon+180)/360*n; lr=math.radians(lat)
    y=(1-math.log(math.tan(lr)+1/math.cos(lr))/math.pi)/2*n; return x,y
corners=[t.transform(x,y) for x in (x0,x1) for y in (y0,y1)]
txs=[tile_xy(lo,la,Z) for lo,la in corners]
tx0=int(min(a for a,b in txs)); tx1=int(max(a for a,b in txs)); ty0=int(min(b for a,b in txs)); ty1=int(max(b for a,b in txs))
W=(tx1-tx0+1)*256; H=(ty1-ty0+1)*256
mos=Image.new('RGB',(W,H))
for tx in range(tx0,tx1+1):
  for ty in range(ty0,ty1+1):
    url=f"https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{Z}/{ty}/{tx}"
    d=urllib.request.urlopen(urllib.request.Request(url,headers={'User-Agent':'Mozilla/5.0'})).read()
    mos.paste(Image.open(io.BytesIO(d)).convert('RGB'),((tx-tx0)*256,(ty-ty0)*256))
print('tiles',tx1-tx0+1,ty1-ty0+1)
A=np.asarray(mos)
xs=x0+(np.arange(N)+0.5)*(x1-x0)/N; ys=y1-(np.arange(N)+0.5)*(y1-y0)/N
X,Y=np.meshgrid(xs,ys); lon,lat=t.transform(X,Y)
n=2**Z; px=((lon+180)/360*n-tx0)*256
lr=np.radians(lat); py=((1-np.log(np.tan(lr)+1/np.cos(lr))/np.pi)/2*n-ty0)*256
px=np.clip(px.astype(int),0,W-1); py=np.clip(py.astype(int),0,H-1)
Image.fromarray(A[py,px]).save(out,quality=88)

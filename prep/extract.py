import numpy as np, sys
from PIL import Image
S=29.53; U0,V0=580,317; X0,Y0=-17.7,15.5
def tolocal(u,v): return (X0+(u-U0)/S, Y0-(v-V0)/S)
names={1:'eksist',2:'V4',3:'V1',4:'V2',5:'V3'}
for p,name in names.items():
    a=np.asarray(Image.open(f'/tmp/hytte/pdf/s150-{p}.png').convert('RGB')).astype(int)
    a=a[:, :2050]
    r,g,b=a[...,0],a[...,1],a[...,2]
    m=(r>230)&(g>140)&(g<215)&(b<120)
    # light orange (link) too
    m2=(r>230)&(g>=195)&(g<235)&(b>100)&(b<190)
    ys,xs=np.nonzero(m|m2)
    # label components simple flood via scipy-less: grid bucket by connectivity using union-find on downsampled
    from collections import deque
    mask=(m|m2)
    seen=np.zeros_like(mask)
    comps=[]
    H,W=mask.shape
    for y0,x0 in zip(ys[::50],xs[::50]):
        if seen[y0,x0]: continue
        q=deque([(y0,x0)]); seen[y0,x0]=1; pts=[]
        while q:
            y,x=q.popleft(); pts.append((y,x))
            for dy,dx in ((1,0),(-1,0),(0,1),(0,-1)):
                yy,xx=y+dy,x+dx
                if 0<=yy<H and 0<=xx<W and mask[yy,xx] and not seen[yy,xx]:
                    seen[yy,xx]=1; q.append((yy,xx))
        if len(pts)>2000: comps.append(np.array(pts))
    print('==',name)
    for c in comps:
        pts=np.array([tolocal(x,y) for y,x in c[::7]])
        best=None
        for ang in np.arange(0,90,0.25):
            t=np.radians(ang); R=np.array([[np.cos(t),-np.sin(t)],[np.sin(t),np.cos(t)]])
            q=pts@R.T; area=np.ptp(q[:,0])*np.ptp(q[:,1])
            if best is None or area<best[0]: best=(area,ang)
        t=np.radians(best[1]); R=np.array([[np.cos(t),-np.sin(t)],[np.sin(t),np.cos(t)]])
        q=pts@R.T
        print(f' comp n={len(c)} areaPix={len(c)/S/S:.1f}m2 ang={best[1]} bbox rot: x[{q[:,0].min():.2f},{q[:,0].max():.2f}] y[{q[:,1].min():.2f},{q[:,1].max():.2f}] centroid {pts.mean(0).round(2)}')
        # occupancy grid 0.5m
        gx=np.floor((q[:,0]-q[:,0].min())/0.5).astype(int); gy=np.floor((q[:,1]-q[:,1].min())/0.5).astype(int)
        G=np.zeros((gy.max()+1,gx.max()+1),int); G[gy,gx]=1
        for row in G[::-1]: print('   '+''.join('#' if v else '.' for v in row))

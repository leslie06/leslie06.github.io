# Trees where trees really are (2026-10-02, 「地面与树」): crowns picked from the 1 m canopy height map by
# Meta and WRI (High Resolution Canopy Height Maps, CC BY 4.0, https://registry.opendata.aws/dataforgood-fb-forests/)
# over the play area, into .cache/buildings/trees.json for build.mjs: {"p": [x, z, height, ...]} in game metres.
# A crown is a local maximum of the canopy over a 3.6 m radius at least 4 m tall; crowns closer than
# SPACING keep the taller. Inside the 4th Ring the map is ~22% canopy (ESA WorldCover agrees: 21.6%).
# Needs `python3 -m pip install --user rasterio "affine<3" scipy` and the two quadkey tiles that cover
# Beijing's centre (non-COG GeoTIFFs, 1.1 GB, so downloaded whole; delete them afterwards):
#   curl -o data/chm-132100121.tif https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/132100121.tif
#   curl -o data/chm-132100103.tif https://dataforgood-fb-data.s3.amazonaws.com/forests/v1/alsgedi_global_v6_float/chm/132100103.tif
# Usage: python3 scripts/city/fetch-trees.py [spacing m]
import json, math, os, sys, time
import numpy as np
import rasterio
from rasterio.windows import from_bounds
from scipy.ndimage import maximum_filter

W, S, E, N = 116.264, 39.826, 116.55, 39.992
SPACING = float(sys.argv[1]) if len(sys.argv) > 1 else 7.0
TILES = ['data/chm-132100121.tif', 'data/chm-132100103.tif']
LAT0, LON0, R = 39.90883, 116.39757, 6378137.0
KX = math.pi / 180 * R * math.cos(math.radians(LAT0))
KZ = math.pi / 180 * R

def merc(lon, lat):
    return lon * math.pi / 180 * R, math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) * R

t0 = time.time()
x0, y0 = merc(W, S)
x1, y1 = merc(E, N)
pts = []
for path in TILES:
    with rasterio.open(path) as r:
        b = r.bounds
        wx0, wy0, wx1, wy1 = max(x0, b.left), max(y0, b.bottom), min(x1, b.right), min(y1, b.top)
        if wx0 >= wx1 or wy0 >= wy1:
            continue
        win = from_bounds(wx0, wy0, wx1, wy1, r.transform).round_offsets().round_lengths()
        a = r.read(1, window=win)
        tr = r.window_transform(win)
        print(path, a.shape, f'{time.time() - t0:.0f} s')
        # crowns: the canopy's local maxima (radius 3 px = 3.6 m), 4 m tall or more
        mx = maximum_filter(a, size=7, mode='constant')
        ys, xs = np.nonzero((a == mx) & (a >= 4))
        h = a[ys, xs]
        mx_ = tr.c + (xs + 0.5) * tr.a
        my_ = tr.f + (ys + 0.5) * tr.e
        lon = mx_ / R * 180 / math.pi
        lat = np.degrees(2 * np.arctan(np.exp(my_ / R)) - math.pi / 2)
        gx = (lon - LON0) * KX
        gz = -(lat - LAT0) * KZ
        pts.append(np.stack([gx, gz, h.astype(np.float64)], axis=1))
        del a, mx
P = np.concatenate(pts)
print('maxima', len(P), f'{time.time() - t0:.0f} s')
# keep the tallest first, nothing within SPACING of a kept one (a hash grid of SPACING cells)
order = np.argsort(-P[:, 2], kind='stable')
P = P[order]
cell = SPACING
grid = {}
keep = []
for i in range(len(P)):
    x, z, h = P[i]
    cx, cz = int(math.floor(x / cell)), int(math.floor(z / cell))
    ok = True
    for dx in (-1, 0, 1):
        for dz in (-1, 0, 1):
            for j in grid.get((cx + dx, cz + dz), ()):
                if (P[j, 0] - x) ** 2 + (P[j, 1] - z) ** 2 < SPACING * SPACING:
                    ok = False
                    break
            if not ok: break
        if not ok: break
    if ok:
        grid.setdefault((cx, cz), []).append(i)
        keep.append(i)
K = P[keep]
os.makedirs('.cache/buildings', exist_ok=True)
with open('.cache/buildings/trees.json', 'w') as f:
    json.dump({'src': 'Meta/WRI canopy height v1 (CC BY 4.0), crowns at least %g m apart' % SPACING,
               'p': [round(float(v), 1) for row in K for v in row]}, f, separators=(',', ':'))
print('crowns', len(K), 'heights q10/50/90', np.percentile(K[:, 2], [10, 50, 90]), f'{time.time() - t0:.0f} s')

# Green ground from ESA WorldCover 10 m 2021 v200 (CC BY 4.0, doi:10.5281/zenodo.7254221): tree cover,
# grassland and cropland over the play area as polygons, into .cache/buildings/green.json for build.mjs
# ({"p": [[outer x, z, ...], [hole], ..., null, ...]}: rings of a polygon, the outer first, polygons
# separated by null), game metres. Read straight from the public COG (a window, no download).
# The build lays them under everything else as 'lawn': the courtyards, compounds and verges under the
# trees stop being bare paving. Inside the 4th Ring: 22% tree cover, 1% grass, 3% crops.
# Needs `python3 -m pip install --user rasterio "affine<3" scipy shapely`.
# Usage: python3 scripts/city/fetch-ground.py
import json, math, os, time
import numpy as np
import rasterio
from rasterio import features
from rasterio.windows import from_bounds
from scipy.ndimage import binary_opening, binary_closing
from shapely.geometry import shape
from shapely.ops import transform

W, S, E, N = 116.264, 39.826, 116.55, 39.992
URL = 'https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N39E114_Map.tif'
LAT0, LON0, R = 39.90883, 116.39757, 6378137.0
KX = math.pi / 180 * R * math.cos(math.radians(LAT0))
KZ = math.pi / 180 * R

t0 = time.time()
with rasterio.open(URL) as r:
    win = from_bounds(W, S, E, N, r.transform).round_offsets().round_lengths()
    a = r.read(1, window=win)
    tr = r.window_transform(win)
green = np.isin(a, (10, 30, 40))
# drop single pixels and close one-pixel gaps (a street tree's crown is not a lawn)
green = binary_closing(binary_opening(green, iterations=1), iterations=1)
print('green share', round(float(green.mean()) * 100, 1), '%', f'{time.time() - t0:.0f} s')
to_game = lambda lon, lat: ((np.asarray(lon) - LON0) * KX, -(np.asarray(lat) - LAT0) * KZ)
out, n = [], 0
for geom, v in features.shapes(green.astype(np.uint8), mask=green, transform=tr):
    poly = transform(to_game, shape(geom)).simplify(3.0, preserve_topology=True)
    if poly.is_empty or poly.area < 400:
        continue
    polys = [poly] if poly.geom_type == 'Polygon' else list(poly.geoms)
    for p in polys:
        if p.area < 400:
            continue
        rings = [p.exterior] + [h for h in p.interiors if abs(h.area if hasattr(h, 'area') else 0) >= 0]
        for ring in rings:
            cs = list(ring.coords)[:-1]
            if len(cs) < 3:
                continue
            out.append([round(c, 1) for xy in cs for c in xy])
        out.append(None)
        n += 1
os.makedirs('.cache/buildings', exist_ok=True)
with open('.cache/buildings/green.json', 'w') as f:
    json.dump({'src': 'ESA WorldCover 10m 2021 v200 (CC BY 4.0): tree cover, grassland, cropland', 'p': out}, f, separators=(',', ':'))
print('polygons', n, f'{os.path.getsize(".cache/buildings/green.json") / 1e6:.1f} MB', f'{time.time() - t0:.0f} s')

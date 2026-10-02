# Building footprints and heights beyond OSM, for Beijing inside the 4th Ring (and the corridors), into
# .cache/buildings/ for build.mjs:
#   clsm.json    footprints OSM lacks: Overture's buildings theme minus its OSM features, i.e. the
#                machine-learnt East-Asian footprints of Shi et al. 2023 (CLSM, doi:10.5281/zenodo.8174931,
#                CC BY 4.0), already conflated against OSM by Overture.  {"p": [[lon, lat, ...], ...]}
#   globfp.json  heights: 3D-GloBFP (Che et al. 2024, CC BY 4.0), tile 2292.  {"p": [[h, lon, lat, ...], ...]}
#   cmab.json    heights, function and age: CMAB (Zhang, Zhao & Long 2025, CC BY 4.0), Beijing.
#                {"fn": [...], "p": [[h, fn, year, lon, lat, ...], ...]}  (year 1985 = 1985 or before, 2019 = after 2018)
# All WGS-84 (checked: no GCJ-02 offset in any of them). Needs `python3 -m pip install --user duckdb` and
#   data/3d-globfp-2292.zip   https://ndownloader.figshare.com/files/54101543 (232 MB)
#   data/cmab-beijing.zip     https://ndownloader.figshare.com/files/53666768 (249 MB)
# Overture is read straight from its public S3 bucket (a bbox filter; ~3 min).
# Usage: python3 scripts/city/fetch-buildings.py [overture|globfp|cmab ...]
import json, os, sys, time, zipfile
import duckdb

W, S, E, N = 116.25, 39.82, 116.56, 40.01
OVERTURE = 's3://overturemaps-us-west-2/release/2026-09-23.1/theme=buildings/type=building/*'
OUT = '.cache/buildings'
os.makedirs(OUT, exist_ok=True)

db = duckdb.connect()
for s in ['INSTALL spatial', 'LOAD spatial', 'INSTALL httpfs', 'LOAD httpfs', "SET s3_region='us-west-2'"]:
    db.sql(s)


def rings(gj):
    """Exterior rings of a GeoJSON polygon or multipolygon, as flat [lon, lat, ...] lists (closing point dropped)."""
    g = json.loads(gj)
    polys = [g['coordinates']] if g['type'] == 'Polygon' else g['coordinates'] if g['type'] == 'MultiPolygon' else []
    out = []
    for p in polys:
        r = p[0][:-1] if p[0][0] == p[0][-1] else p[0]
        if len(r) >= 3:
            out.append([round(v, 7) for q in r for v in q[:2]])
    return out


def write(name, obj):
    path = os.path.join(OUT, name)
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    print(f'{path}: {len(obj["p"])} polygons, {os.path.getsize(path) / 1e6:.1f} MB')


def overture():
    t0 = time.time()
    rows = db.sql(f"""
      SELECT ST_AsGeoJSON(geometry) FROM read_parquet('{OVERTURE}', hive_partitioning=1)
      WHERE bbox.xmin > {W} AND bbox.xmax < {E} AND bbox.ymin > {S} AND bbox.ymax < {N}
        AND sources[1].dataset <> 'OpenStreetMap'""").fetchall()
    write('clsm.json', {'src': 'Overture 2026-09-23.1 buildings, non-OSM (CLSM, Shi et al. 2023, CC BY 4.0)', 'p': [r for (g,) in rows for r in rings(g)]})
    print(f'  {time.time() - t0:.0f} s')


def shp_in(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        return [n for n in z.namelist() if n.endswith('.shp')]


def globfp():
    zp = 'data/3d-globfp-2292.zip'
    out = []
    for shp in shp_in(zp):
        rows = db.sql(f"""
          SELECT Height, ST_AsGeoJSON(geom) FROM ST_Read('/vsizip/{zp}/{shp}')
          WHERE Height > 0 AND ST_XMin(geom) > {W} AND ST_XMax(geom) < {E} AND ST_YMin(geom) > {S} AND ST_YMax(geom) < {N}""").fetchall()
        out += [[round(h, 1)] + r for (h, g) in rows for r in rings(g)]
    write('globfp.json', {'src': '3D-GloBFP tile 2292 (Che et al. 2024, CC BY 4.0)', 'p': out})


FN = ['Residence', 'Office', 'Public service', 'Commerce', 'Industry', 'Others']


def cmab():
    zp = 'data/cmab-beijing.zip'
    out = []
    for shp in shp_in(zp):
        # EPSG:3857 -> WGS-84; the box is tested after the transform.
        rows = db.sql(f"""
          WITH b AS (SELECT Height, "Function" AS fn, Age, ST_Transform(geom, 'EPSG:3857', 'EPSG:4326', always_xy := true) AS g
                     FROM ST_Read('/vsizip/{zp}/{shp}'))
          SELECT Height, fn, Age, ST_AsGeoJSON(g) FROM b
          WHERE ST_XMin(g) > {W} AND ST_XMax(g) < {E} AND ST_YMin(g) > {S} AND ST_YMax(g) < {N}""").fetchall()
        for h, fn, age, g in rows:
            fn = (fn or '').strip()
            code = FN.index(fn) if fn in FN else len(FN) - 1
            age = (age or '').strip()
            year = 2019 if age.startswith('AF') else int(age) if age.isdigit() else 0
            out += [[round(h or 0, 1), code, year] + r for r in rings(g)]
    write('cmab.json', {'src': 'CMAB Beijing (Zhang, Zhao & Long 2025, CC BY 4.0)', 'fn': FN, 'p': out})


steps = sys.argv[1:] or ['overture', 'globfp', 'cmab']
for s in steps:
    print(f'== {s}')
    {'overture': overture, 'globfp': globfp, 'cmab': cmab}[s]()

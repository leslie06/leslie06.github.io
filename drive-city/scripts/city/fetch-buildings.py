# Building footprints and heights beyond OSM, for Beijing inside the 5th Ring (since 2026-10-16; the 4th before), into
# .cache/buildings/ for build.mjs:
#   clsm.json    footprints OSM lacks: Overture's buildings theme minus its OSM features, i.e. the
#                machine-learnt East-Asian footprints of Shi et al. 2023 (CLSM, doi:10.5281/zenodo.8174931,
#                CC BY 4.0), already conflated against OSM by Overture.  {"p": [[lon, lat, ...], ...]}
#   globfp.json  heights: 3D-GloBFP (Che et al. 2024, CC BY 4.0), tiles 2292 (116.25-117.5 E, 38.75-40 N),
#                2291 (west of 116.25: 石景山) and 2350 (north of 40: 清河、来广营).  {"p": [[h, lon, lat, ...], ...]}
#   cmab.json    heights, function and age: CMAB (Zhang, Zhao & Long 2025, CC BY 4.0), Beijing.
#                {"fn": [...], "p": [[h, fn, year, lon, lat, ...], ...]}  (year 1985 = 1985 or before, 2019 = after 2018)
# All WGS-84 (checked: no GCJ-02 offset in any of them). Needs `python3 -m pip install --user duckdb` and
#   data/3d-globfp-2292.zip   https://ndownloader.figshare.com/files/54101543 (232 MB)
#   data/3d-globfp-2291.zip   https://ndownloader.figshare.com/files/54101528 (193 MB, 2026-10-16 for the 5th Ring)
#   data/3d-globfp-2350.zip   https://ndownloader.figshare.com/files/54107210 (75 MB, same)
#   data/cmab-beijing.zip     https://ndownloader.figshare.com/files/53666768 (249 MB)
# Overture is read straight from its public S3 bucket (a bbox filter; ~3 min).
# Usage: python3 scripts/city/fetch-buildings.py [overture|globfp|cmab ...] [--south OLD_S] [--box w,s,e,n]
#   --south OLD_S: the box only grew south (from OLD_S to S): fetch just the rows with S < ymin <= OLD_S and append
#   them to the existing files (the union is exactly what a full run with the new S returns; 2026-11-08 枣园).
#   --box w,s,e,n（2026-11-16 机场）：另加一个框，只取整个落在这个框里、又不整个落在上面 W,S,E,N 老框里的，追加到
#   现有文件（老框取的是整个落在框里的，所以不会重复）。3D-GloBFP 只读和这个框相交的块（本地没有的块跳过并提示），
#   data/cmab-beijing.zip 不在就跳过 cmab（高度只用 3D-GloBFP）。机场那次：--box 116.504,40.014,116.628,40.116。
import json, os, sys, time, zipfile
import duckdb

W, S, E, N = 116.19, 39.735, 116.62, 40.03  # 南到 39.735：4 号线枣园、清源路（2026-11-08；之前 39.748）
args = sys.argv[1:]
OLD_S = None
if '--south' in args:
    i = args.index('--south')
    OLD_S = float(args[i + 1])
    del args[i:i + 2]
ONLY = '' if OLD_S is None else f' AND {{y}} <= {OLD_S}'
BOX = None
if '--box' in args:
    i = args.index('--box')
    BOX = [float(v) for v in args[i + 1].split(',')]
    del args[i:i + 2]
    # rows wholly inside the new box and not wholly inside the old one; {x0},{x1},{y0},{y1} are the row's bbox
    OLD = (W, S, E, N)
    W, S, E, N = BOX
    OLD_S = -1  # append mode
    ONLY = (f' AND NOT ({{x0}} > {OLD[0]} AND {{x1}} < {OLD[2]} AND {{y0}} > {OLD[1]} AND {{y1}} < {OLD[3]})')
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


def only(x0, x1, y0, y1):
    return ONLY.format(x0=x0, x1=x1, y0=y0, y1=y1, y=y0)


def write(name, obj):
    path = os.path.join(OUT, name)
    if OLD_S is not None:
        with open(path) as f:
            old = json.load(f)
        print(f'{path}: +{len(obj["p"])} polygons ' + (f'south of {OLD_S}' if BOX is None else f'in {BOX}'))
        obj['p'] = old['p'] + obj['p']
    with open(path, 'w') as f:
        json.dump(obj, f, separators=(',', ':'))
    print(f'{path}: {len(obj["p"])} polygons, {os.path.getsize(path) / 1e6:.1f} MB')


def overture():
    t0 = time.time()
    rows = db.sql(f"""
      SELECT ST_AsGeoJSON(geometry) FROM read_parquet('{OVERTURE}', hive_partitioning=1)
      WHERE bbox.xmin > {W} AND bbox.xmax < {E} AND bbox.ymin > {S} AND bbox.ymax < {N}{only('bbox.xmin', 'bbox.xmax', 'bbox.ymin', 'bbox.ymax')}
        AND sources[1].dataset <> 'OpenStreetMap'""").fetchall()
    write('clsm.json', {'src': 'Overture 2026-09-23.1 buildings, non-OSM (CLSM, Shi et al. 2023, CC BY 4.0)', 'p': [r for (g,) in rows for r in rings(g)]})
    print(f'  {time.time() - t0:.0f} s')


def shp_in(zip_path):
    with zipfile.ZipFile(zip_path) as z:
        return [n for n in z.namelist() if n.endswith('.shp')]


GLOBFP = ['2292', '2291', '2350']
# each tile's extent (w, s, e, n)
GLOBFP_BOX = {'2292': (116.25, 38.75, 117.5, 40), '2291': (115, 38.75, 116.25, 40), '2350': (116.25, 40, 117.5, 41.25)}


def globfp():
    out = []
    tiles = GLOBFP
    if BOX is not None:
        tiles = [t for t in GLOBFP if not (GLOBFP_BOX[t][0] >= E or GLOBFP_BOX[t][2] <= W or GLOBFP_BOX[t][1] >= N or GLOBFP_BOX[t][3] <= S)]
        for t in tiles:
            if not os.path.exists(f'data/3d-globfp-{t}.zip'): raise SystemExit(f'data/3d-globfp-{t}.zip missing')
    for zp, shp in [(zp, shp) for t in tiles for zp in [f'data/3d-globfp-{t}.zip'] for shp in shp_in(zp)]:
        rows = db.sql(f"""
          SELECT Height, ST_AsGeoJSON(geom) FROM ST_Read('/vsizip/{zp}/{shp}')
          WHERE Height > 0 AND ST_XMin(geom) > {W} AND ST_XMax(geom) < {E} AND ST_YMin(geom) > {S} AND ST_YMax(geom) < {N}{only('ST_XMin(geom)', 'ST_XMax(geom)', 'ST_YMin(geom)', 'ST_YMax(geom)')}""").fetchall()
        out += [[round(h, 1)] + r for (h, g) in rows for r in rings(g)]
    write('globfp.json', {'src': f'3D-GloBFP tiles {", ".join(GLOBFP)} (Che et al. 2024, CC BY 4.0)', 'p': out})


FN = ['Residence', 'Office', 'Public service', 'Commerce', 'Industry', 'Others']


def cmab():
    zp = 'data/cmab-beijing.zip'
    if BOX is not None and not os.path.exists(zp):
        print(f'{zp} missing: cmab skipped (heights from 3D-GloBFP)')
        return
    out = []
    for shp in shp_in(zp):
        # EPSG:3857 -> WGS-84; the box is tested after the transform.
        rows = db.sql(f"""
          WITH b AS (SELECT Height, "Function" AS fn, Age, ST_Transform(geom, 'EPSG:3857', 'EPSG:4326', always_xy := true) AS g
                     FROM ST_Read('/vsizip/{zp}/{shp}'))
          SELECT Height, fn, Age, ST_AsGeoJSON(g) FROM b
          WHERE ST_XMin(g) > {W} AND ST_XMax(g) < {E} AND ST_YMin(g) > {S} AND ST_YMax(g) < {N}{only('ST_XMin(g)', 'ST_XMax(g)', 'ST_YMin(g)', 'ST_YMax(g)')}""").fetchall()
        for h, fn, age, g in rows:
            fn = (fn or '').strip()
            code = FN.index(fn) if fn in FN else len(FN) - 1
            age = (age or '').strip()
            year = 2019 if age.startswith('AF') else int(age) if age.isdigit() else 0
            out += [[round(h or 0, 1), code, year] + r for r in rings(g)]
    write('cmab.json', {'src': 'CMAB Beijing (Zhang, Zhao & Long 2025, CC BY 4.0)', 'fn': FN, 'p': out})


steps = args or ['overture', 'globfp', 'cmab']
for s in steps:
    print(f'== {s}')
    {'overture': overture, 'globfp': globfp, 'cmab': cmab}[s]()

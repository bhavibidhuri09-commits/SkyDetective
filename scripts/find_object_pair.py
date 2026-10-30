"""
find_object_pair.py - find SPHEREx image pairs that caught a known moving object.

Follows the object's path (JPL Horizons), asks IRSA which SPHEREx exposures
contained it, and prints the best same-detector pairs plus the exact
fetch_spherex_pair.py command to build each one as a level.

Examples
    python find_object_pair.py --target 9 --start 2025-06-20 --stop 2025-07-10
    python find_object_pair.py --target Makemake --start 2025-05-01 --stop 2025-10-01 \
        --min-dt 24 --max-dt 400 --target-dt 96
"""
import argparse

import numpy as np
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.time import Time
from astroquery.ipac.irsa import Irsa
from astroquery.jplhorizons import Horizons

from fetch_spherex_pair import covers_box, find_collections


def find_pairs(target, start, stop, size=0.5, min_dt=2, max_dt=30, target_dt=10, collection="auto"):
    """Returns (object name, pairs best first). Each pair is a dict with
    detector, dt (hours), a and b (exposures) and mid (field centre)."""
    eph = Horizons(id=target, id_type="smallbody", location="500",
                   epochs={"start": start, "stop": stop, "step": "12h"}).ephemerides()
    name = str(eph["targetname"][0])
    jd, ra, dec = np.array(eph["datetime_jd"]), np.array(eph["RA"]), np.array(eph["DEC"])
    print(f"{name}: V {float(eph['V'][0]):.1f}, {len(jd)} path points")

    # Each Quick Release covers different weeks, so look in all of them.
    seen = {}
    for coll in find_collections(collection):
        for j, r, d in zip(jd, ra, dec):
            mjd = j - 2400000.5
            table = Irsa.query_sia(pos=(SkyCoord(r, d, unit="deg"), 0.3 * u.deg), collection=coll,
                                   time=(Time(mjd - 0.3, format="mjd"), Time(mjd + 0.3, format="mjd")))
            for row in table:
                if str(row["dataproduct_subtype"]) == "science":
                    key = (str(row["obs_id"]), str(row["energy_bandpassname"]))
                    seen.setdefault(key, (float(row["t_min"]), str(row["s_region"])))
    print(f"{len(seen)} exposures near the path")

    hits = []
    for (obs_id, detector), (t_min, region) in seen.items():
        tj = t_min + 2400000.5
        where = SkyCoord(np.interp(tj, jd, ra), np.interp(tj, jd, dec), unit="deg")
        if covers_box(region, where, 0.05):
            hits.append(dict(obs_id=obs_id, detector=detector, t_min=t_min, where=where, region=region))
    print(f"{len(hits)} exposures contain {name}")

    pairs = {}
    for i, a in enumerate(hits):
        for b in hits[i + 1:]:
            if a["detector"] != b["detector"]:
                continue
            a, b = sorted((a, b), key=lambda h: h["t_min"])
            dt = (b["t_min"] - a["t_min"]) * 24
            if not min_dt <= dt <= max_dt:
                continue
            mid = SkyCoord((a["where"].ra.deg + b["where"].ra.deg) / 2,
                           (a["where"].dec.deg + b["where"].dec.deg) / 2, unit="deg")
            if covers_box(a["region"], mid, size / 2) and covers_box(b["region"], mid, size / 2):
                pairs[(a["obs_id"], b["obs_id"], a["detector"])] = dict(
                    detector=a["detector"], dt=dt, a=a, b=b, mid=mid)
    # Short-wavelength detectors (1-3) first: asteroids shine there by reflected sunlight.
    ranked = sorted(pairs.values(), key=lambda p: (int(p["detector"][-1]) > 3, abs(p["dt"] - target_dt)))
    return name, ranked


def fetch_args(name, pair, size, level_name):
    """The fetch_spherex_pair.py arguments that build this pair as a level."""
    return ["--ra", f"{pair['mid'].ra.deg:.4f}", "--dec", f"{pair['mid'].dec.deg:.4f}",
            "--date", Time(pair["a"]["t_min"], format="mjd").isot[:10], "--window-days", "1.5",
            "--detectors", pair["detector"][-1],
            "--min-dt", f"{pair['dt'] - 0.3:.1f}", "--max-dt", f"{pair['dt'] + 0.3:.1f}",
            "--target-dt", f"{pair['dt']:.2f}", "--size", str(size), "--name", level_name]


def main():
    ap = argparse.ArgumentParser(description="Find SPHEREx pairs that contain a moving object.")
    ap.add_argument("--target", required=True, help="asteroid number or name, e.g. 9 or Makemake")
    ap.add_argument("--start", required=True, help="search from this UTC date, e.g. 2025-06-20")
    ap.add_argument("--stop", required=True, help="search up to this UTC date")
    ap.add_argument("--size", type=float, default=0.5, help="level field width, degrees (default 0.5)")
    ap.add_argument("--min-dt", type=float, default=2, help="min hours between frames")
    ap.add_argument("--max-dt", type=float, default=30, help="max hours between frames")
    ap.add_argument("--target-dt", type=float, default=10, help="preferred hours between frames")
    ap.add_argument("--collection", default="auto", help="IRSA collection, e.g. spherex_qr2")
    ap.add_argument("--show", type=int, default=8, help="pairs to print")
    args = ap.parse_args()

    name, pairs = find_pairs(args.target, args.start, args.stop, args.size, args.min_dt,
                             args.max_dt, args.target_dt, args.collection)
    if not pairs:
        print("No pair covers the whole field. Try other dates, a smaller --size or a wider --max-dt.")
        return

    print()
    for p in pairs[:args.show]:
        print(f"{p['detector']}  {p['dt']:.1f} h  {p['a']['obs_id']} -> {p['b']['obs_id']}  "
              f"{Time(p['a']['t_min'], format='mjd').isot[:16]} UTC")
    slug = name.split("(")[0].strip().split()[-1].lower()
    print("\nBuild the best one:")
    print("python scripts/fetch_spherex_pair.py " + " ".join(fetch_args(name, pairs[0], args.size, f"level-{slug}")))


if __name__ == "__main__":
    main()

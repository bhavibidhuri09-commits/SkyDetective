"""
weekly_update.py - build a "Fresh from SPHEREx" round from the newest data.

1. Asks IRSA for the newest SPHEREx exposures.
2. Asks SkyBoT which bright asteroids sat in a sample of that week's pointings.
3. Finds a same-detector pair that caught one of them hours apart and builds it
   as a level, keeping it only if the asteroid is in the answer key and jumps
   at least 20 px.
4. Replaces last week's fresh round in site/public/levels with the new one,
   saves its JPL info card, and copies a blink preview to review/.
5. Writes a report for the pull request that a person reviews and merges.

Makes no changes (so no pull request) when nothing suitable is found.

Example
    python scripts/weekly_update.py --site site --work .work
"""
import argparse
import json
import shutil
from pathlib import Path

from astropy import units as u
from astropy.coordinates import GeocentricTrueEcliptic, SkyCoord
from astropy.time import Time
from astroquery.ipac.irsa import Irsa

import fetch_spherex_pair
from fetch_object_info import lookup
from fetch_spherex_pair import find_collections, skybot_objects
from find_object_pair import fetch_args, find_pairs

ROUND_PREFIX = "auto-"


def newest_exposures(days):
    """The newest collection, its last exposure time, and that week's D2 pointings."""
    collection = find_collections("auto")[0]
    last = Irsa.query_tap(
        f"SELECT TOP 1 t_min FROM ivoa.obscore WHERE obs_collection = '{collection}' ORDER BY t_min DESC"
    ).to_table()
    newest = float(last["t_min"][0])
    rows = Irsa.query_tap(
        f"SELECT TOP 2000 obs_id, s_ra, s_dec, t_min FROM ivoa.obscore "
        f"WHERE obs_collection = '{collection}' AND t_min > {newest - days} "
        f"AND energy_bandpassname = 'SPHEREx-D2'"  # dataproduct_subtype is blank in TAP
    ).to_table()
    return collection, newest, rows


def spread_pointings(rows, count, max_ecliptic_lat=20, min_sep_deg=4):
    """Pointings near the ecliptic (where asteroids are), at least min_sep_deg apart."""
    chosen = []
    for r in rows:
        where = SkyCoord(float(r["s_ra"]), float(r["s_dec"]), unit="deg")
        if abs(where.transform_to(GeocentricTrueEcliptic()).lat.deg) > max_ecliptic_lat:
            continue
        if all(where.separation(c[0]).deg >= min_sep_deg for c in chosen):
            chosen.append((where, float(r["t_min"])))
        if len(chosen) == count:
            break
    return chosen


def bright_asteroids(pointings, vmax):
    found = {}
    for where, mjd in pointings:
        for obj in skybot_objects(where, 1.5, mjd, "500").values():
            if obj["number"] and obj["vmag"] <= vmax:
                found.setdefault(obj["number"], dict(obj, mjd=mjd))
        print(f"  pointing RA {where.ra.deg:.1f} Dec {where.dec.deg:+.1f}: {len(found)} bright asteroids so far")
    return sorted(found.values(), key=lambda o: o["vmag"])


def try_build(candidate, newest, work, size):
    start = Time(candidate["mjd"] - 3, format="mjd").isot[:10]
    stop = Time(min(candidate["mjd"] + 3, newest + 0.5), format="mjd").isot[:10]
    name, pairs = find_pairs(candidate["number"], start, stop, size=size, min_dt=6, max_dt=30, target_dt=12)
    for pair in pairs[:2]:
        level_name = f"{ROUND_PREFIX}{candidate['number']}"
        try:
            out_dir = fetch_spherex_pair.main(fetch_args(name, pair, size, level_name) + ["--out", str(work)])
        except SystemExit as e:
            print(f"  could not build: {e}")
            continue
        level = json.loads((out_dir / "level.json").read_text(encoding="utf-8"))
        match = [o for o in level["objects"] if o["number"] == candidate["number"] and o["name"] in level["movers"]]
        if match and match[0]["motion_px"] >= 20:
            return out_dir, level, match[0]
        print("  not clear enough: the asteroid is not a visible mover or barely moves")
    return None


def install(out_dir, level, mover, site, review):
    levels = site / "public" / "levels"
    index_path = levels / "index.json"
    index = json.loads(index_path.read_text(encoding="utf-8"))
    for old in [r for r in index["rounds"] if r["id"].startswith(ROUND_PREFIX)]:
        shutil.rmtree(levels / old["folder"], ignore_errors=True)
    index["rounds"] = [r for r in index["rounds"] if not r["id"].startswith(ROUND_PREFIX)]

    date = Time(level["frames"][0]["mjd"], format="mjd").datetime
    round_id = f"{ROUND_PREFIX}{date:%Y-%m-%d}-{mover['number']}"
    dest = levels / round_id
    dest.mkdir(parents=True, exist_ok=True)
    for name in ("frame_a.png", "frame_b.png", "diff.png", "level.json"):
        shutil.copy(out_dir / name, dest / name)
    day = f"{date.day} {date:%b %Y}"
    new_round = {"id": round_id, "kind": "real", "folder": round_id,
                 "title": {"en": f"Fresh from SPHEREx: {day}", "hi": f"SPHEREx से ताज़ा: {day}"}}
    # Just before the last round, which is the "Nothing moved" field.
    index["rounds"].insert(max(len(index["rounds"]) - 1, 0), new_round)
    index_path.write_text(json.dumps(index, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    info = lookup(mover["number"])
    objects = site / "public" / "objects"
    objects.mkdir(parents=True, exist_ok=True)
    (objects / f"{mover['number']}.json").write_text(json.dumps(info, indent=2), encoding="utf-8")

    review.mkdir(parents=True, exist_ok=True)
    shutil.copy(out_dir / "preview.gif", review / "latest-preview.gif")
    shutil.copy(out_dir / "diff.png", review / "latest-diff.png")
    return round_id, info


def report(path, collection, newest, level, mover, info, round_id):
    frames = level["frames"]
    others = [o for o in level["objects"] if o["name"] != mover["name"]]
    signal = ", ".join(f"{q['signal_sigma']}σ" for q in mover["frames"])
    lines = [
        f"## New round: {info['name']}, {frames[0]['utc'][:10]}",
        "",
        f"The weekly robot built `{round_id}` from the newest SPHEREx data "
        f"(`{collection}`, last exposure {Time(newest, format='mjd').isot[:10]}).",
        "",
        f"- **Images:** `{frames[0]['obs_id']}` and `{frames[1]['obs_id']}`, {frames[0]['detector']}, "
        f"{frames[0]['wavelength_um']} / {frames[1]['wavelength_um']} µm, {level['dt_hours']:.1f} h apart",
        f"- **Mover:** {info['name']}, V {mover['vmag']}, jumps {mover['motion_px']} px, signal {signal}",
        f"- **Other known objects in view:** {len(others)}, none marked visible"
        if not [o for o in others if o["visible_guess"]]
        else f"- **Also marked visible:** {', '.join(o['name'] for o in others if o['visible_guess'])}",
        f"- **Info card:** {info['diameter_km']} km, {info['sun_distance_au']} au, discovered {info['discovered']}",
        "",
        "### Before you merge",
        "",
        "- [ ] Open `review/latest-preview.gif` in the Files tab: the mover jumps, and nothing else does",
        "- [ ] `review/latest-diff.png` shows one white and one black blob for the mover",
        "- [ ] The Vercel preview link below plays the new round",
        "",
        "Merging puts this round on the live site and removes last week's fresh round.",
    ]
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser(description="Build this week's fresh SPHEREx round.")
    ap.add_argument("--site", default="site", help="the game folder (default: site)")
    ap.add_argument("--work", default=".work", help="scratch folder for downloads (default: .work)")
    ap.add_argument("--review", default="review", help="where the blink preview goes (default: review)")
    ap.add_argument("--days", type=float, default=4, help="how far back from the newest exposure to look")
    ap.add_argument("--pointings", type=int, default=20, help="pointings to check for bright asteroids")
    # Hygiea (V 11.9) shows at ~1,000 sigma in one exposure, so V 15 is still an easy find.
    ap.add_argument("--vmax", type=float, default=15, help="faintest asteroid to use (V magnitude)")
    ap.add_argument("--tries", type=int, default=5, help="asteroids to try before giving up")
    ap.add_argument("--size", type=float, default=0.5, help="field width, degrees")
    args = ap.parse_args()
    work = Path(args.work)

    collection, newest, rows = newest_exposures(args.days)
    print(f"Newest SPHEREx data: {collection}, up to {Time(newest, format='mjd').isot[:16]} UTC, "
          f"{len(rows)} D2 exposures in the last {args.days:g} days")
    candidates = bright_asteroids(spread_pointings(rows, args.pointings), args.vmax)
    print(f"{len(candidates)} bright asteroids: "
          + ", ".join(f"({c['number']}) {c['name']} V{c['vmag']:.1f}" for c in candidates[:10]))

    for candidate in candidates[:args.tries]:
        print(f"\n-> trying ({candidate['number']}) {candidate['name']}")
        built = try_build(candidate, newest, work / "levels", args.size)
        if built:
            out_dir, level, mover = built
            round_id, info = install(out_dir, level, mover, Path(args.site), Path(args.review))
            report(work / "weekly_report.md", collection, newest, level, mover, info, round_id)
            print(f"\nNew round {round_id}: {info['name']}. Report: {work / 'weekly_report.md'}")
            return
    print("\nNo suitable asteroid this week. Nothing changed.")


if __name__ == "__main__":
    main()

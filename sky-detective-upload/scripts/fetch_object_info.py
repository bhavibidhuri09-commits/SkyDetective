"""
fetch_object_info.py - save info-card facts for every mover in the built levels.

Reads <levels>/*/level.json, looks up each numbered mover in the JPL Small-Body
Database API, and writes <out>/<number>.json for the game's info card.

Example
    python fetch_object_info.py --levels site/public/levels --out site/public/objects
"""
import argparse
import json
from pathlib import Path

import requests

SBDB = "https://ssd-api.jpl.nasa.gov/sbdb.api"


def lookup(number):
    r = requests.get(SBDB, params={"sstr": str(number), "phys-par": 1, "discovery": 1}, timeout=60)
    r.raise_for_status()
    data = r.json()
    elements = {e["name"]: e["value"] for e in data["orbit"]["elements"]}
    phys = {p["name"]: p["value"] for p in data.get("phys_par", [])}
    disc = data.get("discovery") or {}
    period_days = float(elements["per"]) if elements.get("per") else None
    return dict(
        number=number,
        name=data["object"]["shortname"],
        orbit_class=data["object"]["orbit_class"]["name"],
        diameter_km=float(phys["diameter"]) if phys.get("diameter") else None,
        albedo=float(phys["albedo"]) if phys.get("albedo") else None,
        sun_distance_au=float(elements["a"]),
        perihelion_au=float(elements["q"]),
        aphelion_au=float(elements["ad"]) if elements.get("ad") else None,
        period_years=round(period_days / 365.25, 2) if period_days else None,
        discovered=disc.get("date"),
        discovered_by=disc.get("who"),
        discovered_at=disc.get("location"),
        sbdb_url=f"https://ssd.jpl.nasa.gov/tools/sbdb_lookup.html#/?sstr={number}",
        mpc_url=f"https://minorplanetcenter.net/db_search/show_object?object_id={number}",
        source="JPL Small-Body Database API",
    )


def main():
    ap = argparse.ArgumentParser(description="Fetch JPL SBDB facts for every mover in the levels.")
    ap.add_argument("--levels", required=True, help="folder holding <level>/level.json")
    ap.add_argument("--out", required=True, help="folder to write <number>.json into")
    args = ap.parse_args()

    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    numbers = set()
    for path in Path(args.levels).glob("*/level.json"):
        level = json.loads(path.read_text(encoding="utf-8"))
        for obj in level["objects"]:
            if obj["name"] in level["movers"] and obj.get("number"):
                numbers.add(obj["number"])
    for number in sorted(numbers):
        info = lookup(number)
        (out / f"{number}.json").write_text(json.dumps(info, indent=2), encoding="utf-8")
        print(f"{info['name']}: {info['diameter_km']} km, {info['sun_distance_au']} au, "
              f"discovered {info['discovered']}")


if __name__ == "__main__":
    main()

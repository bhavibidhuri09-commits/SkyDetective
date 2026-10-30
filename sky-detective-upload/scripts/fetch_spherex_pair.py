"""
fetch_spherex_pair.py - Sky Detective data pipeline.

Downloads two SPHEREx exposures of the same sky patch from NASA/IPAC IRSA,
aligns them on one north-up grid, and writes a game-ready level:

    <out>/<name>/frame_a.png    earlier exposure
    <out>/<name>/frame_b.png    later exposure (same stretch, flux-matched)
    <out>/<name>/diff.png       A - B (white = only in A, black = only in B)
    <out>/<name>/preview.gif    blink preview for the team
    <out>/<name>/level.json     frame metadata + known solar-system objects

Object positions come from IMCCE SkyBoT (everything known in the field) and,
with --track, JPL Horizons (one named target, e.g. Makemake).

Examples
    python fetch_spherex_pair.py --ra 180 --dec 0 --list
    python fetch_spherex_pair.py --ra 180 --dec 0 --name level2-asteroids
    python fetch_spherex_pair.py --ra 270 --dec -23 --name level3-makemake \
        --min-dt 24 --max-dt 400 --target-dt 96 --track Makemake

PNG pixel coordinates in level.json: origin at the top-left corner of the
image, x to the right, y down (canvas convention). u, v are the same position
as a fraction of the image width/height, so they survive any display scaling.
"""
import argparse
import json
import re
import sys
import time
import warnings
from pathlib import Path

import numpy as np
import requests
from astropy import log
from astropy import units as u
from astropy.coordinates import SkyCoord
from astropy.io import fits
from astropy.time import Time
from astropy.wcs import WCS, FITSFixedWarning
from numpy.lib.stride_tricks import sliding_window_view
from PIL import Image
from reproject import reproject_interp

warnings.filterwarnings("ignore", category=FITSFixedWarning)
log.setLevel("WARNING")  # hides astropy's SIP notice on the wavelength WCS

NATIVE_ARCSEC_PER_PX = 6.15
# FLAGS bits that mean "this pixel is junk" (cosmic rays, hot/dead pixels...).
# Bit numbers are read from the MP_* header keys. SOURCE and OUTLIER are left
# alone on purpose: they can sit on stars and on real movers.
BAD_FLAGS = ["TRANSIENT", "OVERFLOW", "SUR_ERROR", "PHANTOM", "NONFUNC",
             "MISSING_DATA", "HOT", "COLD", "PERSIST"]
CREDIT = ("SPHEREx data: NASA/JPL-Caltech, via NASA/IPAC Infrared Science Archive (IRSA). "
          "Solar-system positions: IMCCE SkyBoT; JPL Horizons.")


# ---------------------------------------------------------------- archive

def find_collections(requested):
    if requested != "auto":
        return [requested]
    from astroquery.ipac.irsa import Irsa
    names = [str(c) for c in Irsa.list_collections()["collection"]
             if re.fullmatch(r"spherex_qr\d+", str(c))]
    return sorted(names, key=lambda c: int(c[len("spherex_qr"):]), reverse=True)


def query_exposures(center, collection):
    from astroquery.ipac.irsa import Irsa
    table = Irsa.query_sia(pos=(center, 0.01 * u.deg), collection=collection)
    rows = []
    for r in table:
        if str(r["dataproduct_subtype"]) != "science":
            continue
        rows.append(dict(obs_id=str(r["obs_id"]), detector=str(r["energy_bandpassname"]),
                         t_min=float(r["t_min"]), url=str(r["access_url"]),
                         s_region=str(r["s_region"]), collection=collection))
    return rows


def _inside(x, y, px, py):
    inside = False
    for i in range(len(px)):
        x1, y1, x2, y2 = px[i], py[i], px[i - 1], py[i - 1]
        if (y1 > y) != (y2 > y) and x < x1 + (y - y1) * (x2 - x1) / (y2 - y1):
            inside = not inside
    return inside


def covers_box(s_region, center, half_deg):
    """True if the exposure footprint contains all four corners of our square."""
    nums = [float(v) for v in re.findall(r"[-+]?\d+\.?\d*(?:[eE][-+]?\d+)?", s_region)]
    off = SkyCoord(nums[0::2], nums[1::2], unit="deg").transform_to(center.skyoffset_frame())
    px, py = off.lon.deg, off.lat.deg
    return all(_inside(sx * half_deg, sy * half_deg, px, py) for sx in (-1, 1) for sy in (-1, 1))


def candidate_pairs(rows, min_dt, max_dt, target_dt, detectors):
    pairs = []
    for i, a in enumerate(rows):
        for b in rows[i + 1:]:
            if a["detector"] != b["detector"]:
                continue
            if detectors and int(a["detector"][-1]) not in detectors:
                continue
            first, second = (a, b) if a["t_min"] <= b["t_min"] else (b, a)
            dt = (second["t_min"] - first["t_min"]) * 24
            if min_dt <= dt <= max_dt:
                pairs.append((abs(dt - target_dt), dt, first, second))
    pairs.sort(key=lambda p: p[0])
    return pairs


def download_cutout(url, center, size_deg, cache_dir):
    stem = url.rsplit("/", 1)[-1].replace(".fits", "")
    path = cache_dir / f"{stem}_{center.ra.deg:.4f}_{center.dec.deg:+.4f}_{size_deg:.3f}.fits"
    if path.exists() and path.stat().st_size > 0:
        return path
    cutout = f"{url}?center={center.ra.deg:.6f},{center.dec.deg:.6f}&size={size_deg:.4f}"
    for attempt in range(1, 4):
        try:
            r = requests.get(cutout, timeout=300)
            r.raise_for_status()
            if not r.content.startswith(b"SIMPLE"):
                raise IOError("response is not a FITS file")
            tmp = path.with_suffix(".part")
            tmp.write_bytes(r.content)
            tmp.replace(path)
            return path
        except Exception as e:
            print(f"   download failed ({e}), retry {attempt}/3")
            time.sleep(5)
    raise RuntimeError(f"could not download {cutout}")


# ---------------------------------------------------------------- images

def fill_bad(img):
    """Replace NaN pixels with the median of their 5x5 neighbourhood."""
    bad = ~np.isfinite(img)
    if bad.any():
        windows = sliding_window_view(np.pad(img, 2, mode="reflect"), (5, 5))
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", RuntimeWarning)
            img[bad] = np.nanmedian(windows[bad], axis=(-1, -2))
        img[~np.isfinite(img)] = np.nanmedian(img)
    return img


def load_exposure(path, center):
    with fits.open(path) as h:
        hdr = h["IMAGE"].header
        img = h["IMAGE"].data.astype("f8") - h["ZODI"].data  # remove zodiacal glow
        flags, fhdr = h["FLAGS"].data, h["FLAGS"].header
        for name in BAD_FLAGS:
            bit = fhdr.get("MP_" + name)
            if bit is not None:
                img[((flags >> int(bit)) & 1).astype(bool)] = np.nan
        sky = WCS(hdr)
        try:  # SPHEREx's wavelength changes across the detector; read it at our target
            x, y = sky.world_to_pixel(center)
            lam, _ = WCS(hdr, fobj=h, key="W").pixel_to_world_values(x, y)
            wavelength = round(float(lam), 4)
        except Exception:
            wavelength = None
        mjd = float(hdr["MJD-AVG"])
    return dict(data=fill_bad(img), wcs=sky, mjd=mjd, wavelength_um=wavelength)


def output_wcs(center, size_deg, npix):
    w = WCS(naxis=2)
    w.wcs.ctype = ["RA---TAN", "DEC--TAN"]
    w.wcs.crval = [center.ra.deg, center.dec.deg]
    w.wcs.crpix = [(npix + 1) / 2, (npix + 1) / 2]
    w.wcs.cdelt = [-size_deg / npix, size_deg / npix]  # north up, east left
    return w


def robust_stats(x):
    x = x[np.isfinite(x)]
    med = np.median(x)
    return med, 1.4826 * np.median(np.abs(x - med))


def stretch(img, lo, hi, soft=8.0):
    x = np.clip((img - lo) / (hi - lo), 0, 1)
    return (np.arcsinh(soft * x) / np.arcsinh(soft) * 255).astype(np.uint8)


def save_png(arr, path):
    Image.fromarray(np.flipud(arr)).save(path)  # FITS row 0 is the bottom


# ---------------------------------------------------------------- solar system

def _num(x):
    return float(getattr(x, "value", x))


def skybot_objects(center, radius_deg, mjd, location):
    from astroquery.imcce import Skybot
    try:
        table = Skybot.cone_search(center, radius_deg * u.deg, Time(mjd, format="mjd"),
                                   location=location, cache=False)
    except RuntimeError as e:
        if "No solar system object" in str(e):
            return {}
        raise
    found = {}
    for r in table:
        name = str(r["Name"])
        number = None if np.ma.is_masked(r["Number"]) else int(r["Number"])
        found[name] = dict(name=name, number=number, type=str(r["Type"]), vmag=_num(r["V"]),
                           ra=_num(r["RA"]), dec=_num(r["DEC"]), source="SkyBoT")
    return found


def horizons_object(target, mjds, location):
    from astroquery.jplhorizons import Horizons
    eph = Horizons(id=target, id_type="smallbody", location=location,
                   epochs=[m + 2400000.5 for m in mjds]).ephemerides()
    vmag = _num(eph["V"][0]) if "V" in eph.colnames else None
    return [dict(name=str(eph["targetname"][i]), number=None, type="tracked", vmag=vmag,
                 ra=_num(eph["RA"][i]), dec=_num(eph["DEC"][i]), source="JPL Horizons")
            for i in range(len(mjds))]


def peak_sigma(diff, x, y, r):
    """Brightest pixel of `diff` within r px of (x, y), FITS pixel coords."""
    xi, yi = int(round(x)), int(round(y))
    box = diff[max(yi - r, 0):yi + r + 1, max(xi - r, 0):xi + r + 1]
    return round(float(box.max()), 1) if box.size else None


def vanished_fraction(img, other, x, y, r):
    """Share of the light at the object's brightest pixel that is gone in the
    other frame: near 1 for a real mover, near 0 for a star that only changed
    brightness between the two wavelengths."""
    xi, yi = int(round(x)), int(round(y))
    window = (slice(max(yi - r, 0), yi + r + 1), slice(max(xi - r, 0), xi + r + 1))
    box = img[window]
    if not box.size or box.max() <= 0:
        return 0.0
    j = np.unravel_index(np.argmax(box), box.shape)
    return round(float((box[j] - other[window][j]) / box[j]), 2)


# ---------------------------------------------------------------- main

def main(argv=None):
    """Builds one level. Returns its output folder (None for --list)."""
    ap = argparse.ArgumentParser(description="Make a Sky Detective level from a SPHEREx image pair.")
    ap.add_argument("--ra", type=float, required=True, help="field centre RA, degrees")
    ap.add_argument("--dec", type=float, required=True, help="field centre Dec, degrees")
    ap.add_argument("--name", help="level id / output folder (default from position)")
    ap.add_argument("--out", default="levels", help="output root folder (default: levels)")
    ap.add_argument("--size", type=float, default=0.5, help="field width, degrees (default 0.5)")
    ap.add_argument("--upscale", type=int, default=2, help="output px per SPHEREx px (default 2)")
    ap.add_argument("--min-dt", type=float, default=1, help="min hours between frames")
    ap.add_argument("--max-dt", type=float, default=30, help="max hours between frames")
    ap.add_argument("--target-dt", type=float, default=10, help="preferred hours between frames")
    ap.add_argument("--detectors", type=int, nargs="*", help="only use these detectors (1-6)")
    ap.add_argument("--date", help="only use exposures near this UTC date, e.g. 2025-09-24")
    ap.add_argument("--window-days", type=float, default=1, help="days either side of --date (default 1)")
    ap.add_argument("--collection", default="auto", help="IRSA collection, e.g. spherex_qr2")
    ap.add_argument("--list", action="store_true", help="only list candidate pairs")
    ap.add_argument("--pick", type=int, help="use pair N from --list instead of the best one")
    ap.add_argument("--tries", type=int, default=5, help="pairs to try if coverage is poor")
    ap.add_argument("--track", help="also place this object via JPL Horizons (e.g. Makemake)")
    ap.add_argument("--vmax", type=float, default=22, help="ignore SkyBoT objects fainter than this V")
    ap.add_argument("--location", default="500", help="observer code for ephemerides (500 = geocentre)")
    args = ap.parse_args(argv)

    center = SkyCoord(args.ra, args.dec, unit="deg")
    name = args.name or f"ra{args.ra:.3f}_dec{args.dec:+.3f}"
    out_dir, cache_dir = Path(args.out) / name, Path(args.out) / ".cache"
    half = args.size / 2

    # Each Quick Release covers different weeks, so look in all of them.
    rows, seen = [], set()
    for collection in find_collections(args.collection):
        found = [r for r in query_exposures(center, collection) if covers_box(r["s_region"], center, half)]
        if args.date:
            day = Time(args.date).mjd + 0.5
            found = [r for r in found if abs(r["t_min"] - day) <= args.window_days + 0.5]
        print(f"{collection}: {len(found)} exposures fully cover the {args.size} deg box")
        for r in found:
            if (r["obs_id"], r["detector"]) not in seen:
                seen.add((r["obs_id"], r["detector"]))
                rows.append(r)
    if not rows:
        sys.exit("No SPHEREx exposure fully covers this box. Try a smaller --size or another position.")

    pairs = candidate_pairs(rows, args.min_dt, args.max_dt, args.target_dt, args.detectors)
    if not pairs:
        sys.exit("No same-detector pair in the time window. Widen --min-dt/--max-dt.")

    if args.list:
        print(f"{'#':>3}  {'detector':<11} {'dt (h)':>7}  {'frame A':<20} {'frame B':<20} A time (UTC)")
        for i, (_, dt, a, b) in enumerate(pairs[:25]):
            utc = Time(a["t_min"], format="mjd").isot[:16]
            print(f"{i:>3}  {a['detector']:<11} {dt:>7.1f}  {a['obs_id']:<20} {b['obs_id']:<20} {utc}")
        print(f"({len(pairs)} pairs total; use --pick N)")
        return None

    cache_dir.mkdir(parents=True, exist_ok=True)
    npix = int(round(args.size * 3600 / NATIVE_ARCSEC_PER_PX * args.upscale))
    grid = output_wcs(center, args.size, npix)
    cut_size = args.size * np.sqrt(2) * 1.05  # our square may be rotated on the detector

    chosen = [pairs[args.pick]] if args.pick is not None else pairs[:args.tries]
    for _, dt, a, b in chosen:
        print(f"-> {a['obs_id']} + {b['obs_id']} ({a['detector']}, {dt:.1f} h apart)")
        ea = load_exposure(download_cutout(a["url"], center, cut_size, cache_dir), center)
        eb = load_exposure(download_cutout(b["url"], center, cut_size, cache_dir), center)
        A, foot_a = reproject_interp((ea["data"], ea["wcs"]), grid, shape_out=(npix, npix))
        B, foot_b = reproject_interp((eb["data"], eb["wcs"]), grid, shape_out=(npix, npix))
        coverage = min(np.mean(foot_a > 0), np.mean(foot_b > 0))
        if coverage >= 0.98 or args.pick is not None:
            break
        print(f"   only {coverage:.0%} covered, trying the next pair")
    else:
        sys.exit("No pair covered the whole box. Try a smaller --size.")

    # Same background, same brightness scale, same stretch -> stars don't flicker.
    A, B = np.nan_to_num(A), np.nan_to_num(B)
    med_a, sig_a = robust_stats(A)
    med_b, sig_b = robust_stats(B)
    A, B = A - med_a, B - med_b
    bright = (A > 10 * sig_a) & (B > 10 * sig_b)
    flux_scale = float(np.median(B[bright] / A[bright])) if bright.sum() > 20 else 1.0
    B = B / flux_scale
    lo, hi = -2 * sig_a, max(np.percentile(A, 99.8), 20 * sig_a)

    out_dir.mkdir(parents=True, exist_ok=True)
    png_a, png_b = stretch(A, lo, hi), stretch(B, lo, hi)
    save_png(png_a, out_dir / "frame_a.png")
    save_png(png_b, out_dir / "frame_b.png")
    diff = A - B
    _, sig_d = robust_stats(diff)
    diff_sigma = diff / sig_d
    save_png(np.clip(128 + diff_sigma / 5 * 127, 0, 255).astype(np.uint8), out_dir / "diff.png")
    frames = [Image.fromarray(np.flipud(p)) for p in (png_a, png_b)]
    frames[0].save(out_dir / "preview.gif", save_all=True, append_images=frames[1:], duration=600, loop=0)

    # Known objects at each frame's mid-exposure time.
    print("-> asking SkyBoT what was in the field")
    radius = half * np.sqrt(2) * 1.1
    found = [skybot_objects(center, radius, e["mjd"], args.location) for e in (ea, eb)]
    tracks = [[found[0][n], found[1][n]] for n in found[0] if n in found[1]
              and found[0][n]["vmag"] <= args.vmax]
    if args.track:
        print(f"-> asking JPL Horizons for {args.track}")
        tracks.append(horizons_object(args.track, [ea["mjd"], eb["mjd"]], args.location))

    r = max(2, args.upscale + 1)
    objects = []
    for track in tracks:
        positions = []
        for i, p in enumerate(track):
            x, y = grid.world_to_pixel(SkyCoord(p["ra"], p["dec"], unit="deg"))
            x, y = float(x), float(y)
            in_view = 0 <= x < npix and 0 <= y < npix
            sig = diff_sigma if i == 0 else -diff_sigma
            img, other = (A, B) if i == 0 else (B, A)
            positions.append(dict(x=round(x + 0.5, 2), y=round(npix - 0.5 - y, 2),
                                  u=round((x + 0.5) / npix, 4), v=round((npix - 0.5 - y) / npix, 4),
                                  ra=round(p["ra"], 6), dec=round(p["dec"], 6), in_view=in_view,
                                  signal_sigma=peak_sigma(sig, x, y, r) if in_view else None,
                                  vanished=vanished_fraction(img, other, x, y, r) if in_view else None))
        if not any(q["in_view"] for q in positions):
            continue
        sky_a = SkyCoord(track[0]["ra"], track[0]["dec"], unit="deg")
        sky_b = SkyCoord(track[1]["ra"], track[1]["dec"], unit="deg")
        motion_arcsec = float(sky_a.separation(sky_b).arcsec)
        motion_px = motion_arcsec / (args.size * 3600 / npix)
        signals = [q["signal_sigma"] or 0 for q in positions]
        vanished = [q["vanished"] or 0 for q in positions]
        objects.append(dict(
            name=track[0]["name"], number=track[0]["number"], type=track[0]["type"],
            vmag=None if track[0]["vmag"] is None else round(track[0]["vmag"], 2),
            source=track[0]["source"], frames=positions,
            motion_arcsec=round(motion_arcsec, 1), motion_px=round(motion_px, 1),
            rate_arcsec_per_hour=round(motion_arcsec / dt, 2),
            # A guess for the level designer, not truth: check it on diff.png.
            visible_guess=all(q["in_view"] for q in positions) and min(signals) >= 5
            and min(vanished) >= 0.6 and motion_px >= 2 * args.upscale))
    objects.sort(key=lambda o: (not o["visible_guess"], o["vmag"] if o["vmag"] is not None else 99))

    level = dict(
        id=name, center=dict(ra=args.ra, dec=args.dec), size_deg=args.size,
        image_px=npix, arcsec_per_px=round(args.size * 3600 / npix, 3),
        orientation="north up, east left", coords="x,y in PNG pixels from top-left; u,v as fractions",
        dt_hours=round(dt, 3), collection=a["collection"],
        frames=[dict(png=f"frame_{k}.png", obs_id=row["obs_id"], detector=row["detector"],
                     mjd=round(e["mjd"], 6), utc=Time(e["mjd"], format="mjd").isot[:19] + "Z",
                     wavelength_um=e["wavelength_um"], source_url=row["url"])
                for k, row, e in (("a", a, ea), ("b", b, eb))],
        flux_scale_b=round(flux_scale, 4), diff_png="diff.png",
        objects=objects, movers=[o["name"] for o in objects if o["visible_guess"]],
        credit=CREDIT)
    (out_dir / "level.json").write_text(json.dumps(level, indent=2), encoding="utf-8")

    print(f"\nWrote {out_dir.resolve()}")
    print(f"  {npix}x{npix} px, {dt:.1f} h apart, {a['detector']}, "
          f"{ea['wavelength_um']} / {eb['wavelength_um']} um, coverage {coverage:.0%}")
    print(f"  {len(objects)} known objects in view, {len(level['movers'])} look visible:")
    for o in objects[:15]:
        mark = "*" if o["visible_guess"] else " "
        print(f"   {mark} {o['name']:<22} V={o['vmag']}  moved {o['motion_px']} px  "
              f"signal {[q['signal_sigma'] for q in o['frames']]}  "
              f"vanished {[q['vanished'] for q in o['frames']]}")
    return out_dir


if __name__ == "__main__":
    main()

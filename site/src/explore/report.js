// A candidate report: enough for someone else to find the same images and check the claim.
import { flagNames, fluxAt } from "./frames.js";

export const mjdToUtc = (mjd) => new Date((mjd - 40587) * 86400000).toISOString().slice(0, 19) + "Z";

const round = (value, places) => (value === null || value === undefined ? null : Number(value.toFixed(places)));

export function buildReport({ grid, pin, frames, detector, opinion, note, pageUrl }) {
  const sorted = [...frames].sort((a, b) => a.mjdMid - b.mjdMid);
  return {
    report: "Sky Detective candidate report",
    status: "Unverified. One person's reading of the images, not a confirmed object or a discovery.",
    created_utc: new Date().toISOString().slice(0, 19) + "Z",
    position: { ra_deg: round(pin.ra, 5), dec_deg: round(pin.dec, 5), frame: "ICRS" },
    opinion,
    note: note.trim(),
    view: { center_ra_deg: round(grid.ra, 5), center_dec_deg: round(grid.dec, 5), field_deg: grid.fovDeg, detector: `D${detector}`, link: pageUrl },
    images: sorted.map((f) => ({
      obs_id: f.obsId,
      release: f.collection,
      utc: mjdToUtc(f.mjdMid),
      mjd: round(f.mjdMid, 6),
      wavelength_um: round(f.wavelengthOf(pin.ra, pin.dec), 4),
      brightness_mjy_sr_above_background: round(fluxAt(f, grid, pin.col, pin.row), 3),
      flags_at_position: flagNames(f.flagsHeader, f.flags[pin.row * grid.npix + pin.col]),
      source_file: f.url,
    })),
    data_credit: "SPHEREx data: NASA/JPL-Caltech, via NASA/IPAC Infrared Science Archive (IRSA).",
  };
}

export function saveReport(report) {
  const blob = new Blob([JSON.stringify(report, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const day = report.created_utc.slice(0, 10);
  link.download = `sky-detective-candidate-${report.position.ra_deg}_${report.position.dec_deg}-${day}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

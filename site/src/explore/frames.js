// Turns raw SPHEREx cutouts into aligned frames, and frames into what the explorer shows.
import { parseFits } from "./fits.js";
import { skyToPixel, wavelengthAt } from "./wcs.js";

// Pixels that aren't sky. SOURCE and OUTLIER stay, since they can sit on stars and on real movers.
const BAD_FLAGS = ["TRANSIENT", "OVERFLOW", "SUR_ERROR", "PHANTOM", "NONFUNC", "MISSING_DATA", "HOT", "COLD", "PERSIST"];
const SOFT = 8;
const GLOW_INNER_PX = 5; // SPHEREx pixels from the star
const GLOW_OUTER_PX = 10;

function badMask(flagsHeader) {
  return BAD_FLAGS.reduce((mask, name) => {
    const bit = flagsHeader[`MP_${name}`];
    return bit === undefined ? mask : mask | (1 << bit);
  }, 0);
}

export function flagNames(flagsHeader, value) {
  return Object.keys(flagsHeader)
    .filter((k) => k.startsWith("MP_") && value & (1 << flagsHeader[k]))
    .map((k) => k.slice(3));
}

function robustStats(values) {
  const sample = [];
  const step = Math.max(1, Math.floor(values.length / 20000));
  for (let i = 0; i < values.length; i += step) if (Number.isFinite(values[i])) sample.push(values[i]);
  if (!sample.length) return { median: 0, sigma: 1, high: 1 };
  sample.sort((a, b) => a - b);
  const median = sample[sample.length >> 1];
  const deviations = sample.map((v) => Math.abs(v - median)).sort((a, b) => a - b);
  return {
    median,
    sigma: 1.4826 * deviations[deviations.length >> 1] || 1,
    high: sample[Math.floor(sample.length * 0.998)],
  };
}

// Resamples one cutout onto the grid. Values become MJy/sr above the frame's own background.
export function alignCutout(buffer, exposure, grid) {
  const fits = parseFits(buffer);
  const { IMAGE, FLAGS, ZODI } = fits;
  const h = IMAGE.header;
  const w = h.NAXIS1;
  const rows = h.NAXIS2;
  const mask = badMask(FLAGS.header);
  const toPixel = skyToPixel(h);
  const n = grid.npix * grid.npix;
  const data = new Float32Array(n).fill(NaN);
  const flags = new Int32Array(n);
  let covered = 0;
  for (let i = 0; i < n; i++) {
    const [x, y] = toPixel(grid.sky[i * 2], grid.sky[i * 2 + 1]);
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= rows - 1) continue;
    const fx = x - x0;
    const fy = y - y0;
    let sum = 0;
    let weight = 0;
    let anyFlags = 0;
    for (const [px, py, share] of [
      [x0, y0, (1 - fx) * (1 - fy)], [x0 + 1, y0, fx * (1 - fy)],
      [x0, y0 + 1, (1 - fx) * fy], [x0 + 1, y0 + 1, fx * fy],
    ]) {
      const at = py * w + px;
      if (share > 0.25) anyFlags |= FLAGS.data[at];
      if (FLAGS.data[at] & mask) continue;
      const value = IMAGE.data[at] - (ZODI ? ZODI.data[at] : 0);
      if (Number.isFinite(value)) {
        sum += value * share;
        weight += share;
      }
    }
    flags[i] = anyFlags;
    covered++;
    if (weight > 0.5) data[i] = sum / weight;
  }
  const stats = robustStats(data);
  for (let i = 0; i < n; i++) data[i] -= stats.median;
  return {
    ...exposure,
    data,
    flags,
    flagsHeader: FLAGS.header,
    sigma: stats.sigma,
    high: stats.high - stats.median,
    coverage: covered / n,
    wavelengthOf: (ra, dec) => {
      const [x, y] = toPixel(ra, dec);
      return wavelengthAt(h, fits["WCS-WAVE"]?.table, x, y);
    },
    mjdMid: h["MJD-AVG"] || exposure.mjd,
  };
}

// Brightness at a grid position: mean within the aperture, in MJy/sr above the background.
export function fluxAt(frame, grid, col, row) {
  const radius = Math.max(1, Math.round((6.15 / 3600 / grid.scale) * 1.2));
  let sum = 0;
  let count = 0;
  for (let y = row - radius; y <= row + radius; y++) {
    for (let x = col - radius; x <= col + radius; x++) {
      if (x < 0 || y < 0 || x >= grid.npix || y >= grid.npix) continue;
      if ((x - col) ** 2 + (y - row) ** 2 > radius ** 2) continue;
      const value = frame.data[y * grid.npix + x];
      if (Number.isFinite(value)) {
        sum += value;
        count++;
      }
    }
  }
  return count ? sum / count : null;
}

// For a star so bright its core is saturated: the mean of its outer glow still follows its brightness.
export function glowAt(frame, grid, col, row) {
  const pixel = 6.15 / 3600 / grid.scale;
  const inner = (GLOW_INNER_PX * pixel) ** 2;
  const outer = (GLOW_OUTER_PX * pixel) ** 2;
  const reach = Math.ceil(GLOW_OUTER_PX * pixel);
  let sum = 0;
  let count = 0;
  for (let y = row - reach; y <= row + reach; y++) {
    for (let x = col - reach; x <= col + reach; x++) {
      if (x < 0 || y < 0 || x >= grid.npix || y >= grid.npix) continue;
      const d = (x - col) ** 2 + (y - row) ** 2;
      const value = frame.data[y * grid.npix + x];
      if (d >= inner && d <= outer && Number.isFinite(value)) {
        sum += value;
        count++;
      }
    }
  }
  return count ? sum / count : null;
}

function medianStack(frames, npix) {
  const n = npix * npix;
  const data = new Float32Array(n);
  const values = new Float32Array(frames.length);
  for (let i = 0; i < n; i++) {
    let count = 0;
    for (const f of frames) {
      const v = f.data[i];
      if (Number.isFinite(v)) values[count++] = v;
    }
    if (!count) {
      data[i] = NaN;
    } else {
      const sorted = values.subarray(0, count).sort();
      data[i] = sorted[count >> 1];
    }
  }
  return data;
}

function stackOf(frames, npix) {
  const data = medianStack(frames, npix);
  const stats = robustStats(data);
  return {
    data,
    sigma: stats.sigma,
    high: stats.high,
    mjdMid: frames[frames.length >> 1].mjdMid,
    mjdFirst: frames[0].mjdMid,
    mjdLast: frames[frames.length - 1].mjdMid,
    count: frames.length,
    stack: true,
  };
}

// Exposures closer in time than this belong to one visit: SPHEREx revisits a patch every six months.
const VISIT_GAP_DAYS = 30;

export function stackVisits(frames, npix) {
  const sorted = [...frames].sort((a, b) => a.mjdMid - b.mjdMid);
  const visits = [];
  for (const f of sorted) {
    const current = visits[visits.length - 1];
    if (current && f.mjdMid - current[current.length - 1].mjdMid < VISIT_GAP_DAYS) current.push(f);
    else visits.push([f]);
  }
  return visits.map((v) => stackOf(v, npix));
}

export const stackAll = (frames, npix) => stackOf([...frames].sort((a, b) => a.mjdMid - b.mjdMid), npix);

export function subtract(a, b, npix) {
  const n = npix * npix;
  const data = new Float32Array(n);
  for (let i = 0; i < n; i++) data[i] = a.data[i] - b.data[i];
  return { data, sigma: robustStats(data).sigma, difference: true };
}

export function toImage(frame, npix) {
  const pixels = new ImageData(npix, npix);
  const { data } = frame;
  const low = -2 * frame.sigma;
  const high = Math.max(frame.high, 20 * frame.sigma);
  const norm = Math.asinh(SOFT);
  for (let i = 0; i < data.length; i++) {
    const v = data[i];
    let shade = 0;
    if (Number.isFinite(v)) {
      if (frame.difference) {
        shade = Math.max(0, Math.min(255, 128 + (v / frame.sigma / 5) * 127));
      } else {
        const x = Math.max(0, Math.min(1, (v - low) / (high - low)));
        shade = (Math.asinh(SOFT * x) / norm) * 255;
      }
    }
    pixels.data[i * 4] = shade;
    pixels.data[i * 4 + 1] = shade;
    pixels.data[i * 4 + 2] = shade;
    pixels.data[i * 4 + 3] = 255;
  }
  return pixels;
}

// True if an exposure's footprint contains all four corners of the requested square.
export function coversField(region, ra, dec, halfDeg) {
  const nums = (region.match(/-?\d+\.?\d*(?:[eE][-+]?\d+)?/g) || []).map(Number);
  const cos = Math.cos((dec * Math.PI) / 180);
  const xs = [];
  const ys = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    xs.push((((nums[i] - ra + 540) % 360) - 180) * cos);
    ys.push(nums[i + 1] - dec);
  }
  const inside = (x, y) => {
    let hit = false;
    for (let i = 0, j = xs.length - 1; i < xs.length; j = i++) {
      if ((ys[i] > y) !== (ys[j] > y) && x < xs[i] + ((y - ys[i]) * (xs[j] - xs[i])) / (ys[j] - ys[i])) hit = !hit;
    }
    return hit;
  };
  return [-1, 1].every((sx) => [-1, 1].every((sy) => inside(sx * halfDeg, sy * halfDeg)));
}

// Picks up to `count` exposures, shared evenly between visits so that every visit gets a fair stack.
export function spreadInTime(exposures, count) {
  const sorted = [...exposures].sort((a, b) => a.mjd - b.mjd);
  if (sorted.length <= count) return sorted;
  const visits = [];
  for (const e of sorted) {
    const current = visits[visits.length - 1];
    if (current && e.mjd - current[current.length - 1].mjd < VISIT_GAP_DAYS) current.push(e);
    else visits.push([e]);
  }
  const chosen = [];
  for (let round = 0; chosen.length < count; round++) {
    for (const visit of visits) {
      // Walks each visit from its ends inward, so a visit's picks span its wavelengths.
      const at = round % 2 ? visit.length - 1 - (round >> 1) : round >> 1;
      if (round < visit.length && at >= 0 && at < visit.length && chosen.length < count) chosen.push(visit[at]);
    }
  }
  return chosen.sort((a, b) => a.mjd - b.mjd);
}

// "133.795" or "08h55m10.8s" or "08 55 10.8" or "08:55:10.8" for RA; same forms with d for Dec.
export function parseAngle(text, isRa) {
  const s = String(text).trim().toLowerCase();
  if (!s) return null;
  if (/^[-+]?\d*\.?\d+( ?(deg|°))?$/.test(s)) {
    const value = parseFloat(s);
    return (isRa ? value >= 0 && value < 360 : Math.abs(value) <= 90) ? value : null;
  }
  const m = s.match(/^([-+]?)(\d+(?:\.\d+)?)[hd°:\s]+(\d+(?:\.\d+)?)?[m'′:\s]*(\d+(?:\.\d+)?)?[s"″]?$/);
  if (!m) return null;
  const size = Number(m[2]) + Number(m[3] || 0) / 60 + Number(m[4] || 0) / 3600;
  const value = (m[1] === "-" ? -size : size) * (isRa ? 15 : 1);
  return (isRa ? value >= 0 && value < 360 : Math.abs(value) <= 90) ? value : null;
}

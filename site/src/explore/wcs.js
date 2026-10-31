// Sky <-> pixel maths for SPHEREx images (TAN projection with SIP distortion) and for the
// north-up grid every exposure is resampled onto.
const RAD = Math.PI / 180;

function sipTerms(header, prefix) {
  const terms = [];
  Object.keys(header).forEach((key) => {
    const m = key.match(new RegExp(`^${prefix}_(\\d+)_(\\d+)$`));
    if (m) terms.push({ p: Number(m[1]), q: Number(m[2]), c: header[key] });
  });
  return terms;
}

const applySip = (terms, u, v) => terms.reduce((sum, t) => sum + t.c * u ** t.p * v ** t.q, 0);

// Returns (ra, dec in degrees) => [x, y], zero-based pixels of this image.
export function skyToPixel(h) {
  const ra0 = h.CRVAL1 * RAD;
  const dec0 = h.CRVAL2 * RAD;
  const cd11 = h.PC1_1 * h.CDELT1;
  const cd12 = (h.PC1_2 || 0) * h.CDELT1;
  const cd21 = (h.PC2_1 || 0) * h.CDELT2;
  const cd22 = h.PC2_2 * h.CDELT2;
  const det = cd11 * cd22 - cd12 * cd21;
  const ap = sipTerms(h, "AP");
  const bp = sipTerms(h, "BP");
  return (ra, dec) => {
    const a = ra * RAD;
    const d = dec * RAD;
    const cosc = Math.sin(dec0) * Math.sin(d) + Math.cos(dec0) * Math.cos(d) * Math.cos(a - ra0);
    const xi = (Math.cos(d) * Math.sin(a - ra0)) / cosc / RAD;
    const eta = (Math.cos(dec0) * Math.sin(d) - Math.sin(dec0) * Math.cos(d) * Math.cos(a - ra0)) / cosc / RAD;
    const u = (cd22 * xi - cd12 * eta) / det;
    const v = (cd11 * eta - cd21 * xi) / det;
    return [h.CRPIX1 + u + applySip(ap, u, v) - 1, h.CRPIX2 + v + applySip(bp, u, v) - 1];
  };
}

// SPHEREx's wavelength depends on where a pixel sits on the detector.
export function wavelengthAt(h, t, x, y) {
  if (!t) return null;
  const locate = (axis, value) => {
    const last = axis.length - 2;
    let i = 0;
    while (i < last && value > axis[i + 1]) i++;
    return { i, f: (value - axis[i]) / (axis[i + 1] - axis[i]) };
  };
  const px = locate(t.x, h.CRVAL1W + h.CDELT1W * (x + 1 - h.CRPIX1W));
  const py = locate(t.y, h.CRVAL2W + h.CDELT2W * (y + 1 - h.CRPIX2W));
  const at = (ix, iy) => t.wavelength[iy * t.width + ix];
  const low = at(px.i, py.i) * (1 - px.f) + at(px.i + 1, py.i) * px.f;
  const high = at(px.i, py.i + 1) * (1 - px.f) + at(px.i + 1, py.i + 1) * px.f;
  return low * (1 - py.f) + high * py.f;
}

// A square, north-up, east-left view of the sky centred on (ra, dec). Row 0 is the top.
export function makeGrid(ra, dec, fovDeg, npix) {
  const scale = fovDeg / npix;
  const ra0 = ra * RAD;
  const dec0 = dec * RAD;
  const centre = (npix - 1) / 2;
  const toSky = (col, row) => {
    const xi = (centre - col) * scale * RAD;
    const eta = (centre - row) * scale * RAD;
    const denom = Math.cos(dec0) - eta * Math.sin(dec0);
    const a = ra0 + Math.atan2(xi, denom);
    const d = Math.atan2((Math.sin(dec0) + eta * Math.cos(dec0)) * Math.cos(a - ra0), denom);
    return [((a / RAD) + 360) % 360, d / RAD];
  };
  const fromSky = (r, d) => {
    const a = r * RAD;
    const de = d * RAD;
    const cosc = Math.sin(dec0) * Math.sin(de) + Math.cos(dec0) * Math.cos(de) * Math.cos(a - ra0);
    const xi = (Math.cos(de) * Math.sin(a - ra0)) / cosc / RAD;
    const eta = (Math.cos(dec0) * Math.sin(de) - Math.sin(dec0) * Math.cos(de) * Math.cos(a - ra0)) / cosc / RAD;
    return { x: centre - xi / scale, y: centre - eta / scale };
  };
  const sky = new Float64Array(npix * npix * 2);
  for (let row = 0; row < npix; row++) {
    for (let col = 0; col < npix; col++) {
      const [r, d] = toSky(col, row);
      sky[(row * npix + col) * 2] = r;
      sky[(row * npix + col) * 2 + 1] = d;
    }
  }
  return { ra, dec, fovDeg, npix, scale, sky, toSky, fromSky };
}

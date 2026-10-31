// Reads the parts of a SPHEREx cutout the explorer needs: IMAGE, FLAGS, ZODI and the
// WCS-WAVE table. Only what these files use: 2D images and that one fixed-layout table.
const BLOCK = 2880;

function readHeader(view, start) {
  const header = {};
  const bytes = new Uint8Array(view.buffer, view.byteOffset, view.byteLength);
  let at = start;
  for (;;) {
    for (let i = 0; i < BLOCK; i += 80) {
      const card = String.fromCharCode(...bytes.subarray(at + i, at + i + 80));
      const key = card.slice(0, 8).trim();
      if (key === "END") return { header, end: at + BLOCK };
      if (card[8] === "=") {
        const raw = card.slice(10);
        if (raw.trim().startsWith("'")) {
          header[key] = raw.split("'")[1].trim();
        } else {
          const value = raw.split("/")[0].trim();
          const num = Number(value);
          header[key] = value !== "" && Number.isFinite(num) ? num : value;
        }
      }
    }
    at += BLOCK;
  }
}

function readImage(view, at, h) {
  const n = h.NAXIS1 * h.NAXIS2;
  if (h.BITPIX === -32) {
    const data = new Float32Array(n);
    for (let i = 0; i < n; i++) data[i] = view.getFloat32(at + i * 4);
    return data;
  }
  if (h.BITPIX === 32) {
    const data = new Int32Array(n);
    for (let i = 0; i < n; i++) data[i] = view.getInt32(at + i * 4);
    return data;
  }
  throw new Error(`unexpected BITPIX ${h.BITPIX}`);
}

// One row: X and Y axes and VALUES (wavelength, bandwidth at each grid point). The grid's size
// differs between detectors, so it comes from the header.
function readWaveTable(view, at, h) {
  const nx = parseInt(h.TFORM1, 10);
  const ny = parseInt(h.TFORM2, 10);
  const x = Array.from({ length: nx }, (_, i) => view.getInt32(at + i * 4));
  const y = Array.from({ length: ny }, (_, i) => view.getInt32(at + (nx + i) * 4));
  const start = at + (nx + ny) * 4;
  const wavelength = Array.from({ length: nx * ny }, (_, i) => view.getFloat32(start + i * 8));
  return { x, y, wavelength, width: nx };
}

export function parseFits(buffer) {
  const view = new DataView(buffer);
  const hdus = {};
  let at = 0;
  while (at + BLOCK <= buffer.byteLength) {
    const { header, end } = readHeader(view, at);
    let bytes = 0;
    if (header.NAXIS > 0) {
      bytes = Math.abs(header.BITPIX) / 8;
      for (let n = 1; n <= header.NAXIS; n++) bytes *= header[`NAXIS${n}`];
    }
    bytes += header.PCOUNT || 0;
    const name = header.EXTNAME || "PRIMARY";
    if (name === "IMAGE" || name === "FLAGS" || name === "ZODI") {
      hdus[name] = { header, data: readImage(view, end, header) };
    } else if (name === "WCS-WAVE") {
      hdus[name] = { header, table: readWaveTable(view, end, header) };
    }
    at = end + Math.ceil(bytes / BLOCK) * BLOCK;
  }
  if (!hdus.IMAGE || !hdus.FLAGS) throw new Error("cutout is missing IMAGE or FLAGS");
  return hdus;
}

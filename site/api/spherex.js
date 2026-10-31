// Passes SPHEREx data from NASA/IPAC IRSA to the browser, which IRSA doesn't allow directly.
//   ?op=search&ra&dec                 exposures that contain a position, from every Quick Release
//   ?op=cutout&url&ra&dec&size        one FITS cutout, without the large PSF table
//   ?op=catalog&cat&ra&dec&radius     Gaia or WISE sources in a circle
const IRSA = "https://irsa.ipac.caltech.edu";
const DATA_PREFIX = `${IRSA}/ibe/data/spherex/`;
// New Quick Releases show up by themselves: a collection that doesn't exist yet returns no rows.
const COLLECTIONS = ["spherex_qr2", "spherex_qr3", "spherex_qr4", "spherex_qr5", "spherex_qr6"];
const CATALOGS = {
  gaia: { table: "gaia_dr3_source", mag: "phot_g_mean_mag", faintest: 15 },
  wise: { table: "allwise_p3as_psd", mag: "w1mpro", faintest: 13 },
};
const DROPPED_HDUS = ["PSF", "EPSF", "VARIANCE"]; // the PSF table alone is about 5 MB per cutout
const MAX_CUTOUT_DEG = 1.5;
const MAX_CATALOG_ROWS = 1500;
const BUDGET_MS = 55000;
const BLOCK = 2880;
const YEAR = 31536000;

const json = (body, status = 200, cache = 0) => new Response(JSON.stringify(body), {
  status,
  headers: {
    "content-type": "application/json",
    "cache-control": cache ? `public, s-maxage=${cache}` : "no-store",
  },
});

async function fetchWithRetry(url, accept) {
  const deadline = Date.now() + BUDGET_MS;
  let lastError = new Error("no attempt made");
  while (Date.now() < deadline - 2000) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(deadline - Date.now()) });
      if (r.ok) {
        const buffer = Buffer.from(await r.arrayBuffer());
        if (accept(buffer)) return buffer;
        lastError = new Error("unexpected response from IRSA");
      } else {
        lastError = new Error(`IRSA returned ${r.status}`);
      }
    } catch (e) {
      lastError = e;
    }
    await new Promise((done) => setTimeout(done, 1000));
  }
  throw lastError;
}

function parseExposures(xml, collection) {
  const fields = [...xml.matchAll(/<FIELD\b[^>]*?\bname="([^"]+)"/g)].map((m) => m[1]);
  const at = (name) => fields.indexOf(name);
  return [...xml.matchAll(/<TR>(.*?)<\/TR>/gs)]
    .map((row) => [...row[1].matchAll(/<TD[^>]*>(.*?)<\/TD>/gs)].map((m) => m[1]))
    .filter((c) => c[at("dataproduct_subtype")] === "science")
    .map((c) => ({
      obsId: c[at("obs_id")],
      detector: Number(c[at("energy_bandpassname")].slice(-1)),
      mjd: Number(c[at("t_min")]),
      url: c[at("access_url")],
      region: c[at("s_region")],
      collection,
    }));
}

async function search(ra, dec) {
  const results = await Promise.allSettled(COLLECTIONS.map(async (collection) => {
    const pos = encodeURIComponent(`circle ${ra} ${dec} 0.01`);
    const url = `${IRSA}/SIA?COLLECTION=${collection}&POS=${pos}&RESPONSEFORMAT=VOTABLE`;
    const buffer = await fetchWithRetry(url, (b) => b.includes("<VOTABLE"));
    return parseExposures(buffer.toString("utf8"), collection);
  }));
  const seen = new Set();
  const exposures = [];
  results.flatMap((r) => (r.status === "fulfilled" ? r.value : [])).forEach((row) => {
    const key = `${row.obsId}/${row.detector}`;
    if (!seen.has(key)) {
      seen.add(key);
      exposures.push(row);
    }
  });
  const failed = COLLECTIONS.filter((_, i) => results[i].status === "rejected");
  if (failed.length === COLLECTIONS.length) throw new Error("IRSA search failed");
  return json({ exposures, failed }, 200, failed.length ? 0 : 86400);
}

function dropPsf(fitsFile) {
  const kept = [];
  let at = 0;
  while (at < fitsFile.length) {
    const cards = {};
    let end = at;
    let finished = false;
    while (!finished) {
      for (let i = 0; i < BLOCK; i += 80) {
        const card = fitsFile.toString("latin1", end + i, end + i + 80);
        const key = card.slice(0, 8).trim();
        if (key === "END") finished = true;
        else if (card[8] === "=") cards[key] = card.slice(10).split("/")[0].trim().replace(/'/g, "").trim();
      }
      end += BLOCK;
    }
    let bytes = Math.abs(Number(cards.BITPIX)) / 8;
    for (let n = 1; n <= Number(cards.NAXIS); n++) bytes *= Number(cards[`NAXIS${n}`]);
    if (!Number(cards.NAXIS)) bytes = 0;
    bytes += Number(cards.PCOUNT || 0);
    const next = end + Math.ceil(bytes / BLOCK) * BLOCK;
    if (!DROPPED_HDUS.includes(cards.EXTNAME)) kept.push(fitsFile.subarray(at, next));
    at = next;
  }
  return Buffer.concat(kept);
}

async function cutout(url, ra, dec, size) {
  if (!url?.startsWith(DATA_PREFIX) || !url.endsWith(".fits")) return json({ error: "not a SPHEREx file" }, 400);
  if (!(size > 0 && size <= MAX_CUTOUT_DEG)) return json({ error: "bad size" }, 400);
  const source = `${url}?center=${ra},${dec}&size=${size}`;
  const buffer = await fetchWithRetry(source, (b) => b.toString("latin1", 0, 6) === "SIMPLE");
  return new Response(dropPsf(buffer), {
    headers: { "content-type": "application/fits", "cache-control": `public, s-maxage=${YEAR}` },
  });
}

async function catalog(name, ra, dec, radius) {
  const cat = CATALOGS[name];
  if (!cat) return json({ error: "unknown catalog" }, 400);
  if (!(radius > 0 && radius <= MAX_CUTOUT_DEG)) return json({ error: "bad radius" }, 400);
  const adql = `SELECT TOP ${MAX_CATALOG_ROWS} ra,dec,${cat.mag} FROM ${cat.table} `
    + `WHERE CONTAINS(POINT('ICRS',ra,dec),CIRCLE('ICRS',${ra},${dec},${radius}))=1 AND ${cat.mag}<${cat.faintest}`;
  const url = `${IRSA}/TAP/sync?QUERY=${encodeURIComponent(adql)}&FORMAT=CSV`;
  const buffer = await fetchWithRetry(url, (b) => b.toString("latin1", 0, 2) === "ra");
  const sources = buffer.toString("utf8").trim().split("\n").slice(1).map((line) => {
    const [r, d, m] = line.split(",").map(Number);
    return { ra: r, dec: d, mag: m };
  });
  return json({ sources }, 200, YEAR);
}

export async function GET(request) {
  const q = new URL(request.url).searchParams;
  const ra = Number(q.get("ra"));
  const dec = Number(q.get("dec"));
  if (!q.get("ra") || !q.get("dec") || !(ra >= 0 && ra < 360 && dec >= -90 && dec <= 90)) {
    return json({ error: "bad coordinates" }, 400);
  }
  try {
    if (q.get("op") === "search") return await search(ra, dec);
    if (q.get("op") === "cutout") return await cutout(q.get("url"), ra, dec, Number(q.get("size")));
    if (q.get("op") === "catalog") return await catalog(q.get("cat"), ra, dec, Number(q.get("radius")));
    return json({ error: "unknown op" }, 400);
  } catch (e) {
    return json({ error: String(e.message || e) }, 502);
  }
}

// Talks to our /api/spherex route.
import { alignCutout } from "./frames.js";

const ATTEMPTS = 3;
const API = `${import.meta.env.BASE_URL}api/spherex`;

async function request(params) {
  let lastError;
  for (let i = 0; i < ATTEMPTS; i++) {
    try {
      const r = await fetch(`${API}?${new URLSearchParams(params)}`);
      if (r.ok) return r;
      lastError = new Error(`status ${r.status}`);
    } catch (e) {
      lastError = e;
    }
  }
  throw lastError;
}

export async function searchExposures(ra, dec) {
  return (await request({ op: "search", ra, dec })).json();
}

export async function loadFrame(exposure, grid, sizeDeg) {
  const r = await request({ op: "cutout", url: exposure.url, ra: grid.ra, dec: grid.dec, size: sizeDeg.toFixed(4) });
  return alignCutout(await r.arrayBuffer(), exposure, grid);
}

export async function loadCatalog(cat, ra, dec, radius) {
  const { sources } = await (await request({ op: "catalog", cat, ra, dec, radius: radius.toFixed(3) })).json();
  return sources;
}

// Runs jobs a few at a time. A failed job is skipped, and onFail lets the caller count it.
export async function runQueue(items, limit, job, isCancelled, onFail) {
  let next = 0;
  const worker = async () => {
    while (next < items.length && !isCancelled()) {
      const item = items[next++];
      try {
        await job(item);
      } catch {
        onFail();
      }
    }
  };
  await Promise.all(Array.from({ length: limit }, worker));
}

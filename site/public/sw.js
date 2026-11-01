// Keeps the case file playable without internet. Fresh files are used whenever the
// network answers; the saved copies are only the fallback. The Explorer's /api stays online-only.
const CACHE = "sky-detective-v1";
const NETWORK_WAIT_MS = 5000;

async function saveAll(cache, urls) {
  await Promise.allSettled(urls.map(async (url) => {
    const response = await fetch(url, { cache: "no-cache" });
    if (response.ok) await cache.put(url, response);
  }));
}

async function saveCaseFile() {
  const cache = await caches.open(CACHE);
  const page = await fetch("/", { cache: "no-cache" });
  if (!page.ok) return;
  const html = await page.clone().text();
  await cache.put("/", page);

  // The page names its current code files. Older versions of them are removed.
  const code = [...html.matchAll(/(?:src|href)="(\/assets\/[^"]+)"/g)].map((m) => m[1]);
  await saveAll(cache, code);
  for (const request of await cache.keys()) {
    const path = new URL(request.url).pathname;
    if (path.startsWith("/assets/") && !code.includes(path)) await cache.delete(request);
  }

  const indexResponse = await fetch("/levels/index.json", { cache: "no-cache" });
  if (!indexResponse.ok) return;
  const { rounds } = await indexResponse.clone().json();
  await cache.put("/levels/index.json", indexResponse);

  for (const folder of new Set(rounds.map((r) => r.folder))) {
    const dir = `/levels/${folder}/`;
    const levelResponse = await fetch(`${dir}level.json`, { cache: "no-cache" });
    if (!levelResponse.ok) continue;
    const level = await levelResponse.clone().json();
    await cache.put(`${dir}level.json`, levelResponse);
    const files = [`${dir}frame_a.png`, `${dir}frame_b.png`, `${dir}diff.png`];
    for (const object of level.objects) {
      if (object.number && level.movers.includes(object.name)) files.push(`/objects/${object.number}.json`);
    }
    await saveAll(cache, files);
  }
}

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name !== CACHE) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

// The page asks for this once it has finished loading, so saving never slows the first visit.
self.addEventListener("message", (event) => {
  if (event.data === "save-case-file") event.waitUntil(saveCaseFile().catch(() => {}));
});

async function networkFirst(request, fallbackKey) {
  const cache = await caches.open(CACHE);
  const network = fetch(request);
  const saved = network.then(async (response) => {
    if (response.ok) await cache.put(fallbackKey, response.clone());
    return response;
  });
  saved.catch(() => {});

  const slow = new Promise((resolve) => setTimeout(resolve, NETWORK_WAIT_MS, "slow"));
  try {
    const first = await Promise.race([saved, slow]);
    if (first !== "slow") return first;
    return (await cache.match(fallbackKey)) ?? (await saved);
  } catch (error) {
    const copy = await cache.match(fallbackKey);
    if (copy) return copy;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;
  // Every page address, with or without ?test=1 or ?lang=hi, is the same saved page.
  const key = event.request.mode === "navigate" ? "/" : url.pathname;
  event.respondWith(networkFirst(event.request, key));
});

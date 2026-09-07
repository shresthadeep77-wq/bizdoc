// Service worker — makes the app open with no internet.
//
// It has to be a real file: a worker registered from a blob: URL is rejected by
// the browser, which is why offline mode silently never worked before.
//
// Strategy: network-first for the page itself, so a new deploy is picked up on
// the next online visit; cache-first for everything else.
const CACHE = "pipo-v3";
const APP = "./";

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => c.add(APP)).catch(() => {}));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET" || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(APP, copy)); return res; })
        .catch(() => caches.match(APP).then(hit => hit || caches.match(req)))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
      return res;
    }))
  );
});

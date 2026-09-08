// Service worker — makes the app open with no internet.
//
// It has to be a real file: a worker registered from a blob: URL is rejected by
// the browser, which is why offline mode silently never worked before.
//
// Strategy: network-first for pages, so a new deploy is picked up on the next
// online visit; cache-first for everything else.
const CACHE = "pipo-v4";
const APP = "./";

// Fetched during install so the first offline visit already has them. The two
// PDF libraries are the important ones: they are no longer inlined in
// index.html, and without them here an export would fail the first time someone
// tried it offline. The guide pages are small and cheap to keep.
const PRECACHE = [
  "./",
  "./lib/html2canvas.js",
  "./lib/jspdf.js",
  "./assets/icon-192.png",
  "./assets/apple-touch-icon.png",
  "./manifest.webmanifest",
  "./icon.svg",
  "./favicon.ico",
  "./documents/",
  "./customers/",
  "./products/",
  "./offline/",
  "./privacy/",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  // Added one at a time, not with addAll: addAll rejects as a whole if any
  // single request fails, which would leave the app with no cache at all
  // because one icon 404'd.
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      Promise.all(PRECACHE.map((url) => c.add(url).catch(() => {})))
    ).catch(() => {})
  );
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
        .then(res => {
          // Only cache a real page. A 404 response is still a response, and
          // storing it under the app's own URL would serve the not-found page
          // to everyone offline afterwards.
          if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); }
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match(APP)))
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {}); }
      return res;
    }))
  );
});

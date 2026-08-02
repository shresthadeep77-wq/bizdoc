// PWA: inline manifest + service worker (no separate files) so the app can be
// "Add to Home Screen" installed and run fullscreen. Only active over http(s).
(function(){
  try {
    const icon = "data:image/svg+xml," + encodeURIComponent(
      "<svg xmlns='http://www.w3.org/2000/svg' width='512' height='512'><rect width='512' height='512' rx='96' fill='#1F4E79'/><text x='50%' y='54%' font-family='Segoe UI,Arial' font-size='210' font-weight='700' fill='#fff' text-anchor='middle' dominant-baseline='middle'>PI</text></svg>");
    const manifest = {
      name: "PI & PO Maker", short_name: "PI/PO", start_url: ".", scope: ".",
      display: "standalone", background_color: "#e9edf3", theme_color: "#1F4E79",
      icons: [{ src: icon, sizes: "512x512", type: "image/svg+xml", purpose: "any maskable" }]
    };
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = URL.createObjectURL(new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" }));
    document.head.appendChild(link);
    const aicon = document.createElement("link");
    aicon.rel = "apple-touch-icon"; aicon.href = icon; document.head.appendChild(aicon);

    if ("serviceWorker" in navigator && location.protocol.startsWith("http")) {
      const here = location.pathname;
      const sw = 'const C="pipo-v2";const APP=' + JSON.stringify(here) + ';'
        + 'self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.add(APP).catch(()=>{})));});'
        + 'self.addEventListener("activate",e=>e.waitUntil(self.clients.claim()));'
        + 'self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;'
        // Navigations (opening the app) → serve cached page when offline.
        + 'if(e.request.mode==="navigate"){e.respondWith(fetch(e.request).then(r=>{caches.open(C).then(c=>c.put(APP,r.clone()));return r;}).catch(()=>caches.match(APP).then(h=>h||caches.match(e.request))));return;}'
        // Everything else → cache-first, fall back to network.
        + 'e.respondWith(caches.open(C).then(c=>c.match(e.request).then(h=>'
        + 'h||fetch(e.request).then(r=>{try{c.put(e.request,r.clone());}catch(_){ }return r;}).catch(()=>h))));});';
      const swUrl = URL.createObjectURL(new Blob([sw], { type: "text/javascript" }));
      navigator.serviceWorker.register(swUrl).catch(()=>{});
      // Also cache this exact page now, so it's available offline even before
      // the SW's install cache completes.
      if ("caches" in window) {
        caches.open("pipo-v2").then(c => c.add(location.href).catch(()=>{})).catch(()=>{});
      }
    }
  } catch(e) { /* best-effort */ }
})();

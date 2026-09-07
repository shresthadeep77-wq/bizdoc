// PWA wiring — lets the app be installed to the home screen and opened with no
// internet. Only runs over http(s); from a file:// path the browser refuses
// both a manifest and a service worker, and the single index.html already works
// offline on its own there.
//
// manifest.webmanifest, sw.js and icon.svg sit next to index.html. They used to
// be generated in-page as blob: URLs, which looked tidier but never actually
// worked: the browser rejects a service worker script served from blob:, so the
// app was silently never cached.
(function () {
  try {
    if (!location.protocol.startsWith("http")) return;

    const add = (rel, href) => {
      const l = document.createElement("link");
      l.rel = rel; l.href = href;
      document.head.appendChild(l);
    };
    add("manifest", "manifest.webmanifest");
    add("apple-touch-icon", "icon.svg");

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch((e) => {
          console.warn("Offline mode unavailable:", e.message);
        });
      });
    }
  } catch (e) { /* best-effort — never block the app from starting */ }
})();

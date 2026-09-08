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

    // Only the manifest is added here. The icons are declared statically in the
    // page <head>, including a real PNG apple-touch-icon — iOS ignores an SVG
    // one, so pointing this at icon.svg only ever added a second, useless link.
    const link = document.createElement("link");
    link.rel = "manifest";
    link.href = "manifest.webmanifest";
    document.head.appendChild(link);

    if ("serviceWorker" in navigator) {
      window.addEventListener("load", () => {
        navigator.serviceWorker.register("sw.js").catch((e) => {
          console.warn("Offline mode unavailable:", e.message);
        });
      });
    }
  } catch (e) { /* best-effort — never block the app from starting */ }
})();

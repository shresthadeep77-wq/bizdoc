// ==================== PDF LIBRARIES, LOADED ON DEMAND ====================
// html2canvas and jsPDF together are about 550 KB — more than the entire rest
// of the app. They are only ever touched when someone exports a PDF or a PNG,
// which most visits never do, so the build leaves them out of index.html and
// writes them to lib/ instead. This fetches them the first time they are
// actually needed.
//
// The service worker caches them alongside the page, so the second export works
// with no connection. `node build.js --single` inlines them instead, in which
// case both globals already exist and this resolves immediately.

let _pdfLibsPromise = null;

const pdfLibsReady = () => !!(window.html2canvas && window.jspdf && window.jspdf.jsPDF);

const loadScriptOnce = (src) => new Promise((resolve, reject) => {
  const s = document.createElement("script");
  s.src = src;
  s.async = false; // keep execution order predictable if two are queued
  s.onload = () => resolve();
  s.onerror = () => reject(new Error("Could not load " + src));
  document.head.appendChild(s);
});

// Resolve to true when both libraries are usable, false when they could not be
// fetched. Callers show their own message on false — a failed export should say
// so in place rather than throwing into the console.
const ensurePdfLibs = async () => {
  if (pdfLibsReady()) return true;
  if (!_pdfLibsPromise) {
    _pdfLibsPromise = (async () => {
      // html2canvas first: jsPDF is the larger file, and starting it second
      // still overlaps both downloads because async=false only orders execution.
      await Promise.all([
        loadScriptOnce("lib/html2canvas.js"),
        loadScriptOnce("lib/jspdf.js"),
      ]);
      if (!pdfLibsReady()) throw new Error("PDF libraries loaded but did not register");
    })();
    // A failed attempt must not poison every later one — clear the cached
    // promise so the next export retries (the user may just have been offline).
    _pdfLibsPromise.catch(() => { _pdfLibsPromise = null; });
  }
  try {
    await _pdfLibsPromise;
    return true;
  } catch (e) {
    toast(
      navigator.onLine
        ? "Couldn't load the PDF export tools. Try again."
        : "PDF export needs to download once while online. Connect and try again.",
      "err", 6000
    );
    return false;
  }
};

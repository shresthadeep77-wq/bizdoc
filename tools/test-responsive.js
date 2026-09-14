#!/usr/bin/env node
/**
 * Checks the app's screens at real device widths, in a real browser.
 *
 *   node tools/test-responsive.js
 *
 * What it is looking for is the one thing that makes a page feel broken on a
 * phone and cannot be seen from the source: content wider than the screen, so
 * the whole page scrolls sideways. It also checks that tap targets are big
 * enough to hit with a thumb, and that every form field has a label.
 *
 * Uses headless Edge/Chrome, same as tools/make-assets.js. Skips if neither is
 * installed rather than failing.
 */
const fs = require("fs");
const path = require("path");
const os = require("os");
const http = require("http");
const { spawn } = require("child_process");

const ROOT = path.join(__dirname, "..");
const BROWSERS = [
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];
const browser = BROWSERS.find((b) => fs.existsSync(b));
if (!browser) {
  console.log("Skipped: no Edge/Chrome found (this test needs a real browser to lay the page out).");
  process.exit(0);
}

// Widths that matter: a small Android phone, a normal phone, a tablet, a laptop.
const WIDTHS = [320, 390, 768, 1280];

const PROBE = `
<script>
(async () => {
  // The harness loads this page inside an iframe of an exact width, because a
  // desktop browser window cannot be made as narrow as a phone — Windows has a
  // minimum window width of around 490px. Inside an iframe the viewport, and
  // therefore every CSS media query, is whatever we say it is.
  if (window === window.top) return;
  const results = [];
  const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
  const check = (name, ok, detail) => results.push({ name: name, ok: !!ok, detail: detail || "" });

  // Anything the app complains about while every screen is being opened. A
  // console full of errors is how a real bug usually announces itself first.
  const complaints = [];
  const realError = console.error;
  console.error = function () {
    complaints.push(Array.prototype.slice.call(arguments).map(String).join(" ").slice(0, 160));
    realError.apply(console, arguments);
  };
  window.addEventListener("error", (e) => complaints.push("uncaught: " + (e.message || "")));
  window.addEventListener("unhandledrejection", (e) => complaints.push("unhandled promise: " + String((e.reason && e.reason.message) || e.reason)));

  const seed = () => {
    const biz = {
      id: 1, name: "Deep Jyoti Plastic Udyog Pvt. Ltd.", address1: "Birgunj, Parsa",
      phone: "051-520000", pan: "301234567", currency: "NPR", taxRate: 13,
      units: ["pcs"], banks: [], signatory: "Authorised Signatory"
    };
    const cust = {
      id: 1001, businessId: 1,
      companyName: "Sunrise Hardware & Construction Suppliers Private Limited",
      contactName: "Ram Bahadur", addr1: "Kathmandu", phone: "9801234567",
      vatNo: "609876543", discountRules: []
    };
    const products = [];
    for (let i = 0; i < 12; i++) {
      products.push({
        id: i + 1, businessId: 1, description: "PVC pipe 110mm class 2 heavy duty pressure rated " + i,
        unit: "pcs", rate: 1250.5, weight: 2.4, taxable: true, category: "PVC", partNumber: "PVC-110-" + i
      });
    }
    const documents = [];
    for (let i = 0; i < 6; i++) {
      const d = {
        id: i + 1, businessId: 1, customerId: 1001, type: ["PI", "PO", "QT", "INV", "DN"][i % 5],
        number: "DOC-2082-000" + i, date: "2026-09-14", currency: "NPR", status: "Draft",
        lineItems: [{ description: "PVC pipe 110mm class 2 heavy duty", unit: "pcs", qty: 12, rate: 1250.5, taxable: true }],
        shipping: {}, additional: {},
        totals: { taxRate: 13, delivery: 0, freight: 0, insurance: 0, legal: 0, inspection: 0, other1: 0, other2: 0 }
      };
      computeTotals(d);
      documents.push(d);
    }
    replaceDB({ businesses: [biz], activeBusinessId: 1, customers: [cust], products: products, documents: documents });
  };

  try {
    seed();
    const width = window.innerWidth;
    const tabs = ["dashboard", "customers", "products", "documents"];

    tabs.forEach(function (tab) {
      currentTab = tab;
      render();
      const overflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
      check(width + "px \\u00b7 " + tab + " does not scroll sideways", overflow <= 1,
        overflow > 1 ? overflow + "px wider than the screen" : "");

      // Name the widest offender, so a failure is actionable.
      if (overflow > 1) {
        let worst = null;
        document.querySelectorAll("#app *").forEach(function (n) {
          const r = n.getBoundingClientRect();
          if (r.right > width + 1 && (!worst || r.right > worst.right)) {
            worst = { right: r.right, tag: n.tagName.toLowerCase() + "." + (n.className || "").toString().split(" ")[0] };
          }
        });
        if (worst) results[results.length - 1].detail += " \\u2014 widest: " + worst.tag + " reaching " + Math.round(worst.right) + "px";
      }
    });

    // Tap targets. 24px is the WCAG 2.2 minimum; anything under that is a
    // genuine miss-and-hit-the-wrong-thing problem on a phone.
    if (width <= 480) {
      currentTab = "documents";
      render();
      const small = [];
      document.querySelectorAll("#app button, #app a[href]").forEach(function (b) {
        const r = b.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // not on screen
        if (r.height < 24 || r.width < 24) small.push((b.textContent || b.className || "button").trim().slice(0, 24) + " " + Math.round(r.width) + "x" + Math.round(r.height));
      });
      check(width + "px \\u00b7 every button is big enough to tap", small.length === 0, small.slice(0, 5).join(" | "));
    }

    // The document builder and the preview are the busiest screens in the app
    // and the likeliest to burst out of a phone. Open them for real.
    currentTab = "documents";
    render();
    startNewDoc("INV");
    openDocBuilder();
    const builderOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    check(width + "px · the new-document screen does not scroll sideways", builderOverflow <= 1,
      builderOverflow > 1 ? builderOverflow + "px wider than the screen" : "");
    check(width + "px · the new-document screen actually opened", !!document.querySelector(".builder-shell"), "");
    closeModal();

    openDocPreview(db.documents[0]);
    await nextFrame();
    await nextFrame();
    const previewOverflow = document.documentElement.scrollWidth - document.documentElement.clientWidth;
    check(width + "px · the document preview does not scroll sideways", previewOverflow <= 1,
      previewOverflow > 1 ? previewOverflow + "px wider than the screen" : "");
    // The A4 page is fixed at 794px and is scaled down to fit; if the scaling
    // stops working the page hangs off the side of a phone.
    const pv = document.querySelector(".pv-page");
    check(width + "px · the A4 page is scaled to fit the screen",
      !pv || pv.getBoundingClientRect().width <= width + 1,
      pv ? Math.round(pv.getBoundingClientRect().width) + "px wide on a " + width + "px screen" : "no page rendered");
    closeModal();

    // Every input a user types into needs a name a screen reader can read out.
    currentTab = "customers";
    render();
    openCustomerModal(null);
    const topModal = Array.prototype.slice.call(document.querySelectorAll(".modal")).pop();
    const unlabelled = [];
    topModal.querySelectorAll("input, select, textarea").forEach(function (i) {
      if (i.type === "hidden" || i.type === "checkbox" || i.type === "radio") return;
      const hasAria = i.getAttribute("aria-label") || i.getAttribute("aria-labelledby");
      const id = i.getAttribute("id");
      const hasFor = id && document.querySelector('label[for="' + id + '"]');
      const wrapped = i.closest("label");
      const fieldLabel = i.closest(".field") && i.closest(".field").querySelector("label");
      if (!hasAria && !hasFor && !wrapped && !fieldLabel) {
        unlabelled.push((i.getAttribute("placeholder") || i.name || (i.previousElementSibling && i.previousElementSibling.textContent) || i.type || "input").slice(0, 40));
      }
    });
    check(width + "px \\u00b7 every field in the customer form has a label", unlabelled.length === 0, unlabelled.slice(0, 5).join(", "));
    closeModal();
  } catch (e) {
    check(window.innerWidth + "px \\u00b7 the app renders without throwing", false, (e && e.message) || String(e));
  }

  // The Google sign-in script is fetched from the network on demand and cannot
  // be reached from a test server; nothing else is allowed to complain.
  const real = complaints.filter((c) => !/accounts\\.google\\.com|gsi\\/client/i.test(c));
  check(window.innerWidth + "px \\u00b7 nothing is logged to the console", real.length === 0, real.slice(0, 3).join(" | "));

  fetch("/__results", { method: "POST", body: JSON.stringify(results) });
})();
</script>
`;

const built = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
// The probe goes before the *last* </body>: the first one in the file is inside
// a JavaScript string (printDoc writes a document into the print window).
const closeBody = built.lastIndexOf("</body>");
const probePage = built.slice(0, closeBody) + PROBE + built.slice(closeBody);

// A page whose only job is to hold the app in an iframe of an exact width.
const harness = (width) => `<!doctype html><meta charset="utf-8">
<style>html,body{margin:0;padding:0}iframe{border:0;display:block}</style>
<iframe src="/probe.html" width="${width}" height="900"></iframe>`;

const runAt = (width) =>
  new Promise((resolve, reject) => {
    let done;
    const got = new Promise((res) => { done = res; });
    const server = http.createServer((req, res) => {
      const url = req.url.split("?")[0];
      if (req.method === "POST" && url === "/__results") {
        let body = "";
        req.on("data", (c) => { body += c; });
        req.on("end", () => { res.writeHead(204).end(); done(JSON.parse(body)); });
        return;
      }
      if (url === "/sw.js") { res.writeHead(404).end(); return; }
      if (url === "/" || url === "/harness.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(harness(width));
        return;
      }
      if (url === "/probe.html") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(probePage);
        return;
      }
      const file = path.join(ROOT, url.replace(/^\/+/, ""));
      if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) {
        res.writeHead(200).end(fs.readFileSync(file));
        return;
      }
      res.writeHead(404).end();
    });

    server.listen(0, "127.0.0.1", () => {
      const port = server.address().port;
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bizdoc-rwd-"));
      const child = spawn(browser, [
        "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
        "--hide-scrollbars", "--force-device-scale-factor=1",
        "--user-data-dir=" + path.join(tmp, "profile"),
        "--window-size=1600,1000",
        "http://127.0.0.1:" + port + "/harness.html",
      ], { stdio: "ignore" });

      const timer = setTimeout(() => reject(new Error("timed out at " + width + "px")), 60000);
      got.then((r) => {
        clearTimeout(timer);
        child.kill();
        server.close();
        try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* the browser still has it */ }
        resolve(r);
      });
    });
  });

(async () => {
  let all = [];
  for (const w of WIDTHS) all = all.concat(await runAt(w));
  const failed = all.filter((r) => !r.ok);
  failed.forEach((r) => console.error("  \u2717 " + r.name + (r.detail ? " \u2014 " + r.detail : "")));
  if (failed.length) {
    console.error("\n" + failed.length + " of " + all.length + " responsive checks FAILED.");
    process.exit(1);
  }
  console.log("All " + all.length + " responsive checks passed at " + WIDTHS.join("px, ") + "px.");
})().catch((e) => {
  console.error("Responsive test could not run: " + e.message);
  process.exit(1);
});

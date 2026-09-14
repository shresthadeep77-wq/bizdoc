#!/usr/bin/env node
/**
 * End-to-end check of the printed document, in a real browser.
 *
 *   node tools/test-document.js
 *
 * These are the things that only go wrong once a browser has actually laid the
 * page out: rows falling off the bottom of an A4 page (.pv-page is
 * overflow:hidden, so they vanish silently rather than erroring), a money
 * column that no longer adds up to the totals beside it, page numbering.
 *
 * Uses headless Edge/Chrome, same as tools/make-assets.js — nothing to install.
 * If neither is present the test skips rather than failing.
 */
const { execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

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

/* Appended to a copy of the built index.html. It runs after the app has booted,
   so it can call the app's own functions by name — they share one script scope. */
const PROBE = `
<script>
(() => {
  const results = [];
  const check = (name, ok, detail) => results.push({ name, ok: !!ok, detail: detail || "" });
  const money = (s) => Number(String(s).replace(/[^0-9.-]/g, "")) || 0;

  try {
    const biz = {
      id: 1, name: "\u0926\u0940\u092a \u091c\u094d\u092f\u094b\u0924\u093f Plastic Udyog Pvt. Ltd.",
      address1: "Birgunj, Parsa", phone: "051-520000", pan: "301234567",
      currency: "NPR", taxRate: 13, units: ["pcs"], banks: [], signatory: "Authorised Signatory"
    };
    const cust = {
      id: 1001, businessId: 1,
      companyName: "A Very Long Customer Company Name Private Limited Nepal",
      contactName: "\u0930\u093e\u092e \u092c\u0939\u093e\u0926\u0941\u0930 \u0936\u094d\u0930\u0947\u0937\u094d\u0920",
      addr1: "Kathmandu", phone: "9801234567", vatNo: "609876543", discountRules: []
    };
    // 40 lines, deliberately awkward: descriptions long enough to wrap over
    // several lines, Nepali text, an unbroken SKU, decimal quantities, and
    // rates that already include VAT.
    const lineItems = [];
    for (let i = 0; i < 40; i++) {
      lineItems.push({
        description: i % 3 === 0
          ? "Extra heavy duty reinforced polypropylene woven sack with UV stabiliser, laminated inner liner and printed four-colour branding, size 60cm x 100cm \u2014 \u092c\u094b\u0930\u093e " + i
          : (i % 3 === 1 ? "SKU-" + "X".repeat(48) + "-" + i : "Plain item " + i),
        unit: "pcs",
        qty: i % 4 === 0 ? 2.5 : 3,
        rate: i % 5 === 0 ? 113 : 33.33,
        listRate: i % 5 === 0 ? 113 : 40,
        taxable: i % 7 !== 0,
        rateIncludesVat: i % 5 === 0,
        catPath: i % 2 ? ["Sacks"] : ["Films"],
        weight: 0.25
      });
    }
    const doc = {
      id: 1, businessId: 1, customerId: 1001, type: "INV", number: "INV-2082-0001",
      date: "2026-09-14", currency: "NPR", status: "Draft", separateVat: true,
      lineItems: lineItems, shipping: {}, additional: {}, showTerms: true, showBanks: false,
      terms: "Payment within 30 days.\\nGoods once sold are not returnable.",
      totals: { taxRate: 13, delivery: 250, freight: 0, insurance: 0, legal: 0, inspection: 0, other1: 0, other2: 0 }
    };
    computeTotals(doc);

    // Load it the way a restored backup would, then render exactly as the
    // on-screen preview and the PDF export do.
    replaceDB({ businesses: [biz], activeBusinessId: 1, customers: [cust], products: [], documents: [doc] });
    const stored = db.documents[0];
    const book = renderPreview(stored, db.businesses[0], db.customers[0]);
    const stage = document.createElement("div");
    stage.style.cssText = "position:absolute;left:-99999px;top:0";
    stage.appendChild(book);
    document.body.appendChild(stage);

    const pages = Array.prototype.slice.call(book.querySelectorAll(".pv-page"));
    check("the document renders at least one page", pages.length > 0, pages.length + " pages");

    // Nothing may fall past the bottom of an A4 page: .pv-page is
    // overflow:hidden, so anything that does is simply missing from the PDF.
    pages.forEach((p, i) => {
      const over = p.scrollHeight - p.clientHeight;
      check("page " + (i + 1) + " holds all of its own content", over <= 1, over > 1 ? over + "px past the bottom" : "");
      check("page " + (i + 1) + " does not run off the side", p.scrollWidth - p.clientWidth <= 1, "");
    });

    const rows = Array.prototype.slice.call(book.querySelectorAll(".pv-items tbody tr"));
    check("every line item is printed", rows.length === lineItems.length, rows.length + " printed of " + lineItems.length);

    const serials = rows.map(tr => Number(tr.children[0].textContent));
    check("serial numbers run 1 to " + lineItems.length + " in order",
      serials.every((v, i) => v === i + 1), serials.slice(0, 6).join(",") + "\u2026");

    // The printed money column must add up to the printed Subtotal.
    const colSum = Math.round(rows.reduce((a, tr) => a + money(tr.children[tr.children.length - 1].textContent), 0) * 100) / 100;
    check("the amount column adds up to the subtotal", Math.abs(colSum - stored.totals.subtotal) < 0.01,
      "column " + colSum + " vs subtotal " + stored.totals.subtotal);

    const grandCell = book.querySelector(".pv-totals-wide tr.grand td:last-child");
    check("the printed TOTAL matches the stored total",
      grandCell && Math.abs(money(grandCell.textContent) - stored.totals.total) < 0.01,
      grandCell ? grandCell.textContent + " vs " + stored.totals.total : "no TOTAL row found");

    // Worked out here independently of the app's own code.
    const expectedTotal = (() => {
      let sub = 0, exclusive = 0, inclusiveTax = 0;
      lineItems.forEach(li => {
        const gross = round2(mulExact(li.qty, li.rate));
        if (li.taxable && li.rateIncludesVat) {
          const net = round2(gross / 1.13);
          sub = round2(sub + net);
          inclusiveTax = round2(inclusiveTax + round2(gross - net));
        } else {
          sub = round2(sub + gross);
          if (li.taxable) exclusive = round2(exclusive + gross);
        }
      });
      return round2(round2(sub + round2(round2(exclusive * 13 / 100) + inclusiveTax)) + 250);
    })();
    check("VAT-inclusive rates are not taxed twice", Math.abs(stored.totals.total - expectedTotal) < 0.01,
      stored.totals.total + " vs " + expectedTotal);

    const footers = Array.prototype.slice.call(book.querySelectorAll(".pv-page-footer .page-num")).map(e => e.textContent.trim());
    check("every page is numbered out of the right total",
      footers.length === pages.length && footers.every((f, i) => f === "Page " + (i + 1) + " of " + pages.length),
      footers.join(" | "));

    // A one-line document must still be exactly one page.
    const small = JSON.parse(JSON.stringify(stored));
    small.lineItems = [{ description: "One item", unit: "pcs", qty: 1, rate: 100, taxable: true }];
    computeTotals(small);
    const smallBook = renderPreview(small, db.businesses[0], db.customers[0]);
    stage.appendChild(smallBook);
    const smallPages = smallBook.querySelectorAll(".pv-page");
    check("a one-item document is a single page", smallPages.length === 1, smallPages.length + " pages");
    check("that single page holds all of its content",
      smallPages[0].scrollHeight - smallPages[0].clientHeight <= 1, "");

    // Every document type must render. A delivery note hides prices entirely,
    // a quotation drops the freight/insurance rows — both have their own path
    // through the page builder.
    ["PI", "PO", "QT", "INV", "DN"].forEach(function (type) {
      const typed = JSON.parse(JSON.stringify(stored));
      typed.type = type;
      typed.number = type + "-0001";
      typed.delivery = { mode: "own", driverName: "Hari", driverPhone: "9800000000", vehicleNo: "BA 2 KHA 1234" };
      computeTotals(typed);
      let pageEls = [];
      try {
        pageEls = Array.prototype.slice.call(renderPreview(typed, db.businesses[0], db.customers[0]).querySelectorAll(".pv-page"));
      } catch (err) {
        check("a " + type + " renders", false, err.message);
        return;
      }
      check("a " + type + " renders", pageEls.length > 0, pageEls.length + " pages");
      pageEls.forEach(function (p, i) {
        stage.appendChild(p);
        check("a " + type + " keeps page " + (i + 1) + " inside the page",
          p.scrollHeight - p.clientHeight <= 1, "");
      });
    });

    // ---- The column layouts ---------------------------------------------
    // Each switch changes what is printed, never what is owed, and whatever is
    // printed must still add up to the totals underneath it.
    const layoutDoc = (opts) => {
      const l = JSON.parse(JSON.stringify(stored));
      l.separateVat = !!opts.separateVat;
      l.showDiscountColumn = !!opts.showDiscountColumn;
      l.lineItems = [
        { description: "Inclusive priced item", unit: "pcs", qty: 12, rate: 113, listRate: 125, discountPct: 10, taxable: true, rateIncludesVat: true },
        { description: "Plain item", unit: "pcs", qty: 4, rate: 100, taxable: true },
        { description: "Exempt item", unit: "pcs", qty: 2, rate: 50, taxable: false }
      ];
      l.totals = { taxRate: 13, delivery: 250, freight: 0, insurance: 0, legal: 0, inspection: 0, other1: 0, other2: 0 };
      computeTotals(l);
      return l;
    };
    const headersOf = (book) => Array.prototype.slice.call(book.querySelectorAll(".pv-items thead th")).map(th => th.textContent);
    const columnAddsUp = (book, doc) => {
      const rs = Array.prototype.slice.call(book.querySelectorAll(".pv-items tbody tr"));
      const total = Math.round(rs.reduce((a, tr) => a + money(tr.children[tr.children.length - 1].textContent), 0) * 100) / 100;
      return Math.abs(total - doc.totals.subtotal) < 0.01;
    };

    const plain = layoutDoc({});
    const plainBook = renderPreview(plain, db.businesses[0], db.customers[0]);
    stage.appendChild(plainBook);
    check("by default the document looks as it always did",
      headersOf(plainBook).join("|") === "S.N.|DESCRIPTION|QTY|UNIT|UNIT PRICE|TAX|TOTAL AMOUNT", headersOf(plainBook).join("|"));
    check("prices print exactly as typed", money(plainBook.querySelector(".pv-items tbody tr td:nth-child(5)").textContent), 113);
    check("the default layout adds up", columnAddsUp(plainBook, plain), "subtotal " + plain.totals.subtotal);

    const vatSplit = layoutDoc({ separateVat: true });
    const vatBook = renderPreview(vatSplit, db.businesses[0], db.customers[0]);
    stage.appendChild(vatBook);
    check("separating VAT gives it its own column",
      headersOf(vatBook).indexOf("VAT") > -1, headersOf(vatBook).join("|"));
    check("an inclusive price prints without its VAT",
      money(vatBook.querySelector(".pv-items tbody tr td:nth-child(5)").textContent), 100);
    check("the split-out layout adds up", columnAddsUp(vatBook, vatSplit), "subtotal " + vatSplit.totals.subtotal);
    check("separating VAT does not change the total", vatSplit.totals.total, plain.totals.total);

    const withDisc = layoutDoc({ showDiscountColumn: true });
    const discBook = renderPreview(withDisc, db.businesses[0], db.customers[0]);
    stage.appendChild(discBook);
    check("the discount column replaces the plain TAX column",
      headersOf(discBook).indexOf("DISCOUNT") > -1 && headersOf(discBook).indexOf("TAX") === -1,
      headersOf(discBook).join("|"));
    check("the discount column shows the percentage and the list price",
      /−10%/.test(discBook.textContent) && /was 125\.00/.test(discBook.textContent), "");
    check("an undiscounted line shows nothing in it",
      discBook.querySelectorAll(".pv-items tbody tr")[1].children[5].textContent.trim() === "–",
      discBook.querySelectorAll(".pv-items tbody tr")[1].children[5].textContent);
    check("the discount layout adds up", columnAddsUp(discBook, withDisc), "subtotal " + withDisc.totals.subtotal);
    // Replacing the TAX column must not lose which lines carry no VAT.
    check("an exempt line is still marked when the TAX column is gone",
      discBook.querySelectorAll(".pv-items tbody tr")[2].querySelector(".pv-novat-chip") !== null, "");
    check("a taxable line is not marked",
      discBook.querySelectorAll(".pv-items tbody tr")[0].querySelector(".pv-novat-chip") === null, "");
    check("the default layout marks tax with an X instead",
      /X/.test(plainBook.querySelectorAll(".pv-items tbody tr")[0].children[5].textContent)
        && plainBook.querySelector(".pv-novat-chip") === null, "");
    check("showing the discount does not change the total", withDisc.totals.total, plain.totals.total);

    const both = layoutDoc({ separateVat: true, showDiscountColumn: true });
    const bothBook = renderPreview(both, db.businesses[0], db.customers[0]);
    stage.appendChild(bothBook);
    check("both columns can be shown together",
      headersOf(bothBook).join("|") === "S.N.|DESCRIPTION|QTY|UNIT|UNIT PRICE|DISCOUNT|VAT|TOTAL AMOUNT",
      headersOf(bothBook).join("|"));
    check("with both columns the list price is also shown without VAT",
      /was 110\.62/.test(bothBook.textContent), "");
    check("eight columns still fit across the page",
      bothBook.querySelector(".pv-page").scrollWidth - bothBook.querySelector(".pv-page").clientWidth <= 1, "");
    check("both columns together do not change the total", both.totals.total, plain.totals.total);

    // ---- The whole save flow, as a person does it -----------------------
    // New document -> pick a customer -> add a line -> Save. This is the path
    // every document takes, so it is the one worth exercising end to end.
    // On the first steps the primary button is "Next"; saving is the secondary
    // ".step-save-alt". On the last step it is "Save & Preview".
    const clickSave = () => {
      const btn = document.querySelector(".step-foot-btns .step-save-alt")
        || document.querySelector(".step-foot-btns .btn-primary");
      btn.click();
    };

    replaceDB({ businesses: [biz], activeBusinessId: 1, customers: [cust], products: [], documents: [] });
    const seqBefore = db.businesses[0].nextInv || 1;
    startNewDoc("INV");
    docBuilder.customerId = 1001;
    docBuilder.lineItems.push({ description: "PVC pipe 110mm", unit: "pcs", qty: 4, rate: 250, taxable: true });
    docBuilder.totals.taxRate = 13;
    openDocBuilder();
    clickSave();

    check("saving creates exactly one document", db.documents.length === 1, db.documents.length + " saved");
    const savedDoc = db.documents[0];
    check("the saved document has an id", !!savedDoc && !!savedDoc.id, "");
    check("the saved totals are right", savedDoc && savedDoc.totals.total === 1130,
      savedDoc ? String(savedDoc.totals.total) : "nothing saved");
    check("the next invoice number moved on", db.businesses[0].nextInv === seqBefore + 1,
      seqBefore + " -> " + db.businesses[0].nextInv);
    check("builder-only flags are not stored", savedDoc && savedDoc._editing === undefined && savedDoc._seq === undefined, "");
    check("it survives a reload", (() => {
      const reloaded = JSON.parse(localStorage.getItem("pipomaker_v1"));
      return reloaded && reloaded.documents.length === 1 && reloaded.documents[0].totals.total === 1130;
    })(), "");
    closeModal();

    // Editing must update in place, not add a second copy or burn a number.
    const numberBefore = savedDoc.number;
    editDoc(savedDoc);
    docBuilder.lineItems[0].qty = 8;
    clickSave();
    check("editing does not create a second document", db.documents.length === 1, db.documents.length + " documents");
    check("editing keeps the same number", db.documents[0].number === numberBefore, db.documents[0].number);
    check("editing does not use up another number", db.businesses[0].nextInv === seqBefore + 1, String(db.businesses[0].nextInv));
    check("the edited total is right", db.documents[0].totals.total === 2260, String(db.documents[0].totals.total));
    closeModal();

    // Two documents of the same type must not quietly share a number.
    startNewDoc("INV");
    docBuilder.customerId = 1001;
    docBuilder.number = numberBefore; // as if the counter had been reset
    docBuilder.lineItems.push({ description: "Another item", unit: "pcs", qty: 1, rate: 100, taxable: true });
    openDocBuilder();
    clickSave();
    check("a repeated document number is questioned before saving",
      db.documents.length === 1 && /already used/i.test(document.body.textContent),
      db.documents.length + " documents after the attempt");
    closeModal();
    closeModal();

    // ---- Autosave as a draft ---------------------------------------------
    // Driven by calling autosaveDraft() directly rather than waiting on the
    // three-second timer, so the test runs in milliseconds.
    replaceDB({ businesses: [biz], activeBusinessId: 1, customers: [cust], products: [], documents: [] });
    const startSeq = db.businesses[0].nextInv || 1;
    startNewDoc("INV");
    openDocBuilder();
    stopAutosave(); // the timer would race the assertions below

    check("an untouched new document is not autosaved", autosaveDraft() === "" && db.documents.length === 0,
      db.documents.length + " documents");

    docBuilder.customerId = 1001;
    docBuilder.lineItems.push({ description: "PVC pipe 110mm", unit: "pcs", qty: 4, rate: 250, taxable: true });
    check("once there is something to keep, it is saved as a draft", autosaveDraft() === "created", "");
    check("and it is in Documents", db.documents.length === 1, db.documents.length + " documents");
    check("with status Draft", db.documents[0].status === "Draft", String(db.documents[0].status));
    check("and it took the next number", db.businesses[0].nextInv === startSeq + 1,
      startSeq + " -> " + db.businesses[0].nextInv);
    check("autosaving again with nothing changed does nothing", autosaveDraft() === "", "");
    check("and does not add a second copy", db.documents.length === 1, db.documents.length + " documents");

    docBuilder.lineItems[0].qty = 10;
    check("a change is autosaved over the same draft", autosaveDraft() === "updated", "");
    check("still just the one document", db.documents.length === 1, db.documents.length + " documents");
    check("with the new figures", db.documents[0].totals.total === 2825, String(db.documents[0].totals.total));
    check("and no second number was taken", db.businesses[0].nextInv === startSeq + 1, String(db.businesses[0].nextInv));

    const draftNumber = docBuilder.number;
    clickSave();
    check("pressing Save does not duplicate the draft", db.documents.length === 1, db.documents.length + " documents");
    check("it keeps the number the draft already had", db.documents[0].number === draftNumber, db.documents[0].number);
    check("and still no extra number was used", db.businesses[0].nextInv === startSeq + 1, String(db.businesses[0].nextInv));
    check("the autosave flag is not stored", db.documents[0]._autosaved === undefined, "");
    closeModal();
    stopAutosave();

    // Autosaving while editing an existing document must not fork it.
    editDoc(db.documents[0]);
    stopAutosave();
    docBuilder.lineItems[0].qty = 20;
    check("editing autosaves over the same record", autosaveDraft() === "updated", "");
    check("editing never creates a second document", db.documents.length === 1, db.documents.length + " documents");
    check("and never consumes another number", db.businesses[0].nextInv === startSeq + 1, String(db.businesses[0].nextInv));
    closeModal();
    stopAutosave();

    // ---- Sending on WhatsApp ---------------------------------------------
    // The number has to carry a country code or wa.me reads a Nepali mobile as
    // an American one and the chat never opens.
    check("a bare Nepali mobile gets its country code", waNumber("9801234567"), "9779801234567");
    check("punctuation is ignored", waNumber("980-123 4567"), "9779801234567");
    check("a number already in international form is left alone", waNumber("+977 9801234567"), "9779801234567");
    check("00 is understood as the international prefix", waNumber("00977 9801234567"), "9779801234567");
    check("an overseas customer is not given a Nepali code", waNumber("+1 415 555 0123"), "14155550123");

    // The hand-off panel is what replaced the popup the browser used to block.
    openWhatsAppHandoff(db.documents[0], db.customers[0], "Test message", "doc.png", "");
    // The topmost modal, not the first one the page happens to contain.
    const waPanel = Array.prototype.slice.call(document.querySelectorAll(".modal")).pop();
    const waLink = waPanel.querySelector("a[href^='https://wa.me/']");
    check("the panel offers a real link the user can click", !!waLink, "");
    check("pointing at this customer's chat",
      !!waLink && waLink.getAttribute("href").indexOf("wa.me/9779801234567") > -1,
      waLink ? waLink.getAttribute("href").slice(0, 40) : "");
    check("opening safely in a new tab",
      !!waLink && waLink.getAttribute("target") === "_blank" && /noopener/.test(waLink.getAttribute("rel") || ""), "");
    check("and it says where the image went", /doc\.png/.test(waPanel.textContent), waPanel.textContent.slice(0, 80));
    closeModal();

    // A document with no items at all must still render rather than throw.
    const empty = JSON.parse(JSON.stringify(stored));
    empty.lineItems = [];
    computeTotals(empty);
    const emptyBook = renderPreview(empty, db.businesses[0], db.customers[0]);
    check("an empty document still renders", emptyBook.querySelectorAll(".pv-page").length === 1, "");
  } catch (e) {
    check("the document renders without throwing", false, (e && e.message) || String(e));
  }

  fetch("/__results", { method: "POST", body: JSON.stringify(results) });
})();
</script>
`;

const built = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
// The probe goes before the *last* </body>. The first one in the file is inside
// a JavaScript string (printDoc writes a whole document into the print window),
// and injecting there breaks the app instead of extending it.
const closeBody = built.lastIndexOf("</body>");
const probePage = built.slice(0, closeBody) + PROBE + built.slice(closeBody);

/* The probe reports back over HTTP rather than through --dump-dom, which prints
   nothing on current Edge builds. A throwaway server on localhost also means
   the app runs from an http:// origin, the way it really does. */
const run = async () => {
  const http = require("http");
  let resolveResults;
  const gotResults = new Promise((res) => { resolveResults = res; });

  const server = http.createServer((req, res) => {
    const url = req.url.split("?")[0];
    if (req.method === "POST" && url === "/__results") {
      let body = "";
      req.on("data", (c) => { body += c; });
      req.on("end", () => {
        res.writeHead(204).end();
        resolveResults(JSON.parse(body));
      });
      return;
    }
    // No service worker during the test: it would cache the probe page and
    // serve a stale one on the next run.
    if (url === "/sw.js") { res.writeHead(404).end(); return; }
    if (url === "/" || url === "/probe.html") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }).end(probePage);
      return;
    }
    const file = path.join(ROOT, url.replace(/^\/+/, ""));
    if (file.startsWith(ROOT) && fs.existsSync(file) && fs.statSync(file).isFile()) {
      const type = file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": type }).end(fs.readFileSync(file));
      return;
    }
    res.writeHead(404).end();
  });

  await new Promise((res) => server.listen(0, "127.0.0.1", res));
  const port = server.address().port;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "bizdoc-test-"));
  const child = require("child_process").spawn(browser, [
    "--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--hide-scrollbars", "--force-device-scale-factor=1",
    "--user-data-dir=" + path.join(tmp, "profile"),
    "--window-size=1280,1600",
    "http://127.0.0.1:" + port + "/probe.html",
  ], { stdio: "ignore" });

  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), 60000));
  let results;
  try {
    results = await Promise.race([gotResults, timeout]);
  } finally {
    child.kill();
    server.close();
    // The browser is still letting go of its profile directory; failing to
    // delete a temp folder is not a test failure.
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* left for the OS to clean up */ }
  }
  return results;
};

run().then((results) => {
  const failed = results.filter((r) => !r.ok);
  failed.forEach((r) => console.error("  ✗ " + r.name + (r.detail ? " — " + r.detail : "")));
  if (failed.length) {
    console.error("\n" + failed.length + " of " + results.length + " document checks FAILED.");
    process.exit(1);
  }
  console.log("All " + results.length + " document checks passed.");
}).catch((e) => {
  console.error("The probe never reported back — the app may have failed to start. (" + e.message + ")");
  process.exit(1);
});

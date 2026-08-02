// ==================== PREVIEW (paginated A4 book) ====================
// Builds a stack of A4 pages (.pv-book) so long documents don't get cut mid-row
// during PDF export. Short documents produce a single-page book that looks
// exactly like the old preview. Every page has a footer with "Page X of N".
const renderPreview = (d, biz, cust) => {
  const PAGE_W = 794, PAGE_H = 1123;
  const PAD_TOP = 28, PAD_BOTTOM = 46, PAD_X = 30;
  const CONTENT_H = PAGE_H - PAD_TOP - PAD_BOTTOM;
  const isQuote = d.type === "QT";
  const cfg = DOC_TYPES[d.type];

  // -------- Section builders --------
  const buildLetterhead = () => {
    const wrap = el("div");
    // Head
    const head = el("div", { class: "pv-head" });
    const left = el("div", { class: "pv-logo-area", style: { position: "relative" } });
    if (biz.logo) left.appendChild(el("img", { src: biz.logo, class: "pv-logo", style: { maxHeight: (60 * (biz.logoScale || 1)) + "px" } }));
    left.appendChild(el("div", { class: "pv-bizname" }, biz.name));
    head.appendChild(left);
    head.appendChild(el("div", { class: "pv-title" }, cfg.title));
    wrap.appendChild(head);
    // Meta
    const meta = el("div", { class: "pv-meta" });
    const metaL = el("div");
    if (biz.address1) metaL.appendChild(el("div", {}, biz.address1));
    if (biz.address2) metaL.appendChild(el("div", {}, biz.address2));
    if (biz.phone) metaL.appendChild(el("div", {}, "Phone: " + biz.phone));
    if (biz.pan) metaL.appendChild(el("div", {}, "PAN: " + biz.pan));
    if (biz.website) metaL.appendChild(el("div", {}, "Website: " + biz.website));
    meta.appendChild(metaL);
    const metaR = el("div", { class: "pv-meta-r" });
    const metaTbl = el("table");
    const metaRow = (l, v) => { const r = el("tr"); r.appendChild(el("td", {}, l)); r.appendChild(el("td", {}, v || "-")); metaTbl.appendChild(r); };
    metaRow("Date", d.date);
    if (d.expiryDate) metaRow(cfg.expiryLabel || "Expiration Date", d.expiryDate);
    metaRow(cfg.numLabel, d.number);
    if (cust) metaRow(`${cfg.partyLabel} ID`, String(cust.id));
    metaR.appendChild(metaTbl);
    meta.appendChild(metaR);
    wrap.appendChild(meta);
    // 3-col boxes
    const shipping = d.shipping || {};
    const hasShip = !isQuote || !!(shipping.deliveryLocation || shipping.shipDate || shipping.grossWeight || shipping.totalPackages || shipping.freightType);
    const c3wrap = el("div");
    const hdrRow = el("div", { style: { display: "grid", gridTemplateColumns: hasShip ? "1fr 1fr 1fr" : "1fr" } });
    hdrRow.appendChild(el("div", { class: "pv-section-hdr" }, cfg.partyLabel.toUpperCase()));
    if (hasShip) {
      hdrRow.appendChild(el("div", { class: "pv-section-hdr" }, "SHIP TO"));
      hdrRow.appendChild(el("div", { class: "pv-section-hdr" }, "SHIPPING DETAILS"));
    }
    c3wrap.appendChild(hdrRow);
    const c3 = el("div", { class: "pv-3col", style: hasShip ? {} : { gridTemplateColumns: "1fr" } });
    const custBox = el("div");
    if (cust) {
      custBox.appendChild(el("div", {}, cust.contactName));
      custBox.appendChild(el("div", {}, cust.companyName));
      if (cust.addr1) custBox.appendChild(el("div", {}, cust.addr1));
      if (cust.addr2) custBox.appendChild(el("div", {}, cust.addr2));
      custBox.appendChild(el("div", {}, cust.phone));
      if (cust.vatNo) custBox.appendChild(el("div", {}, "VAT/PAN: " + cust.vatNo));
    }
    c3.appendChild(custBox);
    if (hasShip) {
      const shipBox = el("div");
      // Per-document delivery location takes priority in SHIP TO.
      if (shipping.deliveryLocation) shipBox.appendChild(el("div", { style: { fontWeight: 600 } }, shipping.deliveryLocation));
      if (cust) {
        if (cust.regNo) shipBox.appendChild(el("div", {}, "REGISTRATION NO. " + cust.regNo));
        const sa1 = cust.sameAsBill ? cust.addr1 : cust.shipAddr1;
        const sa2 = cust.sameAsBill ? cust.addr2 : cust.shipAddr2;
        if (sa1) shipBox.appendChild(el("div", {}, sa1));
        if (cust.email) shipBox.appendChild(el("div", {}, cust.email));
        if (sa2) shipBox.appendChild(el("div", {}, sa2));
        if (cust.eximCode) shipBox.appendChild(el("div", {}, "EXIM CODE - " + cust.eximCode));
      }
      c3.appendChild(shipBox);
      const detailBox = el("div");
      const dRow = (l, v) => { const r = el("div", { style: { display: "table", width: "100%" } }); r.appendChild(el("span", { style: { display: "table-cell", fontWeight: 600 } }, l)); r.appendChild(el("span", { style: { display: "table-cell", textAlign: "right" } }, v || "-")); return r; };
      detailBox.appendChild(dRow("Freight Type", shipping.freightType));
      detailBox.appendChild(dRow("Est Ship Date", shipping.shipDate));
      detailBox.appendChild(dRow("Est Gross Weight", shipping.grossWeight));
      detailBox.appendChild(dRow("Est Cubic Weight", shipping.cubicWeight));
      detailBox.appendChild(dRow("Total Packages", shipping.totalPackages));
      c3.appendChild(detailBox);
    }
    c3wrap.appendChild(c3);
    wrap.appendChild(c3wrap);
    return wrap;
  };

  const buildContHeader = (pageNum, totalPages) => {
    const h = el("div", { class: "pv-cont-hdr" });
    h.appendChild(el("div", { class: "biz" }, biz.name));
    const right = el("div", { style: { display: "flex", alignItems: "center", gap: "8px" } });
    right.appendChild(el("span", { class: "cont-badge" }, "CONTINUED"));
    right.appendChild(el("span", { class: "doc" }, `${cfg.title} · #${d.number}`));
    h.appendChild(right);
    return h;
  };

  // Sort line items by their existing per-row category tag (catPath[0]) so
  // same-category rows sit together, alphabetically, "Uncategorized" last.
  // Ties keep their original relative order. No separate header row —
  // the existing pv-cat-chip on each row is what shows the category.
  const buildDisplayRows = () => {
    const withIdx = (d.lineItems || []).map((li, i) => ({ li, origIdx: i }));
    const catOf = (li) => (Array.isArray(li.catPath) && li.catPath[0]) ? li.catPath[0] : "";
    withIdx.sort((a, b) => {
      const ca = catOf(a.li), cb = catOf(b.li);
      if (ca === cb) return a.origIdx - b.origIdx;
      if (!ca) return 1;
      if (!cb) return -1;
      return ca.localeCompare(cb);
    });
    return withIdx;
  };
  const displayRows = buildDisplayRows();

  const hidePrices = !!cfg.hidePrices;
  const buildItemsTable = () => {
    const items = el("div", { class: "pv-items" });
    const table = el("table");
    const thead = el("thead");
    const trH = el("tr");
    const cols = hidePrices
      ? ["S.N.", "DESCRIPTION", "QTY", "UNIT"]
      : ["S.N.", "DESCRIPTION", "QTY", "UNIT", "UNIT PRICE", "TAX", "TOTAL AMOUNT"];
    cols.forEach(h => trH.appendChild(el("th", {}, h)));
    thead.appendChild(trH);
    table.appendChild(thead);
    table.appendChild(el("tbody"));
    items.appendChild(table);
    return items;
  };

  const buildItemRow = (li, serial) => {
    if (!li) return el("tr");
    const r = el("tr");
    r.appendChild(el("td", {}, String(serial)));
    // Description cell: category tag (if any) on top, then description text
    const descCell = el("td");
    const cat = Array.isArray(li.catPath) && li.catPath.length ? li.catPath[0] : "";
    if (cat) descCell.appendChild(el("span", { class: "pv-cat-chip" }, cat));
    descCell.appendChild(el("span", { class: "pv-desc-text" }, li.description));
    r.appendChild(descCell);
    r.appendChild(el("td", { class: "num" }, String(li.qty)));
    r.appendChild(el("td", {}, li.unit));
    if (!hidePrices) {
      r.appendChild(el("td", { class: "num" }, fmt(li.rate)));
      const sep = !!d.separateVat;
      const tr = (d.totals && d.totals.taxRate || 0) / 100;
      let taxCell = li.taxable ? "X" : "";
      if (sep && li.taxable && tr > 0) {
        const perUnit = li.rateIncludesVat ? (li.rate - li.rate / (1 + tr)) : (li.rate * tr);
        taxCell = fmt(perUnit);
      }
      r.appendChild(el("td", { class: sep ? "num" : "", style: sep ? {} : { textAlign: "center" } }, taxCell));
      r.appendChild(el("td", { class: "num" }, fmt(li.qty * li.rate)));
    }
    return r;
  };

  const buildDisplayRow = (entry, serial) => buildItemRow(entry.li, serial);

  const buildTotalsBlock = () => {
    const t = d.totals;
    const wrap = el("div", { class: "pv-totals-wide" });
    const note = el("div", { class: "side-note" });
    note.appendChild(el("div", { style: { fontWeight: 700, color: "#1F4E79", marginBottom: "3px" } }, "Amount payable"));
    note.appendChild(el("div", {}, `Total items: ${d.lineItems.length}`));
    if (t.taxable > 0) note.appendChild(el("div", {}, `Taxable amount: ${d.currency} ${fmt(t.taxable)}`));
    wrap.appendChild(note);
    const tbl = el("table");
    const trAdd = (l, v) => { const r = el("tr"); r.appendChild(el("td", {}, l)); r.appendChild(el("td", {}, v)); tbl.appendChild(r); };
    trAdd("Subtotal", fmt(t.subtotal));
    trAdd("Taxable", fmt(t.taxable));
    trAdd("Tax rate", (Number(t.taxRate) || 0).toFixed(3) + "%");
    trAdd("Tax", t.tax > 0 ? fmt(t.tax) : "-");
    if (Number(t.delivery) > 0) trAdd("Delivery", fmt(t.delivery));
    if (!isQuote) {
      trAdd("Freight", t.freight > 0 ? fmt(t.freight) : "-");
      trAdd("Insurance", t.insurance > 0 ? fmt(t.insurance) : "-");
      trAdd("Legal/Consular", t.legal > 0 ? fmt(t.legal) : "-");
      trAdd("Inspection/Cert.", t.inspection > 0 ? fmt(t.inspection) : "-");
    }
    const grand = el("tr", { class: "grand" });
    grand.appendChild(el("td", {}, "TOTAL"));
    grand.appendChild(el("td", {}, `${d.currency} ${fmt(t.total)}`));
    tbl.appendChild(grand);
    wrap.appendChild(tbl);
    return wrap;
  };

  const buildWordsBlock = () => {
    const words = el("div", { class: "pv-words" });
    words.appendChild(el("span", { class: "pv-words-label" }, "In words: "));
    words.appendChild(el("span", {}, amountToWords(d.totals.total, d.currency)));
    return words;
  };

  const buildTermsBlock = () => {
    if (d.showTerms === false) return null;
    if (!d.terms || !d.terms.trim()) return null;
    const terms = el("div", { class: "pv-terms" });
    terms.appendChild(el("div", { class: "pv-terms-hdr" }, "TERMS OF SALE AND OTHER COMMENTS"));
    const tb = el("div", { class: "pv-terms-body" });
    d.terms.split("\n").forEach(line => { if (line.trim()) tb.appendChild(el("div", {}, line)); });
    terms.appendChild(tb);
    return terms;
  };

  const buildBanksBlock = () => {
    if (!d.showBanks) return null;
    let banksToShow = Array.isArray(biz.banks) ? biz.banks.filter(b => b.bankName || b.accountName || b.accountNumber || b.notes) : [];
    if (d.bankId) {
      const only = banksToShow.filter(b => b.id === d.bankId);
      if (only.length) banksToShow = only;
    }
    if (banksToShow.length) {
      const bank = el("div", { class: "pv-terms", style: { marginTop: "4px" } });
      bank.appendChild(el("div", { class: "pv-terms-hdr" }, "BANKING DETAILS"));
      const bb = el("div", { class: "pv-terms-body" });
      banksToShow.forEach((b, idx) => {
        const showQR = b.showQR !== false;
        const bankRow = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginTop: idx ? "8px" : "0", paddingTop: idx ? "6px" : "0", borderTop: idx ? "1px dashed #cbd5e1" : "none" } });
        const details = el("div", { style: { flex: "1" } });
        const line1 = [b.bankName, b.branch].filter(Boolean).join(" — ");
        if (line1) details.appendChild(el("div", { style: { fontWeight: 700 } }, line1));
        if (b.accountName) details.appendChild(el("div", {}, `A/C Name: ${b.accountName}`));
        if (b.accountNumber) details.appendChild(el("div", {}, `A/C No: ${b.accountNumber}`));
        if (b.swift || b.bankCode) details.appendChild(el("div", {}, `SWIFT/BIC: ${b.bankCode || b.swift}`));
        if (b.notes) b.notes.split("\n").forEach(line => { if (line.trim()) details.appendChild(el("div", {}, line)); });
        bankRow.appendChild(details);
        if (showQR) {
          const qrText = bankQRText(b);
          const qrImg = qrText ? makeQRImg(qrText, 96, "L") : null;
          if (qrImg) {
            const qrBox = el("div", { style: { textAlign: "center", flexShrink: "0" } });
            qrBox.appendChild(qrImg);
            qrBox.appendChild(el("div", { style: { fontSize: "8px", color: "#555", marginTop: "2px" } }, "Scan to pay"));
            bankRow.appendChild(qrBox);
          }
        }
        bb.appendChild(bankRow);
      });
      bank.appendChild(bb);
      return bank;
    } else if (biz.bank && biz.bank.trim()) {
      const bank = el("div", { class: "pv-terms", style: { marginTop: "4px" } });
      bank.appendChild(el("div", { class: "pv-terms-hdr" }, "BANKING DETAILS"));
      const bb = el("div", { class: "pv-terms-body" });
      biz.bank.split("\n").forEach(line => { if (line.trim()) bb.appendChild(el("div", {}, line)); });
      bank.appendChild(bb);
      return bank;
    }
    return null;
  };

  const buildAdditionalBlock = () => {
    if (!d.showExport) return null;
    const additional = d.additional || {};
    const addl = el("div", { class: "pv-addl" });
    addl.appendChild(el("div", { class: "pv-addl-hdr" }, "ADDITIONAL DETAILS"));
    const ab = el("div", { class: "pv-addl-body" });
    const at = el("table");
    const ar = (l, v) => { const r = el("tr"); r.appendChild(el("td", {}, l)); r.appendChild(el("td", {}, v || "-")); at.appendChild(r); };
    ar("Country of Origin", additional.origin);
    ar("Port of Embarkation", additional.embarkation);
    ar("Port of Discharge", additional.discharge);
    ab.appendChild(at);
    ab.appendChild(el("div", { style: { marginTop: 8 } }, "Reason for Export: " + (additional.reason || "-")));
    addl.appendChild(ab);
    return addl;
  };

  const buildSignatureFooter = () => {
    const foot = el("div", { class: "pv-footer", style: { position: "relative" } });
    foot.appendChild(el("div", { style: { marginTop: 8 } }, "I certify the above to be true and correct to the best of my knowledge."));
    const sig = el("div", { class: "pv-sig" });
    if (biz.signature) sig.appendChild(el("img", { src: biz.signature, class: "pv-sig-img", style: { maxHeight: (40 * (biz.signScale || 1)) + "px" } }));
    sig.appendChild(el("div", { class: "pv-sigline" }));
    foot.appendChild(sig);
    if (biz.stamp) foot.appendChild(el("img", { src: biz.stamp, class: "pv-stamp-img", style: { maxHeight: (90 * (biz.stampScale || 1)) + "px", maxWidth: (130 * (biz.stampScale || 1)) + "px" } }));
    const fr = el("div", { style: { marginTop: 4, display: "flex", justifyContent: "space-between" } });
    const fl = el("div");
    fl.appendChild(el("div", {}, biz.signatory || ""));
    fl.appendChild(el("div", {}, biz.name));
    fr.appendChild(fl);
    fr.appendChild(el("div", {}, "Date: " + d.date));
    foot.appendChild(fr);
    return foot;
  };

  const buildPageFooter = (pageNum, totalPages) => {
    const f = el("div", { class: "pv-page-footer" });
    f.appendChild(el("span", {}, `${cfg.title} · ${d.number}${cust ? " · " + cust.companyName : ""}`));
    f.appendChild(el("span", { class: "page-num" }, `Page ${pageNum} of ${totalPages}`));
    return f;
  };

  // Delivery-details block — only on delivery notes.
  const buildDeliveryBlock = () => {
    const dl = d.delivery || {};
    const box = el("div", { class: "pv-terms", style: { marginTop: "8px" } });
    box.appendChild(el("div", { class: "pv-terms-hdr" }, "DELIVERY DETAILS"));
    const body = el("div", { class: "pv-terms-body" });
    const row = (k, v) => { if (!v) return; body.appendChild(el("div", {}, `${k}: ${v}`)); };
    if (dl.mode === "transport") {
      row("Transport company", dl.transportCompany);
      row("Driver", dl.driverName);
      row("Driver phone", dl.driverPhone);
    } else {
      row("Driver", dl.driverName);
      row("Driver phone", dl.driverPhone);
    }
    row("Vehicle no.", dl.vehicleNo);
    if (!body.childNodes.length) body.appendChild(el("div", {}, "—"));
    box.appendChild(body);
    return box;
  };

  // -------- Assemble finish sections (they go on the last page in order) --------
  const finishSectionsBuilder = () => {
    const out = [];
    if (hidePrices) {
      // Delivery note: no prices, no totals/words/banks.
      out.push(buildDeliveryBlock());
      const t = buildTermsBlock(); if (t) out.push(t);
      out.push(buildSignatureFooter());
      return out;
    }
    out.push(buildTotalsBlock());
    out.push(buildWordsBlock());
    const t = buildTermsBlock(); if (t) out.push(t);
    const b = buildBanksBlock(); if (b) out.push(b);
    const a = buildAdditionalBlock(); if (a) out.push(a);
    out.push(buildSignatureFooter());
    return out;
  };

  // -------- Measure heights offscreen --------
  const measureHeight = (nodes) => {
    const holder = el("div", {
      class: "pv-page",
      style: { position: "absolute", left: "-99999px", top: "0", visibility: "hidden", height: "auto" }
    });
    nodes.forEach(n => holder.appendChild(n));
    document.body.appendChild(holder);
    // Subtract the page's own vertical padding since we want the *content* height
    const h = holder.scrollHeight - PAD_TOP - PAD_BOTTOM;
    holder.remove();
    return Math.max(0, h);
  };

  const letterheadH = measureHeight([buildLetterhead()]);
  const contHdrH = measureHeight([buildContHeader(2, 3)]);
  const emptyItemsH = measureHeight([buildItemsTable()]);
  const finishH = measureHeight(finishSectionsBuilder());

  // Row height: measure a real row using the first line item (or synthesize)
  let rowH = 22;
  {
    const sampleTable = buildItemsTable();
    const tbody = sampleTable.querySelector("tbody");
    const sampleData = d.lineItems[0] || { partNumber: "1", unit: "pcs", description: "Sample line item description text goes here", qty: 1, rate: 100, taxable: true };
    tbody.appendChild(buildItemRow(sampleData, 0));
    const withOneH = measureHeight([sampleTable]);
    rowH = Math.max(20, withOneH - emptyItemsH);
  }

  const SAFETY = 40; // buffer against sub-pixel & border/margin drift + page footer breathing room
  const p1MaxRows = Math.max(1, Math.floor((CONTENT_H - letterheadH - emptyItemsH - SAFETY) / rowH));
  const contMaxRows = Math.max(1, Math.floor((CONTENT_H - contHdrH - emptyItemsH - SAFETY) / rowH));
  const p1WithFinishMaxRows = Math.max(0, Math.floor((CONTENT_H - letterheadH - emptyItemsH - finishH - SAFETY) / rowH));
  const contWithFinishMaxRows = Math.max(0, Math.floor((CONTENT_H - contHdrH - emptyItemsH - finishH - SAFETY) / rowH));

  // -------- Distribute items across pages --------
  const nItems = displayRows.length;
  const distribution = []; // items per page
  const layouts = [];      // "p1_full" | "p1_with_finish" | "cont" | "cont_with_finish" | "finish_only"

  if (nItems <= p1WithFinishMaxRows) {
    // Whole doc fits on one page
    distribution.push(nItems);
    layouts.push("p1_with_finish");
  } else {
    distribution.push(p1MaxRows);
    layouts.push("p1_full");
    let remaining = nItems - p1MaxRows;
    while (remaining > contWithFinishMaxRows) {
      distribution.push(contMaxRows);
      layouts.push("cont");
      remaining -= contMaxRows;
    }
    if (remaining > 0) {
      distribution.push(remaining);
      layouts.push("cont_with_finish");
    } else {
      distribution.push(0);
      layouts.push("finish_only");
    }
  }

  // -------- Build the book --------
  const book = el("div", { class: "pv-book", id: "preview-doc" });
  const totalPages = distribution.length;
  let itemStart = 0;

  distribution.forEach((rowCount, pageIdx) => {
    const layout = layouts[pageIdx];
    const isFirst = pageIdx === 0;
    const hasFinish = layout.endsWith("with_finish") || layout === "finish_only";

    const page = el("div", { class: "pv-page" });

    if (isFirst) {
      page.appendChild(buildLetterhead());
    } else {
      page.appendChild(buildContHeader(pageIdx + 1, totalPages));
    }

    if (layout !== "finish_only") {
      const itemsTable = buildItemsTable();
      const tbody = itemsTable.querySelector("tbody");
      const cap = Math.min(rowCount, displayRows.length - itemStart);
      for (let i = 0; i < cap; i++) {
        tbody.appendChild(buildDisplayRow(displayRows[itemStart + i], itemStart + i + 1));
      }
      // For visual weight, pad short last pages so the table doesn't look sparse.
      // Only pad if we're on a page WITH finish sections (i.e. the last one) AND
      // the item count is small enough that padding won't push finish sections
      // off the page.
      page.appendChild(itemsTable);
      itemStart += rowCount;

      // "…continued" marker on non-final pages
      if (!hasFinish) {
        page.appendChild(el("div", { class: "pv-items-cont-note" }, `…continued on page ${pageIdx + 2}`));
      }
    }

    if (hasFinish) {
      finishSectionsBuilder().forEach(sec => page.appendChild(sec));
    }

    page.appendChild(buildPageFooter(pageIdx + 1, totalPages));
    book.appendChild(page);
  });

  return book;
};

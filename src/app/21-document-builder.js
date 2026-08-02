// ==================== DOCUMENT BUILDER ====================
// A business's starting terms text: the preset marked as default in Settings,
// falling back to the free-text "Default Terms of Sale".
const defaultTermsFor = (biz) => {
  const preset = (biz.termsPresets || []).find(p => p.id === biz.defaultTermsPresetId);
  return (preset ? preset.text : biz.terms) || "";
};

// Does this business have at least one usable bank account?
const hasUsableBank = (biz) => (biz.banks || []).some(b => b.bankName || b.accountName || b.accountNumber);

const startNewDoc = (type) => {
  const biz = activeBiz();
  const cfg = DOC_TYPES[type];
  const seq = biz[cfg.seqKey] || 1;
  const fmt = biz[cfg.fmtKey] || cfg.defaultFmt;
  docBuilder = {
    type,
    number: formatDocNumber(fmt, seq, today()),
    _seq: seq,
    date: today(),
    expiryDate: cfg.hasExpiry ? addDays(today(), Number(biz[cfg.validityKey] ?? cfg.defaultValidity) || cfg.defaultValidity) : "",
    customerId: null,
    // Defaults from Settings; both are changeable in the builder's Details step.
    bankId: biz.defaultBankId || null,
    showBanks: hasUsableBank(biz),
    showTerms: true,
    status: "Draft",
    currency: biz.currency,
    lineItems: [],
    totals: { subtotal: 0, taxable: 0, taxRate: biz.taxRate || 0, tax: 0, delivery: 0, freight: 0, insurance: 0, legal: 0, inspection: 0, other1: 0, other1Label: "", other2: 0, other2Label: "", total: 0 },
    terms: defaultTermsFor(biz),
    shipping: { deliveryLocation: "", freightType: "land", shipDate: biz.defaultShipNote || "to be discussed", grossWeight: "", cubicWeight: "", totalPackages: "" },
    showExport: false,
    additional: { origin: "NEPAL", embarkation: "", discharge: "", reason: "" },
    businessId: db.activeBusinessId
  };
  openDocBuilder();
};

const editDoc = (d) => {
  docBuilder = JSON.parse(JSON.stringify(d));
  docBuilder._editing = true;
  openDocBuilder();
};

// Convert a source document (e.g. a Quotation) into a NEW linked document of
// another type (PI / Invoice / Delivery Note). The source stays untouched; the
// new doc copies items, customer and totals, gets its own number in the target
// series, and remembers where it came from so the two can link both ways.
const convertDoc = (src, targetType) => {
  const biz = activeBiz();
  const cfg = DOC_TYPES[targetType];
  const seq = biz[cfg.seqKey] || 1;
  const fmt = biz[cfg.fmtKey] || cfg.defaultFmt;
  const copy = JSON.parse(JSON.stringify(src));
  copy.type = targetType;
  copy.number = formatDocNumber(fmt, seq, today());
  copy._seq = seq;
  copy.id = undefined;              // a brand-new record
  copy._editing = false;
  copy.status = "Draft";
  copy.date = today();
  copy.expiryDate = cfg.hasExpiry ? addDays(today(), Number(biz[cfg.validityKey] ?? cfg.defaultValidity) || cfg.defaultValidity) : "";
  copy.fromDoc = { id: src.id, type: src.type, number: src.number };  // chain link
  if (cfg.hasDelivery && !copy.delivery) {
    copy.delivery = { mode: "own", driverName: "", driverPhone: "", transportCompany: "", vehicleNo: "" };
  }
  docBuilder = copy;
  openDocBuilder();
  toast(`Converting ${DOC_TYPES[src.type].shortLabel} #${src.number} → ${cfg.shortLabel}`);
};

// Re-apply the selected customer's rate card to every line that came from the
// catalogue. Called when the customer changes so prices never reflect the
// previous party's discounts.
const repriceLineItems = () => {
  const rules = customerRules(docBuilder.customerId);
  let changed = 0;
  docBuilder.lineItems.forEach(li => {
    if (li.manualRate) return; // user typed a rate by hand — leave it alone
    const list = Number(li.listRate);
    if (!list && list !== 0) return; // ad-hoc line with no list price
    const { pct } = resolveDiscount({ category: li.catPath?.[0], subCategory1: li.catPath?.[1], subCategory2: li.catPath?.[2], subCategory3: li.catPath?.[3] }, rules);
    const net = pct ? +(list * (1 - pct / 100)).toFixed(2) : list;
    if (net !== li.rate || pct !== li.discountPct) changed++;
    li.rate = net; li.discountPct = pct;
  });
  return changed;
};

const recomputeTotals = () => {
  const t = docBuilder.totals;
  const r = (t.taxRate || 0) / 100;
  const sep = !!docBuilder.separateVat;
  let base = 0, taxableBase = 0, tax = 0;
  docBuilder.lineItems.forEach(li => {
    const line = li.qty * li.rate;
    if (sep && li.taxable && li.rateIncludesVat && r > 0) {
      const b = line / (1 + r); base += b; taxableBase += b; tax += line - b;
    } else if (sep && li.taxable) {
      base += line; taxableBase += line; tax += line * r;
    } else {
      base += line; if (li.taxable) taxableBase += line;
    }
  });
  if (!sep) tax = taxableBase * r;
  t.subtotal = base;
  t.discountGiven = docBuilder.lineItems.reduce((s, li) => {
    const list = Number(li.listRate);
    if (!list && list !== 0) return s;
    return s + (li.qty * Math.max(0, list - li.rate));
  }, 0);
  t.taxable = taxableBase;
  t.tax = tax;
  t.total = t.subtotal + t.tax + Number(t.delivery || 0) + Number(t.freight || 0) + Number(t.insurance || 0) + Number(t.legal || 0) + Number(t.inspection || 0) + Number(t.other1 || 0) + Number(t.other2 || 0);
  const gw = docBuilder.lineItems.reduce((s, li) => s + (li.qty * (li.weight || 0)), 0);
  if (gw > 0 && !docBuilder.shipping._userSetWeight) docBuilder.shipping.grossWeight = gw.toFixed(2) + " kg";
};

const openDocBuilder = () => {
  recomputeTotals();

  // ---- Stepped layout ----
  // Sections below append to `wrap`; we swap what `wrap` points at as we go,
  // so each block lands in its own step without rewriting the section code.
  const isDelivery = !!DOC_TYPES[docBuilder.type].hasDelivery;
  const steps = {
    party:    el("div", { class: "step-pane" }),
    items:    el("div", { class: "step-pane" }),
    charges:  el("div", { class: "step-pane" }),
    delivery: el("div", { class: "step-pane" }),
    details:  el("div", { class: "step-pane" }),
  };
  const STEP_ORDER = isDelivery
    ? ["party", "items", "delivery", "details"]
    : ["party", "items", "charges", "details"];
  const STEP_LABELS = { party: "Party", items: "Items", charges: "Charges", delivery: "Delivery", details: "Details" };
  let wrap = steps.party;

  // Header info
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Document #", "number", docBuilder),
    inputField("Date", "date", docBuilder, { type: "date" }),
  ]));
  if (DOC_TYPES[docBuilder.type].hasExpiry) wrap.appendChild(inputField(DOC_TYPES[docBuilder.type].expiryLabel, "expiryDate", docBuilder, { type: "date" }));

  // Customer
  const custField = el("div", { class: "field" });
  custField.appendChild(el("label", {}, `${DOC_TYPES[docBuilder.type].partyLabel} *`));
  const custSel = el("select", { onchange: (e) => {
    if (e.target.value === "__new__") {
      openCustomerModal(null, (newCust) => {
        docBuilder.customerId = newCust.id;
        refreshCustSel();
        toast(`${newCust.companyName} added and selected`);
      });
      return;
    }
    docBuilder.customerId = parseInt(e.target.value);
    const n = repriceLineItems();
    renderResults();
    if (n) { recomputeTotals(); rerenderLI(); updateTotals(); toast(`${n} line${n === 1 ? "" : "s"} re-priced for this customer`); }
  }});
  const custSearch = el("input", { placeholder: "🔍 Search " + DOC_TYPES[docBuilder.type].partyLabel.toLowerCase() + "...", style: { marginBottom: "8px" } });
  const refreshCustSel = (q = "") => {
    custSel.innerHTML = "";
    custSel.appendChild(el("option", { value: "" }, "-- select --"));
    const cTerms = q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    const matches = bizCustomers().filter(c => {
      if (!cTerms.length) return true;
      const hay = ("c" + String(c.id).padStart(4, "0") + " " + c.id + " " + c.companyName + " " +
        c.contactName + " " + c.phone + " " + (c.vatNo || "")).toLowerCase();
      return cTerms.every(t => hay.includes(t));
    });
    matches.forEach(c => {
      const o = el("option", { value: c.id }, `C${String(c.id).padStart(4, "0")} — ${c.companyName} (${c.contactName})`);
      if (docBuilder.customerId === c.id) o.selected = true;
      custSel.appendChild(o);
    });
    if (cTerms.length && matches.length === 1) { custSel.value = matches[0].id; docBuilder.customerId = matches[0].id; }
    custSel.appendChild(el("option", { value: "__new__" }, "+ Add new..."));
  };
  refreshCustSel();
  custSearch.addEventListener("input", (e) => refreshCustSel(e.target.value));
  custField.appendChild(custSearch);
  custField.appendChild(custSel);
  wrap.appendChild(custField);

  // Bank account is chosen in the Details step, pre-filled from the business
  // default — it used to be duplicated here, where it had no effect unless
  // "Show banking details" was also ticked further along.

  // Shipping details — available for every document type.
  let grossInp = null;
  {
    const shipCard = el("div", { class: "card", style: { padding: "12px", marginBottom: "12px", background: "#f9fafb" } });
    shipCard.appendChild(el("div", { style: { fontWeight: 600, marginBottom: 8 } }, "Shipping details"));
    shipCard.appendChild(inputField("Delivery location / site (optional)", "deliveryLocation", docBuilder.shipping, { placeholder: "e.g. Construction site, Sudal-9, Bhaktapur" }));
    shipCard.appendChild(el("div", { class: "row" }, [
      selectField("Freight", "freightType", docBuilder.shipping, ["land", "sea", "air"]),
      inputField("Ship Date", "shipDate", docBuilder.shipping),
    ]));
    const grossField = el("div", { class: "field" });
    grossField.appendChild(el("label", {}, "Est. Gross Weight (auto)"));
    grossInp = el("input", { value: docBuilder.shipping.grossWeight || "", oninput: (e) => { docBuilder.shipping.grossWeight = e.target.value; docBuilder.shipping._userSetWeight = true; }});
    grossField.appendChild(grossInp);
    shipCard.appendChild(grossField);
    shipCard.appendChild(inputField("Total Packages", "totalPackages", docBuilder.shipping));
    wrap.appendChild(shipCard);
  }

  wrap = steps.items;
  // Line items
  const liCard = el("div", { class: "card", style: { padding: "12px" } });
  liCard.appendChild(el("div", { style: { fontWeight: 600, marginBottom: 8 } }, "Line items"));
  const liList = el("div", { id: "li-list" });
  const rerenderLI = () => {
    if (docBuilder._onTotals) docBuilder._onTotals();
    liList.innerHTML = "";
    const hdr = el("div", { class: "li-header" });
    ["#", "Description", "Unit", "Qty", "Rate", ""].forEach(t => hdr.appendChild(el("div", {}, t)));
    liList.appendChild(hdr);
    docBuilder.lineItems.forEach((li, idx) => {
      const row = el("div", { class: "li-row" });
      row.appendChild(el("div", { class: "li-num" }, String(idx + 1)));
      row.appendChild(el("input", { class: "li-desc", placeholder: "Description", "aria-label": "Description", value: li.description, oninput: (e) => { li.description = e.target.value; }}));
      row.appendChild(el("input", { class: "li-unit", placeholder: "Unit", "aria-label": "Unit", value: li.unit, oninput: (e) => { li.unit = e.target.value; }}));
      row.appendChild(el("input", { class: "li-qty", type: "number", inputmode: "decimal", placeholder: "Qty", "aria-label": "Quantity", value: li.qty, oninput: (e) => { li.qty = parseFloat(e.target.value) || 0; recomputeTotals(); refreshTotals(); if (docBuilder.shipping._userSetWeight === false || !docBuilder.shipping._userSetWeight) updateGross(); }}));
      row.appendChild(el("input", { class: "li-rate", type: "number", inputmode: "decimal", placeholder: "Rate", "aria-label": "Rate", value: li.rate, oninput: (e) => {
        li.rate = parseFloat(e.target.value) || 0;
        li.manualRate = true; // don't overwrite a hand-typed rate on reprice
        recomputeTotals(); refreshTotals(); rerenderNote(idx);
      }}));
      row.appendChild(el("button", { class: "remove-btn", title: "Remove line", onclick: () => { docBuilder.lineItems.splice(idx, 1); recomputeTotals(); rerenderLI(); updateTotals(); updateGross(); }}, "×"));
      liList.appendChild(row);
      // Builder-only discount note. Never printed — the document stays silent.
      const note = el("div", { class: "li-note", id: `li-note-${idx}` });
      liList.appendChild(note);
      drawNote(note, li);
    });
  };
  // Renders the small under-row hint showing what discount was applied.
  function drawNote(note, li) {
    note.innerHTML = "";
    if (Number(li.packQty) > 0) {
      const packs = li.qty / li.packQty;
      note.appendChild(el("span", { class: "pack-chip", style: { marginRight: "6px" } },
        `${Number.isInteger(packs) ? packs : packs.toFixed(2)} ${li.packUnit || "box"} × ${li.packQty} ${li.unit}`));
    }
    if (li.manualRate) {
      note.appendChild(el("span", { class: "li-note-manual" }, "rate set manually"));
      return;
    }
    if (li.discountPct) {
      note.appendChild(el("span", { class: "li-note-disc" }, `list ${fmt(li.listRate)} → ${fmt(li.rate)} (−${li.discountPct}%)`));
    } else if (li.listRate !== undefined) {
      note.appendChild(el("span", { class: "li-note-none" }, "no discount rule"));
    }
  }
  function rerenderNote(idx) {
    const note = document.getElementById(`li-note-${idx}`);
    if (note) drawNote(note, docBuilder.lineItems[idx]);
  }
  const updateGross = () => {
    if (!docBuilder.shipping._userSetWeight) {
      const gw = docBuilder.lineItems.reduce((s, li) => s + (li.qty * (li.weight || 0)), 0);
      if (gw > 0) { docBuilder.shipping.grossWeight = gw.toFixed(2) + " kg"; if (grossInp) grossInp.value = docBuilder.shipping.grossWeight; }
    }
  };
  rerenderLI();
  liCard.appendChild(liList);

  // Add line item — segmented: Existing product / New product
  const addWrap = el("div", { style: { marginTop: 10 } });
  const segTabs = el("div", { class: "seg-tabs" });
  const tabExisting = el("button", { type: "button", class: "seg-tab active" }, "📦 Existing product");
  const tabNew = el("button", { type: "button", class: "seg-tab" }, "✨ New product");
  const tabBulk = el("button", { type: "button", class: "seg-tab" }, "📋 Bulk paste");
  segTabs.appendChild(tabExisting); segTabs.appendChild(tabNew); segTabs.appendChild(tabBulk);
  addWrap.appendChild(segTabs);

  // --- Pane: existing product ---
  const existingPane = el("div", { class: "seg-pane" });
  const prodSearch = el("input", { placeholder: "🔍 Search products by name, part no, category...", style: { marginBottom: "8px" } });
  existingPane.appendChild(prodSearch);

  // Category quick-filter chips (only if categories exist)
  const pickerCats = Array.from(new Set(bizProducts().map(p => p.category).filter(Boolean))).sort();
  let activePickCat = "";
  const catChipRow = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "5px", marginBottom: "8px" } });
  const results = el("div", { class: "prod-results" });
  const existQty = el("input", { type: "number", class: "qty-inline", value: 1, min: "0", title: "Default qty" });

  const addProductLine = (p, qty, packs) => {
    const rules = customerRules(docBuilder.customerId);
    const { pct } = resolveDiscount(p, rules);
    const listRate = Number(p.rate) || 0;
    const netRate = pct ? +(listRate * (1 - pct / 100)).toFixed(2) : listRate;
    docBuilder.lineItems.push({
      partNumber: p.partNumber || String(docBuilder.lineItems.length + 1),
      description: p.description, unit: p.unit, qty: parseFloat(qty) || 1,
      rate: netRate, listRate: listRate, discountPct: pct,
      catPath: productPath(p),
      packQty: Number(p.packQty) || 0, packUnit: p.packUnit || "", packs: Number(packs) || 0,
      taxable: p.taxable, rateIncludesVat: !!p.rateIncludesVat, weight: p.weight || 0
    });
    recomputeTotals(); rerenderLI(); updateTotals(); updateGross();
    const packNote = packs ? ` (${packs} ${p.packUnit || "box"})` : "";
    toast(pct ? `Added ${p.description}${packNote} — ${pct}% off` : `Added ${p.description}${packNote}`);
  };

  const renderResults = () => {
    const terms = prodSearch.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    results.innerHTML = "";
    let matches = bizProducts().filter(p => {
      if (activePickCat && p.category !== activePickCat) return false;
      if (!terms.length) return true;
      const hay = [p.description, p.partNumber, p.category, p.subCategory1, p.subCategory2,
        p.subCategory3, p.hsn, p.unit, p.packUnit].filter(Boolean).join(" ").toLowerCase();
      return terms.every(t => hay.includes(t));
    });
    if (bizProducts().length === 0) {
      results.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", padding: "8px" } }, "No saved products yet — use \"New product\" to add one on the fly."));
      return;
    }
    if (matches.length === 0) {
      results.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", padding: "8px" } }, "No products match your search."));
      return;
    }
    matches.slice(0, 50).forEach(p => {
      const rules = customerRules(docBuilder.customerId);
      const { pct } = resolveDiscount(p, rules);
      const listRate = Number(p.rate) || 0;
      const netRate = pct ? +(listRate * (1 - pct / 100)).toFixed(2) : listRate;
      const row = el("div", { class: "prod-result-row" });
      const info = el("div", { style: { flex: "1", minWidth: "0" } });
      info.appendChild(el("div", { style: { fontWeight: 600, fontSize: "13px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, p.description));
      const metaRow = el("div", { style: { fontSize: "11px", color: "var(--muted)", display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" } });
      if (p.category) metaRow.appendChild(el("span", {}, p.category));
      if (pct) {
        metaRow.appendChild(el("span", { style: { textDecoration: "line-through", opacity: ".7" } }, `${activeBiz().currency} ${fmt(listRate)}`));
        metaRow.appendChild(el("span", { style: { color: "var(--accent)", fontWeight: 700 } }, `${activeBiz().currency} ${fmt(netRate)}/${p.unit}`));
        metaRow.appendChild(el("span", { class: "disc-badge" }, `-${pct}%`));
      } else {
        metaRow.appendChild(el("span", {}, `${activeBiz().currency} ${fmt(listRate)}/${p.unit}`));
      }
      info.appendChild(metaRow);
      row.appendChild(info);
      const packN = Number(p.packQty) || 0;
      const qtyInp = el("input", { type: "number", value: existQty.value || 1, min: "0", style: { width: "56px", flex: "none", textAlign: "right" }, title: "Qty" });
      row.appendChild(qtyInp);
      if (packN > 0) {
        // Toggle between entering loose units and whole packs.
        const modeSel = el("select", { style: { width: "70px", flex: "none", fontSize: "11px", padding: "5px" } });
        modeSel.appendChild(el("option", { value: "unit" }, p.unit));
        modeSel.appendChild(el("option", { value: "pack" }, p.packUnit || "box"));
        row.appendChild(modeSel);
        const conv = el("div", { style: { fontSize: "10px", color: "var(--muted)", flex: "none", minWidth: "58px" } });
        const drawConv = () => {
          const q = parseFloat(qtyInp.value) || 0;
          conv.textContent = modeSel.value === "pack" ? `= ${q * packN} ${p.unit}` : (q >= packN && packN ? `≈ ${(q / packN).toFixed(2)} ${p.packUnit || "box"}` : "");
        };
        qtyInp.addEventListener("input", drawConv);
        modeSel.addEventListener("change", drawConv);
        drawConv();
        row.appendChild(conv);
        row.appendChild(el("button", { class: "btn btn-primary", style: { flex: "none", padding: "7px 12px" },
          onclick: () => {
            const q = parseFloat(qtyInp.value) || 0;
            addProductLine(p, modeSel.value === "pack" ? q * packN : q, modeSel.value === "pack" ? q : 0);
          } }, "+ Add"));
      } else {
        row.appendChild(el("button", { class: "btn btn-primary", style: { flex: "none", padding: "7px 12px" }, onclick: () => addProductLine(p, qtyInp.value) }, "+ Add"));
      }
      results.appendChild(row);
    });
  };

  if (pickerCats.length) {
    const mkChip = (label, val) => {
      const chip = el("button", { type: "button", class: "pick-chip" + (activePickCat === val ? " active" : ""), onclick: () => {
        activePickCat = val;
        catChipRow.querySelectorAll(".pick-chip").forEach(c => c.classList.remove("active"));
        chip.classList.add("active");
        renderResults();
      }}, label);
      return chip;
    };
    catChipRow.appendChild(mkChip("All", ""));
    pickerCats.forEach(c => catChipRow.appendChild(mkChip(c, c)));
    existingPane.appendChild(catChipRow);
  }

  const qtyHintRow = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px", fontSize: "12px", color: "var(--muted)" } });
  qtyHintRow.appendChild(el("span", {}, "Default qty:"));
  qtyHintRow.appendChild(existQty);
  existingPane.appendChild(qtyHintRow);

  prodSearch.addEventListener("input", renderResults);
  existingPane.appendChild(results);
  renderResults();

  // Compatibility shim: the "new product" save handler calls fillProdSel() to
  // refresh the picker after adding to the catalog. Re-render the results list.
  const fillProdSel = () => renderResults();

  addWrap.appendChild(existingPane);

  // --- Pane: new / ad-hoc product ---
  const newPane = el("div", { class: "seg-pane", style: { display: "none" } });
  const np = { description: "", unit: "pcs", qty: 1, rate: 0, weight: 0, taxable: true, saveToCatalog: true };
  const npDescField = el("div", { class: "field" });
  npDescField.appendChild(el("label", {}, "Description *"));
  const npDesc = el("input", { placeholder: "e.g. 4 inch PVC pipe", value: np.description, oninput: (e) => np.description = e.target.value });
  npDescField.appendChild(npDesc);
  newPane.appendChild(npDescField);
  const npRow = el("div", { class: "row" });
  const npUnitField = el("div", { class: "field" });
  npUnitField.appendChild(el("label", {}, "Unit"));
  const npUnit = el("select");
  bizUnits().forEach(u => npUnit.appendChild(el("option", { value: u, selected: u === np.unit ? "" : undefined }, u)));
  npUnit.value = np.unit;
  npUnit.addEventListener("change", (e) => np.unit = e.target.value);
  npUnitField.appendChild(npUnit);
  npRow.appendChild(npUnitField);
  const npQtyField = el("div", { class: "field" });
  npQtyField.appendChild(el("label", {}, "Qty"));
  const npQty = el("input", { type: "number", value: np.qty, oninput: (e) => np.qty = parseFloat(e.target.value) || 0 });
  npQtyField.appendChild(npQty);
  npRow.appendChild(npQtyField);
  const npRateField = el("div", { class: "field" });
  npRateField.appendChild(el("label", {}, "Rate *"));
  const npRate = el("input", { type: "number", value: np.rate, oninput: (e) => np.rate = parseFloat(e.target.value) || 0 });
  npRateField.appendChild(npRate);
  npRow.appendChild(npRateField);
  newPane.appendChild(npRow);
  const npSaveChip = el("label", { class: "chip-check" });
  const npSaveCb = el("input", { type: "checkbox", checked: "" });
  npSaveCb.checked = true;
  npSaveCb.addEventListener("change", (e) => np.saveToCatalog = e.target.checked);
  npSaveChip.appendChild(npSaveCb);
  npSaveChip.appendChild(el("span", {}, "Also save this as a product in my catalog"));
  newPane.appendChild(npSaveChip);
  const npAddBtn = el("button", { class: "btn btn-green btn-full", style: { marginTop: 8 }, onclick: () => {
    if (!np.description.trim()) { toast("Description required", "err"); return; }
    docBuilder.lineItems.push({
      partNumber: String(docBuilder.lineItems.length + 1),
      description: np.description.trim(), unit: np.unit, qty: np.qty || 1, rate: np.rate || 0, taxable: np.taxable, weight: np.weight || 0
    });
    if (np.saveToCatalog) {
      db.products.push({
        id: uid("prod"), businessId: db.activeBusinessId, partNumber: "", description: np.description.trim(),
        unit: np.unit, rate: np.rate || 0, weight: 0, taxable: np.taxable, hsn: "", notes: ""
      });
      saveDB();
      fillProdSel(prodSearch.value);
    }
    recomputeTotals(); rerenderLI(); updateTotals(); updateGross();
    npDesc.value = ""; np.description = ""; npQty.value = 1; np.qty = 1; npRate.value = 0; np.rate = 0;
    toast(np.saveToCatalog ? "Added & saved to catalog" : "Line item added");
  }}, "+ Add to document");
  newPane.appendChild(npAddBtn);
  addWrap.appendChild(newPane);

  // --- Pane: bulk paste ---
  const bulkPane = el("div", { class: "seg-pane", style: { display: "none" } });
  bulkPane.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "6px" } },
    "One item per line: Description, Qty, Rate, Unit (unit optional). If the description matches a saved product, its rate/unit/tax are used automatically — otherwise the pasted values are used as-is."));
  const bulkTa = el("textarea", { rows: 6, placeholder: "4 inch PVC pipe, 50, 350, m\n1/2 inch CPVC elbow, 100, 45" });
  bulkPane.appendChild(bulkTa);
  const bulkAddBtn = el("button", { class: "btn btn-green btn-full", style: { marginTop: 8 }, onclick: () => {
    const lines = bulkTa.value.split("\n").map(l => l.trim()).filter(Boolean);
    let added = 0, skipped = 0;
    lines.forEach(line => {
      const parts = line.split(",").map(p => p.trim());
      const [description, qtyStr = "1", rateStr, unit] = parts;
      if (!description) { skipped++; return; }
      const match = bizProducts().find(p => p.description.toLowerCase() === description.toLowerCase());
      docBuilder.lineItems.push({
        partNumber: (match && match.partNumber) || String(docBuilder.lineItems.length + 1),
        description: match ? match.description : description,
        unit: unit || (match ? match.unit : "pcs"),
        qty: parseFloat(qtyStr) || 1,
        rate: rateStr !== undefined && rateStr !== "" ? (parseFloat(rateStr) || 0) : (match ? match.rate : 0),
        taxable: match ? match.taxable : true,
        weight: match ? (match.weight || 0) : 0
      });
      added++;
    });
    recomputeTotals(); rerenderLI(); updateTotals(); updateGross();
    bulkTa.value = "";
    toast(skipped ? `Added ${added}, skipped ${skipped}` : `Added ${added} line item${added === 1 ? "" : "s"}`);
  }}, "+ Add all to document");
  bulkPane.appendChild(bulkAddBtn);
  addWrap.appendChild(bulkPane);

  const setMode = (mode) => {
    tabExisting.classList.toggle("active", mode === "existing");
    tabNew.classList.toggle("active", mode === "new");
    tabBulk.classList.toggle("active", mode === "bulk");
    existingPane.style.display = mode === "existing" ? "" : "none";
    newPane.style.display = mode === "new" ? "" : "none";
    bulkPane.style.display = mode === "bulk" ? "" : "none";
  };
  tabExisting.addEventListener("click", () => setMode("existing"));
  tabNew.addEventListener("click", () => setMode("new"));
  tabBulk.addEventListener("click", () => setMode("bulk"));

  liCard.appendChild(addWrap);
  wrap.appendChild(liCard);

  wrap = steps.charges;
  wrap.appendChild(checkboxField("Separate VAT from prices", "separateVat", docBuilder, () => { recomputeTotals(); updateTotals(); }));
  // Totals
  const totCard = el("div", { class: "card totals" });
  const totCt = el("div", { id: "tot-ct" });
  const totDisplays = {};
  const updateTotals = () => {
    totCt.innerHTML = "";
    const t = docBuilder.totals;
    if (docBuilder._onTotals) docBuilder._onTotals();
    const rowT = (l, v, key) => {
      const r = el("div", { class: "totals-row" });
      r.appendChild(el("div", {}, l));
      const ve = el("div", {}, `${docBuilder.currency} ${fmt(v)}`);
      if (key) totDisplays[key] = ve;
      r.appendChild(ve);
      return r;
    };
    const rowInp = (l, k) => {
      const r = el("div", { class: "totals-row" });
      r.appendChild(el("div", {}, l));
      const i = el("input", { type: "number", inputmode: "decimal", value: t[k] || 0, style: { width: "100px", textAlign: "right" }, oninput: (e) => { t[k] = parseFloat(e.target.value) || 0; recomputeTotals(); refreshTotals(); }});
      r.appendChild(i);
      return r;
    };
    totCt.appendChild(rowT("Subtotal", t.subtotal, "subtotal"));
    totCt.appendChild(rowT("Taxable", t.taxable, "taxable"));
    const taxRow = el("div", { class: "totals-row" });
    taxRow.appendChild(el("div", {}, "Tax rate %"));
    taxRow.appendChild(el("input", { type: "number", inputmode: "decimal", value: t.taxRate, style: { width: "100px", textAlign: "right" }, oninput: (e) => { t.taxRate = parseFloat(e.target.value) || 0; recomputeTotals(); refreshTotals(); }}));
    totCt.appendChild(taxRow);
    totCt.appendChild(rowT("Tax", t.tax, "tax"));
    totCt.appendChild(rowInp("Delivery", "delivery"));
    if (docBuilder.type !== "QT") {
      totCt.appendChild(rowInp("Freight", "freight"));
      totCt.appendChild(rowInp("Insurance", "insurance"));
      totCt.appendChild(rowInp("Legal/Consular", "legal"));
      totCt.appendChild(rowInp("Inspection/Cert.", "inspection"));
    }
    totCt.appendChild(rowT("TOTAL", t.total, "total"));
    const gr = el("div", { class: "totals-row grand" });
    gr.appendChild(el("div", {}, "GRAND TOTAL"));
    const grv = el("div", {}, `${docBuilder.currency} ${fmt(t.total)}`);
    totDisplays.grand = grv;
    gr.appendChild(grv);
    totCt.appendChild(gr);
  };
  const refreshTotals = () => {
    const t = docBuilder.totals;
    if (docBuilder._onTotals) docBuilder._onTotals();
    if (totDisplays.subtotal) totDisplays.subtotal.textContent = `${docBuilder.currency} ${fmt(t.subtotal)}`;
    if (totDisplays.taxable) totDisplays.taxable.textContent = `${docBuilder.currency} ${fmt(t.taxable)}`;
    if (totDisplays.tax) totDisplays.tax.textContent = `${docBuilder.currency} ${fmt(t.tax)}`;
    if (totDisplays.total) totDisplays.total.textContent = `${docBuilder.currency} ${fmt(t.total)}`;
    if (totDisplays.grand) totDisplays.grand.textContent = `${docBuilder.currency} ${fmt(t.total)}`;
  };
  updateTotals();
  totCard.appendChild(totCt);
  wrap.appendChild(totCard);

  // ---- Delivery step (delivery notes only) ----
  if (isDelivery) {
    if (!docBuilder.delivery) docBuilder.delivery = { mode: "own", driverName: "", driverPhone: "", transportCompany: "", vehicleNo: "" };
    wrap = steps.delivery;
    const dl = docBuilder.delivery;
    const dCard = el("div", { class: "card" });
    dCard.appendChild(el("div", { class: "card-title" }, "Delivery details"));

    const modeRow = el("div", { class: "seg-tabs", style: { marginBottom: "12px" } });
    const drawDeliveryFields = () => {
      fieldsBox.innerHTML = "";
      if (dl.mode === "transport") {
        fieldsBox.appendChild(inputField("Transport company", "transportCompany", dl));
        fieldsBox.appendChild(el("div", { class: "row" }, [
          inputField("Driver name (optional)", "driverName", dl),
          inputField("Driver phone (optional)", "driverPhone", dl),
        ]));
      } else {
        fieldsBox.appendChild(el("div", { class: "row" }, [
          inputField("Driver name", "driverName", dl),
          inputField("Driver phone", "driverPhone", dl),
        ]));
      }
      fieldsBox.appendChild(inputField("Vehicle / plate no. (optional)", "vehicleNo", dl));
    };
    const mkMode = (key, label) => {
      const b = el("button", { class: "seg-tab" + (dl.mode === key ? " active" : ""), type: "button", onclick: () => {
        dl.mode = key;
        modeRow.querySelectorAll(".seg-tab").forEach(x => x.classList.remove("active"));
        b.classList.add("active");
        drawDeliveryFields();
      }}, label);
      return b;
    };
    modeRow.appendChild(mkMode("own", "Own delivery"));
    modeRow.appendChild(mkMode("transport", "Transport company"));
    dCard.appendChild(modeRow);
    const fieldsBox = el("div");
    dCard.appendChild(fieldsBox);
    drawDeliveryFields();
    wrap.appendChild(dCard);
  }

  wrap = steps.details;

  // Export block toggle
  const expWrap = el("div", { class: "card", style: { padding: "12px", background: "#f9fafb" } });
  expWrap.appendChild(checkboxField("Show Export Details (Country of Origin, Ports, EXIM)", "showExport", docBuilder, () => {
    expWrap.querySelectorAll(".export-fields").forEach(x => x.style.display = docBuilder.showExport ? "" : "none");
  }));
  const expFields = el("div", { class: "export-fields", style: { display: docBuilder.showExport ? "" : "none" } });
  expFields.appendChild(el("div", { class: "row" }, [
    inputField("Country of Origin", "origin", docBuilder.additional),
    inputField("Port of Embarkation", "embarkation", docBuilder.additional),
    inputField("Port of Discharge", "discharge", docBuilder.additional),
  ]));
  expFields.appendChild(inputField("Reason for Export", "reason", docBuilder.additional));
  expWrap.appendChild(expFields);
  wrap.appendChild(expWrap);

  // Terms of Sale — toggle + editable text (defaults to on).
  if (docBuilder.showTerms === undefined) docBuilder.showTerms = true;
  if (!docBuilder.terms) docBuilder.terms = defaultTermsFor(activeBiz());
  const termsWrap = el("div", { class: "card", style: { padding: "12px", background: "#f9fafb" } });
  termsWrap.appendChild(checkboxField("Show Terms of Sale & other comments", "showTerms", docBuilder, () => {
    termsBody.style.display = docBuilder.showTerms ? "" : "none";
  }));
  const termsBody = el("div", { style: { display: docBuilder.showTerms ? "" : "none" } });
  const bizPresets = (activeBiz().termsPresets || []);
  if (bizPresets.length) {
    const pickRow = el("div", { style: { display: "flex", gap: "6px", marginBottom: "8px" } });
    const sel = el("select", { style: { flex: "1" } });
    sel.appendChild(el("option", { value: "" }, "Apply a saved preset…"));
    bizPresets.forEach((p, i) => sel.appendChild(el("option", { value: String(i) }, p.name)));
    pickRow.appendChild(sel);
    pickRow.appendChild(el("button", { class: "btn btn-secondary", type: "button", style: { flex: "none" }, onclick: () => {
      if (sel.value === "") return;
      docBuilder.terms = bizPresets[Number(sel.value)].text;
      const ta = termsBody.querySelector("textarea");
      if (ta) ta.value = docBuilder.terms;
      sel.value = "";
    }}, "Apply"));
    termsBody.appendChild(pickRow);
  }
  termsBody.appendChild(inputField("Terms text", "terms", docBuilder, { textarea: true, rows: 4 }));
  termsWrap.appendChild(termsBody);
  wrap.appendChild(termsWrap);

  // Banking details — on by default whenever the business has an account saved,
  // pre-selected to the Settings default. Both are overridable per document.
  const banks = Array.isArray(activeBiz().banks) ? activeBiz().banks.filter(b => b.bankName || b.accountNumber) : [];
  if (docBuilder.showBanks === undefined) docBuilder.showBanks = hasUsableBank(activeBiz());
  if (docBuilder.bankId === undefined || docBuilder.bankId === null) docBuilder.bankId = activeBiz().defaultBankId || "";
  const bankWrap = el("div", { class: "card", style: { padding: "12px", background: "#f9fafb" } });
  bankWrap.appendChild(checkboxField("Show banking details", "showBanks", docBuilder, () => {
    bankBody.style.display = docBuilder.showBanks ? "" : "none";
  }));
  const bankBody = el("div", { style: { display: docBuilder.showBanks ? "" : "none" } });
  if (!banks.length) {
    bankBody.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)" } }, "No bank accounts saved. Add one in Settings → Bank accounts."));
  } else {
    const bf = el("div", { class: "field" });
    bf.appendChild(el("label", {}, "Account to show"));
    const bs = el("select", { onchange: (e) => docBuilder.bankId = e.target.value || "" });
    bs.appendChild(el("option", { value: "" }, "All accounts"));
    banks.forEach(b => {
      const o = el("option", { value: b.id }, [b.bankName, b.accountNumber].filter(Boolean).join(" — "));
      if (docBuilder.bankId === b.id) o.selected = true;
      bs.appendChild(o);
    });
    bf.appendChild(bs);
    bankBody.appendChild(bf);
  }
  bankWrap.appendChild(bankBody);
  wrap.appendChild(bankWrap);

  // Status
  const stField = el("div", { class: "field" });
  stField.appendChild(el("label", {}, "Status"));
  const stSel = el("select", { onchange: (e) => docBuilder.status = e.target.value });
  ["Draft", "Sent", "Confirmed", "Cancelled"].forEach(s => {
    const o = el("option", { value: s }, s);
    if (docBuilder.status === s) o.selected = true;
    stSel.appendChild(o);
  });
  stField.appendChild(stSel);
  wrap.appendChild(stField);

  // ---- Assemble the stepped shell ----
  const saveDoc = () => {
    if (!docBuilder.customerId) { goStep("party"); toast("Select a customer first", "err"); return; }
    if (docBuilder.lineItems.length === 0) { goStep("items"); toast("Add at least one line item", "err"); return; }
    recomputeTotals();
    // Drop transient builder-only keys before persisting.
    delete docBuilder._onTotals;
    if (docBuilder._editing) {
      const idx = db.documents.findIndex(d => d.id === docBuilder.id);
      db.documents[idx] = { ...docBuilder };
    } else {
      docBuilder.id = uid("doc");
      db.documents.push(docBuilder);
      const biz = activeBiz();
      biz[DOC_TYPES[docBuilder.type].seqKey] = docBuilder._seq + 1;
    }
    saveDB();
    const saved = docBuilder;
    closeModal();
    openDocPreview(saved);
    toast(`${DOC_TYPES[saved.type].shortLabel} #${saved.number} saved`);
  };

  const shell = el("div", { class: "builder-shell" });
  const tabsBar = el("div", { class: "step-tabs" });
  const body = el("div", { class: "step-body" });
  STEP_ORDER.forEach(k => body.appendChild(steps[k]));

  const footer = el("div", { class: "step-footer" });
  const totalLine = el("div", { class: "step-total" });
  const footBtns = el("div", { class: "step-foot-btns" });

  let current = "party";
  const stepTabEls = {};

  const refreshFooter = () => {
    const t = docBuilder.totals || {};
    totalLine.innerHTML = "";
    const n = docBuilder.lineItems.length;
    totalLine.appendChild(el("div", { class: "step-total-amt" },
      `${docBuilder.currency} ${fmt(t.total || 0)}`));
    const bits = [`${n} item${n === 1 ? "" : "s"}`];
    if (t.discountGiven > 0) bits.push(`${fmt(t.discountGiven)} off`);
    totalLine.appendChild(el("div", { class: "step-total-sub" }, bits.join(" • ")));
  };

  const goStep = (k) => {
    current = k;
    STEP_ORDER.forEach(s => {
      steps[s].style.display = s === k ? "" : "none";
      if (stepTabEls[s]) stepTabEls[s].classList.toggle("active", s === k);
    });
    // footer buttons adapt to position
    footBtns.innerHTML = "";
    const pos = STEP_ORDER.indexOf(k);
    if (pos > 0) footBtns.appendChild(el("button", { class: "btn btn-secondary", onclick: () => goStep(STEP_ORDER[pos - 1]) }, "Back"));
    if (pos < STEP_ORDER.length - 1) {
      footBtns.appendChild(el("button", { class: "btn btn-primary", onclick: () => goStep(STEP_ORDER[pos + 1]) }, "Next"));
      footBtns.appendChild(el("button", { class: "btn btn-secondary step-save-alt", onclick: saveDoc, title: "Save now" }, "Save"));
    } else {
      footBtns.appendChild(el("button", { class: "btn btn-primary", onclick: saveDoc }, "Save & Preview"));
    }
    refreshFooter();
    body.scrollTop = 0;
  };

  STEP_ORDER.forEach(k => {
    const tab = el("button", { class: "step-tab", onclick: () => goStep(k) });
    tab.appendChild(el("span", { class: "step-tab-label" }, STEP_LABELS[k]));
    stepTabEls[k] = tab;
    tabsBar.appendChild(tab);
  });

  footer.appendChild(totalLine);
  footer.appendChild(footBtns);
  shell.appendChild(tabsBar);
  shell.appendChild(body);
  shell.appendChild(footer);

  // keep the footer total live as items/charges change
  docBuilder._onTotals = refreshFooter;
  goStep("party");

  openModal(`${docBuilder._editing ? "Edit" : "New"} ${DOC_TYPES[docBuilder.type].label}`, shell, { wide: true });
};

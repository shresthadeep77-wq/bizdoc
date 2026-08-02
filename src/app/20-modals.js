// ==================== MODALS ====================
const openModal = (title, contentEl, opts = {}) => {
  const bg = el("div", { class: "modal-bg", onclick: (e) => { if (e.target === bg) attemptClose(); } });
  const m = el("div", { class: "modal" + (opts.wide ? " modal-wide" : "") + (opts.settings ? " modal-settings" : "") + (opts.flush ? " modal-flush" : "") });
  const h = el("div", { class: "modal-header" });
  h.appendChild(el("h2", {}, title));
  h.appendChild(el("button", { class: "modal-close", onclick: () => attemptClose() }, "×"));
  const body = el("div", { class: "modal-body" });
  body.appendChild(contentEl);
  m.appendChild(h);
  m.appendChild(body);
  if (opts.footer) m.appendChild(opts.footer);
  bg.appendChild(m);
  // Track edits so closing doesn't silently throw away typed work.
  bg._guard = opts.guard !== false;
  bg._dirty = false;
  m.addEventListener("input", (e) => {
    const t = (e.target.tagName || "").toLowerCase();
    if (t === "input" || t === "textarea" || t === "select") bg._dirty = true;
  });
  // Reserve exactly one history entry for the whole chain of modals (not one
  // per modal) — nested modals (e.g. "add customer" opened from inside the
  // doc builder) share it. The phone's back button then closes the chain
  // instead of leaving the app.
  if (modalStack.length === 0 && !modalHistoryPushed) {
    history.pushState({ ppmModal: true }, "");
    modalHistoryPushed = true;
  }
  modalStack.push(bg);
  document.getElementById("app").appendChild(bg);
  document.body.classList.add("modal-open");
};

// Close the top modal, asking first if the user typed something they'd lose.
const attemptClose = () => {
  const top = modalStack[modalStack.length - 1];
  if (top && top._guard && top._dirty) {
    confirmModal("Discard your changes?", () => { closeModal(); },
      { confirmLabel: "Discard", cancelLabel: "Keep editing" });
    return;
  }
  closeModal();
};
// Closes only the topmost modal — any modal underneath (e.g. a document you were
// mid-way through building) reappears exactly as you left it.
const closeModal = () => {
  const bg = modalStack.pop();
  if (bg && bg.parentNode) bg.parentNode.removeChild(bg);
  if (!modalStack.length) {
    document.body.classList.remove("modal-open");
    // Nothing left open — refresh the underlying view so edits made in the
    // modal show immediately (no page reload needed).
    render();
  }
};

// Physical/gesture back button: close whatever modal chain is open instead of
// navigating the browser away from the app. If nothing is open, this is just
// the reserved entry being consumed by a real "leave the app" navigation.
window.addEventListener("popstate", () => {
  modalHistoryPushed = false;
  if (modalStack.length) {
    modalStack = [];
    render();
  }
});

// Styled confirmation modal — replaces native confirm() so destructive actions
// match the app's look instead of a browser popup. Cancel just closes; Confirm
// closes then runs onConfirm.
const confirmModal = (message, onConfirm, opts = {}) => {
  const wrap = el("div");
  wrap.appendChild(el("div", { style: { fontSize: "14px", lineHeight: "1.5", color: "var(--text)", marginBottom: "18px" } }, message));
  const actions = el("div", { class: "action-bar" });
  actions.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, opts.cancelLabel || "Cancel"));
  const confirmBtn = el("button", { class: opts.danger === false ? "btn btn-primary" : "btn btn-danger", onclick: () => {
    closeModal();
    onConfirm();
  }}, opts.confirmLabel || "Confirm");
  if (opts.typeToConfirm) {
    confirmBtn.disabled = true;
    const tf = el("div", { class: "field" });
    tf.appendChild(el("label", {}, `Type "${opts.typeToConfirm}" to confirm`));
    tf.appendChild(el("input", { oninput: (e) => { confirmBtn.disabled = e.target.value !== opts.typeToConfirm; } }));
    wrap.appendChild(tf);
  }
  actions.appendChild(confirmBtn);
  wrap.appendChild(actions);
  openModal(opts.title || "Are you sure?", wrap, { guard: false });
};

const openBusinessModal = () => {
  const form = renderBusinessForm(null, (biz) => {
    biz.id = uid("biz"); biz.nextPi = biz.nextPi || 1; biz.nextPo = biz.nextPo || 1; biz.nextQt = biz.nextQt || 1; biz.nextInv = biz.nextInv || 1; biz.nextDn = biz.nextDn || 1;
    db.businesses.push(biz); db.activeBusinessId = biz.id; saveDB();
    closeModal();
    toast(`"${biz.name}" added`);
  });
  openModal("New business", form);
};

const openCustomerModal = (existing, onCreated) => {
  const data = existing ? { ...existing } : {
    contactName: "", companyName: "", phone: "", vatNo: "", addr1: "", addr2: "",
    regNo: "", shipAddr1: "", shipAddr2: "", email: "", eximCode: "", country: "NEPAL",
    sameAsBill: true, businessId: db.activeBusinessId, discountRules: []
  };
  if (!Array.isArray(data.discountRules)) data.discountRules = [];
  else data.discountRules = data.discountRules.map(r => ({ ...r }));
  const wrap = el("div");
  wrap.appendChild(el("div", { style: { fontWeight: 600, marginBottom: 8, color: "#1F4E79" } }, "Bill-to (Customer)"));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Contact Name *", "contactName", data),
    inputField("Company Name *", "companyName", data),
  ]));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Phone (for WhatsApp) *", "phone", data, { hint: "Include country code, e.g., 9779851158034" }),
    inputField("VAT / PAN No.", "vatNo", data, { hint: "Party's VAT or PAN number" }),
  ]));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Address Line 1", "addr1", data),
    inputField("Address Line 2", "addr2", data),
  ]));

  const shipWrap = el("div");
  const rerenderShip = () => {
    shipWrap.innerHTML = "";
    shipWrap.appendChild(el("div", { style: { fontWeight: 600, marginBottom: 8, marginTop: 12, color: "#1F4E79" } }, "Ship-to"));
    shipWrap.appendChild(checkboxField("Same as Bill-to", "sameAsBill", data, rerenderShip));
    if (!data.sameAsBill) {
      shipWrap.appendChild(inputField("Registration No.", "regNo", data));
      shipWrap.appendChild(el("div", { class: "row" }, [
        inputField("Ship Address 1", "shipAddr1", data),
        inputField("Ship Address 2", "shipAddr2", data),
      ]));
    }
    shipWrap.appendChild(el("div", { class: "row" }, [
      inputField("Email", "email", data),
      inputField("Country", "country", data),
    ]));
    shipWrap.appendChild(inputField("EXIM Code (export only)", "eximCode", data));
  };
  rerenderShip();
  wrap.appendChild(shipWrap);

  // ---- Discount rate card ----
  const discBox = el("div", { class: "card", style: { marginTop: "12px" } });
  discBox.appendChild(el("div", { class: "card-title" }, "Discount rate card"));
  discBox.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginBottom: "8px" } },
    "Set a % on any category level. Everything inside that level inherits it; a deeper rule overrides."));
  const rulesList = el("div");
  const drawRules = () => {
    rulesList.innerHTML = "";
    if (!data.discountRules.length) {
      rulesList.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", padding: "8px 0" } },
        "No discounts — this customer pays list price."));
    }
    data.discountRules.forEach((r, i) => {
      const row = el("div", { class: "rule-row" });
      row.appendChild(el("div", { style: { fontWeight: 600, fontSize: "12.5px" } }, pathKey(r.path)));
      const subRow = el("div", { class: "rule-subrow" });
      const depthNote = (r.path || []).length > 1 ? "applies to this level and below" : "applies to whole category";
      subRow.appendChild(el("div", { style: { fontSize: "10.5px", color: "var(--muted)", flex: "1", minWidth: "0" } }, depthNote));
      const pctInp = el("input", { type: "number", value: r.pct, min: "0", max: "100", step: "0.5",
        style: { width: "52px", flex: "none", textAlign: "right", border: "none", padding: "0", background: "transparent" },
        oninput: (e) => { r.pct = parseFloat(e.target.value) || 0; } });
      const pctGroup = el("div", { class: "pct-group" }, [pctInp, el("span", {}, "%")]);
      subRow.appendChild(pctGroup);
      subRow.appendChild(el("button", { class: "btn-icon danger", title: "Remove",
        onclick: () => { data.discountRules.splice(i, 1); drawRules(); } }, "🗑"));
      row.appendChild(subRow);
      rulesList.appendChild(row);
    });
  };
  drawRules();
  discBox.appendChild(rulesList);
  discBox.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginTop: "8px" }, onclick: () => {
    if (!bizProducts().length) { toast("Add products with categories first", "err"); return; }
    const existingPaths = data.discountRules.map(r => r.path || []);
    openCategoryPicker((paths) => {
      let added = 0, skipped = 0;
      paths.forEach(path => {
        const key = pathKey(path);
        if (data.discountRules.some(r => pathKey(r.path) === key)) { skipped++; return; }
        data.discountRules.push({ path, pct: 0 });
        added++;
      });
      drawRules();
      if (added && skipped) toast(`Added ${added} — ${skipped} already existed`);
      else if (added) toast(`Added ${added} categor${added === 1 ? "y" : "ies"} — set the %`);
      else if (skipped) toast("All already in the list", "err");
    }, { multi: true, excludePaths: existingPaths });
  }}, "+ Add category discount"));
  wrap.appendChild(discBox);

  wrap.appendChild(el("button", { class: "btn btn-primary btn-full", style: { marginTop: "12px" }, onclick: () => {
    if (!data.companyName.trim() || !data.phone.trim()) { toast("Company name and phone required", "err"); return; }
    let isNew = false;
    if (existing) { Object.assign(existing, data); }
    else { data.id = uid("cust"); db.customers.push(data); isNew = true; }
    saveDB(); closeModal();
    if (isNew && onCreated) onCreated(data);
    else toast(isNew ? "Customer added" : "Customer saved");
  }}, existing ? "Save" : "Add customer"));
  openModal(existing ? "Edit customer" : "New customer", wrap);
};

// Recompute totals for an already-saved document (used when bulk-updating a
// product's rate across past documents). Mirrors recomputeTotals(), which
// only works on the in-progress docBuilder.
const recomputeDocTotalsFor = (d) => {
  const t = d.totals || (d.totals = {});
  const lis = d.lineItems || [];
  t.subtotal = lis.reduce((s, li) => s + (li.qty * li.rate), 0);
  t.discountGiven = lis.reduce((s, li) => {
    const list = Number(li.listRate);
    if (!list && list !== 0) return s;
    return s + (li.qty * Math.max(0, list - li.rate));
  }, 0);
  t.taxable = lis.filter(li => li.taxable).reduce((s, li) => s + (li.qty * li.rate), 0);
  t.tax = t.taxable * ((t.taxRate || 0) / 100);
  t.total = t.subtotal + t.tax + Number(t.delivery || 0) + Number(t.freight || 0) + Number(t.insurance || 0)
    + Number(t.legal || 0) + Number(t.inspection || 0) + Number(t.other1 || 0) + Number(t.other2 || 0);
};

// After a product's rate is edited, offer to push the new rate into every
// past document that still uses this product — instead of leaving old PI/PO
// documents quoting the stale rate.
const offerRateUpdate = (product, oldRate, newRate) => {
  const affected = bizDocs().filter(d => (d.lineItems || []).some(li => li.productId === product.id));
  if (!affected.length) return;
  const cur = activeBiz()?.currency || "NPR";
  const wrap = el("div");
  wrap.appendChild(el("div", { style: { marginBottom: "12px", fontSize: "13px" } },
    `Rate for "${product.description}" changed from ${cur} ${fmt(oldRate)} to ${cur} ${fmt(newRate)}. Update it in these existing documents too?`));
  const list = el("div", { style: { maxHeight: "280px", overflowY: "auto", marginBottom: "12px", border: "1px solid var(--border)", borderRadius: "8px" } });
  const rows = [];
  affected.forEach(d => {
    const lineCount = d.lineItems.filter(li => li.productId === product.id).length;
    const row = el("label", { style: { display: "flex", alignItems: "center", gap: "10px", padding: "8px 10px", borderBottom: "1px solid var(--border)", cursor: "pointer" } });
    const cb = el("input", { type: "checkbox", checked: d.status !== "Cancelled" });
    rows.push({ cb, doc: d });
    row.appendChild(cb);
    row.appendChild(el("div", { style: { flex: "1" } }, [
      el("div", { style: { fontWeight: 600 } }, `${d.type} #${d.number} — ${d.status || "Draft"}`),
      el("div", { style: { fontSize: "11px", color: "var(--muted)" } }, `${lineCount} line item(s) using this product`),
    ]));
    list.appendChild(row);
  });
  wrap.appendChild(list);
  wrap.appendChild(el("button", { class: "btn btn-primary btn-full", onclick: () => {
    let updated = 0;
    rows.forEach(({ cb, doc }) => {
      if (!cb.checked) return;
      doc.lineItems.forEach(li => { if (li.productId === product.id) { li.rate = newRate; li.listRate = newRate; } });
      recomputeDocTotalsFor(doc);
      updated++;
    });
    if (updated) saveDB();
    closeModal();
    toast(updated ? `Rate updated in ${updated} document${updated === 1 ? "" : "s"}` : "No documents updated");
    render();
  }}, "Update selected documents"));
  wrap.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginTop: "8px" }, onclick: closeModal }, "Skip — leave documents as they are"));
  openModal("Update rate in existing documents?", wrap);
};

const openProductModal = (existing) => {
  const data = existing ? { ...existing } : {
    partNumber: "", description: "", unit: "pcs", rate: 0, weight: 0,
    taxable: true, rateIncludesVat: false, hsn: "", notes: "", businessId: db.activeBusinessId,
    category: "", subCategory1: "", subCategory2: "", subCategory3: "",
    packQty: 0, packUnit: "box", rateBasis: "pcs", kgRate: 0
  };
  if (!data.rateBasis) data.rateBasis = "pcs";
  const wrap = el("div");

  // Unit — options depend on the category level chosen below (level-wise units).
  const unitFieldWrap = el("div", { class: "field" });
  unitFieldWrap.appendChild(el("label", {}, "Unit"));
  const unitSelect = el("select", { onchange: (e) => { data.unit = e.target.value; } });
  const refreshUnitOptions = (forceDefault) => {
    const path = productPath(data);
    const opts = unitsForCategoryPath(path);
    if (forceDefault) {
      const def = defaultUnitForCategoryPath(path);
      if (def && opts.includes(def)) data.unit = def;
    }
    const cur = data.unit;
    unitSelect.innerHTML = "";
    opts.forEach(o => {
      const opt = el("option", { value: o }, o);
      if (cur === o) opt.selected = true;
      unitSelect.appendChild(opt);
    });
    if (!opts.includes(cur)) { data.unit = opts[0] || ""; if (unitSelect.firstChild) unitSelect.firstChild.selected = true; }
  };
  refreshUnitOptions(!data.unit);
  unitFieldWrap.appendChild(unitSelect);

  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Part Number", "partNumber", data),
    unitFieldWrap,
  ]));
  wrap.appendChild(inputField("Description *", "description", data));

  // Category / Sub-categories
  const catPresets = ["PVC", "CPVC", "HDPE", "Borewell"];
  const usedCats = bizProducts().map(p => p.category);
  const usedSub1 = bizProducts().map(p => p.subCategory1);
  const usedSub2 = bizProducts().map(p => p.subCategory2);
  const usedSub3 = bizProducts().map(p => p.subCategory3);
  const catField = el("div", { class: "row" }, [
    comboField("Category", "category", data, [...catPresets, ...usedCats], { placeholder: "PVC / CPVC / HDPE / Borewell…", onChange: () => refreshUnitOptions(true) }),
    comboField("Sub Category 1", "subCategory1", data, usedSub1, { onChange: () => refreshUnitOptions(true) }),
  ]);
  wrap.appendChild(catField);
  wrap.appendChild(el("div", { class: "row" }, [
    comboField("Sub Category 2", "subCategory2", data, usedSub2, { onChange: () => refreshUnitOptions(true) }),
    comboField("Sub Category 3", "subCategory3", data, usedSub3, { onChange: () => refreshUnitOptions(true) }),
  ]));

  // ---- Pricing basis: per piece (e.g. fittings) vs per kg (e.g. HDPE pipe) ----
  const getCatDefault = (cat) => (activeBiz()?.categoryDefaults || {})[cat];
  const pricingBox = el("div", { class: "card", style: { marginTop: "10px" } });
  pricingBox.appendChild(el("div", { class: "card-title" }, "Pricing"));
  let basisTouched = !!existing; // only auto-apply category default for brand-new products
  const basisRow = el("div", { class: "row" });
  const basisSel = selectField("Rate Basis", "rateBasis", data, ["pcs", "kg"], {
    onChange: () => { basisTouched = true; drawPricingFields(); }
  });
  basisRow.appendChild(basisSel);
  pricingBox.appendChild(basisRow);
  const pricingFields = el("div");
  pricingBox.appendChild(pricingFields);
  const rememberRow = el("div", { class: "toggle-row" });
  const rememberCb = el("input", { type: "checkbox" });
  rememberRow.appendChild(rememberCb);
  rememberRow.appendChild(el("label", { style: { marginBottom: 0 } }, "Set as default pricing basis for this category"));
  pricingBox.appendChild(rememberRow);
  const drawPricingFields = () => {
    pricingFields.innerHTML = "";
    if (data.rateBasis === "kg") {
      const computedLine = el("div", { style: { fontSize: "12px", color: "var(--muted)", marginTop: "-6px", marginBottom: "8px" } });
      const refreshComputed = () => {
        data.rate = +((Number(data.kgRate) || 0) * (Number(data.weight) || 0)).toFixed(2);
        const c = (Number(data.kgRate) || 0) * (Number(data.weight) || 0);
        computedLine.textContent = c > 0 ? `= ${activeBiz()?.currency || ""} ${fmt(c)} per pcs (used on documents)` : "Enter both kg rate and weight per pcs.";
      };
      const kgRow = el("div", { class: "row" });
      kgRow.appendChild(inputField("Rate (per kg) *", "kgRate", data, { type: "number", onInput: refreshComputed }));
      kgRow.appendChild(inputField("Weight (kg per pcs) *", "weight", data, { type: "number", hint: "Also used for gross weight on docs", onInput: refreshComputed }));
      pricingFields.appendChild(kgRow);
      refreshComputed();
      pricingFields.appendChild(computedLine);
      pricingFields.appendChild(inputField("HSN Code", "hsn", data));
    } else {
      const row = el("div", { class: "row" });
      row.appendChild(inputField("Rate (per pcs) *", "rate", data, { type: "number" }));
      row.appendChild(inputField("Weight (kg per unit)", "weight", data, { type: "number", hint: "Used to auto-calc gross weight on docs" }));
      row.appendChild(inputField("HSN Code", "hsn", data));
      pricingFields.appendChild(row);
    }
  };
  drawPricingFields();
  wrap.appendChild(pricingBox);
  const vatIncF = checkboxField("Rate includes VAT", "rateIncludesVat", data);
  const syncVatInc = () => {
    const cb = vatIncF.querySelector("input");
    cb.disabled = !data.taxable;
    vatIncF.style.opacity = data.taxable ? "1" : ".45";
    if (!data.taxable) { data.rateIncludesVat = false; cb.checked = false; }
  };
  wrap.appendChild(checkboxField("Taxable", "taxable", data, syncVatInc));
  wrap.appendChild(vatIncF);
  syncVatInc();

  // Auto-apply the category's saved default rate basis for brand-new products
  // once a category is chosen (never overrides a value the user already touched).
  const catInput = catField.querySelector("input");
  if (catInput) {
    catInput.addEventListener("change", () => {
      if (basisTouched) return;
      const def = getCatDefault(data.category);
      if (def && def.rateBasis) {
        data.rateBasis = def.rateBasis;
        basisSel.querySelector("select").value = def.rateBasis;
        drawPricingFields();
      }
    });
  }

  // ---- Packing ----
  const packBox = el("div", { class: "card", style: { marginTop: "10px" } });
  packBox.appendChild(el("div", { class: "card-title" }, "Packing"));
  packBox.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginBottom: "8px" } },
    `How many ${data.unit || "pcs"} come in one box/bag/bundle. Leave 0 if sold loose.`));
  const packNote = el("div", { class: "pack-note" });
  const drawPackNote = () => {
    const q = Number(data.packQty) || 0;
    packNote.innerHTML = "";
    if (q > 0) {
      packNote.appendChild(el("span", { class: "pack-chip" },
        `1 ${data.packUnit || "box"} = ${q} ${data.unit || "pcs"}`));
      const perPack = (Number(data.rate) || 0) * q;
      if (perPack > 0) packNote.appendChild(el("span", { style: { fontSize: "11px", color: "var(--muted)", marginLeft: "8px" } },
        `${activeBiz().currency} ${fmt(perPack)} per ${data.packUnit || "box"}`));
    } else {
      packNote.appendChild(el("span", { style: { fontSize: "11px", color: "var(--muted)" } }, "Sold loose — no packing set."));
    }
  };
  packBox.appendChild(el("div", { class: "row" }, [
    inputField("Qty per pack", "packQty", data, { type: "number", hint: "e.g. 32", onInput: drawPackNote }),
    selectField("Pack unit", "packUnit", data, ["box", "bag", "bundle", "carton", "roll", "coil", "set", "pallet"], { onChange: drawPackNote }),
  ]));
  drawPackNote();
  packBox.appendChild(packNote);
  wrap.appendChild(packBox);

  wrap.appendChild(inputField("Notes (internal)", "notes", data, { textarea: true, rows: 2 }));
  wrap.appendChild(el("button", { class: "btn btn-primary btn-full", style: { marginTop: "12px" }, onclick: () => {
    if (!data.description.trim()) { toast("Description required", "err"); return; }
    if (rememberCb.checked && data.category) {
      const biz = activeBiz();
      biz.categoryDefaults = biz.categoryDefaults || {};
      biz.categoryDefaults[data.category] = { rateBasis: data.rateBasis };
    }
    const isNew = !existing;
    const oldRate = existing ? Number(existing.rate) || 0 : null;
    const newRate = Number(data.rate) || 0;
    if (existing) { Object.assign(existing, data); }
    else { data.id = uid("prod"); db.products.push(data); }
    saveDB(); closeModal();
    toast(isNew ? "Product added" : "Product saved");
    if (existing && oldRate !== newRate) offerRateUpdate(existing, oldRate, newRate);
  }}, existing ? "Save" : "Add product"));
  openModal(existing ? "Edit product" : "New product", wrap);
};

const openBulkProductModal = () => {
  const wrap = el("div");
  wrap.appendChild(el("div", { style: { fontSize: "13px", color: "var(--muted)", marginBottom: "10px" } },
    "One product per line, comma-separated: Description, Unit, Rate, Category, Part No, HSN, Weight, Taxable(yes/no), Notes. Only Description is required; the rest are optional."));
  const ta = el("textarea", { rows: 10, placeholder: "4 inch PVC pipe, m, 350, PVC, P-01, 3917, 1.2, yes, Class B\n1/2 inch CPVC elbow, pcs, 45, CPVC" });
  wrap.appendChild(ta);
  wrap.appendChild(el("button", { class: "btn btn-primary btn-full", style: { marginTop: "12px" }, onclick: () => {
    const lines = ta.value.split("\n").map(l => l.trim()).filter(Boolean);
    let added = 0, skipped = 0;
    lines.forEach(line => {
      const parts = line.split(",").map(p => p.trim());
      const [description, unit = "pcs", rate = "0", category = "", partNumber = "", hsn = "", weight = "", taxable = "yes", notes = ""] = parts;
      if (!description) { skipped++; return; }
      db.products.push({
        id: uid("prod"), businessId: db.activeBusinessId,
        partNumber, description, unit: unit || "pcs", rate: parseFloat(rate) || 0, weight: parseFloat(weight) || 0,
        taxable: !/^(no|n|false|0)$/i.test(taxable), hsn, notes, category, subCategory1: "", subCategory2: "", subCategory3: ""
      });
      added++;
    });
    if (added) saveDB();
    closeModal(); render();
    toast(skipped ? `Added ${added}, skipped ${skipped} (missing description)` : `Added ${added} product${added === 1 ? "" : "s"}`);
  }}, "Add all"));
  openModal("Bulk add products", wrap);
};

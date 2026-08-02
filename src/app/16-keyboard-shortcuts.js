// ==================== KEYBOARD SHORTCUTS ====================
// Escape closes the top modal, "/" jumps to the visible search box, and Enter
// submits a form's primary action when you're not in a textarea.
document.addEventListener("keydown", (e) => {
  const tag = (e.target.tagName || "").toLowerCase();
  const typing = tag === "input" || tag === "textarea" || tag === "select" || e.target.isContentEditable;

  if (e.key === "Escape") {
    if (modalStack.length) { e.preventDefault(); attemptClose(); }
    else if (typing && tag === "input") e.target.blur();
    return;
  }

  // "/" focuses the search field of whatever list is on screen.
  if (e.key === "/" && !typing) {
    const box = document.querySelector(".modal .picker-list ~ input, .modal input[placeholder*='earch'], .search input, input[placeholder*='earch']");
    if (box) { e.preventDefault(); box.focus(); box.select && box.select(); }
    return;
  }

  // Enter fires the primary button of the open modal (not from a textarea,
  // where Enter means newline, and not when a button already has focus).
  if (e.key === "Enter" && !e.shiftKey && tag !== "textarea" && tag !== "button") {
    const scope = modalStack.length ? modalStack[modalStack.length - 1] : null;
    if (!scope) return;
    // Don't hijack Enter inside the stepped builder — too easy to save early.
    if (scope.querySelector(".builder-shell")) return;
    const primary = scope.querySelector(".action-bar .btn-primary, .btn-primary.btn-full");
    if (primary && !primary.disabled) { e.preventDefault(); primary.click(); }
  }
});

const csvEscape = (v) => {
  const s = v === null || v === undefined ? "" : String(v);
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};
const toCSV = (rows, cols) =>
  [cols.join(",")].concat(rows.map(r => cols.map(c => csvEscape(r[c])).join(","))).join("\r\n");

// Minimal RFC-4180 parser: handles quoted fields, embedded commas/newlines.
const parseCSV = (text) => {
  const rows = []; let row = []; let cur = ""; let inQ = false;
  text = text.replace(/^\uFEFF/, ""); // strip BOM
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += ch;
    } else if (ch === '"') inQ = true;
    else if (ch === ",") { row.push(cur); cur = ""; }
    else if (ch === "\n") { row.push(cur); rows.push(row); row = []; cur = ""; }
    else if (ch !== "\r") cur += ch;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  return rows.filter(r => r.some(c => String(c).trim() !== ""));
};

const downloadTextFile = (text, filename, mime = "text/csv;charset=utf-8") => {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const PRODUCT_COLS = ["partNumber", "description", "unit", "rate", "weight", "hsn", "taxable",
  "category", "subCategory1", "subCategory2", "subCategory3", "packQty", "packUnit", "notes"];
const CUSTOMER_COLS = ["clientNo", "companyName", "contactName", "phone", "vatNo", "email",
  "addr1", "addr2", "country", "regNo", "shipAddr1", "shipAddr2", "eximCode", "discountRules"];

const exportProductsCSV = () => {
  const rows = bizProducts().map(p => ({ ...p, taxable: p.taxable ? "yes" : "no" }));
  if (!rows.length) { toast("No products to export", "err"); return; }
  const code = (activeBiz()?.shortCode || autoShortCode(activeBiz()?.name)).replace(/\s+/g, "");
  downloadTextFile(toCSV(rows, PRODUCT_COLS), `products_${code}_${today()}.csv`);
  toast(`Exported ${rows.length} products`);
};

const exportCustomersCSV = () => {
  const rows = bizCustomers().map(c => ({
    ...c,
    clientNo: "C" + String(c.id).padStart(4, "0"),
    // rules serialise as "PVC>Fittings:10 | Water Tank:8"
    discountRules: (c.discountRules || []).map(r => `${(r.path || []).join(">")}:${r.pct}`).join(" | ")
  }));
  if (!rows.length) { toast("No customers to export", "err"); return; }
  const code = (activeBiz()?.shortCode || autoShortCode(activeBiz()?.name)).replace(/\s+/g, "");
  downloadTextFile(toCSV(rows, CUSTOMER_COLS), `customers_${code}_${today()}.csv`);
  toast(`Exported ${rows.length} customers`);
};

const exportDocumentsCSV = () => {
  const rows = bizDocs().map(d => {
    const c = db.customers.find(x => x.id === d.customerId);
    return {
      type: d.type, number: d.number, date: d.date, status: d.status,
      party: c ? c.companyName : "", currency: d.currency,
      subtotal: (d.totals?.subtotal ?? 0).toFixed(2),
      tax: (d.totals?.tax ?? 0).toFixed(2),
      total: (d.totals?.total ?? 0).toFixed(2),
      discountGiven: (d.totals?.discountGiven ?? 0).toFixed(2),
      lineCount: (d.lineItems || []).length
    };
  });
  if (!rows.length) { toast("No documents to export", "err"); return; }
  const code = (activeBiz()?.shortCode || autoShortCode(activeBiz()?.name)).replace(/\s+/g, "");
  downloadTextFile(toCSV(rows, ["type", "number", "date", "status", "party", "currency",
    "subtotal", "tax", "total", "discountGiven", "lineCount"]), `documents_${code}_${today()}.csv`);
  toast(`Exported ${rows.length} documents`);
};

// Generic CSV import with a preview step, so nothing is written blindly.
const importCSV = (kind) => {
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = ".csv,text/csv";
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const rdr = new FileReader();
    rdr.onload = () => {
      try {
        const rows = parseCSV(rdr.result);
        if (rows.length < 2) { toast("That file has no data rows", "err"); return; }
        const header = rows[0].map(h => h.trim());
        const body = rows.slice(1);
        showImportPreview(kind, header, body);
      } catch (e) { console.error(e); toast("Couldn't read that CSV", "err"); }
    };
    rdr.readAsText(f);
  };
  inp.click();
};

const showImportPreview = (kind, header, body) => {
  const isProd = kind === "products";
  const known = isProd ? PRODUCT_COLS : CUSTOMER_COLS;
  const idx = {}; known.forEach(k => { idx[k] = header.findIndex(h => h.toLowerCase() === k.toLowerCase()); });
  const required = isProd ? ["description"] : ["companyName"];
  const missing = required.filter(r => idx[r] < 0);

  const wrap = el("div");
  if (missing.length) {
    wrap.appendChild(el("div", { style: { color: "var(--danger)", fontSize: "13px", marginBottom: "8px" } },
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}`));
    wrap.appendChild(el("div", { style: { fontSize: "11.5px", color: "var(--muted)" } },
      `Expected headers: ${known.join(", ")}`));
    const bar0 = el("div", { class: "action-bar" });
    bar0.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Close"));
    wrap.appendChild(bar0);
    openModal("Import — problem", wrap);
    return;
  }
  const unknown = header.filter(h => !known.some(k => k.toLowerCase() === h.toLowerCase()));
  wrap.appendChild(el("div", { style: { fontSize: "12.5px", marginBottom: "6px" } },
    `${body.length} row${body.length === 1 ? "" : "s"} found.`));
  if (unknown.length) wrap.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginBottom: "8px" } },
    `Ignored columns: ${unknown.join(", ")}`));

  // preview first 5
  const prev = el("div", { class: "picker-list", style: { maxHeight: "220px" } });
  body.slice(0, 5).forEach(r => {
    const line = el("div", { style: { padding: "7px 10px", borderBottom: "1px solid #f0f2f5", fontSize: "12px" } });
    line.appendChild(el("div", { style: { fontWeight: 600 } }, r[idx[isProd ? "description" : "companyName"]] || "(blank)"));
    const sub = isProd
      ? [r[idx.category], r[idx.rate] ? `rate ${r[idx.rate]}` : "", r[idx.packQty] ? `${r[idx.packQty]}/${r[idx.packUnit] || "box"}` : ""].filter(Boolean).join(" • ")
      : [r[idx.contactName], r[idx.phone]].filter(Boolean).join(" • ");
    line.appendChild(el("div", { style: { fontSize: "10.5px", color: "var(--muted)" } }, sub));
    prev.appendChild(line);
  });
  wrap.appendChild(prev);
  if (body.length > 5) wrap.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "6px" } }, `…and ${body.length - 5} more`));

  const mode = { replace: false };
  wrap.appendChild(checkboxField(
    isProd ? "Update existing products with the same description" : "Update existing customers with the same company name",
    "replace", mode));

  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Cancel"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => {
    const g = (r, k) => idx[k] >= 0 ? String(r[idx[k]] ?? "").trim() : "";
    let added = 0, updated = 0, skipped = 0;
    body.forEach(r => {
      if (isProd) {
        const desc = g(r, "description");
        if (!desc) { skipped++; return; }
        const existing = mode.replace ? bizProducts().find(p => (p.description || "").toLowerCase() === desc.toLowerCase()) : null;
        const rec = {
          partNumber: g(r, "partNumber"), description: desc, unit: g(r, "unit") || "pcs",
          rate: parseFloat(g(r, "rate")) || 0, weight: parseFloat(g(r, "weight")) || 0,
          hsn: g(r, "hsn"), taxable: !/^(no|false|0)$/i.test(g(r, "taxable") || "yes"),
          category: g(r, "category"), subCategory1: g(r, "subCategory1"),
          subCategory2: g(r, "subCategory2"), subCategory3: g(r, "subCategory3"),
          packQty: parseFloat(g(r, "packQty")) || 0, packUnit: g(r, "packUnit") || "box",
          notes: g(r, "notes"), businessId: db.activeBusinessId
        };
        if (existing) { Object.assign(existing, rec); updated++; }
        else { rec.id = uid("prod"); db.products.push(rec); added++; }
      } else {
        const co = g(r, "companyName");
        if (!co) { skipped++; return; }
        const existing = mode.replace ? bizCustomers().find(c => (c.companyName || "").toLowerCase() === co.toLowerCase()) : null;
        const rulesRaw = g(r, "discountRules");
        const discountRules = rulesRaw ? rulesRaw.split("|").map(s => {
          const [pathPart, pctPart] = s.split(":");
          const path = (pathPart || "").trim().split(">").map(x => x.trim()).filter(Boolean);
          const pct = parseFloat(pctPart) || 0;
          return path.length ? { path, pct } : null;
        }).filter(Boolean) : [];
        const rec = {
          companyName: co, contactName: g(r, "contactName"), phone: g(r, "phone"),
          vatNo: g(r, "vatNo"), email: g(r, "email"), addr1: g(r, "addr1"), addr2: g(r, "addr2"),
          country: g(r, "country") || "NEPAL", regNo: g(r, "regNo"),
          shipAddr1: g(r, "shipAddr1"), shipAddr2: g(r, "shipAddr2"), eximCode: g(r, "eximCode"),
          sameAsBill: !g(r, "shipAddr1"), discountRules, businessId: db.activeBusinessId
        };
        if (existing) { Object.assign(existing, rec); updated++; }
        else { rec.id = uid("cust"); db.customers.push(rec); added++; }
      }
    });
    saveDB(); closeModal(); render();
    toast(`Imported — ${added} added, ${updated} updated${skipped ? `, ${skipped} skipped` : ""}`, "ok", 5000);
  }}, "Import"));
  wrap.appendChild(bar);
  openModal(`Import ${kind}`, wrap);
};

// Downloadable blank templates so the expected columns are obvious.
const downloadTemplate = (kind) => {
  if (kind === "products") {
    downloadTextFile(toCSV([{
      partNumber: "ELB110", description: "PVC 110mm Elbow", unit: "pcs", rate: 250, weight: 0.4,
      hsn: "3917", taxable: "yes", category: "PVC", subCategory1: "Fittings", subCategory2: "", subCategory3: "",
      packQty: 32, packUnit: "box", notes: ""
    }], PRODUCT_COLS), "products_template.csv");
  } else {
    downloadTextFile(toCSV([{
      clientNo: "", companyName: "ABC Traders Pvt Ltd", contactName: "Ram", phone: "9779800000000",
      vatNo: "600123456", email: "", addr1: "Lubhu", addr2: "", country: "NEPAL", regNo: "",
      shipAddr1: "", shipAddr2: "", eximCode: "", discountRules: "PVC>Fittings:10 | Water Tank:8"
    }], CUSTOMER_COLS), "customers_template.csv");
  }
  toast("Template downloaded");
};

const prodView = { mode: "categories", path: [] };

const renderProducts = () => {
  const wrap = el("div");

  // Sub-tabs: browse the category tree, or search the flat catalogue.
  const seg = el("div", { class: "subtabs" });
  const mkSeg = (key, label) => el("button", {
    class: "subtab" + (prodView.mode === key ? " active" : ""),
    onclick: () => { prodView.mode = key; if (key === "categories") prodView.path = []; render(); }
  }, label);
  seg.appendChild(mkSeg("categories", "Categories"));
  seg.appendChild(mkSeg("all", "All products"));
  seg.appendChild(mkSeg("units", "Units"));
  wrap.appendChild(seg);

  if (prodView.mode === "categories") wrap.appendChild(renderCategoryBrowser());
  else if (prodView.mode === "units") wrap.appendChild(renderUnitsManager());
  else wrap.appendChild(renderAllProducts());

  wrap.appendChild(el("button", { class: "fab", onclick: () => openProductModal(null) }, "+"));
  return wrap;
};

// ---- Units view: master unit list + drill-down level-wise config ----
const unitsViewState = { path: [] };
const renderUnitsManager = () => {
  const biz = activeBiz();
  const wrap = el("div");
  if (!biz) return wrap;
  if (!Array.isArray(biz.units) || !biz.units.length) {
    biz.units = ["pcs", "kg", "set", "box", "m", "ft", "litre", "bundle"];
  }
  if (!biz.categoryUnits || typeof biz.categoryUnits !== "object") biz.categoryUnits = {};

  wrap.appendChild(el("div", { style: { fontSize: "12.5px", color: "var(--muted)", marginBottom: "10px" } },
    "Add your units once below. Then drill into a category to set a default unit or restrict which units apply there — sub-categories inherit unless you set their own."));

  // ---- Master unit list ----
  const listBox = el("div", { class: "field" });
  const labelRow = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" } });
  labelRow.appendChild(el("label", { style: { marginBottom: 0 } }, "Your units"));
  let reorderMode = false;
  const reorderToggle = el("button", { class: "btn-icon", type: "button", title: "Reorder units", onclick: () => { reorderMode = !reorderMode; drawList(); } }, "\u2195 Reorder");
  labelRow.appendChild(reorderToggle);
  listBox.appendChild(labelRow);
  const list = el("div", { class: "units-chips" });
  const drawList = () => {
    list.innerHTML = "";
    reorderToggle.classList.toggle("active", reorderMode);
    if (biz.units.length === 0) {
      list.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", padding: "8px 4px" } },
        "No units yet. Add one below."));
    }
    biz.units.forEach((u, i) => {
      const chip = el("span", { class: "unit-chip" });
      if (reorderMode) {
        chip.appendChild(el("button", { class: "unit-chip-arrow", type: "button", title: "Move up", onclick: () => {
          if (i === 0) return;
          [biz.units[i-1], biz.units[i]] = [biz.units[i], biz.units[i-1]];
          saveDB(); drawList();
        }}, "\u2039"));
      }
      // Tap the label to rename inline.
      const label = el("span", { class: "unit-chip-label", title: "Tap to rename", onclick: () => {
        const inp = el("input", { value: u, class: "unit-chip-edit" });
        const commit = () => {
          const v = inp.value.trim();
          if (v && v !== u && biz.units.includes(v)) { toast("Already in the list", "err"); drawList(); return; }
          biz.units[i] = v || u; saveDB(); drawList();
        };
        inp.addEventListener("blur", commit);
        inp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); inp.blur(); } });
        chip.replaceChild(inp, label);
        inp.focus(); inp.select();
      }}, u);
      chip.appendChild(label);
      if (reorderMode) {
        chip.appendChild(el("button", { class: "unit-chip-arrow", type: "button", title: "Move down", onclick: () => {
          if (i === biz.units.length - 1) return;
          [biz.units[i+1], biz.units[i]] = [biz.units[i], biz.units[i+1]];
          saveDB(); drawList();
        }}, "\u203A"));
      }
      chip.appendChild(el("button", { class: "unit-chip-x", type: "button", title: "Delete unit", onclick: () => {
        const used = bizProducts().some(p => p.unit === u || p.packUnit === u);
        const confirmDelete = () => {
          biz.units.splice(i, 1);
          Object.keys(biz.categoryUnits).forEach(k => {
            const entry = normCatUnitEntry(biz.categoryUnits[k]);
            biz.categoryUnits[k] = { allowed: entry.allowed.filter(x => x !== u), default: entry.default === u ? "" : entry.default };
          });
          saveDB(); drawList();
        };
        if (used) {
          confirmModal(`"${u}" is used by one or more products. Delete anyway?`,
            confirmDelete, { title: "Delete unit?", confirmLabel: "Delete", danger: true });
        } else {
          confirmDelete();
        }
      }}, "\u00D7"));
      list.appendChild(chip);
    });
  };
  drawList();
  listBox.appendChild(list);
  const addBox = el("div", { style: { display: "flex", gap: "6px", marginTop: "10px" } });
  const newInp = el("input", { placeholder: "e.g. carton, bag, pallet", style: { flex: "1" } });
  const addBtn = el("button", { class: "btn btn-secondary", onclick: () => {
    const v = newInp.value.trim();
    if (!v) { toast("Type a unit name first", "err"); return; }
    if (biz.units.includes(v)) { toast("Already in the list", "err"); return; }
    biz.units.push(v);
    newInp.value = "";
    saveDB(); drawList();
  }}, "+ Add");
  newInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addBtn.click(); } });
  addBox.appendChild(newInp);
  addBox.appendChild(addBtn);
  listBox.appendChild(addBox);
  wrap.appendChild(listBox);

  // ---- Drill-down: units per category level ----
  const levelBox = el("div", { style: { marginTop: "18px" } });
  levelBox.appendChild(el("label", {}, "Units by category level"));
  const tree = buildCategoryTree(bizProducts());
  let node = tree;
  const valid = [];
  for (const seg of unitsViewState.path) {
    const nxt = node.children.find(c => c.name === seg);
    if (!nxt) break;
    node = nxt; valid.push(seg);
  }
  unitsViewState.path = valid;

  if (!tree.children.length) {
    levelBox.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", padding: "6px 4px" } },
      "No categories yet — add products with categories to set units per level."));
    wrap.appendChild(levelBox);
    return wrap;
  }

  // breadcrumb
  const crumb = el("div", { class: "crumb-bar", style: { margin: "8px 0 10px" } });
  crumb.appendChild(el("button", { type: "button", class: "crumb", onclick: () => { unitsViewState.path = []; render(); } }, "All categories"));
  node.path.forEach((seg, i) => {
    crumb.appendChild(el("span", { class: "crumb-sep" }, "\u203A"));
    crumb.appendChild(el("button", { type: "button", class: "crumb", onclick: () => { unitsViewState.path = node.path.slice(0, i + 1); render(); } }, seg));
  });
  levelBox.appendChild(crumb);

  // Effective (inherited) state — what applies here right now, before any override at this level
  const parentPath = node.path.slice(0, -1);
  const inheritedAllowed = node.path.length ? unitsForCategoryPath(parentPath) : bizUnits();
  const inheritedDefault = node.path.length ? defaultUnitForCategoryPath(parentPath) : "";
  const key = pathKey(node.path);
  const entry = normCatUnitEntry(biz.categoryUnits[key]);
  const hasOverride = entry.allowed.length > 0;
  const setEntry = (patch) => {
    biz.categoryUnits[key] = { ...entry, ...patch };
    saveDB(); render();
  };

  if (node.path.length) {
    const panel = el("div", { class: "card", style: { marginBottom: "12px" } });
    panel.appendChild(el("div", { class: "card-title" }, `Units for "${node.name}"`));

    // Default unit
    const defWrap = el("div", { class: "field" });
    defWrap.appendChild(el("label", {}, "Default unit here"));
    const pool = hasOverride ? entry.allowed : inheritedAllowed;
    const defSel = el("select", { onchange: (e) => setEntry({ default: e.target.value }) });
    defSel.appendChild(el("option", { value: "" }, inheritedDefault ? `Inherit (${inheritedDefault})` : "None"));
    pool.forEach(u => {
      const opt = el("option", { value: u }, u);
      if (entry.default === u) opt.selected = true;
      defSel.appendChild(opt);
    });
    defWrap.appendChild(defSel);
    panel.appendChild(defWrap);

    // Allowed units — chips. Untouched = inherits parent's full set.
    panel.appendChild(el("div", { style: { fontSize: "12.5px", fontWeight: 600, margin: "10px 0 6px" } }, "Allowed units here"));
    const chips = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "6px" } });
    biz.units.forEach(u => {
      const active = hasOverride ? entry.allowed.includes(u) : inheritedAllowed.includes(u);
      const chip = el("button", { type: "button", class: "chip" + (active ? " active" : ""), onclick: () => {
        const base = hasOverride ? entry.allowed : [...inheritedAllowed]; // first click on an inherited set "forks" it
        const next = base.includes(u) ? base.filter(x => x !== u) : [...base, u];
        setEntry({ allowed: next });
      }}, u);
      chips.appendChild(chip);
    });
    panel.appendChild(chips);

    const status = hasOverride
      ? el("div", { style: { fontSize: "10.5px", color: "var(--primary)", marginTop: "6px", fontWeight: 600 } }, "\u2713 Set at this level")
      : el("div", { style: { fontSize: "10.5px", color: "var(--muted)", marginTop: "6px" } },
          node.path.length > 1 ? `Inherited from "${node.path[node.path.length - 2]}"` : "Inherited from all units");
    panel.appendChild(status);

    if (hasOverride) {
      panel.appendChild(el("button", { class: "btn btn-secondary", style: { marginTop: "8px", fontSize: "11.5px", padding: "6px 10px" }, onclick: () => {
        delete biz.categoryUnits[key];
        saveDB(); render();
      }}, "Clear override — go back to inheriting"));
    }
    levelBox.appendChild(panel);
  }

  // sub-category cards, each showing its effective default unit
  if (node.children.length) {
    const grid = el("div", { class: "cat-grid" });
    node.children.forEach(ch => {
      const chDef = defaultUnitForCategoryPath(ch.path);
      const chOverridden = normCatUnitEntry(biz.categoryUnits[pathKey(ch.path)]).allowed.length > 0;
      const card = el("div", { class: "cat-card", onclick: () => { unitsViewState.path = ch.path; render(); } });
      card.appendChild(el("div", { class: "cat-card-name" }, ch.name));
      card.appendChild(el("div", { class: "cat-card-meta" },
        (chDef ? `Default: ${chDef}` : "No default") + (chOverridden ? " \u2022 own units" : "")));
      grid.appendChild(card);
    });
    levelBox.appendChild(grid);
  } else if (!node.path.length) {
    levelBox.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", padding: "6px 4px" } }, "Pick a category above to set its units."));
  }

  wrap.appendChild(levelBox);
  return wrap;
};

// ---- Categories view: drill down the real catalogue tree ----
const renderCategoryBrowser = () => {
  const wrap = el("div");
  const all = bizProducts();
  if (all.length === 0) return emptyState("\u{1F4E6}", "No products yet", "Add your first product");

  const tree = buildCategoryTree(all);
  // walk to the current path
  let node = tree;
  const valid = [];
  for (const seg of prodView.path) {
    const nxt = node.children.find(c => c.name === seg);
    if (!nxt) break;
    node = nxt; valid.push(seg);
  }
  prodView.path = valid;

  // breadcrumb
  const crumb = el("div", { class: "crumb-bar", style: { marginBottom: "10px" } });
  crumb.appendChild(el("button", { type: "button", class: "crumb", onclick: () => { prodView.path = []; render(); } }, "All categories"));
  node.path.forEach((seg, i) => {
    crumb.appendChild(el("span", { class: "crumb-sep" }, "\u203A"));
    crumb.appendChild(el("button", { type: "button", class: "crumb", onclick: () => { prodView.path = node.path.slice(0, i + 1); render(); } }, seg));
  });
  wrap.appendChild(crumb);

  // Add / rename categories at the level you're viewing.
  const catActions = el("div", { style: { display: "flex", gap: "6px", marginBottom: "10px", flexWrap: "wrap" } });
  catActions.appendChild(el("button", { class: "btn btn-secondary", style: { flex: "none", fontSize: "12px", padding: "7px 12px" },
    onclick: () => openAddCategoryModal(node.path) },
    node.path.length ? `+ Sub-category in ${node.name}` : "+ Add category"));
  if (node.path.length) {
    catActions.appendChild(el("button", { class: "btn btn-secondary", style: { flex: "none", fontSize: "12px", padding: "7px 12px" },
      onclick: () => openRenameCategoryModal(node.path) }, "✏️ Rename"));
  }
  catActions.appendChild(el("button", { class: "btn btn-secondary", style: { flex: "none", fontSize: "12px", padding: "7px 12px" },
    onclick: () => openMoveProductsModal(node.path) }, "📦 Move products here"));
  wrap.appendChild(catActions);

  // sub-category cards
  if (node.children.length) {
    const grid = el("div", { class: "cat-grid" });
    node.children.forEach(ch => {
      const card = el("div", { class: "cat-card", onclick: () => { prodView.path = ch.path; render(); } });
      card.appendChild(el("div", { class: "cat-card-name" }, ch.name));
      card.appendChild(el("div", { class: "cat-card-meta" },
        `${ch.count} product${ch.count === 1 ? "" : "s"}` + (ch.children.length ? ` \u2022 ${ch.children.length} sub` : "")));
      grid.appendChild(card);
    });
    wrap.appendChild(grid);
  }

  // products sitting exactly at this level
  const here = all.filter(p => {
    const pp = productPath(p);
    return pp.length === node.path.length && node.path.every((s, i) => pp[i] === s);
  });
  if (here.length) {
    wrap.appendChild(el("div", { class: "cat-section-hdr", style: { marginTop: "14px" } }, [
      el("div", { class: "cat-name" }, node.path.length ? `In ${node.name}` : "Uncategorized"),
      el("div", { class: "cat-count" }, String(here.length))
    ]));
    const box = el("div", { id: "prod-list" });
    here.forEach(p => box.appendChild(renderProductItem(p)));
    wrap.appendChild(box);
  } else if (!node.children.length) {
    wrap.appendChild(el("div", { class: "picker-empty" }, "Nothing here."));
  }
  return wrap;
};

// ---- All products view: flat, searchable ----
const renderAllProducts = () => {
  const wrap = el("div");
  // State for the category filter (persists across renders inside this session)
  if (!prodView.filterCat) prodView.filterCat = "";
  const searchRow = el("div", { style: { display: "flex", gap: "8px", marginBottom: "10px", flexWrap: "wrap" } });
  const search = el("div", { class: "search", style: { flex: "2", minWidth: "180px" } });
  search.appendChild(el("input", { placeholder: "Search all products...", oninput: (e) => filterProductList(e.target.value, prodView.filterCat) }));
  searchRow.appendChild(search);
  // Category filter — flat list of every top-level and sub-level category path
  const all = bizProducts();
  const catPaths = Array.from(new Set(all.map(p => pathKey(productPath(p))).filter(Boolean))).sort();
  const catSel = el("select", { style: { flex: "1", minWidth: "140px" }, onchange: (e) => {
    prodView.filterCat = e.target.value;
    // Re-filter the list in place
    const q = search.querySelector("input").value;
    filterProductList(q, prodView.filterCat);
  }});
  catSel.appendChild(el("option", { value: "" }, "All categories"));
  catPaths.forEach(p => {
    const opt = el("option", { value: p }, p);
    if (prodView.filterCat === p) opt.selected = true;
    catSel.appendChild(opt);
  });
  searchRow.appendChild(catSel);
  wrap.appendChild(searchRow);

  const list = all.slice().sort((a, b) => (a.description || "").localeCompare(b.description || ""));

  if (bulkActive("prod")) {
    wrap.appendChild(bulkBar("prod",
      () => [...document.querySelectorAll("#prod-list .list-item")]
        .filter(i => i.style.display !== "none")
        .map(i => Number(i.dataset.id)).filter(Boolean),
      (ids) => {
        const snapshot = db.products.filter(p => ids.includes(p.id));
        deleteWithUndo(`${ids.length} product${ids.length === 1 ? "" : "s"}`,
          () => { db.products = db.products.filter(p => !ids.includes(p.id)); bulkSel.ids.clear(); },
          () => { db.products.push(...snapshot); });
      },
      [el("button", { class: "btn btn-secondary bulk-mini", onclick: () => {
        const ids = [...bulkSel.ids];
        if (!ids.length) { toast("Nothing selected", "err"); return; }
        openCategoryPicker((path) => {
          const keyFor = (d) => d === 0 ? "category" : `subCategory${d}`;
          db.products.forEach(p => {
            if (!ids.includes(p.id)) return;
            ["category", "subCategory1", "subCategory2", "subCategory3"].forEach(k => p[k] = "");
            path.forEach((seg, i) => { p[keyFor(i)] = seg; });
          });
          saveDB(); bulkSel.ids.clear(); render();
          toast(`Moved ${ids.length} to ${pathKey(path)}`);
        });
      }}, "\u{1F4E6} Move to\u2026"),
      el("button", { class: "btn btn-secondary bulk-mini", onclick: () => {
        const ids = [...bulkSel.ids];
        if (!ids.length) { toast("Nothing selected", "err"); return; }
        const text = db.products.filter(p => ids.includes(p.id)).map(productToLine).join("\n");
        shareText(text, "Products");
      }}, "\u{1F4E4} Share")]));
  } else {
    const bulkRow = el("div", { style: { display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" } });
    bulkRow.appendChild(el("button", { class: "btn btn-secondary", onclick: openBulkProductModal }, "\u{1F4CB} Bulk add products"));
    if (list.length) bulkRow.appendChild(el("button", { class: "btn btn-secondary", onclick: () => bulkToggleMode("prod") }, "\u2611\uFE0F Select"));
    wrap.appendChild(bulkRow);
  }

  const listCt = el("div", { id: "prod-list" });
  if (list.length === 0) {
    listCt.appendChild(emptyState("\u{1F4E6}", "No products yet", "Add your first product"));
  } else {
    list.forEach(p => listCt.appendChild(renderProductItem(p)));
  }
  wrap.appendChild(listCt);
  return wrap;
};

// Read-only product detail preview.
const openProductPreview = (p) => {
  const wrap = el("div");
  const row = (l, v) => { if (!v && v !== 0) return; const r = el("div", { style: { display: "flex", gap: "10px", padding: "5px 0", borderBottom: "1px solid var(--border)" } }); r.appendChild(el("div", { style: { fontWeight: 600, minWidth: "140px", color: "var(--muted)" } }, l)); r.appendChild(el("div", {}, String(v))); wrap.appendChild(r); };
  row("Description", p.description);
  row("Part Number", p.partNumber);
  row("Rate", `${activeBiz().currency || "NPR"} ${fmt(p.rate)} / ${p.unit}`);
  row("Unit", p.unit);
  row("Weight", p.weight ? `${p.weight} kg/${p.unit}` : "");
  row("Packing", Number(p.packQty) > 0 ? `1 ${p.packUnit || "box"} = ${p.packQty} ${p.unit}` : "Sold loose");
  row("HSN Code", p.hsn);
  row("Taxable", p.taxable ? "Yes" : "No");
  row("Category", [p.category, p.subCategory1, p.subCategory2, p.subCategory3].filter(Boolean).join(" › "));
  row("Notes", p.notes);
  const actions = el("div", { class: "action-bar" });
  actions.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Close"));
  actions.appendChild(el("button", { class: "btn btn-primary", onclick: () => { closeModal(); openProductModal(p); } }, "✏️ Edit"));
  wrap.appendChild(actions);
  openModal(p.description, wrap, { guard: false });
};

const renderProductItem = (p) => {
  const searchIdx = [p.description, p.partNumber, p.category, p.subCategory1, p.subCategory2,
    p.subCategory3, p.hsn, p.notes, p.unit, p.packUnit, p.rate, p.packQty].filter(Boolean).join(" ").toLowerCase();
  const catPath = pathKey(productPath(p));
  const item = el("div", { class: "list-item" + (bulkSel.ids.has(p.id) && bulkActive("prod") ? " row-selected" : ""), "data-search": searchIdx, "data-category": p.category || "", "data-catpath": catPath, "data-id": p.id });
  const cbP = bulkCheckbox("prod", p.id);
  if (cbP) item.appendChild(cbP);
  const info = el("div", { class: "info", style: { cursor: "pointer" }, onclick: () => openProductPreview(p) });
  info.appendChild(el("div", { class: "name" }, p.description));
  const wt = p.weight ? ` • ${p.weight}kg/${p.unit}` : "";
  const pk = Number(p.packQty) > 0 ? ` • ${p.packQty}/${p.packUnit || "box"}` : "";
  const cats = [p.category, p.subCategory1, p.subCategory2, p.subCategory3].filter(Boolean);
  if (cats.length) info.appendChild(el("div", { style: { display: "flex", gap: "4px", flexWrap: "wrap", margin: "3px 0" } },
    cats.map(c => el("span", { style: { fontSize: "10px", fontWeight: 600, color: "var(--primary)", background: "var(--primary-tint)", padding: "1px 7px", borderRadius: "999px" } }, c))
  ));
  info.appendChild(el("div", { class: "sub" }, `${activeBiz().currency || "NPR"} ${fmt(p.rate)}/${p.unit}${wt}${pk}${p.taxable ? " • Taxable" : ""}`));
  item.appendChild(info);
  // Inline rate edit — tweak the price without opening the full product form.
  const rateInp = el("input", { type: "number", value: p.rate, step: "0.01", title: "Rate",
    style: { width: "64px", flex: "none", textAlign: "right", fontSize: "12px", padding: "6px 7px" },
    onclick: (e) => e.stopPropagation() });
  rateInp.addEventListener("change", (e) => {
    const newRate = parseFloat(e.target.value) || 0;
    const oldRate = Number(p.rate) || 0;
    if (newRate === oldRate) return;
    p.rate = newRate;
    saveDB(); render();
    if (oldRate !== newRate) offerRateUpdate(p, oldRate, newRate);
  });
  item.appendChild(rateInp);
  const actions = el("div", { class: "actions" });
  actions.appendChild(el("button", { class: "btn-icon", title: "Preview", onclick: () => openProductPreview(p) }, "👁️"));
  actions.appendChild(el("button", { class: "btn-icon", title: "Share", onclick: () => shareText(productToLine(p), p.description) }, "📤"));
  actions.appendChild(el("button", { class: "btn-icon", title: "Edit", onclick: () => openProductModal(p) }, "✏️"));
  actions.appendChild(el("button", { class: "btn-icon", title: "Duplicate", onclick: () => {
    const copy = { ...p, id: uid("prod"), description: p.description + " (copy)" };
    db.products.push(copy); saveDB(); render();
    toast("Product duplicated");
  }}, "📄"));
  actions.appendChild(el("button", { class: "btn-icon danger", title: "Delete", onclick: () => {
    confirmModal(`Delete "${p.description}"? This can't be undone.`, () => {
      db.products = db.products.filter(x => x.id !== p.id); saveDB(); render();
      toast("Product deleted");
    }, { title: "Delete product?", confirmLabel: "Delete" });
  }}, "🗑️"));
  item.appendChild(actions);
  return item;
};

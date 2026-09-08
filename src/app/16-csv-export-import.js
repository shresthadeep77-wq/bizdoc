// ==================== CSV EXPORT / IMPORT ====================
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
  track("csv.exported", { kind: "products" });
  const rows = bizProducts().map(p => ({ ...p, taxable: p.taxable ? "yes" : "no" }));
  if (!rows.length) { toast("No products to export", "err"); return; }
  const code = (activeBiz()?.shortCode || autoShortCode(activeBiz()?.name)).replace(/\s+/g, "");
  downloadTextFile(toCSV(rows, PRODUCT_COLS), `products_${code}_${today()}.csv`);
  toast(`Exported ${rows.length} products`);
};

const exportCustomersCSV = () => {
  track("csv.exported", { kind: "customers" });
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
  track("csv.exported", { kind: "documents" });
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
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: async (e) => {
    const g = (r, k) => idx[k] >= 0 ? String(r[idx[k]] ?? "").trim() : "";
    let added = 0, updated = 0, skipped = 0;
    await runBulk(e.currentTarget, "Importing", body, (r) => {
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
  track("csv.template_downloaded", { kind });
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

// ==================== CUSTOMER REPORT ====================
const customerStats = (c) => {
  const docs = bizDocs().filter(d => d.customerId === c.id);
  const sales = docs.filter(d => d.status !== "Cancelled");
  const total = sales.reduce((s, d) => s + (d.totals?.total || 0), 0);
  const discount = sales.reduce((s, d) => s + (d.totals?.discountGiven || 0), 0);
  const dates = docs.map(d => d.date).filter(Boolean).sort();
  const byStatus = {};
  docs.forEach(d => { byStatus[d.status || "Draft"] = (byStatus[d.status || "Draft"] || 0) + 1; });
  // product mix by value
  const mix = {};
  sales.forEach(d => (d.lineItems || []).forEach(li => {
    const key = (li.catPath && li.catPath.length) ? li.catPath[0] : (li.description || "Other");
    mix[key] = (mix[key] || 0) + (li.qty || 0) * (li.rate || 0);
  }));
  const mixArr = Object.entries(mix).sort((a, b) => b[1] - a[1]);
  return { docs, sales, total, discount, dates, byStatus, mixArr,
    avg: sales.length ? total / sales.length : 0 };
};

const openCustomerReport = (c) => {
  const biz = activeBiz();
  const st = customerStats(c);
  const cur = biz.currency || "NPR";
  const wrap = el("div");
  const rpt = el("div", { class: "report-doc", id: "customer-report" });

  const head = el("div", { class: "rpt-head" });
  head.appendChild(el("div", { class: "rpt-biz" }, biz.name || ""));
  head.appendChild(el("div", { class: "rpt-title" }, "Customer Report"));
  head.appendChild(el("div", { class: "rpt-date" }, `Generated ${today()}`));
  rpt.appendChild(head);

  // identity
  const idBox = el("div", { class: "rpt-section" });
  idBox.appendChild(el("div", { class: "rpt-h" }, "Customer"));
  const idTbl = el("table", { class: "rpt-tbl" });
  const kv = (k, v) => { if (!v && v !== 0) return; const r = el("tr");
    r.appendChild(el("td", { class: "rpt-k" }, k)); r.appendChild(el("td", {}, String(v))); idTbl.appendChild(r); };
  kv("Client No.", "C" + String(c.id).padStart(4, "0"));
  kv("Company", c.companyName);
  kv("Contact", c.contactName);
  kv("Phone", c.phone);
  kv("VAT / PAN", c.vatNo);
  kv("Email", c.email);
  kv("Address", [c.addr1, c.addr2].filter(Boolean).join(", "));
  kv("Country", c.country);
  idBox.appendChild(idTbl);
  rpt.appendChild(idBox);

  // summary figures
  const sum = el("div", { class: "rpt-section" });
  sum.appendChild(el("div", { class: "rpt-h" }, "Summary"));
  const grid = el("div", { class: "rpt-grid" });
  const stat = (label, val) => {
    const b = el("div", { class: "rpt-stat" });
    b.appendChild(el("div", { class: "rpt-stat-v" }, val));
    b.appendChild(el("div", { class: "rpt-stat-l" }, label));
    grid.appendChild(b);
  };
  stat("Documents", String(st.docs.length));
  stat("Total value", `${cur} ${fmt(st.total)}`);
  stat("Average", `${cur} ${fmt(st.avg)}`);
  stat("Discount given", `${cur} ${fmt(st.discount)}`);
  sum.appendChild(grid);
  if (st.dates.length) {
    sum.appendChild(el("div", { class: "rpt-note" },
      `First: ${st.dates[0]} • Latest: ${st.dates[st.dates.length - 1]}`));
  }
  const statusBits = Object.entries(st.byStatus).map(([k, v]) => `${k}: ${v}`).join(" • ");
  if (statusBits) sum.appendChild(el("div", { class: "rpt-note" }, statusBits));
  rpt.appendChild(sum);

  // rate card
  const rc = el("div", { class: "rpt-section" });
  rc.appendChild(el("div", { class: "rpt-h" }, "Discount rate card"));
  const rules = (c.discountRules || []);
  if (!rules.length) {
    rc.appendChild(el("div", { class: "rpt-note" }, "No discounts — pays list price."));
  } else {
    const rt = el("table", { class: "rpt-tbl" });
    const hr = el("tr");
    hr.appendChild(el("th", {}, "Category")); hr.appendChild(el("th", { style: { textAlign: "right" } }, "Discount"));
    rt.appendChild(hr);
    rules.forEach(r => {
      const tr = el("tr");
      tr.appendChild(el("td", {}, pathKey(r.path)));
      tr.appendChild(el("td", { style: { textAlign: "right" } }, `${r.pct}%`));
      rt.appendChild(tr);
    });
    rc.appendChild(rt);
  }
  rpt.appendChild(rc);

  // product mix
  if (st.mixArr.length) {
    const mx = el("div", { class: "rpt-section" });
    mx.appendChild(el("div", { class: "rpt-h" }, "What they buy"));
    const mt = el("table", { class: "rpt-tbl" });
    const mh = el("tr");
    mh.appendChild(el("th", {}, "Category"));
    mh.appendChild(el("th", { style: { textAlign: "right" } }, "Value"));
    mh.appendChild(el("th", { style: { textAlign: "right" } }, "Share"));
    mt.appendChild(mh);
    const mixTotal = st.mixArr.reduce((s, [, v]) => s + v, 0) || 1;
    st.mixArr.slice(0, 10).forEach(([k, v]) => {
      const tr = el("tr");
      tr.appendChild(el("td", {}, k));
      tr.appendChild(el("td", { style: { textAlign: "right" } }, fmt(v)));
      tr.appendChild(el("td", { style: { textAlign: "right" } }, `${((v / mixTotal) * 100).toFixed(1)}%`));
      mt.appendChild(tr);
    });
    mx.appendChild(mt);
    rpt.appendChild(mx);
  }

  // document history
  const hist = el("div", { class: "rpt-section" });
  hist.appendChild(el("div", { class: "rpt-h" }, "Document history"));
  if (!st.docs.length) {
    hist.appendChild(el("div", { class: "rpt-note" }, "No documents yet."));
  } else {
    const ht = el("table", { class: "rpt-tbl" });
    const hh = el("tr");
    ["Type", "Number", "Date", "Status"].forEach(t => hh.appendChild(el("th", {}, t)));
    hh.appendChild(el("th", { style: { textAlign: "right" } }, "Total"));
    ht.appendChild(hh);
    st.docs.slice().sort((a, b) => (b.date || "").localeCompare(a.date || "")).forEach(d => {
      const tr = el("tr");
      tr.appendChild(el("td", {}, DOC_TYPES[d.type]?.shortLabel || d.type));
      tr.appendChild(el("td", {}, d.number));
      tr.appendChild(el("td", {}, d.date));
      tr.appendChild(el("td", {}, d.status || "Draft"));
      tr.appendChild(el("td", { style: { textAlign: "right" } }, fmt(d.totals?.total || 0)));
      ht.appendChild(tr);
    });
    hist.appendChild(ht);
  }
  rpt.appendChild(hist);

  wrap.appendChild(rpt);

  const bar = el("div", { class: "action-bar no-print" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Close"));
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: () => {
    const rows = st.docs.map(d => ({
      type: d.type, number: d.number, date: d.date, status: d.status,
      subtotal: (d.totals?.subtotal ?? 0).toFixed(2),
      tax: (d.totals?.tax ?? 0).toFixed(2),
      total: (d.totals?.total ?? 0).toFixed(2),
      discountGiven: (d.totals?.discountGiven ?? 0).toFixed(2)
    }));
    if (!rows.length) { toast("No documents to export", "err"); return; }
    downloadTextFile(toCSV(rows, ["type", "number", "date", "status", "subtotal", "tax", "total", "discountGiven"]),
      `report_${safeFilePart(c.companyName, 40)}_${today()}.csv`);
    toast("CSV exported");
  }}, "📊 CSV"));
  const pdfB = el("button", { class: "btn btn-primary" }, "📄 PDF");
  pdfB.addEventListener("click", () => downloadReportPDF(rpt, `report_${safeFilePart(c.companyName, 40)}_${today()}.pdf`, pdfB));
  bar.appendChild(pdfB);
  wrap.appendChild(bar);
  openModal(`Report — ${c.companyName}`, wrap, { wide: true, guard: false });
};

// Renders any report element to an A4 PDF.
const downloadReportPDF = async (elm, filename, btn) => {
  const original = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Generating…'; }
  try {
    const { jsPDF } = window.jspdf;
    const canvas = await html2canvas(elm, { scale: 2, backgroundColor: "#fff" });
    const img = canvas.toDataURL("image/jpeg", 0.92);
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pw = pdf.internal.pageSize.getWidth(), ph = pdf.internal.pageSize.getHeight();
    const m = 8, iw = pw - m * 2, avail = ph - m * 2;
    const ih = (canvas.height * iw) / canvas.width;
    if (ih <= avail + 3) pdf.addImage(img, "JPEG", m, m, iw, Math.min(ih, avail));
    else {
      let left = ih, y = m;
      pdf.addImage(img, "JPEG", m, y, iw, ih); left -= avail;
      while (left > 3) { y -= avail; pdf.addPage(); pdf.addImage(img, "JPEG", m, y, iw, ih); left -= avail; }
    }
    const saved = await writeToFolder(pdf.output("blob"), filename);
    if (saved) toast(`Saved to folder "${saved.name}" — ${filename}`, "ok", 6000);
    else { pdf.save(filename); toast("PDF downloaded"); }
  } catch (e) { console.error(e); toast("Couldn't generate PDF", "err"); }
  finally { if (btn) { btn.disabled = false; btn.innerHTML = original; } }
};

const openCustomerPreview = (c) => {
  const wrap = el("div");
  const row = (l, v) => { if (!v && v !== 0) return; const r = el("div", { style: { display: "flex", gap: "10px", padding: "5px 0", borderBottom: "1px solid var(--border)" } }); r.appendChild(el("div", { style: { fontWeight: 600, minWidth: "140px", color: "var(--muted)" } }, l)); r.appendChild(el("div", {}, String(v))); wrap.appendChild(r); };
  row("Client No.", "C" + String(c.id).padStart(4, "0"));
  row("Company", c.companyName);
  row("Contact", c.contactName);
  row("Phone", c.phone);
  row("VAT / PAN", c.vatNo);
  row("Address 1", c.addr1);
  row("Address 2", c.addr2);
  row("Email", c.email);
  row("Country", c.country);
  if (!c.sameAsBill) { row("Reg. No.", c.regNo); row("Ship Address 1", c.shipAddr1); row("Ship Address 2", c.shipAddr2); }
  row("EXIM Code", c.eximCode);
  const dr = Array.isArray(c.discountRules) ? c.discountRules : [];
  if (dr.length) {
    wrap.appendChild(el("div", { style: { fontWeight: 700, margin: "12px 0 4px", color: "var(--primary)" } }, "Discount rate card"));
    dr.forEach(r => row(pathKey(r.path), `${r.pct}%`));
  }
  const actions = el("div", { class: "action-bar" });
  actions.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Close"));
  actions.appendChild(el("button", { class: "btn btn-secondary", onclick: () => { closeModal(); openCustomerReport(c); } }, "📊 Report"));
  actions.appendChild(el("button", { class: "btn btn-primary", onclick: () => { closeModal(); openCustomerModal(c); } }, "✏️ Edit"));
  wrap.appendChild(actions);
  openModal(c.companyName, wrap, { guard: false });
};

const renderCustomerItem = (c) => {
  const clientNo = "C" + String(c.id).padStart(4, "0");
  const item = el("div", { class: "list-item" + (bulkSel.ids.has(c.id) && bulkActive("cust") ? " row-selected" : ""), "data-search": (clientNo + " " + c.id + " " + c.contactName + " " + c.companyName + " " + c.phone + " " + (c.vatNo || "")).toLowerCase(), "data-id": c.id });
  const cbC = bulkCheckbox("cust", c.id);
  if (cbC) item.appendChild(cbC);
  const info = el("div", { class: "info", style: { cursor: "pointer" }, onclick: () => openCustomerPreview(c) });
  const nameRow = el("div", { class: "name", style: { display: "flex", alignItems: "center", gap: "7px", flexWrap: "wrap" } });
  nameRow.appendChild(el("span", { style: { fontSize: "10px", fontWeight: 700, color: "var(--primary)", background: "var(--primary-tint)", padding: "1px 7px", borderRadius: "999px" } }, clientNo));
  nameRow.appendChild(el("span", {}, c.companyName));
  info.appendChild(nameRow);
  info.appendChild(el("div", { class: "sub" }, `${c.contactName} • ${c.phone}`));
  const rules = Array.isArray(c.discountRules) ? c.discountRules.filter(r => Number(r.pct) > 0) : [];
  if (rules.length) {
    const dRow = el("div", { style: { display: "flex", flexWrap: "wrap", gap: "4px", marginTop: "4px" } });
    rules.slice(0, 4).forEach(r => dRow.appendChild(
      el("span", { class: "disc-badge", style: { background: "var(--primary-tint)", color: "var(--primary)" } },
        `${pathKey(r.path)} ${r.pct}%`)));
    if (rules.length > 4) dRow.appendChild(el("span", { style: { fontSize: "10px", color: "var(--muted)" } }, `+${rules.length - 4} more`));
    info.appendChild(dRow);
  }
  item.appendChild(info);
  const actions = el("div", { class: "actions" });
  actions.appendChild(el("button", { class: "btn-icon", title: "Preview", onclick: () => openCustomerPreview(c) }, "👁️"));
  actions.appendChild(el("button", { class: "btn-icon", title: "Report", onclick: () => openCustomerReport(c) }, "📊"));
  actions.appendChild(el("button", { class: "btn-icon", title: "Share", onclick: () => shareText(customerToLine(c), c.companyName) }, "📤"));
  actions.appendChild(el("button", { class: "btn-icon", title: "Edit", onclick: () => openCustomerModal(c) }, "✏️"));
  actions.appendChild(el("button", { class: "btn-icon danger", onclick: () => {
    confirmModal(`Delete customer "${c.companyName}"? This can't be undone.`, () => {
      db.customers = db.customers.filter(x => x.id !== c.id); saveDB(); render();
      toast("Customer deleted");
    }, { title: "Delete customer?", confirmLabel: "Delete" });
  }}, "🗑️"));
  item.appendChild(actions);
  return item;
};

// Token search: every word must appear somewhere in the row, in any order.
// Combined search + category-prefix filter for the flat product list.
const filterProductList = (q, catPathKey) => {
  const terms = (q || "").toLowerCase().trim().split(/\s+/).filter(Boolean);
  const root = document.getElementById("prod-list");
  if (!root) return;
  const catFilter = (catPathKey || "").trim();
  root.querySelectorAll(".list-item").forEach(i => {
    const hay = i.dataset.search || "";
    const searchOK = terms.every(t => hay.includes(t));
    const path = i.dataset.catpath || "";
    // Category filter is a "starts-with" match on the ` > `-joined path
    const catOK = !catFilter || path === catFilter || path.startsWith(catFilter + " \u203A ");
    i.style.display = (searchOK && catOK) ? "" : "none";
  });
};

// So "pvc elbow" matches "Elbow PVC 110mm", and "110 elbow" works too.
const filterList = (kind, q) => {
  const terms = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
  const root = document.getElementById(`${kind}-list`);
  if (!root) return;
  const items = root.querySelectorAll(".list-item");
  let shown = 0;
  items.forEach(i => {
    const hay = i.dataset.search || "";
    const hit = terms.every(t => hay.includes(t));
    i.style.display = hit ? "" : "none";
    if (hit) shown++;
  });
  // Hide category sections that have no visible rows left.
  root.querySelectorAll("[data-cat-group]").forEach(g => {
    const anyVisible = [...g.querySelectorAll(".list-item")].some(i => i.style.display !== "none");
    g.style.display = anyVisible ? "" : "none";
  });
  // "No results" message
  let msg = root.querySelector(".search-empty");
  if (shown === 0 && items.length) {
    if (!msg) {
      msg = el("div", { class: "search-empty picker-empty" }, "");
      root.appendChild(msg);
    }
    msg.textContent = `No matches for "${q.trim()}"`;
    msg.style.display = "";
  } else if (msg) msg.style.display = "none";
};

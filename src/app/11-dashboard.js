// ==================== DASHBOARD ====================
const renderDashboard = () => {
  const wrap = el("div");
  const biz = activeBiz();
  const wel = el("div", { class: "card" });
  wel.appendChild(el("div", { class: "eyebrow" }, "Active business"));
  wel.appendChild(el("div", { class: "display-name", style: { marginTop: "6px" } }, biz.name));
  wrap.appendChild(wel);

  // Quick actions
  const qa = el("div", { class: "card" });
  qa.appendChild(el("div", { class: "card-title" }, "Quick actions"));
  const row = el("div", { class: "row" });
  const npi = el("button", { class: "btn btn-primary btn-full", onclick: () => startNewDoc("PI") }, "+ New PI");
  const npo = el("button", { class: "btn btn-secondary btn-full", onclick: () => startNewDoc("PO") }, "+ New PO");
  const nqt = el("button", { class: "btn btn-secondary btn-full", onclick: () => startNewDoc("QT") }, "+ New Quotation");
  row.appendChild(npi);
  row.appendChild(npo);
  row.appendChild(nqt);
  qa.appendChild(row);
  wrap.appendChild(qa);

  // Stats
  const stats = el("div", { class: "card" });
  stats.appendChild(el("div", { class: "card-title" }, "This business"));
  const s = el("div", { class: "row" });
  const stat = (label, val) => {
    const c = el("div", { class: "stat-tile" });
    c.appendChild(el("div", { class: "stat-num" }, String(val)));
    c.appendChild(el("div", { class: "stat-label" }, label));
    return c;
  };
  s.appendChild(stat("Customers", bizCustomers().length));
  s.appendChild(stat("Products", bizProducts().length));
  s.appendChild(stat("Documents", bizDocs().length));
  stats.appendChild(s);
  wrap.appendChild(stats);

  // Recent docs
  const recent = bizDocs().slice(-5).reverse();
  if (recent.length > 0) {
    const rc = el("div", { class: "card" });
    rc.appendChild(el("div", { class: "card-title" }, "Recent documents"));
    recent.forEach(d => rc.appendChild(renderDocListItem(d)));
    wrap.appendChild(rc);
  }
  return wrap;
};

// Bulk-move selected customers (and their documents) into a different
// business. Mirrors openMoveProductsModal's tick-then-move pattern.
const openMoveCustomersModal = (ids) => {
  const others = db.businesses.filter(b => b.id !== db.activeBusinessId);
  if (!others.length) { toast("No other business to move to", "err"); return; }
  const wrap = el("div");
  wrap.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "10px" } },
    `Move ${ids.length} customer${ids.length === 1 ? "" : "s"} — and their documents — into:`));
  const sel = el("select", { style: { marginBottom: "14px" } });
  others.forEach(b => sel.appendChild(el("option", { value: b.id }, b.name)));
  wrap.appendChild(sel);
  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Cancel"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => {
    const targetId = sel.value;
    let n = 0;
    db.customers.forEach(c => {
      if (!ids.includes(c.id)) return;
      c.businessId = targetId;
      db.documents.forEach(d => { if (d.customerId === c.id) d.businessId = targetId; });
      n++;
    });
    saveDB(); bulkSel.ids.clear(); closeModal(); render();
    toast(`Moved ${n} customer${n === 1 ? "" : "s"}`);
  }}, "Move")); 
  wrap.appendChild(bar);
  openModal("Move customers", wrap);
};

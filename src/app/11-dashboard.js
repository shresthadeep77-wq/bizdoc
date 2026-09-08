// ==================== DASHBOARD ====================
const renderDashboard = () => {
  const wrap = el("div");
  const biz = activeBiz();

  // One card, not two: the business name heads the same card as its counts,
  // and the counts stay side by side instead of stacking down the phone.
  const overview = el("div", { class: "card" });
  overview.appendChild(el("div", { class: "eyebrow" }, "Active business"));
  overview.appendChild(el("h2", { class: "display-name", style: { margin: "6px 0 14px" } }, biz.name));
  const stat = (label, val, tab) => {
    const c = el("button", { class: "stat-tile", type: "button",
      "aria-label": `${val} ${label} — open the ${label} tab`,
      onclick: () => navigateTo(tab) });
    c.appendChild(el("div", { class: "stat-num" }, String(val)));
    c.appendChild(el("div", { class: "stat-label" }, label));
    return c;
  };
  const s = el("div", { class: "stat-row" });
  s.appendChild(stat("Customers", bizCustomers().length, "customers"));
  s.appendChild(stat("Products", bizProducts().length, "products"));
  s.appendChild(stat("Documents", bizDocs().length, "documents"));
  overview.appendChild(s);
  wrap.appendChild(overview);

  // Quick actions
  const qa = el("div", { class: "card" });
  qa.appendChild(el("h2", { class: "card-title" }, "Create a document"));
  const row = el("div", { class: "row" });
  row.appendChild(el("button", { class: "btn btn-primary btn-full", onclick: () => startNewDoc("PI") }, "+ New PI"));
  row.appendChild(el("button", { class: "btn btn-secondary btn-full", onclick: () => startNewDoc("PO") }, "+ New PO"));
  row.appendChild(el("button", { class: "btn btn-secondary btn-full", onclick: () => startNewDoc("QT") }, "+ New Quotation"));
  qa.appendChild(row);
  wrap.appendChild(qa);

  // Recent docs
  const recent = bizDocs().slice(-5).reverse();
  if (recent.length > 0) {
    const rc = el("div", { class: "card" });
    rc.appendChild(el("h2", { class: "card-title" }, "Recent documents"));
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
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: async (e) => {
    const targetId = Number(sel.value);
    const targets = db.customers.filter(c => ids.includes(c.id));
    await runBulk(e.currentTarget, "Moving", targets, (c) => {
      c.businessId = targetId;
      db.documents.forEach(d => { if (d.customerId === c.id) d.businessId = targetId; });
    });
    saveDB(); bulkSel.ids.clear(); closeModal(); render();
    toast(`Moved ${targets.length} customer${targets.length === 1 ? "" : "s"}`);
  }}, "Move"));
  wrap.appendChild(bar);
  openModal("Move customers", wrap);
};

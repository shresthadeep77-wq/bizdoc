// ==================== SETTINGS ====================
const renderSettings = () => {
  const wrap = el("div");
  const biz = activeBiz();

  // Business profile as tappable section cards — each opens a focused editor.
  const bc = el("div", { class: "card" });
  bc.appendChild(el("div", { class: "card-title" }, "Business profile"));
  bc.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "10px" } },
    biz ? biz.name : ""));
  const secList = el("div", { class: "settings-sections" });
  BIZ_SECTIONS.forEach(s => {
    const row = el("div", { class: "settings-row", onclick: () => openBizSection(s.key) });
    row.appendChild(el("div", { class: "settings-icon" }, s.icon));
    const txt = el("div", { style: { flex: "1", minWidth: "0" } });
    txt.appendChild(el("div", { class: "settings-title" }, s.title));
    let sub = s.desc;
    if (s.key === "banks") {
      const n = (biz.banks || []).filter(b => b.bankName || b.accountNumber).length;
      sub = n ? `${n} account${n === 1 ? "" : "s"} set up` : "No accounts yet";
    } else if (s.key === "identity") {
      sub = [biz.phone, biz.pan ? "PAN " + biz.pan : "", biz.shortCode].filter(Boolean).join(" • ") || s.desc;
    } else if (s.key === "numbering") {
      sub = `${biz.currency || "NPR"} • ${biz.taxRate || 0}% tax`;
    } else if (s.key === "branding") {
      sub = [biz.logo ? "Logo set" : "No logo", biz.signature ? "signature set" : "no signature", biz.stamp ? "stamp set" : "no stamp"].join(" • ");
    }
    txt.appendChild(el("div", { class: "settings-sub" }, sub));
    row.appendChild(txt);
    row.appendChild(el("span", { class: "settings-chev" }, "›"));
    secList.appendChild(row);
  });
  bc.appendChild(secList);
  wrap.appendChild(bc);

  const sf = el("div", { class: "card" });
  sf.appendChild(el("div", { class: "card-title" }, "💾 Save location"));
  if (supportsFSA()) {
    sf.appendChild(el("div", { style: { fontSize: "12.5px", color: "var(--muted)", marginBottom: "10px" } },
      "Pick a real folder on this device. PDFs, PNGs and backups will save straight there — no download prompts, no picking a folder every time."));
    if (biz.saveFolderDisplayName) {
      const row = el("div", { class: "list-item" });
      const info = el("div", { class: "info" });
      info.appendChild(el("div", { class: "name" }, `📁 ${biz.saveFolderDisplayName}`));
      info.appendChild(el("div", { class: "sub" }, "All downloads for this business go here"));
      row.appendChild(info);
      const actions = el("div", { class: "actions" });
      actions.appendChild(el("button", { class: "btn-icon", title: "Change folder", onclick: chooseSaveFolder }, "🔄"));
      actions.appendChild(el("button", { class: "btn-icon danger", title: "Stop using this folder", onclick: clearSaveFolder }, "✖"));
      row.appendChild(actions);
      sf.appendChild(row);
    } else {
      sf.appendChild(el("button", { class: "btn btn-primary btn-full", onclick: chooseSaveFolder }, "📁 Choose or create a folder"));
    }
  } else {
    sf.appendChild(el("div", { style: { fontSize: "12.5px", color: "var(--muted)" } },
      "Direct folder picking needs Chrome or Edge. In this browser, use \"Save folder name\" under Document defaults above — downloads will land in a subfolder inside your normal Downloads folder."));
  }
  wrap.appendChild(sf);

  const dc = el("div", { class: "card" });
  dc.appendChild(el("div", { class: "card-title" }, "Data"));
  // --- CSV export / import ---
  dc.appendChild(el("div", { style: { fontSize: "12px", fontWeight: 600, color: "var(--muted)", margin: "2px 0 6px" } }, "Spreadsheets (CSV)"));
  const csvGrid = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "10px" } });
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: exportProductsCSV }, "📤 Export products"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: () => importCSV("products") }, "📥 Import products"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: exportCustomersCSV }, "📤 Export customers"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: () => importCSV("customers") }, "📥 Import customers"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: exportDocumentsCSV }, "📤 Export documents"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: () => {
    const w = el("div");
    w.appendChild(el("div", { style: { fontSize: "12.5px", marginBottom: "10px" } }, "Blank CSV files with the right column headers — fill them in Excel, then import."));
    w.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "6px" }, onclick: () => { downloadTemplate("products"); closeModal(); } }, "Products template"));
    w.appendChild(el("button", { class: "btn btn-secondary btn-full", onclick: () => { downloadTemplate("customers"); closeModal(); } }, "Customers template"));
    openModal("CSV templates", w);
  }}, "📄 Templates"));
  dc.appendChild(csvGrid);
  dc.appendChild(el("div", { style: { fontSize: "12px", fontWeight: 600, color: "var(--muted)", margin: "2px 0 6px" } }, "Full backup"));
  const bk = el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "8px" }, onclick: exportBackup }, "📥 Export backup (JSON)");
  const rs = el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "8px" }, onclick: importBackup }, "📤 Import backup (JSON)");
  const dl = el("button", { class: "btn btn-danger btn-full", onclick: () => {
    confirmModal(
      `This permanently deletes "${biz.name}" and every customer, product, and document under it. This cannot be undone.`,
      () => {
        const name = biz.name;
        db.customers = db.customers.filter(c => c.businessId !== biz.id);
        db.products = db.products.filter(p => p.businessId !== biz.id);
        db.documents = db.documents.filter(d => d.businessId !== biz.id);
        db.businesses = db.businesses.filter(b => b.id !== biz.id);
        db.activeBusinessId = db.businesses[0]?.id || null;
        saveDB(); render();
        toast(`"${name}" and all its data deleted`);
      },
      { title: "Delete this business?", confirmLabel: "Delete everything", typeToConfirm: biz.name }
    );
  }}, "🗑️ Delete this business");
  dc.appendChild(bk); dc.appendChild(rs); dc.appendChild(dl);
  wrap.appendChild(dc);

  return wrap;
};

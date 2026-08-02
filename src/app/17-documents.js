// ==================== DOCUMENTS ====================
const renderDocuments = () => {
  const wrap = el("div");
  const search = el("div", { class: "search" });
  search.appendChild(el("input", { placeholder: "Search documents...", oninput: (e) => filterList("doc", e.target.value) }));
  wrap.appendChild(search);

  const newDocRow = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" } });
  newDocRow.appendChild(el("button", { class: "btn btn-primary", onclick: () => startNewDoc("PI") }, "+ PI"));
  newDocRow.appendChild(el("button", { class: "btn btn-secondary", onclick: () => startNewDoc("PO") }, "+ PO"));
  newDocRow.appendChild(el("button", { class: "btn btn-secondary", onclick: () => startNewDoc("QT") }, "+ QT"));
  wrap.appendChild(newDocRow);

  const filterRow = el("div", { class: "row", style: { marginBottom: "12px" } });
  const typeF = el("select", { onchange: (e) => { docTypeFilter = e.target.value; render(); } });
  ["All", ...Object.keys(DOC_TYPES)].forEach(t => typeF.appendChild(el("option", { value: t, selected: t === docTypeFilter ? "" : undefined }, t === "All" ? "All types" : DOC_TYPES[t].label)));
  typeF.value = docTypeFilter;
  filterRow.appendChild(typeF);
  wrap.appendChild(filterRow);

  const list = bizDocs().filter(d => docTypeFilter === "All" || d.type === docTypeFilter).slice().reverse();
  if (bulkActive("doc")) {
    wrap.appendChild(bulkBar("doc",
      () => [...document.querySelectorAll("#doc-list .list-item")]
        .filter(i => i.style.display !== "none")
        .map(i => i.dataset.id).filter(Boolean),
      (ids) => {
        const snapshot = db.documents.filter(x => ids.includes(String(x.id)) || ids.includes(x.id));
        deleteWithUndo(`${ids.length} document${ids.length === 1 ? "" : "s"}`,
          () => {
            db.documents = db.documents.filter(x => !(ids.includes(String(x.id)) || ids.includes(x.id)));
            bulkSel.ids.clear();
          },
          () => { db.documents.push(...snapshot); });
      }));
  } else if (list.length) {
    const selRow = el("div", { style: { marginBottom: "12px" } });
    selRow.appendChild(el("button", { class: "btn btn-secondary", onclick: () => bulkToggleMode("doc") }, "\u2611\uFE0F Select"));
    wrap.appendChild(selRow);
  }

  const listCt = el("div", { id: "doc-list" });
  if (list.length === 0) {
    listCt.appendChild(emptyState("📄", "No documents yet", "Create your first PI, PO or Quotation"));
  } else {
    list.forEach(d => listCt.appendChild(renderDocListItem(d)));
  }
  wrap.appendChild(listCt);
  return wrap;
};

const renderDocListItem = (d) => {
  const cust = db.customers.find(c => c.id === d.customerId);
  const item = el("div", { class: "list-item" + (bulkSel.ids.has(d.id) && bulkActive("doc") ? " row-selected" : ""), "data-search": (d.number + " " + (cust?.companyName || "") + " " + d.type + " " + (d.status || "") + " " + (d.date || "")).toLowerCase(), "data-id": d.id });
  const cbD = bulkCheckbox("doc", d.id);
  if (cbD) item.appendChild(cbD);
  const info = el("div", { class: "info", onclick: () => openDocPreview(d), style: { cursor: "pointer" } });
  const name = el("div", { class: "name" });
  name.appendChild(document.createTextNode(`${DOC_TYPES[d.type].shortLabel} #${d.number}`));
  const badge = el("span", { class: `status-badge st-${d.status}` }, d.status);
  name.appendChild(badge);
  info.appendChild(name);
  info.appendChild(el("div", { class: "sub" }, `${cust?.companyName || "—"} • ${d.date} • ${d.currency} ${fmt(d.totals?.total || 0)}`));
  item.appendChild(info);
  const actions = el("div", { class: "actions" });
  actions.appendChild(el("button", { class: "btn-icon", title: "Preview", onclick: () => openDocPreview(d) }, "👁️"));
  actions.appendChild(el("button", { class: "btn-icon", title: "Edit", onclick: () => editDoc(d) }, "✏️"));
  actions.appendChild(el("button", { class: "btn-icon danger", title: "Delete", onclick: () => {
    confirmModal(`Delete ${DOC_TYPES[d.type].shortLabel} #${d.number}? This can't be undone.`, () => {
      db.documents = db.documents.filter(x => x.id !== d.id); saveDB(); render();
      toast(`${DOC_TYPES[d.type].shortLabel} #${d.number} deleted`);
    }, { title: `Delete ${DOC_TYPES[d.type].label}?`, confirmLabel: "Delete" });
  }}, "🗑️"));
  item.appendChild(actions);
  return item;
};

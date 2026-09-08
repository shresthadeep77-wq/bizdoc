// ==================== DOCUMENTS ====================
const renderDocuments = () => {
  const wrap = el("div");
  const anyDocs = bizDocs().length > 0;
  if (anyDocs) {
    const search = el("div", { class: "search" });
    search.appendChild(el("input", { type: "search", "aria-label": "Search documents", placeholder: "Search documents…", oninput: (e) => filterList("doc", e.target.value) }));
    wrap.appendChild(search);
  }

  // Once there are documents this is a compact "new" row above the list. With
  // none, the empty state below carries the same three buttons with full names,
  // so a first-time screen isn't two rows of the same thing.
  if (anyDocs) {
    const newDocRow = el("div", { style: { display: "flex", gap: "8px", flexWrap: "wrap", marginBottom: "12px" } });
    newDocRow.appendChild(el("button", { class: "btn btn-primary", onclick: () => startNewDoc("PI") }, "+ PI"));
    newDocRow.appendChild(el("button", { class: "btn btn-secondary", onclick: () => startNewDoc("PO") }, "+ PO"));
    newDocRow.appendChild(el("button", { class: "btn btn-secondary", onclick: () => startNewDoc("QT") }, "+ QT"));
    wrap.appendChild(newDocRow);
  }

  if (anyDocs) {
    const filterRow = el("div", { class: "row", style: { marginBottom: "12px" } });
    const typeF = el("select", { "aria-label": "Filter by document type", onchange: (e) => { docTypeFilter = e.target.value; render(); } });
    ["All", ...Object.keys(DOC_TYPES)].forEach(t => typeF.appendChild(el("option", { value: t, selected: t === docTypeFilter }, t === "All" ? "All types" : DOC_TYPES[t].label)));
    typeF.value = docTypeFilter;
    filterRow.appendChild(typeF);
    wrap.appendChild(filterRow);
  }

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
    if (!anyDocs) {
      listCt.appendChild(emptyState("\u{1F4C4}", "No documents yet",
        "Pick what you want to create. A quotation can be converted into an invoice later without retyping it.",
        { label: "+ New Proforma Invoice", onclick: () => startNewDoc("PI") }));
      const more = el("div", { style: { display: "flex", justifyContent: "center", gap: "8px", flexWrap: "wrap", marginTop: "10px" } });
      more.appendChild(el("button", { class: "btn btn-secondary", onclick: () => startNewDoc("QT") }, "+ New Quotation"));
      more.appendChild(el("button", { class: "btn btn-secondary", onclick: () => startNewDoc("PO") }, "+ New Purchase Order"));
      listCt.appendChild(more);
    } else {
      listCt.appendChild(emptyState("\u{1F50D}", `No ${DOC_TYPES[docTypeFilter].label.toLowerCase()}s yet`,
        "Nothing of this type. Switch the filter back to All types, or create one now.",
        { label: `+ New ${DOC_TYPES[docTypeFilter].label}`, onclick: () => startNewDoc(docTypeFilter) }));
    }
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
  const label = `${DOC_TYPES[d.type].shortLabel} #${d.number}`;
  const iconBtn = (name, glyph, onclick, danger) =>
    el("button", { class: "btn-icon" + (danger ? " danger" : ""), type: "button",
      title: name, "aria-label": `${name} ${label}`, onclick }, glyph);
  actions.appendChild(iconBtn("Preview", "👁️", () => openDocPreview(d)));
  actions.appendChild(iconBtn("Edit", "✏️", () => editDoc(d)));
  actions.appendChild(iconBtn("Delete", "🗑️", () => {
    confirmModal(`Delete ${label}? You will have a few seconds to undo.`,
      () => deleteWithUndo(label,
        () => { track("document.deleted", { type: d.type }); db.documents = db.documents.filter(x => x.id !== d.id); },
        () => { track("document.delete_undone", { type: d.type }); db.documents.push(d); }),
      { title: `Delete ${DOC_TYPES[d.type].label}?`, confirmLabel: "Delete" });
  }, true));
  item.appendChild(actions);
  return item;
};

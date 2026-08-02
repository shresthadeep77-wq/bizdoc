// ==================== PRODUCTS ====================
// Categories aren't standalone records — they're fields on products. So
// "adding" one means naming it and assigning products into it.
const openAddCategoryModal = (parentPath) => {
  const depth = parentPath.length; // which subCategory slot the new name fills
  if (depth >= 4) { toast("Maximum category depth reached", "err"); return; }
  const keyFor = (d) => d === 0 ? "category" : `subCategory${d}`;
  const wrap = el("div");
  const state = { name: "", picked: new Set() };

  if (parentPath.length) {
    wrap.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "8px" } },
      `Inside: ${pathKey(parentPath)}`));
  }
  wrap.appendChild(inputField("Category name *", "name", state, { placeholder: "e.g. Fittings" }));

  // Candidates: products already at the parent level (so nesting makes sense).
  const candidates = bizProducts().filter(p => {
    const pp = productPath(p);
    return parentPath.every((s, i) => pp[i] === s) && pp.length === parentPath.length;
  });
  wrap.appendChild(el("div", { style: { fontWeight: 600, fontSize: "12.5px", margin: "12px 0 4px" } },
    `Move products into it (optional)`));
  if (candidates.length === 0) {
    wrap.appendChild(el("div", { style: { fontSize: "11.5px", color: "var(--muted)", paddingBottom: "6px" } },
      parentPath.length ? "No products sit directly at this level yet. You can create the category now and assign products when you edit them."
                        : "No uncategorized products. Create the category now and assign products when you edit them."));
  } else {
    const box = el("div", { class: "picker-list", style: { maxHeight: "220px" } });
    candidates.forEach(p => {
      const rowEl = el("label", { class: "picker-row", style: { cursor: "pointer", alignItems: "center", padding: "8px 10px" } });
      const cb = el("input", { type: "checkbox", style: { flex: "none", width: "auto", marginRight: "8px" } });
      cb.addEventListener("change", (e) => { e.target.checked ? state.picked.add(p.id) : state.picked.delete(p.id); });
      rowEl.appendChild(cb);
      rowEl.appendChild(el("div", { style: { flex: "1", fontSize: "12.5px" } }, p.description));
      box.appendChild(rowEl);
    });
    wrap.appendChild(box);
  }

  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Cancel"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => {
    const name = (state.name || "").trim();
    if (!name) { toast("Category name required", "err"); return; }
    const siblings = buildCategoryTree(bizProducts());
    let n = siblings;
    for (const seg of parentPath) { n = n.children.find(c => c.name === seg) || { children: [] }; }
    if ((n.children || []).some(c => c.name.toLowerCase() === name.toLowerCase())) {
      toast("That category already exists here", "err"); return;
    }
    if (state.picked.size === 0) {
      // Nothing to assign — the category can't exist on its own, so say so.
      toast("Select at least one product, or add the category from a product's form", "err");
      return;
    }
    let moved = 0;
    db.products.forEach(p => {
      if (!state.picked.has(p.id)) return;
      parentPath.forEach((seg, i) => { p[keyFor(i)] = seg; });
      p[keyFor(depth)] = name;
      moved++;
    });
    saveDB(); closeModal();
    prodView.path = [...parentPath, name];
    render();
    toast(`${name} created with ${moved} product${moved === 1 ? "" : "s"}`);
  }}, "Create category"));
  wrap.appendChild(bar);
  openModal(parentPath.length ? "New sub-category" : "New category", wrap);
};

// Rename a category everywhere it appears (fixes typos / merges duplicates).
const openRenameCategoryModal = (path) => {
  const depth = path.length - 1;
  const keyFor = (d) => d === 0 ? "category" : `subCategory${d}`;
  const state = { name: path[depth] };
  const affected = bizProducts().filter(p => {
    const pp = productPath(p);
    return path.every((s, i) => pp[i] === s);
  });
  const wrap = el("div");
  wrap.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "8px" } },
    `Renaming ${pathKey(path)} — affects ${affected.length} product${affected.length === 1 ? "" : "s"}.`));
  wrap.appendChild(inputField("New name *", "name", state));
  wrap.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "6px" } },
    "Tip: renaming to an existing category name merges them."));
  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Cancel"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => {
    const name = (state.name || "").trim();
    if (!name) { toast("Name required", "err"); return; }
    let n = 0;
    db.products.forEach(p => {
      const pp = productPath(p);
      if (!path.every((s, i) => pp[i] === s)) return;
      p[keyFor(depth)] = name; n++;
    });
    saveDB(); closeModal();
    prodView.path = [...path.slice(0, depth), name];
    render();
    toast(`Renamed — ${n} product${n === 1 ? "" : "s"} updated`);
  }}, "Rename"));
  wrap.appendChild(bar);
  openModal("Rename category", wrap);
};

// Move existing products into the category you're viewing.
const openMoveProductsModal = (targetPath) => {
  const keyFor = (d) => d === 0 ? "category" : `subCategory${d}`;
  const state = { picked: new Set(), q: "" };
  const wrap = el("div");
  wrap.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "8px" } },
    `Products you tick will be moved into: ${pathKey(targetPath) || "Uncategorized"}`));
  const search = el("input", { placeholder: "🔍 Filter products...", style: { marginBottom: "8px" } });
  wrap.appendChild(search);
  const selectAllRow = el("div", { style: { marginBottom: "8px" } });
  wrap.appendChild(selectAllRow);
  const box = el("div", { class: "picker-list", style: { maxHeight: "300px" } });
  const countLbl = el("div", { style: { fontSize: "11.5px", color: "var(--muted)", margin: "6px 0" } });
  let visibleIds = [];

  const draw = () => {
    box.innerHTML = "";
    const term = state.q.trim().toLowerCase();
    // Everything not already sitting exactly at the target path.
    const candidates = bizProducts().filter(p => {
      const pp = productPath(p);
      const already = pp.length === targetPath.length && targetPath.every((s, i) => pp[i] === s);
      if (already) return false;
      return !term || (p.description + " " + (p.partNumber || "") + " " + pathKey(pp)).toLowerCase().includes(term);
    });
    visibleIds = candidates.map(p => p.id);
    if (!candidates.length) {
      box.appendChild(el("div", { class: "picker-empty" }, term ? "No products match." : "Every product is already here."));
    }
    candidates.forEach(p => {
      const rowEl = el("label", { class: "picker-row", style: { cursor: "pointer", alignItems: "center", padding: "8px 10px" } });
      const cb = el("input", { type: "checkbox", style: { flex: "none", width: "auto", marginRight: "8px" } });
      cb.checked = state.picked.has(p.id);
      cb.addEventListener("change", (e) => {
        e.target.checked ? state.picked.add(p.id) : state.picked.delete(p.id);
        countLbl.textContent = `${state.picked.size} selected`;
      });
      rowEl.appendChild(cb);
      const txt = el("div", { style: { flex: "1", minWidth: "0" } });
      txt.appendChild(el("div", { style: { fontSize: "12.5px", fontWeight: 600 } }, p.description));
      txt.appendChild(el("div", { style: { fontSize: "10.5px", color: "var(--muted)" } }, pathKey(productPath(p)) || "Uncategorized"));
      rowEl.appendChild(txt);
      box.appendChild(rowEl);
    });
    selectAllRow.innerHTML = "";
    if (visibleIds.length) {
      const allOn = visibleIds.every(id => state.picked.has(id));
      selectAllRow.appendChild(el("button", { class: "btn btn-secondary bulk-mini", onclick: () => {
        visibleIds.forEach(id => allOn ? state.picked.delete(id) : state.picked.add(id));
        countLbl.textContent = `${state.picked.size} selected`;
        draw();
      }}, allOn ? "Deselect all" : `Select all (${visibleIds.length})`));
    }
  };
  search.addEventListener("input", (e) => { state.q = e.target.value; draw(); });
  draw();
  wrap.appendChild(box);
  countLbl.textContent = "0 selected";
  wrap.appendChild(countLbl);

  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Cancel"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => {
    if (!state.picked.size) { toast("Nothing selected", "err"); return; }
    let n = 0;
    db.products.forEach(p => {
      if (!state.picked.has(p.id)) return;
      // clear all levels, then write the target path
      ["category", "subCategory1", "subCategory2", "subCategory3"].forEach(k => p[k] = "");
      targetPath.forEach((seg, i) => { p[keyFor(i)] = seg; });
      n++;
    });
    saveDB(); closeModal(); render();
    toast(`Moved ${n} product${n === 1 ? "" : "s"}`);
  }}, "Move here"));
  wrap.appendChild(bar);
  openModal("Move products", wrap);
};

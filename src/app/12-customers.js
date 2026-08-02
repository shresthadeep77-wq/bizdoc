// ==================== CUSTOMERS ====================
const renderCustomers = () => {
  const wrap = el("div");
  const search = el("div", { class: "search" });
  const searchInput = el("input", { placeholder: "Search customers...", oninput: (e) => filterList("cust", e.target.value) });
  search.appendChild(searchInput);
  wrap.appendChild(search);

  const list = bizCustomers();
  if (bulkActive("cust")) {
    wrap.appendChild(bulkBar("cust",
      () => [...document.querySelectorAll("#cust-list .list-item")]
        .filter(i => i.style.display !== "none")
        .map(i => Number(i.dataset.id)).filter(Boolean),
      (ids) => {
        const custSnap = db.customers.filter(c => ids.includes(c.id));
        const docSnap = db.documents.filter(d => ids.includes(d.customerId));
        const doIt = () => deleteWithUndo(`${ids.length} customer${ids.length === 1 ? "" : "s"}`,
          () => {
            db.customers = db.customers.filter(c => !ids.includes(c.id));
            db.documents = db.documents.filter(d => !ids.includes(d.customerId));
            bulkSel.ids.clear();
          },
          () => { db.customers.push(...custSnap); db.documents.push(...docSnap); });
        if (docSnap.length) {
          confirmModal(`This also deletes ${docSnap.length} document${docSnap.length === 1 ? "" : "s"} belonging to the selected customer${ids.length === 1 ? "" : "s"}.`, doIt, { confirmLabel: "Delete anyway" });
        } else doIt();
      },
      [el("button", { class: "btn btn-secondary bulk-mini", onclick: () => {
        const ids = [...bulkSel.ids];
        if (!ids.length) { toast("Nothing selected", "err"); return; }
        const text = db.customers.filter(c => ids.includes(c.id)).map(customerToLine).join("\n");
        shareText(text, "Customers");
      }}, "📤 Share"),
      ...(db.businesses.length > 1 ? [el("button", { class: "btn btn-secondary bulk-mini", onclick: () => {
        const ids = [...bulkSel.ids];
        if (!ids.length) { toast("Nothing selected", "err"); return; }
        openMoveCustomersModal(ids);
      }}, "🏢 Move to…")] : [])]));
  } else {
    const bulkRow = el("div", { style: { display: "flex", gap: "6px", marginBottom: "12px", flexWrap: "wrap" } });
    bulkRow.appendChild(el("button", { class: "btn btn-secondary", onclick: openBulkCustomerModal }, "📋 Bulk add customers"));
    if (list.length) bulkRow.appendChild(el("button", { class: "btn btn-secondary", onclick: () => bulkToggleMode("cust") }, "☑️ Select"));
    wrap.appendChild(bulkRow);
  }

  const listCt = el("div", { id: "cust-list" });
  if (list.length === 0) {
    listCt.appendChild(emptyState("👥", "No customers yet", "Add your first customer"));
  } else {
    list.forEach(c => listCt.appendChild(renderCustomerItem(c)));
  }
  wrap.appendChild(listCt);

  const fab = el("button", { class: "fab", onclick: () => openCustomerModal(null) }, "+");
  wrap.appendChild(fab);
  return wrap;
};

const openBulkCustomerModal = () => {
  const wrap = el("div");
  wrap.appendChild(el("div", { style: { fontSize: "13px", color: "var(--muted)", marginBottom: "10px" } },
    "One customer per line, comma-separated: Company, Contact, Phone, Address 1, Address 2, VAT/PAN, Email, Reg No, EXIM, Country. Company and Phone required; rest optional."));
  const ta = el("textarea", { rows: 10, placeholder: "Deep Jyoti Traders, Ram Sharma, 9779851158034, Kathmandu, Ward 5, 601234567, ram@dj.com\nSajilo Nirman, Sita Rai, 9779841234567" });
  wrap.appendChild(ta);
  const result = el("div", { style: { fontSize: "12px", color: "var(--muted)", marginTop: "8px" } });
  wrap.appendChild(result);
  wrap.appendChild(el("button", { class: "btn btn-primary btn-full", style: { marginTop: "12px" }, onclick: () => {
    const lines = ta.value.split("\n").map(l => l.trim()).filter(Boolean);
    let added = 0, skipped = 0;
    lines.forEach(line => {
      const parts = line.split(",").map(p => p.trim());
      const [companyName, contactName = "", phone = "", addr1 = "", addr2 = "", vatNo = "", email = "", regNo = "", eximCode = "", country = "NEPAL"] = parts;
      if (!companyName || !phone) { skipped++; return; }
      db.customers.push({
        id: uid("cust"), businessId: db.activeBusinessId,
        contactName, companyName, phone, addr1, addr2,
        vatNo, regNo, shipAddr1: "", shipAddr2: "", email, eximCode, country: country || "NEPAL", sameAsBill: true
      });
      added++;
    });
    if (added) saveDB();
    closeModal(); render();
    toast(skipped ? `Added ${added}, skipped ${skipped} (missing name/phone)` : `Added ${added} customer${added === 1 ? "" : "s"}`);
  }}, "Add all"));
  openModal("Bulk add customers", wrap);
};

// Read-only customer detail preview.
// Fits the fixed-width A4 preview into whatever width is available, and keeps
// it fitted on rotate/resize. The .preview element itself is never resized —
// html2canvas still captures a full-resolution 794px page for the PDF.
const attachPreviewScaler = (wrapEl, scalerEl, pageEl) => {
  const PAGE_W = 794;
  let userZoom = null; // set when the user taps zoom controls
  let bar = null;      // zoom control bar, built below
  const apply = () => {
    const avail = wrapEl.clientWidth - 24; // minus padding
    if (avail <= 0) return;
    const fit = Math.min(1, avail / PAGE_W);
    const scale = userZoom !== null ? userZoom : fit;
    scalerEl.style.transform = `scale(${scale})`;
    scalerEl.dataset.scale = String(scale);
    // A scaled element still reserves its unscaled box, leaving a large gap.
    // Collapse that by setting the wrapper height to the visual height.
    scalerEl.style.height = (pageEl.offsetHeight * scale) + "px";
    wrapEl.style.overflowX = scale < 1 ? "hidden" : "auto";
    const zi = bar ? bar.querySelector(".pv-zoom-val") : null;
    if (zi) zi.textContent = Math.round(scale * 100) + "%";
  };
  // Zoom controls, useful once the page is shrunk on a phone.
  bar = el("div", { class: "pv-zoom-bar no-print" });
  const mk = (label, fn) => el("button", { class: "pv-zoom-btn", type: "button", onclick: (e) => { e.stopPropagation(); fn(); apply(); } }, label);
  bar.appendChild(mk("\u2212", () => {
    const cur = userZoom !== null ? userZoom : Math.min(1, (wrapEl.clientWidth - 24) / PAGE_W);
    userZoom = Math.max(0.25, cur - 0.15);
  }));
  bar.appendChild(el("span", { class: "pv-zoom-val" }, "100%"));
  bar.appendChild(mk("+", () => {
    const cur = userZoom !== null ? userZoom : Math.min(1, (wrapEl.clientWidth - 24) / PAGE_W);
    userZoom = Math.min(2.5, cur + 0.15);
  }));
  bar.appendChild(mk("Fit", () => { userZoom = null; }));
  wrapEl.parentNode.insertBefore(bar, wrapEl);

  // Re-fit on viewport changes.
  const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(apply) : null;
  if (ro) ro.observe(wrapEl);
  window.addEventListener("resize", apply);
  setTimeout(apply, 0);
  setTimeout(apply, 120); // after images/fonts settle
};

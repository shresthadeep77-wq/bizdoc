// ==================== BACKUP ====================
const exportBackup = async () => {
  track("backup.exported");
  const filename = `pipomaker_backup_${today()}.json`;
  const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
  const savedBk = await writeToFolder(blob, filename, "backups");
  if (savedBk) {
    toast(`Backup saved to "${savedBk.name}/backups"`, "ok", 6000);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
  toast("Backup downloaded");
};

// ---- Restore from what's already on this device ----
// Everything lives in this browser's localStorage under DB_KEY. A copy can end
// up stranded under a different key — an older build, a renamed key, a
// half-finished import — and then the app boots straight into onboarding as if
// nothing was ever saved. This sweeps storage for anything that looks like our
// database so it can be picked back up instead of retyped.
const scanDeviceData = () => {
  const found = [];
  let keys = [];
  try { keys = Object.keys(localStorage); } catch (e) { return found; }
  keys.forEach(k => {
    let raw;
    try { raw = localStorage.getItem(k); } catch (e) { return; }
    if (!raw || raw.length < 20 || raw[0] !== "{") return;
    let v;
    try { v = JSON.parse(raw); } catch (e) { return; }
    if (!v || !Array.isArray(v.businesses) || !v.businesses.length) return;
    found.push({
      key: k, data: v, isCurrent: k === DB_KEY,
      sizeKB: Math.max(1, Math.round(raw.length / 1024)),
      names: v.businesses.map(b => b && b.name).filter(Boolean),
      businesses: v.businesses.length,
      customers: (v.customers || []).length,
      products: (v.products || []).length,
      documents: (v.documents || []).length,
    });
  });
  // Richest copy first — most likely the real history.
  found.sort((a, b) => (b.documents + b.products + b.customers) - (a.documents + a.products + a.customers));
  return found;
};

const deviceEntrySummary = (e) =>
  `${e.products} product${e.products === 1 ? "" : "s"} • ${e.customers} customer${e.customers === 1 ? "" : "s"} • ${e.documents} document${e.documents === 1 ? "" : "s"} • ${e.sizeKB} KB`;

const deviceEntryNames = (e) =>
  e.names.length ? e.names.slice(0, 2).join(", ") + (e.names.length > 2 ? ` +${e.names.length - 2} more` : "") : "Unnamed business";

// Swap the app over to a copy found on this device. Confirms first if there is
// already data loaded that would be replaced.
const restoreDeviceEntry = (entry) => {
  track("backup.device_restore");
  const apply = () => {
    replaceDB(JSON.parse(JSON.stringify(entry.data)));
    if (modalStack.length) closeModal();
    render();
    toast(`Loaded ${entry.businesses} business${entry.businesses === 1 ? "" : "es"} from this device`, "ok", 4000);
  };
  if (db.businesses.length) {
    confirmModal(
      `This replaces every business, customer, product and document currently in the app with the copy saved on this device (${deviceEntrySummary(entry)}).`,
      apply, { title: "Load saved data?", confirmLabel: "Load it" });
  } else {
    apply();
  }
};

const openDeviceRestoreModal = () => {
  const found = scanDeviceData();
  const wrap = el("div");
  if (!found.length) {
    wrap.appendChild(el("div", { class: "picker-empty" }, "No saved data found in this browser."));
    wrap.appendChild(el("div", { style: { fontSize: "11.5px", color: "var(--muted)", padding: "0 4px" } },
      "Data is stored per browser and per device — a different browser, a private window, or cleared site data all start empty. Restore from a backup file or Google Drive instead."));
  } else {
    wrap.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "10px" } },
      `${found.length} saved cop${found.length === 1 ? "y" : "ies"} found in this browser's storage.`));
    const list = el("div", { class: "picker-list" });
    found.forEach(entry => {
      const row = el("div", { class: "picker-row" });
      const body = el("div", { class: "picker-body" });
      const txt = el("div", { style: { flex: "1", minWidth: "0" } });
      const nameRow = el("div", { style: { fontWeight: 600, fontSize: "13px" } }, deviceEntryNames(entry));
      if (entry.isCurrent) nameRow.appendChild(el("span", { style: { marginLeft: "6px", fontSize: "10px", fontWeight: 700, color: "var(--primary)" } }, "IN USE"));
      txt.appendChild(nameRow);
      txt.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "1px" } }, deviceEntrySummary(entry)));
      body.appendChild(txt);
      row.appendChild(body);
      row.appendChild(el("button", { class: "btn btn-secondary picker-use", onclick: () => restoreDeviceEntry(entry) }, "Load"));
      list.appendChild(row);
    });
    wrap.appendChild(list);
  }
  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Close"));
  wrap.appendChild(bar);
  openModal("Data saved on this device", wrap, { guard: false });
};

const importBackup = () => {
  track("backup.imported");
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json";
  inp.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try {
        const imported = JSON.parse(r.result);
        if (!imported.businesses) throw new Error("Invalid backup");
        confirmModal(
          "This replaces every business, customer, product, and document currently in the app with what's in this backup file. Your current data will be lost.",
          () => { replaceDB(imported); render(); toast("Backup restored"); },
          { title: "Replace all data?", confirmLabel: "Replace data" }
        );
      } catch (e) { toast("Invalid backup file: " + e.message, "err"); }
    };
    r.readAsText(f);
  };
  inp.click();
};

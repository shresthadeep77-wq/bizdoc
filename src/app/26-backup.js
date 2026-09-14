// ==================== BACKUP ====================
const exportBackup = async () => {
  const filename = `pipomaker_backup_${today()}.json`;
  try {
    const blob = new Blob([JSON.stringify(db, null, 2)], { type: "application/json" });
    const savedBk = await writeToFolder(blob, filename, "backups");
    if (savedBk) {
      track("backup.exported");
      toast(`Backup saved to "${savedBk.name}/backups"`, "ok", 6000);
      return;
    }
    // The link has to be in the document for Firefox to act on the click, and
    // the object URL has to outlive the click — revoking it on the next line
    // cancels the download on some browsers before it has begun.
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    track("backup.exported");
    toast("Backup downloaded");
  } catch (e) {
    console.error("Backup failed:", e);
    toast("Couldn't save the backup. Please try again.", "err");
  }
};

// Put the database that is about to be thrown away somewhere it can be found
// again. It goes into this browser's storage under its own key, which is
// exactly what Settings -> "Data saved on this device" lists — so a restore
// that turns out to be the wrong file is one click away from being undone.
// Only ever one such copy is kept, and failing to write it never blocks the
// restore the user actually asked for.
const RESCUE_KEY = "pipomaker_before_restore";
const stashCurrentData = () => {
  try {
    if (!db || !Array.isArray(db.businesses) || !db.businesses.length) return false;
    localStorage.setItem(RESCUE_KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    return false; // usually storage is full; the restore still goes ahead
  }
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
      key: k, data: v, isCurrent: k === DB_KEY, isRescue: k === RESCUE_KEY,
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
    // Same safety net as a file restore: keep what is being replaced.
    if (!entry.isRescue) stashCurrentData();
    try {
      replaceDB(JSON.parse(JSON.stringify(entry.data)));
    } catch (e) {
      console.error("Device restore failed:", e);
      toast("Couldn't load that copy. Nothing was changed.", "err");
      return;
    }
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
      if (entry.isRescue) nameRow.appendChild(el("span", { style: { marginLeft: "6px", fontSize: "10px", fontWeight: 700, color: "var(--muted)" } }, "BEFORE LAST RESTORE"));
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
  const inp = document.createElement("input");
  inp.type = "file"; inp.accept = "application/json,.json";
  inp.onchange = (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader();
    r.onerror = () => toast("That file couldn't be read. Please try again.", "err");
    r.onload = () => {
      let imported;
      try {
        imported = JSON.parse(r.result);
      } catch (err) {
        toast("That doesn't look like a BizDoc backup — it isn't readable as a backup file.", "err", 6000);
        return;
      }
      if (!imported || typeof imported !== "object" || !Array.isArray(imported.businesses)) {
        toast("That doesn't look like a BizDoc backup — no businesses in it.", "err", 6000);
        return;
      }
      const counts = `${imported.businesses.length} business${imported.businesses.length === 1 ? "" : "es"}, ` +
        `${(imported.customers || []).length} customers, ${(imported.products || []).length} products, ` +
        `${(imported.documents || []).length} documents`;
      confirmModal(
        `This replaces everything currently in the app with what is in this file (${counts}). ` +
        `Your current data is kept on this device first, so if this is the wrong file you can get it back ` +
        `from Settings → Data & backup → "Data saved on this device".`,
        () => {
          const stashed = stashCurrentData();
          try {
            replaceDB(imported);
          } catch (err) {
            console.error("Restore failed:", err);
            toast("Couldn't load that backup. Nothing was changed.", "err");
            return;
          }
          track("backup.imported");
          render();
          toast(stashed ? "Backup restored — your previous data is still on this device" : "Backup restored", "ok", 6000);
        },
        { title: "Replace all data?", confirmLabel: "Replace data" }
      );
    };
    r.readAsText(f);
  };
  inp.click();
};

// ---- How much room is left ----------------------------------------------
// Browser storage is small — commonly around 5 MB — and a logo or signature
// pasted in at full size eats it fast. Until now the first sign of trouble was
// a save quietly failing. This measures what is actually stored so the app can
// say something while there is still time to do something about it.
const STORAGE_BUDGET_BYTES = 5 * 1024 * 1024; // the usual localStorage ceiling

// Bytes this app is using in localStorage. Strings are stored as UTF-16, so a
// character is two bytes — that is what counts against the browser's limit.
const storageBytesUsed = () => {
  let bytes = 0;
  try {
    for (const key of Object.keys(localStorage)) {
      const val = localStorage.getItem(key) || "";
      bytes += (key.length + val.length) * 2;
    }
  } catch (e) { return 0; }
  return bytes;
};

const formatBytes = (n) => n >= 1024 * 1024
  ? (n / (1024 * 1024)).toFixed(1) + " MB"
  : Math.max(1, Math.round(n / 1024)) + " KB";

// What is taking up the room, biggest first — so "your logo is 1.2 MB" is
// answerable rather than a guess.
const storageBreakdown = () => {
  const used = storageBytesUsed();
  const parts = [];
  const biz = db.businesses || [];
  const imageBytes = biz.reduce((sum, b) =>
    sum + ((b.logo || "").length + (b.stamp || "").length + (b.signature || "").length) * 2, 0);
  if (imageBytes > 0) parts.push({ label: "Logos, stamps and signatures", bytes: imageBytes });
  parts.push({ label: `${(db.documents || []).length} documents`, bytes: JSON.stringify(db.documents || []).length * 2 });
  parts.push({ label: `${(db.products || []).length} products`, bytes: JSON.stringify(db.products || []).length * 2 });
  parts.push({ label: `${(db.customers || []).length} customers`, bytes: JSON.stringify(db.customers || []).length * 2 });
  return { used, budget: STORAGE_BUDGET_BYTES, parts: parts.filter(p => p.bytes > 0).sort((a, b) => b.bytes - a.bytes) };
};

// The meter shown in Settings -> Data & backup.
const renderStorageMeter = () => {
  const info = storageBreakdown();
  const pct = Math.min(100, Math.round((info.used / info.budget) * 100));
  const tight = pct >= 80;

  const box = el("div", { style: { marginBottom: "14px" } });
  const head = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "baseline", fontSize: "12px", marginBottom: "5px" } });
  head.appendChild(el("span", { style: { color: "var(--muted)" } }, "Space used in this browser"));
  head.appendChild(el("span", { style: { fontWeight: 700, color: tight ? "var(--danger)" : "var(--text)" } },
    `${formatBytes(info.used)} of about ${formatBytes(info.budget)}`));
  box.appendChild(head);

  const bar = el("div", {
    role: "progressbar", "aria-valuenow": String(pct), "aria-valuemin": "0", "aria-valuemax": "100",
    "aria-label": "Space used in this browser",
    style: { height: "8px", borderRadius: "999px", background: "rgba(17,24,39,.10)", overflow: "hidden" },
  });
  bar.appendChild(el("div", { style: {
    width: pct + "%", height: "100%", borderRadius: "999px",
    background: tight ? "var(--danger)" : "var(--primary)",
  } }));
  box.appendChild(bar);

  if (info.parts.length) {
    box.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "5px" } },
      info.parts.slice(0, 3).map(p => `${p.label}: ${formatBytes(p.bytes)}`).join(" • ")));
  }
  if (tight) {
    box.appendChild(el("div", { style: { fontSize: "11.5px", color: "var(--danger)", marginTop: "6px", lineHeight: "1.45" } },
      "This browser is nearly full. Export a backup now, then free some room — a smaller logo or signature image usually recovers the most."));
  }
  return box;
};

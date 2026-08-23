// ==================== ONBOARDING ====================
const renderOnboard = () => {
  const wrap = el("div", { class: "onboard" });
  wrap.appendChild(el("h1", {}, "Welcome to PI & PO Maker"));

  // Coming back to a device that already holds data? Offer it before asking for
  // business details all over again. Everything is stored in this browser, so
  // a stranded copy under an old key is exactly what makes the app look empty.
  const found = scanDeviceData();
  const restore = el("div", { class: "card", style: { marginBottom: "20px" } });
  restore.appendChild(el("div", { class: "card-title" }, "Used this app before?"));
  if (found.length) {
    const top = found[0];
    restore.appendChild(el("div", { style: { fontSize: "12.5px", marginBottom: "4px", fontWeight: 600 } },
      deviceEntryNames(top)));
    restore.appendChild(el("div", { style: { fontSize: "11.5px", color: "var(--muted)", marginBottom: "10px" } },
      "Found on this device — " + deviceEntrySummary(top)));
    restore.appendChild(el("button", { class: "btn btn-primary btn-full", style: { marginBottom: "8px" },
      onclick: () => restoreDeviceEntry(top) }, "↩️ Load my data from this device"));
    if (found.length > 1) {
      restore.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "8px" },
        onclick: openDeviceRestoreModal }, `See all ${found.length} saved copies`));
    }
  } else {
    restore.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "10px" } },
      "Nothing saved found in this browser. Data lives per browser and per device — load a backup file or your Google Drive backup if you have one."));
  }
  const restoreRow = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" } });
  restoreRow.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: importBackup },
    "\u{1F4E5} Backup file"));
  restoreRow.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: (e) => gdriveRestore(e.currentTarget) },
    "☁️ Google Drive"));
  restore.appendChild(restoreRow);
  wrap.appendChild(restore);

  wrap.appendChild(el("p", {}, found.length ? "Or set up a new business." : "Let's set up your first business."));
  const form = renderBusinessForm(null, (biz) => {
    biz.id = uid("biz");
    biz.nextPi = biz.nextPi || 1;
    biz.nextPo = biz.nextPo || 1;
    biz.nextQt = biz.nextQt || 1;
    biz.nextInv = biz.nextInv || 1;
    biz.nextDn = biz.nextDn || 1;
    db.businesses.push(biz);
    db.activeBusinessId = biz.id;
    saveDB();
    render();
    toast(`Welcome, ${biz.name}! You're all set.`);
  });
  wrap.appendChild(form);
  return wrap;
};

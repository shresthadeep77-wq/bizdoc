// ==================== FORMS ====================
const inputField = (label, key, obj, opts = {}) => {
  const f = el("div", { class: "field" });
  f.appendChild(el("label", {}, label));
  const inp = el(opts.textarea ? "textarea" : "input", {
    type: opts.type || "text",
    inputmode: opts.type === "number" ? "decimal" : undefined,
    value: obj[key] ?? "",
    placeholder: opts.placeholder || "",
    oninput: (e) => { obj[key] = opts.type === "number" ? parseFloat(e.target.value) || 0 : e.target.value; if (opts.onInput) opts.onInput(obj[key]); },
  });
  if (opts.rows) inp.rows = opts.rows;
  f.appendChild(inp);
  if (opts.hint) f.appendChild(el("div", { style: { fontSize: "11px", color: "#6b7280", marginTop: "4px" } }, opts.hint));
  return f;
};

const selectField = (label, key, obj, options, opts = {}) => {
  const f = el("div", { class: "field" });
  f.appendChild(el("label", {}, label));
  const s = el("select", { onchange: (e) => { obj[key] = e.target.value; if (opts.onChange) opts.onChange(obj[key]); } });
  options.forEach(o => {
    const opt = el("option", { value: o }, o);
    if (obj[key] === o) opt.selected = true;
    s.appendChild(opt);
  });
  if (!obj[key]) obj[key] = options[0];
  f.appendChild(s);
  return f;
};

let comboIdCounter = 0;
const comboField = (label, key, obj, suggestions = [], opts = {}) => {
  const f = el("div", { class: "field" });
  f.appendChild(el("label", {}, label));
  const listId = `dl-${key}-${comboIdCounter++}`;
  const inp = el("input", {
    value: obj[key] ?? "",
    list: listId,
    placeholder: opts.placeholder || "",
    oninput: (e) => { obj[key] = e.target.value; if (opts.onChange) opts.onChange(obj[key]); },
  });
  f.appendChild(inp);
  const dl = el("datalist", { id: listId });
  Array.from(new Set(suggestions.filter(Boolean))).forEach(s => dl.appendChild(el("option", { value: s })));
  f.appendChild(dl);
  return f;
};

const checkboxField = (label, key, obj, onChange) => {
  const f = el("label", { class: "toggle-row", style: { cursor: "pointer" } });
  const cb = el("input", { type: "checkbox", onchange: (e) => { obj[key] = e.target.checked; if (onChange) onChange(); } });
  if (obj[key]) cb.checked = true;
  f.appendChild(cb);
  f.appendChild(el("span", { style: { marginBottom: 0 } }, label));
  return f;
};

const renderBusinessForm = (existing, onSave) => {
  const data = existing ? { ...existing } : {
    name: "", address1: "", address2: "", phone: "", pan: "", website: "", email: "",
    signatory: "", logo: "", signature: "", stamp: "",
    piFormat: "{YYYY}{####}", poFormat: "PO-{YYYY}-{####}", qtFormat: "QT-{YYYY}-{####}",
    nextPi: 1, nextPo: 1, nextQt: 1, nextInv: 1, nextDn: 1, currency: "NPR", taxRate: 13, terms: "1. Payment Terms: 20% advance, 80% after production.\n2. The above rates include VAT and discount.",
    shortCode: "", banks: [], termsPresets: [], saveFolder: "", piValidityDays: 5, poValidityDays: 30, qtValidityDays: 15, defaultShipNote: "to be discussed",
    // Pre-selected on every new document; both can be overridden in the builder.
    // defaultBankId "" means "show all accounts".
    defaultBankId: "", defaultTermsPresetId: "",
    units: ["pcs", "kg", "set", "box", "m", "ft", "litre", "bundle"]
  };
  // Migrate legacy single "bank" text field into the new banks array, once.
  if (!Array.isArray(data.banks)) data.banks = [];
  if (data.bank && data.bank.trim() && data.banks.length === 0) {
    data.banks.push({ id: uid("bank"), bankName: "", accountName: "", accountNumber: "", branch: "", swift: "", notes: data.bank });
  }
  // Each section is a standalone builder, so Settings can present them as cards
  // that open focused editors while "new business" still shows one long form.
  const sections = {};
  sections.identity = () => {
    const wrap = el("div");
  wrap.appendChild(inputField("Business Name *", "name", data));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Address Line 1", "address1", data),
    inputField("Address Line 2", "address2", data),
  ]));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Phone", "phone", data),
    inputField("PAN", "pan", data),
    inputField("Website", "website", data),
  ]));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Email", "email", data),
    inputField("Authorized Signatory", "signatory", data),
    inputField("Short Code", "shortCode", data, { hint: "For document numbers, e.g., DPI" }),
  ]));
    return wrap;
  };
  sections.branding = () => {
    const wrap = el("div");
  // Logo upload
  const logoField = el("div", { class: "field" });
  logoField.appendChild(el("label", {}, "Logo (image)"));
  const logoInp = el("input", { type: "file", accept: "image/*", onchange: (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { data.logo = r.result; logoPrev.src = r.result; logoPrev.style.display = "block"; }; r.readAsDataURL(f);
  }});
  const logoPrev = el("img", { style: { maxHeight: "60px", marginTop: "6px", display: data.logo ? "block" : "none" }, src: data.logo || "" });
  logoField.appendChild(logoInp);
  logoField.appendChild(logoPrev);
  wrap.appendChild(logoField);

  // Signature upload
  const sigField = el("div", { class: "field" });
  sigField.appendChild(el("label", {}, "Signature (image, optional)"));
  const sigInp = el("input", { type: "file", accept: "image/*", onchange: (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { data.signature = r.result; sigPrev.src = r.result; sigPrev.style.display = "block"; }; r.readAsDataURL(f);
  }});
  const sigPrev = el("img", { style: { maxHeight: "50px", marginTop: "6px", display: data.signature ? "block" : "none" }, src: data.signature || "" });
  sigField.appendChild(sigInp);
  sigField.appendChild(sigPrev);
  wrap.appendChild(sigField);

  // Company stamp / seal — printed on documents for official use.
  const stampField = el("div", { class: "field" });
  stampField.appendChild(el("label", {}, "Official stamp / seal (image, optional)"));
  stampField.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginBottom: "6px" } }, "A transparent PNG works best — it prints near the signature on documents."));
  const stampInp = el("input", { type: "file", accept: "image/*", onchange: (e) => {
    const f = e.target.files[0]; if (!f) return;
    const r = new FileReader(); r.onload = () => { data.stamp = r.result; stampPrev.src = r.result; stampPrev.style.display = "block"; stampClear.style.display = "inline-flex"; }; r.readAsDataURL(f);
  }});
  const stampPrev = el("img", { style: { maxHeight: "70px", marginTop: "6px", display: data.stamp ? "block" : "none" }, src: data.stamp || "" });
  const stampClear = el("button", { class: "btn btn-secondary", type: "button", style: { marginTop: "6px", display: data.stamp ? "inline-flex" : "none" }, onclick: () => { data.stamp = ""; stampPrev.src = ""; stampPrev.style.display = "none"; stampClear.style.display = "none"; stampInp.value = ""; } }, "Remove stamp");
  stampField.appendChild(stampInp);
  stampField.appendChild(stampPrev);
  stampField.appendChild(stampClear);
  wrap.appendChild(stampField);

  // Size & position controls for printed images.
  const sliderRow = (label, key, def, min, max) => {
    if (data[key] === undefined) data[key] = def;
    const f = el("div", { class: "field" });
    const head = el("div", { style: { display: "flex", justifyContent: "space-between", fontSize: "12px", fontWeight: 600, color: "#374151" } });
    head.appendChild(el("span", {}, label));
    const val = el("span", { style: { color: "var(--muted)" } }, Math.round(data[key] * 100) + "%");
    head.appendChild(val);
    f.appendChild(head);
    const s = el("input", { type: "range", min: String(min), max: String(max), step: "0.05", value: String(data[key]),
      style: { boxShadow: "none", padding: "0" },
      oninput: (e) => { data[key] = parseFloat(e.target.value); val.textContent = Math.round(data[key] * 100) + "%"; } });
    f.appendChild(s);
    return f;
  };
  wrap.appendChild(el("div", { class: "card-title", style: { marginTop: "8px" } }, "Print sizes & position"));
  wrap.appendChild(sliderRow("Logo size", "logoScale", 1, 0.5, 2));
  wrap.appendChild(sliderRow("Signature size", "signScale", 1, 0.5, 2));
  wrap.appendChild(sliderRow("Stamp size", "stampScale", 1, 0.5, 2));
    return wrap;
  };
  sections.numbering = () => {
    const wrap = el("div");
  wrap.appendChild(el("div", { class: "row" }, [
    selectField("Currency", "currency", data, ["NPR", "USD", "INR", "EUR"]),
    inputField("Default Tax Rate %", "taxRate", data, { type: "number" }),
  ]));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("PI Number Format", "piFormat", data, { hint: "Tokens: {YYYY} {YY} {MM} {####} {BIZ}" }),
    inputField("PO Number Format", "poFormat", data, { hint: "Tokens: {YYYY} {YY} {MM} {####} {BIZ}" }),
  ]));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Quotation Number Format", "qtFormat", data, { hint: "Tokens: {YYYY} {YY} {MM} {####} {BIZ}" }),
  ]));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("Next PI Number", "nextPi", data, { type: "number" }),
    inputField("Next PO Number", "nextPo", data, { type: "number" }),
    inputField("Next Quotation Number", "nextQt", data, { type: "number" }),
  ]));
    return wrap;
  };
  sections.terms = () => {
    const wrap = el("div");
  // Default Terms of Sale — a compact insert-a-line dropdown (was 13 always-
  // visible checkboxes) plus named, saveable presets for whole term blocks.
  const stripNum = (s) => s.replace(/^\d+\.\s*/, "").trim();
  const composeTerms = (lines) => lines.map((l, i) => `${i + 1}. ${l}`).join("\n");
  const termsBox = el("div", { class: "field" });
  termsBox.appendChild(el("label", {}, "Default Terms of Sale"));
  termsBox.appendChild(el("div", { style: { fontSize: "11.5px", color: "var(--muted)", marginBottom: "6px" } },
    "Insert a common line, edit freely below, or apply a saved preset."));

  const termsTa = el("textarea", { rows: 5, value: data.terms || "", oninput: (e) => data.terms = e.target.value });

  const insertRow = el("div", { style: { display: "flex", gap: "6px", marginBottom: "8px" } });
  const presetSel = el("select", { style: { flex: "1" } });
  presetSel.appendChild(el("option", { value: "" }, "+ Insert a common line..."));
  TERM_PRESETS.forEach((p, i) => presetSel.appendChild(el("option", { value: String(i) }, p)));
  insertRow.appendChild(presetSel);
  insertRow.appendChild(el("button", { class: "btn btn-secondary", type: "button", style: { flex: "none" }, onclick: () => {
    if (presetSel.value === "") { toast("Pick a line first", "err"); return; }
    const line = TERM_PRESETS[Number(presetSel.value)];
    const lines = (data.terms || "").split("\n").map(stripNum).filter(Boolean);
    if (!lines.includes(line)) lines.push(line);
    data.terms = composeTerms(lines);
    termsTa.value = data.terms;
    presetSel.value = "";
  } }, "Add"));
  termsBox.appendChild(insertRow);
  termsBox.appendChild(termsTa);

  // Named presets — save the whole textarea as a reusable, named block.
  if (!Array.isArray(data.termsPresets)) data.termsPresets = [];
  const namedBox = el("div", { style: { marginTop: "12px" } });
  namedBox.appendChild(el("div", { style: { fontSize: "11px", fontWeight: 700, color: "var(--muted)", textTransform: "uppercase", letterSpacing: ".03em", marginBottom: "6px" } }, "Saved presets"));
  const namedList = el("div");
  const drawNamed = () => {
    namedList.innerHTML = "";
    if (!data.termsPresets.length) {
      namedList.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "6px" } }, "No saved presets yet — write your terms above, then save them with a name."));
    }
    data.termsPresets.forEach((p, i) => {
      const isDefault = data.defaultTermsPresetId === p.id;
      const row = el("div", { class: "list-item", style: { padding: "9px 12px" } });
      const info = el("div", { class: "info", style: { cursor: "pointer" }, onclick: () => {
        data.terms = p.text; termsTa.value = p.text; toast(`Applied "${p.name}"`);
      } });
      const nameRow = el("div", { class: "name" }, p.name);
      if (isDefault) nameRow.appendChild(el("span", { style: { marginLeft: "6px", fontSize: "10px", fontWeight: 700, color: "var(--primary)", letterSpacing: ".03em" } }, "DEFAULT"));
      info.appendChild(nameRow);
      info.appendChild(el("div", { class: "sub" }, `${p.text.split("\n").filter(Boolean).length} line${p.text.split("\n").filter(Boolean).length === 1 ? "" : "s"}`));
      row.appendChild(info);
      const actions = el("div", { class: "actions" });
      // Star chooses which preset pre-fills new documents. Tapping the current
      // default clears it, falling back to the "Default Terms of Sale" text above.
      actions.appendChild(el("button", { class: "btn-icon", type: "button", title: isDefault ? "Remove as default" : "Use as default on new documents", onclick: () => {
        data.defaultTermsPresetId = isDefault ? "" : p.id;
        if (!isDefault) { data.terms = p.text; termsTa.value = p.text; }
        drawNamed();
        toast(isDefault ? "Default cleared" : `"${p.name}" is now the default`);
      } }, isDefault ? "⭐" : "☆"));
      actions.appendChild(el("button", { class: "btn-icon", type: "button", title: "Apply", onclick: () => { data.terms = p.text; termsTa.value = p.text; toast(`Applied "${p.name}"`); } }, "\u2705"));
      actions.appendChild(el("button", { class: "btn-icon danger", type: "button", title: "Delete preset", onclick: () => {
        if (data.defaultTermsPresetId === p.id) data.defaultTermsPresetId = "";
        data.termsPresets.splice(i, 1);
        drawNamed();
      } }, "🗑️"));
      row.appendChild(actions);
      namedList.appendChild(row);
    });
  };
  drawNamed();
  namedBox.appendChild(namedList);
  const saveRow = el("div", { style: { display: "flex", gap: "6px", marginTop: "6px" } });
  const nameInp = el("input", { placeholder: "Name this set of terms, e.g. \"Export terms\"", style: { flex: "1" } });
  saveRow.appendChild(nameInp);
  saveRow.appendChild(el("button", { class: "btn btn-secondary", type: "button", style: { flex: "none" }, onclick: () => {
    const nm = nameInp.value.trim();
    if (!nm) { toast("Name it first", "err"); return; }
    if (!String(data.terms || "").trim()) { toast("Nothing in the terms box to save yet", "err"); return; }
    data.termsPresets.push({ id: uid("tp"), name: nm, text: data.terms });
    nameInp.value = "";
    drawNamed();
    toast("Preset saved");
  } }, "\u{1F4BE} Save as preset"));
  namedBox.appendChild(saveRow);
  termsBox.appendChild(namedBox);
  wrap.appendChild(termsBox);
    return wrap;
  };
  sections.units = () => {
    const wrap = el("div");
    if (!Array.isArray(data.units) || !data.units.length) {
      data.units = ["pcs", "kg", "set", "box", "m", "ft", "litre", "bundle"];
    }
    wrap.appendChild(el("div", { style: { fontSize: "12.5px", color: "var(--muted)", marginBottom: "10px" } },
      "Add, rename, or reorder the units your products come in. These appear in every product form and pack-unit selector."));
    const listBox = el("div", { class: "field" });
    listBox.appendChild(el("label", {}, "Your units"));
    const list = el("div", { class: "units-list" });
    const draw = () => {
      list.innerHTML = "";
      if (data.units.length === 0) {
        list.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", padding: "10px 4px" } },
          "No units yet. Add one below."));
      }
      data.units.forEach((u, i) => {
        const row = el("div", { class: "unit-row" });
        row.appendChild(el("span", { class: "unit-drag", title: "Drag to reorder" }, "\u22EE\u22EE"));
        const inp = el("input", { value: u, oninput: (e) => { data.units[i] = e.target.value.trim(); } });
        inp.style.flex = "1";
        row.appendChild(inp);
        const up = el("button", { class: "btn-icon", title: "Move up", onclick: () => {
          if (i === 0) return;
          [data.units[i-1], data.units[i]] = [data.units[i], data.units[i-1]];
          draw();
        }}, "\u2191");
        const down = el("button", { class: "btn-icon", title: "Move down", onclick: () => {
          if (i === data.units.length - 1) return;
          [data.units[i+1], data.units[i]] = [data.units[i], data.units[i+1]];
          draw();
        }}, "\u2193");
        const del = el("button", { class: "btn-icon danger", title: "Delete unit", onclick: () => {
          // Warn if any product uses this unit
          const used = bizProducts().some(p => p.unit === u || p.packUnit === u);
          const confirmDelete = () => { data.units.splice(i, 1); draw(); };
          if (used) {
            confirmModal(`"${u}" is used by one or more products. Delete anyway?`,
              confirmDelete, { title: "Delete unit?", confirmLabel: "Delete", danger: true });
          } else {
            confirmDelete();
          }
        }}, "\u{1F5D1}");
        row.appendChild(up); row.appendChild(down); row.appendChild(del);
        list.appendChild(row);
      });
    };
    draw();
    listBox.appendChild(list);
    // Add new unit
    const addBox = el("div", { style: { display: "flex", gap: "6px", marginTop: "10px" } });
    const newInp = el("input", { placeholder: "e.g. carton, bag, pallet", style: { flex: "1" } });
    const addBtn = el("button", { class: "btn btn-secondary", onclick: () => {
      const v = newInp.value.trim();
      if (!v) { toast("Type a unit name first", "err"); return; }
      if (data.units.includes(v)) { toast("Already in the list", "err"); return; }
      data.units.push(v);
      newInp.value = "";
      draw();
    }}, "+ Add");
    newInp.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); addBtn.click(); } });
    addBox.appendChild(newInp);
    addBox.appendChild(addBtn);
    listBox.appendChild(addBox);
    wrap.appendChild(listBox);
    return wrap;
  };
  sections.banks = () => {
    const wrap = el("div");
  // Bank accounts — repeatable list (a business can have several accounts across banks).
  // A filled-in account collapses into a compact row; only one expands at a time.
  const banksBox = el("div", { class: "field" });
  banksBox.appendChild(el("label", {}, "Bank Accounts"));
  const banksList = el("div");
  const isBankFilled = (b) => !!(String(b.bankName || "").trim() || String(b.accountNumber || "").trim());
  const maskAcct = (n) => { const s = String(n || "").trim(); return s.length > 4 ? "•••• " + s.slice(-4) : s; };
  let expandedId = null;

  // Which account is pre-selected on new documents. Redrawn alongside the list
  // so adding or removing an account keeps the options in sync.
  const defaultBankBox = el("div", { style: { marginTop: "10px" } });
  const renderDefaultBank = () => {
    defaultBankBox.innerHTML = "";
    const filled = data.banks.filter(isBankFilled);
    if (!filled.length) return;
    if (data.defaultBankId && !filled.some(b => b.id === data.defaultBankId)) data.defaultBankId = "";
    defaultBankBox.appendChild(el("label", {}, "Default account on new documents"));
    const sel = el("select", { onchange: (e) => data.defaultBankId = e.target.value });
    sel.appendChild(el("option", { value: "" }, "All accounts"));
    filled.forEach(b => {
      const o = el("option", { value: b.id }, [b.bankName, maskAcct(b.accountNumber)].filter(Boolean).join(" — ") || "Bank account");
      if (data.defaultBankId === b.id) o.selected = true;
      sel.appendChild(o);
    });
    defaultBankBox.appendChild(sel);
    defaultBankBox.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "4px" } },
      "Banking details are shown by default; you can switch accounts or hide them on any document."));
  };

  const renderBanksList = () => {
    banksList.innerHTML = "";
    if (data.banks.length === 0) {
      banksList.appendChild(el("div", { style: { fontSize: "12px", color: "var(--muted)", marginBottom: "8px" } }, "No bank accounts added yet."));
    }
    data.banks.forEach((b, idx) => {
      const expanded = expandedId === b.id || !isBankFilled(b);
      if (!expanded) {
        // Collapsed summary row.
        const row = el("div", { class: "list-item" });
        const info = el("div", { class: "info", style: { cursor: "pointer" }, onclick: () => { expandedId = b.id; renderBanksList(); } });
        info.appendChild(el("div", { class: "name" }, b.bankName || "Bank account"));
        info.appendChild(el("div", { class: "sub" }, [maskAcct(b.accountNumber), b.accountName].filter(Boolean).join(" • ") || "Tap to edit"));
        row.appendChild(info);
        const actions = el("div", { class: "actions" });
        actions.appendChild(el("button", { class: "btn-icon", type: "button", title: "Edit", onclick: () => { expandedId = b.id; renderBanksList(); } }, "✏️"));
        actions.appendChild(el("button", { class: "btn-icon danger", type: "button", title: "Remove", onclick: () => { data.banks.splice(idx, 1); renderBanksList(); } }, "🗑️"));
        row.appendChild(actions);
        banksList.appendChild(row);
        return;
      }
      const card = el("div", { style: { border: "1px solid var(--border)", borderRadius: "var(--radius-sm)", padding: "10px", marginBottom: "8px", background: "#fafbfc", boxShadow: "var(--shadow-inset)" } });
      const hdr = el("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "6px" } });
      hdr.appendChild(el("div", { style: { fontSize: "12px", fontWeight: 700, color: "var(--primary)" } }, `Bank account ${idx + 1}`));
      const hdrActions = el("div", { style: { display: "flex", gap: "4px" } });
      if (isBankFilled(b)) {
        hdrActions.appendChild(el("button", { class: "btn-icon", type: "button", title: "Collapse", onclick: () => { expandedId = null; renderBanksList(); } }, "✓ Done"));
      }
      hdrActions.appendChild(el("button", { class: "btn-icon danger", type: "button", title: "Remove", onclick: () => { data.banks.splice(idx, 1); renderBanksList(); } }, "🗑️"));
      hdr.appendChild(hdrActions);
      card.appendChild(hdr);
      const bankNameField = inputField("Bank Name", "bankName", b);
      card.appendChild(el("div", { class: "row" }, [
        bankNameField,
        inputField("Account Name", "accountName", b),
      ]));
      card.appendChild(el("div", { class: "row" }, [
        inputField("Account Number", "accountNumber", b),
        inputField("Branch", "branch", b),
      ]));
      // Bank (for payment QR) — sets the SWIFT/BIC bank code the wallet scanner needs.
      const codeField = el("div", { class: "field" });
      codeField.appendChild(el("label", {}, "Bank (for payment QR)"));
      const codeSel = el("select", { onchange: (e) => {
        b.bankCode = e.target.value;
        b.swift = e.target.value; // keep legacy field in sync
        const nm = bankNameFromCode(e.target.value);
        if (nm && !b.bankName) { b.bankName = nm; const inp = bankNameField.querySelector("input"); if (inp) inp.value = nm; }
      }});
      codeSel.appendChild(el("option", { value: "" }, "-- select bank --"));
      NEPAL_BANK_CODES.forEach(([code, nm]) => {
        const o = el("option", { value: code }, `${nm} (${code})`);
        if ((b.bankCode || b.swift) === code) o.selected = true;
        codeSel.appendChild(o);
      });
      codeField.appendChild(codeSel);
      codeField.appendChild(el("div", { style: { fontSize: "11px", color: "#6b7280", marginTop: "4px" } }, "Required for a scannable payment QR. Encodes account number, name & bank code."));
      card.appendChild(codeField);
      card.appendChild(inputField("Notes (optional)", "notes", b, { textarea: true, rows: 2 }));
      const qrChip = el("label", { class: "chip-check", style: { width: "auto" } });
      const qrCb = el("input", { type: "checkbox" });
      qrCb.checked = b.showQR !== false;
      b.showQR = qrCb.checked;
      qrCb.addEventListener("change", (e) => b.showQR = e.target.checked);
      qrChip.appendChild(qrCb);
      qrChip.appendChild(el("span", {}, "Show QR code for this account on documents"));
      card.appendChild(qrChip);
      banksList.appendChild(card);
    });
    renderDefaultBank();
  };
  renderBanksList();
  banksBox.appendChild(banksList);
  banksBox.appendChild(defaultBankBox);
  banksBox.appendChild(el("button", { class: "btn btn-secondary btn-full", type: "button", onclick: () => {
    const b = { id: uid("bank"), bankName: "", accountName: "", accountNumber: "", branch: "", swift: "", bankCode: "", notes: "", showQR: true };
    data.banks.push(b);
    expandedId = b.id;
    renderBanksList();
  }}, "+ Add bank account"));
  wrap.appendChild(banksBox);
    return wrap;
  };
  sections.docdefaults = () => {
    const wrap = el("div");
  wrap.appendChild(el("div", { class: "card-title", style: { marginTop: "16px", fontSize: "13px" } }, "Document defaults"));
  wrap.appendChild(inputField("Save folder name (optional)", "saveFolder", data, { placeholder: "e.g. DeepJyoti Invoices", hint: "Downloads are saved as [this folder]/filename.pdf inside your browser's Downloads — works automatically in Chrome/Edge. Leave blank to save directly in Downloads." }));
  wrap.appendChild(el("div", { style: { fontWeight: 600, fontSize: "13px", margin: "12px 0 6px", color: "var(--primary)" } }, "Validity / expiry defaults"));
  wrap.appendChild(el("div", { class: "row" }, [
    inputField("PI Validity (days)", "piValidityDays", data, { type: "number", hint: "Expiration Date on new PIs" }),
    inputField("Quotation Validity (days)", "qtValidityDays", data, { type: "number", hint: "Valid Until on new quotations" }),
    inputField("PO Delivery (days)", "poValidityDays", data, { type: "number", hint: "Delivery By on new POs" }),
  ]));
  wrap.appendChild(inputField("Default Ship Date text", "defaultShipNote", data, { hint: "Pre-filled on new documents" }));
    return wrap;
  };

  const wrap = el("div");
  if (existing) {
    ["identity", "branding", "numbering", "terms", "banks", "docdefaults"].forEach(k => wrap.appendChild(sections[k]()));
    const btn = el("button", { class: "btn btn-primary btn-full", style: { marginTop: "12px" }, onclick: () => {
      if (!data.name.trim()) { toast("Business name required", "err"); return; }
      onSave(data);
    }}, "Save changes");
    wrap.appendChild(btn);
  } else {
    // New business: one long form was too much to fill in one go — step
    // through each section instead, one at a time.
    const STEPS = ["identity", "branding", "numbering", "terms", "banks", "docdefaults"];
    const STEP_TITLES = {
      identity: "Business identity", branding: "Logo & signature", numbering: "Numbering & tax",
      terms: "Terms of sale", banks: "Bank accounts", docdefaults: "Document defaults",
    };
    let step = 0;
    const progress = el("div", { style: { fontSize: "11.5px", color: "var(--muted)", fontWeight: 600, marginBottom: "10px", letterSpacing: ".02em" } });
    const stepTitle = el("div", { class: "card-title" });
    const stepBody = el("div");
    const nav = el("div", { style: { display: "flex", gap: "8px", marginTop: "16px" } });

    const draw = () => {
      progress.textContent = `STEP ${step + 1} OF ${STEPS.length}`;
      stepTitle.textContent = STEP_TITLES[STEPS[step]];
      stepBody.innerHTML = "";
      stepBody.appendChild(sections[STEPS[step]]());
      nav.innerHTML = "";
      if (step > 0) {
        nav.appendChild(el("button", { class: "btn btn-secondary", style: { flex: "1" }, onclick: () => { step--; draw(); } }, "\u2190 Back"));
      }
      if (step < STEPS.length - 1) {
        nav.appendChild(el("button", { class: "btn btn-primary", style: { flex: "1" }, onclick: () => {
          if (STEPS[step] === "identity" && !data.name.trim()) { toast("Business name required", "err"); return; }
          step++; draw();
        } }, "Next \u2192"));
      } else {
        nav.appendChild(el("button", { class: "btn btn-primary", style: { flex: "1" }, onclick: () => {
          if (!data.name.trim()) { toast("Business name required", "err"); return; }
          onSave(data);
        } }, "\u2713 Create business"));
      }
    };
    draw();
    wrap.appendChild(progress);
    wrap.appendChild(stepTitle);
    wrap.appendChild(stepBody);
    wrap.appendChild(nav);
  }
  wrap._sections = sections;
  wrap._data = data;
  return wrap;
};

const BIZ_SECTIONS = [
  { key: "identity",    icon: "\u{1F3E2}",        title: "Business identity", desc: "Name, address, phone, PAN, short code" },
  { key: "branding",    icon: "\u{1F5BC}\uFE0F", title: "Logo & signature",  desc: "Images printed on your documents" },
  { key: "numbering",   icon: "\u{1F522}",        title: "Numbering & tax",   desc: "Currency, tax rate, number formats" },
  { key: "terms",       icon: "\u{1F4C4}",        title: "Terms of sale",     desc: "Default terms printed on documents" },
  { key: "banks",       icon: "\u{1F3E6}",        title: "Bank accounts",     desc: "Accounts and payment QR codes" },
  { key: "docdefaults", icon: "\u2699\uFE0F",      title: "Document defaults", desc: "Validity periods, ship note, save folder" },
];

// Opens a single settings section in its own modal.
const openBizSection = (key) => {
  const biz = activeBiz();
  if (!biz) return;
  const meta = BIZ_SECTIONS.find(s => s.key === key);
  const form = renderBusinessForm(biz, () => {});
  const sections = form._sections, data = form._data;
  const wrap = el("div");
  wrap.appendChild(sections[key]());
  const bar = el("div", { class: "modal-footer-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: () => attemptClose() }, "Cancel"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => {
    if (!String(data.name || "").trim()) { toast("Business name required", "err"); return; }
    Object.assign(biz, data);
    saveDB(); closeModal(); render();
    toast("Saved");
  } }, "Save"));
  openModal(meta ? meta.title : "Edit", wrap, { footer: bar });
};

// Full Settings popup — sidebar of every settings section on the left,
// selected section's form on the right. Saves the whole business on Save.
const SETTINGS_NAV = [
  { group: "Business", items: BIZ_SECTIONS },
  { group: "This device", items: [
    { key: "savefolder", icon: "\u{1F4C1}", title: "Save location", desc: "Where PDFs and backups land" },
    { key: "data",       icon: "\u{1F4BE}", title: "Data & backup", desc: "CSV export, JSON backup, delete business" },
  ]},
];

let settingsActiveKey = "identity";
// Opens one settings section as its own popup on top of the Settings modal —
// used on mobile so picking a section doesn't mean scrolling down to it.
const openSettingsSectionPopup = (it, sections, biz) => {
  const wrap = el("div");
  if (sections[it.key]) wrap.appendChild(sections[it.key]());
  else if (it.key === "savefolder") wrap.appendChild(renderSettingsSaveFolder(biz));
  else if (it.key === "data") wrap.appendChild(renderSettingsData(biz));
  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-primary btn-full", onclick: () => closeModal() }, "Done"));
  wrap.appendChild(bar);
  openModal(it.title, wrap, { guard: false });
};

const openSettingsModal = () => {
  const biz = activeBiz();
  if (!biz) return;
  const form = renderBusinessForm(biz, () => {});
  const sections = form._sections, data = form._data;

  const shell = el("div", { class: "settings-shell" });

  // Sidebar
  const side = el("div", { class: "settings-sidebar" });
  side.appendChild(el("div", { class: "settings-side-hdr" }, biz.name));
  SETTINGS_NAV.forEach(group => {
    side.appendChild(el("div", { class: "settings-side-group" }, group.group));
    group.items.forEach(it => {
      const btn = el("button", {
        class: "settings-side-item" + (it.key === settingsActiveKey ? " active" : ""),
        onclick: () => {
          if (window.matchMedia && window.matchMedia("(max-width: 720px)").matches) {
            openSettingsSectionPopup(it, sections, biz);
          } else {
            settingsActiveKey = it.key; drawContent(); refreshSidebar();
          }
        }
      });
      btn.appendChild(el("span", { class: "settings-side-icon" }, it.icon));
      const t = el("div", { style: { flex: "1", minWidth: "0", textAlign: "left" } });
      t.appendChild(el("div", { class: "settings-side-title" }, it.title));
      t.appendChild(el("div", { class: "settings-side-sub" }, it.desc));
      btn.appendChild(t);
      btn.appendChild(el("span", { class: "settings-side-chev" }, "\u203A"));
      side.appendChild(btn);
    });
  });

  const refreshSidebar = () => {
    side.querySelectorAll(".settings-side-item").forEach((el, idx) => {
      const flat = SETTINGS_NAV.flatMap(g => g.items);
      el.classList.toggle("active", flat[idx].key === settingsActiveKey);
    });
  };

  const content = el("div", { class: "settings-content" });
  const drawContent = () => {
    content.innerHTML = "";
    const meta = SETTINGS_NAV.flatMap(g => g.items).find(s => s.key === settingsActiveKey) || {};
    content.appendChild(el("div", { class: "settings-content-hdr" }, meta.title || "Settings"));
    if (sections[settingsActiveKey]) {
      // A business-profile section
      content.appendChild(sections[settingsActiveKey]());
    } else if (settingsActiveKey === "savefolder") {
      content.appendChild(renderSettingsSaveFolder(biz));
    } else if (settingsActiveKey === "data") {
      content.appendChild(renderSettingsData(biz));
    }
  };
  drawContent();

  shell.appendChild(side);
  shell.appendChild(content);

  const wrap = el("div", { class: "settings-wrap" });
  wrap.appendChild(shell);
  const bar = el("div", { class: "modal-footer-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", onclick: () => attemptClose() }, "Close"));
  bar.appendChild(el("button", { class: "btn btn-primary", onclick: () => {
    if (!String(data.name || "").trim()) { toast("Business name required", "err"); return; }
    Object.assign(biz, data);
    saveDB(); closeModal(); render();
    toast("Settings saved");
  } }, "Save changes"));

  openModal("Settings", wrap, { settings: true, footer: bar });
};

// Helpers extracted from the old renderSettings so they can be reused in the modal.
const renderSettingsSaveFolder = (biz) => {
  const sf = el("div");
  if (supportsFSA()) {
    sf.appendChild(el("div", { style: { fontSize: "12.5px", color: "var(--muted)", marginBottom: "10px" } },
      "Pick a real folder on this device. PDFs, PNGs and backups will save straight there — no download prompts, no picking a folder every time."));
    if (biz.saveFolderDisplayName) {
      const row = el("div", { class: "list-item" });
      const info = el("div", { class: "info" });
      info.appendChild(el("div", { class: "name" }, "\u{1F4C1} " + biz.saveFolderDisplayName));
      info.appendChild(el("div", { class: "sub" }, "All downloads for this business go here"));
      row.appendChild(info);
      const actions = el("div", { class: "actions" });
      actions.appendChild(el("button", { class: "btn-icon", title: "Change folder", onclick: chooseSaveFolder }, "\u{1F504}"));
      actions.appendChild(el("button", { class: "btn-icon danger", title: "Stop using this folder", onclick: clearSaveFolder }, "\u2716"));
      row.appendChild(actions);
      sf.appendChild(row);
    } else {
      sf.appendChild(el("button", { class: "btn btn-primary btn-full", onclick: chooseSaveFolder }, "\u{1F4C1} Choose or create a folder"));
    }
  } else {
    sf.appendChild(el("div", { style: { fontSize: "12.5px", color: "var(--muted)" } },
      "Direct folder picking needs Chrome or Edge. In this browser, use \"Save folder name\" under Document defaults — downloads will land in a subfolder inside your normal Downloads folder."));
  }
  return sf;
};

const renderSettingsData = (biz) => {
  const dc = el("div");
  dc.appendChild(el("div", { style: { fontSize: "12px", fontWeight: 600, color: "var(--muted)", margin: "2px 0 6px" } }, "Spreadsheets (CSV)"));
  const csvGrid = el("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginBottom: "10px" } });
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: exportProductsCSV }, "\u{1F4E4} Export products"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: () => importCSV("products") }, "\u{1F4E5} Import products"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: exportCustomersCSV }, "\u{1F4E4} Export customers"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: () => importCSV("customers") }, "\u{1F4E5} Import customers"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: exportDocumentsCSV }, "\u{1F4E4} Export documents"));
  csvGrid.appendChild(el("button", { class: "btn btn-secondary", style: { fontSize: "12px" }, onclick: () => {
    const w = el("div");
    w.appendChild(el("div", { style: { fontSize: "12.5px", marginBottom: "10px" } }, "Blank CSV files with the right column headers — fill them in Excel, then import."));
    w.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "6px" }, onclick: () => { downloadTemplate("products"); closeModal(); } }, "Products template"));
    w.appendChild(el("button", { class: "btn btn-secondary btn-full", onclick: () => { downloadTemplate("customers"); closeModal(); } }, "Customers template"));
    openModal("CSV templates", w);
  }}, "\u{1F4C4} Templates"));
  dc.appendChild(csvGrid);
  dc.appendChild(el("div", { style: { fontSize: "12px", fontWeight: 600, color: "var(--muted)", margin: "10px 0 6px" } }, "Full backup"));
  dc.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "8px" }, onclick: exportBackup }, "\u{1F4E5} Export backup (JSON)"));
  dc.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "16px" }, onclick: importBackup }, "\u{1F4E4} Import backup (JSON)"));
  dc.appendChild(el("div", { style: { fontSize: "12px", fontWeight: 600, color: "var(--muted)", margin: "10px 0 6px" } }, "Google Drive"));
  dc.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "8px" }, onclick: (e) => gdriveBackup(e.currentTarget) }, "\u2601\uFE0F Back up to Google Drive"));
  dc.appendChild(el("button", { class: "btn btn-secondary btn-full", style: { marginBottom: "16px" }, onclick: (e) => gdriveRestore(e.currentTarget) }, "\u2601\uFE0F Restore from Google Drive"));
  dc.appendChild(el("div", { style: { fontSize: "12px", fontWeight: 600, color: "var(--danger, #dc2626)", margin: "10px 0 6px" } }, "Danger zone"));
  dc.appendChild(el("button", { class: "btn btn-danger btn-full", onclick: () => {
    confirmModal(
      `This permanently deletes "${biz.name}" and every customer, product, and document under it. This cannot be undone.`,
      () => {
        const name = biz.name;
        db.customers = db.customers.filter(c => c.businessId !== biz.id);
        db.products = db.products.filter(p => p.businessId !== biz.id);
        db.documents = db.documents.filter(d => d.businessId !== biz.id);
        db.businesses = db.businesses.filter(b => b.id !== biz.id);
        db.activeBusinessId = db.businesses[0]?.id || null;
        saveDB(); closeModal(); render();
        toast(`"${name}" and all its data deleted`);
      },
      { title: "Delete this business?", confirmLabel: "Delete everything", typeToConfirm: biz.name }
    );
  }}, "\u{1F5D1}\uFE0F Delete this business"));
  return dc;
};

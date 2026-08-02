// ==================== CATEGORY TREE & DISCOUNTS ====================
// A product's category path, deepest-last, e.g. ["Water Tank","Plastic","1000L"].
const productPath = (p) => [p.category, p.subCategory1, p.subCategory2, p.subCategory3]
  .map(x => (x || "").trim()).filter(Boolean);

// Build the real category tree from the catalogue, so pickers only ever offer
// paths that actually exist. Returns nested { name, path, children:[], count }.
const buildCategoryTree = (products) => {
  const root = { name: "", path: [], children: [], count: 0 };
  (products || []).forEach(p => {
    const path = productPath(p);
    let node = root;
    node.count++;
    path.forEach((seg, i) => {
      let child = node.children.find(c => c.name === seg);
      if (!child) {
        child = { name: seg, path: path.slice(0, i + 1), children: [], count: 0 };
        node.children.push(child);
      }
      child.count++;
      node = child;
    });
  });
  const sortRec = (n) => { n.children.sort((a, b) => a.name.localeCompare(b.name)); n.children.forEach(sortRec); };
  sortRec(root);
  return root;
};

const pathKey = (path) => (path || []).join(" › ");

// A category's unit entry can be a legacy plain array (old format) or the
// current { allowed: [...], default: "" } shape. Always read through this.
const normCatUnitEntry = (raw) => {
  if (Array.isArray(raw)) return { allowed: raw, default: "" };
  if (raw && typeof raw === "object") return { allowed: Array.isArray(raw.allowed) ? raw.allowed : [], default: raw.default || "" };
  return { allowed: [], default: "" };
};

// Units allowed at a given category path. Set at a level, inherits DOWNWARD
// to sub-categories unless a deeper level overrides it. Falls back to the
// business's full master unit list when no level in the chain has one set.
const unitsForCategoryPath = (path) => {
  const biz = activeBiz();
  const map = (biz && biz.categoryUnits) || {};
  for (let i = (path || []).length; i >= 0; i--) {
    const key = pathKey((path || []).slice(0, i));
    const entry = normCatUnitEntry(map[key]);
    if (entry.allowed.length) return entry.allowed;
  }
  return bizUnits();
};

// Default unit at a given category path — the one a new product's Unit
// field auto-fills to. Inherits downward the same way as allowed units.
const defaultUnitForCategoryPath = (path) => {
  const biz = activeBiz();
  const map = (biz && biz.categoryUnits) || {};
  for (let i = (path || []).length; i >= 0; i--) {
    const key = pathKey((path || []).slice(0, i));
    const entry = normCatUnitEntry(map[key]);
    if (entry.default) return entry.default;
  }
  return "";
};

// Flatten a category tree into a depth-ordered list, root excluded.
const flattenCategoryTree = (node, out = []) => {
  (node.children || []).forEach(ch => { out.push(ch); flattenCategoryTree(ch, out); });
  return out;
};

// Resolve the discount % for a product against a customer's rate card.
// Rules INHERIT DOWNWARD from the level they're set at: a rule on
// ["Water Tank","Plastic"] covers every product beneath it. When several rules
// match, the DEEPEST (most specific) one wins. No match => 0%.
const resolveDiscount = (product, rules) => {
  if (!Array.isArray(rules) || !rules.length) return { pct: 0, rule: null };
  const path = productPath(product);
  let best = null;
  rules.forEach(r => {
    const rp = (r.path || []).map(x => (x || "").trim()).filter(Boolean);
    if (!rp.length) return;
    if (rp.length > path.length) return;
    // rule matches when it is a prefix of the product's path
    const isPrefix = rp.every((seg, i) => seg === path[i]);
    if (!isPrefix) return;
    if (!best || rp.length > (best.path || []).length) best = r;
  });
  return { pct: best ? (Number(best.pct) || 0) : 0, rule: best };
};

// Net unit rate after the customer's category discount.
const discountedRate = (product, rules) => {
  const { pct } = resolveDiscount(product, rules);
  const rate = Number(product.rate) || 0;
  return pct ? +(rate * (1 - pct / 100)).toFixed(2) : rate;
};

const customerRules = (custId) => {
  const c = db.customers.find(x => x.id === custId);
  return (c && Array.isArray(c.discountRules)) ? c.discountRules : [];
};

// Drill-down category picker. Walks the real catalogue tree to any depth; you
// can confirm at whichever level you stop, and that level is what the rule covers.
const openCategoryPicker = (onPick, opts = {}) => {
  const multi = !!opts.multi;
  const excludeKeys = new Set((opts.excludePaths || []).map(p => pathKey(p)));
  const tree = buildCategoryTree(bizProducts());
  let node = tree;
  const selectedByKey = new Map(); // key -> path (multi mode only)
  const wrap = el("div");
  const crumb = el("div", { class: "crumb-bar" });
  const list = el("div", { class: "picker-list" });
  const footer = el("div", { class: "action-bar" });

  const draw = () => {
    crumb.innerHTML = ""; list.innerHTML = ""; footer.innerHTML = "";
    // breadcrumb
    const mk = (label, target) => el("button", { type: "button", class: "crumb", onclick: () => { node = target; draw(); } }, label);
    crumb.appendChild(mk("All categories", tree));
    node.path.forEach((seg, i) => {
      crumb.appendChild(el("span", { class: "crumb-sep" }, "›"));
      let t = tree;
      for (let k = 0; k <= i; k++) t = t.children.find(c => c.name === node.path[k]);
      crumb.appendChild(mk(seg, t));
    });

    if (node.children.length === 0) {
      list.appendChild(el("div", { class: "picker-empty" }, "No further sub-categories — this is the deepest level."));
    } else {
      node.children.forEach(ch => {
        const hasKids = ch.children.length > 0;
        const key = pathKey(ch.path);
        const alreadyPicked = excludeKeys.has(key);
        const row = el("div", { class: "picker-row" + (hasKids ? " has-kids" : "") + (alreadyPicked ? " picker-disabled" : "") });
        if (multi) {
          const cb = el("input", { type: "checkbox", class: "picker-cb", style: { flex: "none", width: "18px", height: "18px", accentColor: "#1F4E79", cursor: alreadyPicked ? "not-allowed" : "pointer" } });
          if (alreadyPicked) cb.disabled = true;
          if (selectedByKey.has(key)) cb.checked = true;
          cb.addEventListener("change", () => {
            if (cb.checked) selectedByKey.set(key, ch.path);
            else selectedByKey.delete(key);
            updateFooter();
          });
          row.appendChild(cb);
        }
        const body = el("div", { class: "picker-body",
          onclick: () => {
            if (multi) {
              if (alreadyPicked) return;
              const cb = row.querySelector(".picker-cb");
              cb.checked = !cb.checked;
              cb.dispatchEvent(new Event("change"));
            } else {
              if (hasKids) { node = ch; draw(); } else { closeModal(); onPick(ch.path); }
            }
          } });
        const txt = el("div", { style: { flex: "1", minWidth: "0" } });
        txt.appendChild(el("div", { style: { fontWeight: 600, fontSize: "13.5px" } }, ch.name));
        const subBits = [`${ch.count} product${ch.count === 1 ? "" : "s"}`];
        if (hasKids) subBits.push(`${ch.children.length} sub-categor${ch.children.length === 1 ? "y" : "ies"}`);
        if (alreadyPicked) subBits.push("already added");
        txt.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", marginTop: "1px" } }, subBits.join(" • ")));
        body.appendChild(txt);
        if (hasKids && !multi) body.appendChild(el("span", { class: "picker-chev" }, "›"));
        row.appendChild(body);
        if (multi && hasKids) {
          // Give a way to drill in during multi-select without toggling the checkbox
          row.appendChild(el("button", { class: "btn btn-secondary picker-use",
            onclick: (e) => { e.stopPropagation(); node = ch; draw(); } }, "Open"));
        } else if (!multi) {
          row.appendChild(el("button", { class: "btn btn-secondary picker-use",
            onclick: (e) => { e.stopPropagation(); closeModal(); onPick(ch.path); } }, "Use"));
        }
        list.appendChild(row);
      });
    }

    updateFooter();
  };

  const updateFooter = () => {
    footer.innerHTML = "";
    footer.appendChild(el("button", { class: "btn btn-secondary", onclick: closeModal }, "Cancel"));
    if (multi) {
      const n = selectedByKey.size;
      const btn = el("button", { class: "btn btn-primary", onclick: () => {
        if (n === 0) { toast("Tick at least one category", "err"); return; }
        closeModal();
        onPick(Array.from(selectedByKey.values()));
      }}, n ? `Add ${n} categor${n === 1 ? "y" : "ies"}` : "Add categories");
      if (n === 0) btn.style.opacity = "0.55";
      footer.appendChild(btn);
    } else if (node.path.length) {
      footer.appendChild(el("button", { class: "btn btn-primary", onclick: () => { closeModal(); onPick(node.path); } },
        `Use all of "${node.name}"`));
    }
  };

  wrap.appendChild(crumb);
  wrap.appendChild(el("div", { style: { fontSize: "11px", color: "var(--muted)", margin: "4px 0 8px" } },
    multi ? "Tick one or more categories. Each becomes its own rule." : "Pick any level. The discount applies to everything inside it."));
  wrap.appendChild(list);
  wrap.appendChild(footer);
  draw();
  openModal(multi ? "Choose categories" : "Choose category", wrap);
};

const today = () => new Date().toISOString().slice(0, 10);
const addDays = (dateStr, n) => { const d = new Date(dateStr); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const activeBiz = () => db.businesses.find(b => b.id === db.activeBusinessId);
const bizCustomers = () => db.customers.filter(c => c.businessId === db.activeBusinessId);
const bizProducts = () => db.products.filter(p => p.businessId === db.activeBusinessId);
const bizDocs = () => db.documents.filter(d => d.businessId === db.activeBusinessId);

// Document type config — add a new type here and it flows through numbering, forms, and preview.
const DOC_TYPES = {
  PI: { label: "Proforma Invoice", shortLabel: "PI", seqKey: "nextPi", fmtKey: "piFormat", defaultFmt: "{YYYY}{####}", partyLabel: "Customer", title: "PRO FORMA INVOICE", numLabel: "Invoice #", hasExpiry: true, expiryLabel: "Expiration Date", validityKey: "piValidityDays", defaultValidity: 5 },
  PO: { label: "Purchase Order", shortLabel: "PO", seqKey: "nextPo", fmtKey: "poFormat", defaultFmt: "PO-{YYYY}-{####}", partyLabel: "Supplier", title: "PURCHASE ORDER", numLabel: "PO #", hasExpiry: true, expiryLabel: "Delivery By", validityKey: "poValidityDays", defaultValidity: 30 },
  QT: { label: "Quotation", shortLabel: "QT", seqKey: "nextQt", fmtKey: "qtFormat", defaultFmt: "QT-{YYYY}-{####}", partyLabel: "Customer", title: "QUOTATION", numLabel: "Quotation #", hasExpiry: true, expiryLabel: "Valid Until", validityKey: "qtValidityDays", defaultValidity: 15, convertsTo: ["PI", "INV"] },
  INV: { label: "Tax Invoice", shortLabel: "INV", seqKey: "nextInv", fmtKey: "invFormat", defaultFmt: "INV-{YYYY}-{####}", partyLabel: "Customer", title: "TAX INVOICE", numLabel: "Invoice #", hasExpiry: false, convertsTo: ["DN"] },
  DN: { label: "Delivery Note", shortLabel: "DN", seqKey: "nextDn", fmtKey: "dnFormat", defaultFmt: "DN-{YYYY}-{####}", partyLabel: "Deliver To", title: "DELIVERY NOTE", numLabel: "Delivery Note #", hasExpiry: false, hidePrices: true, hasDelivery: true },
};
// Human label for the "converted from" chain link.
const convertSourceLabel = (d) => d && d.fromDoc ? `from ${DOC_TYPES[d.fromDoc.type].shortLabel} #${d.fromDoc.number}` : "";
let docTypeFilter = "All";

const TERM_PRESETS = [
  "Payment Terms: 20% advance, 80% before dispatch.",
  "Payment Terms: 50% advance, 50% on delivery.",
  "100% advance payment required before production.",
  "Prices are inclusive of VAT.",
  "Prices are exclusive of VAT.",
  "Delivery within 7-10 working days from confirmed order.",
  "Delivery within 15-20 working days from confirmed order.",
  "Goods once sold will not be taken back.",
  "Ownership of goods remains with the seller until full payment is received.",
  "Rates are valid for 15 days from the date of this document.",
  "Rates are valid for 30 days from the date of this document.",
  "Warranty as per manufacturer's terms.",
  "Transportation charges extra as per actual.",
  "Any bank charges are to be borne by the buyer.",
];

const formatDocNumber = (fmtStr, seq, date) => {
  const d = new Date(date || today());
  return fmtStr
    .replace('{YYYY}', d.getFullYear())
    .replace('{YY}', String(d.getFullYear()).slice(-2))
    .replace('{MM}', String(d.getMonth() + 1).padStart(2, '0'))
    .replace('{DD}', String(d.getDate()).padStart(2, '0'))
    .replace('{####}', String(seq).padStart(4, '0'))
    .replace('{###}', String(seq).padStart(3, '0'))
    .replace('{BIZ}', activeBiz()?.shortCode || '');
};

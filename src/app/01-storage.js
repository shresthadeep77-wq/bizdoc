// ==================== STORAGE ====================
const DB_KEY = "pipomaker_v1";
const DEFAULT_UNITS = ["pcs", "kg", "set", "box", "m", "ft", "litre", "bundle"];

const defaultDB = () => ({
  businesses: [],
  activeBusinessId: null,
  customers: [],
  products: [],
  documents: [],
  nextIds: { biz: 1, cust: 1001, prod: 1, doc: 1 }
});

// Bring any database up to the shape the current code expects.
//
// Every way data gets in — normal load, a backup file, Google Drive, a copy
// found in this browser's storage — goes through here. A backup made by an
// older build (or hand-edited, or half-written) is missing fields that newer
// features read, and one missing field used to blank the whole screen with no
// way back. Filling the gaps up front means a partial backup loads and works
// instead of bricking the app.
const normalizeDB = (raw) => {
  const db = (raw && typeof raw === "object") ? raw : {};
  const base = defaultDB();

  // Top-level lists must exist and be arrays before anything iterates them.
  ["businesses", "customers", "products", "documents"].forEach(k => {
    if (!Array.isArray(db[k])) db[k] = [];
  });
  db.businesses = db.businesses.filter(b => b && typeof b === "object");
  db.nextIds = Object.assign({}, base.nextIds, (db.nextIds && typeof db.nextIds === "object") ? db.nextIds : {});

  db.businesses.forEach(b => {
    if (!Array.isArray(b.units) || !b.units.length) b.units = DEFAULT_UNITS.slice();
    if (!Array.isArray(b.banks)) b.banks = [];
    // Every document type needs a next-number counter (see DOC_TYPES seqKeys).
    ["nextPi", "nextPo", "nextQt", "nextInv", "nextDn"].forEach(k => {
      if (!(Number(b[k]) > 0)) b[k] = 1;
    });
    if (!b.qtFormat) b.qtFormat = "QT-{YYYY}-{####}";
    // Per-type validity: older records only had piValidityDays.
    if (b.piValidityDays === undefined) b.piValidityDays = 5;
    if (b.qtValidityDays === undefined) b.qtValidityDays = 15;
    if (b.poValidityDays === undefined) b.poValidityDays = 30;
  });

  // Ids must be usable: ours are numbers, but CSV/JSON round-trips can turn
  // them into strings, which then never match a === lookup and the record
  // silently disappears from every list.
  const numId = (v) => (typeof v === "string" && v.trim() !== "" && !isNaN(v)) ? Number(v) : v;
  const bizIds = new Set(db.businesses.map(b => (b.id = numId(b.id))));
  ["customers", "products", "documents"].forEach(k => {
    db[k] = db[k].filter(r => r && typeof r === "object");
    db[k].forEach(r => { r.id = numId(r.id); r.businessId = numId(r.businessId); });
  });
  db.customers.forEach(c => { if (!Array.isArray(c.discountRules)) c.discountRules = []; });

  // Documents carry the most optional structure, so they need the most filling in.
  db.documents.forEach(d => {
    d.customerId = numId(d.customerId);
    if (!d.shipping) d.shipping = { deliveryLocation: "", freightType: "", shipDate: "", grossWeight: "", cubicWeight: "", totalPackages: "" };
    if (!d.currency) d.currency = (db.businesses.find(b => b.id === d.businessId) || {}).currency || "NPR";
    if (!d.additional) d.additional = { origin: "", embarkation: "", discharge: "", reason: "" };
    if (!Array.isArray(d.lineItems)) d.lineItems = [];
    if (!d.status) d.status = "Draft";
    const t = d.totals || (d.totals = {});
    ["subtotal", "taxable", "tax", "delivery", "freight", "insurance", "legal", "inspection", "other1", "other2", "total", "discountGiven"].forEach(k => {
      if (typeof t[k] !== "number" || isNaN(t[k])) t[k] = 0;
    });
    if (typeof t.taxRate !== "number" || isNaN(t.taxRate)) t.taxRate = 0;
  });

  // A pointer at a business that no longer exists renders an empty app.
  db.activeBusinessId = numId(db.activeBusinessId);
  if (!bizIds.has(db.activeBusinessId)) {
    db.activeBusinessId = db.businesses.length ? db.businesses[0].id : null;
  }

  // Next ids must clear everything already stored, or the next record created
  // reuses a live id and quietly overwrites/merges with an existing one.
  const maxOf = (list) => list.reduce((m, r) => Math.max(m, Number(r.id) || 0), 0);
  db.nextIds.biz = Math.max(Number(db.nextIds.biz) || 1, maxOf(db.businesses) + 1);
  db.nextIds.cust = Math.max(Number(db.nextIds.cust) || 1001, maxOf(db.customers) + 1);
  db.nextIds.prod = Math.max(Number(db.nextIds.prod) || 1, maxOf(db.products) + 1);
  db.nextIds.doc = Math.max(Number(db.nextIds.doc) || 1, maxOf(db.documents) + 1);
  return db;
};

const loadDB = () => {
  try { return normalizeDB(JSON.parse(localStorage.getItem(DB_KEY))); }
  catch (e) { return defaultDB(); }
};

const saveDB = () => {
  try {
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  } catch (e) {
    console.error("Save failed:", e);
    toast("Save failed — storage may be full (try a smaller logo/signature image)", "err");
  }
};

// Swap in a whole database from a backup/restore. Always normalised first, so a
// backup from an older build can't leave the app in a state it can't render.
const replaceDB = (raw) => { db = normalizeDB(raw); saveDB(); };

let db = loadDB();

// Units for the active business (falls back to a sensible default outside biz context)
const bizUnits = () => (activeBiz()?.units && activeBiz().units.length) ? activeBiz().units : DEFAULT_UNITS;

const uid = (kind) => { if (!db.nextIds) db.nextIds = {}; if (db.nextIds[kind] === undefined) db.nextIds[kind] = 1; const id = db.nextIds[kind]++; saveDB(); return id; };

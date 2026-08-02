// ==================== STORAGE ====================
const DB_KEY = "pipomaker_v1";
const loadDB = () => {
  try { return JSON.parse(localStorage.getItem(DB_KEY)) || defaultDB(); }
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
const defaultDB = () => ({
  businesses: [],
  activeBusinessId: null,
  customers: [],
  products: [],
  documents: [],
  nextIds: { biz: 1, cust: 1001, prod: 1, doc: 1 }
});
let db = loadDB();
// Migration: older businesses may not have a `units` list — seed with defaults.
{
  let migrated = false;
  db.businesses.forEach(b => {
    if (!Array.isArray(b.units) || b.units.length === 0) {
      b.units = ["pcs", "kg", "set", "box", "m", "ft", "litre", "bundle"];
      migrated = true;
    }
  });
  if (migrated) { try { localStorage.setItem(DB_KEY, JSON.stringify(db)); } catch (e) {} }
}

// Units for the active business (falls back to a sensible default outside biz context)
const bizUnits = () => (activeBiz()?.units && activeBiz().units.length) ? activeBiz().units : ["pcs", "kg", "set", "box", "m", "ft", "litre", "bundle"];

// Backfill fields that were added after some businesses were already saved,
// so older data doesn't silently break newer features (e.g. Quotations).
(db.businesses || []).forEach(b => {
  if (!b.qtFormat) b.qtFormat = "QT-{YYYY}-{####}";
  if (!b.nextQt) b.nextQt = 1;
  if (!b.nextInv) b.nextInv = 1;
  if (!b.nextDn) b.nextDn = 1;
  if (!b.nextPi) b.nextPi = b.nextPi || 1;
  if (!b.nextPo) b.nextPo = b.nextPo || 1;
  if (!Array.isArray(b.banks)) b.banks = [];
  // Per-type validity: older records only had piValidityDays.
  if (b.piValidityDays === undefined) b.piValidityDays = 5;
  if (b.qtValidityDays === undefined) b.qtValidityDays = 15;
  if (b.poValidityDays === undefined) b.poValidityDays = 30;
});

// Backfill fields that older/imported documents may be missing. Any one of
// these being undefined used to crash the preview silently (nothing happened
// on tap) instead of showing an error.
(db.documents || []).forEach(d => {
  if (!d.shipping) d.shipping = { deliveryLocation: "", freightType: "", shipDate: "", grossWeight: "", cubicWeight: "", totalPackages: "" };
  if (!d.currency) d.currency = (db.businesses.find(b => b.id === d.businessId) || {}).currency || "NPR";
  if (!d.additional) d.additional = { origin: "", embarkation: "", discharge: "", reason: "" };
  if (!Array.isArray(d.lineItems)) d.lineItems = [];
  const t = d.totals || (d.totals = {});
  ["subtotal", "taxable", "tax", "delivery", "freight", "insurance", "legal", "inspection", "other1", "other2", "total", "discountGiven"].forEach(k => {
    if (typeof t[k] !== "number" || isNaN(t[k])) t[k] = 0;
  });
  if (typeof t.taxRate !== "number" || isNaN(t.taxRate)) t.taxRate = 0;
});

const uid = (kind) => { if (!db.nextIds) db.nextIds = {}; if (db.nextIds[kind] === undefined) db.nextIds[kind] = 1; const id = db.nextIds[kind]++; saveDB(); return id; };

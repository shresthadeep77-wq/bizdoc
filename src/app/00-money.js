// ==================== MONEY & VAT ====================
// Every amount that reaches a document goes through here.
//
// Money is decimal; JavaScript numbers are binary. 0.1 + 0.2 is
// 0.30000000000000004, and the obvious Math.round(n * 100) / 100 turns 1.005
// into 1.00 because the stored value is really 1.00499999999999989. On an
// invoice that shows up as a printed column that does not add up to its own
// total, which is exactly the kind of thing a customer notices.

// A number, or 0 — never NaN, Infinity or "12abc" leaking into a total.
const safeNum = (v) => {
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

// Round to 2 decimals the way a person does it: half away from zero, decided on
// the decimal digits rather than the binary ones. Going through the string form
// ("1.005" -> "1.005e2" -> 100.5) is what makes 1.005 round up to 1.01.
const round2 = (v) => {
  const n = safeNum(v);
  if (Math.abs(n) >= 1e15) return Math.round(n); // past here a double has no decimals left anyway
  const scaled = Number(`${n}e2`);
  return Number(`${Math.round(Math.abs(scaled)) * Math.sign(scaled)}e-2`);
};

// Add a list of amounts, rounding as we go so the sum matches what was printed.
const sum2 = (nums) => nums.reduce((s, n) => round2(s + safeNum(n)), 0);

// Split a number into whole-number digits and how far the point was moved:
// 33.33 -> [3333, 2]. Anything already in exponent form ("1e+21") comes back
// unchanged, and the caller falls back to ordinary multiplication.
const decimalParts = (n) => {
  const s = String(n);
  const dot = s.indexOf(".");
  if (dot < 0) return [Number(s), 0];
  return [Number(s.slice(0, dot) + s.slice(dot + 1)), s.length - dot - 1];
};

// Multiply two decimal amounts without the binary drift. Plain 2.5 * 33.33 is
// 83.32499999999999, which then rounds *down* to 83.32 and loses a paisa on
// every such line; multiplying 25 x 3333 as whole numbers gives exactly 83.325.
const mulExact = (a, b) => {
  const x = safeNum(a), y = safeNum(b);
  const [mx, ex] = decimalParts(x);
  const [my, ey] = decimalParts(y);
  const product = mx * my;
  if (!Number.isSafeInteger(mx) || !Number.isSafeInteger(my) || !Number.isSafeInteger(product)) {
    return x * y; // beyond what a double can hold exactly — nothing to gain
  }
  return ex + ey === 0 ? product : Number(`${product}e-${ex + ey}`);
};

// ---- One line's money ----------------------------------------------------
//
// Two separate ideas meet here, and keeping them apart is what makes the
// numbers trustworthy:
//
//   `rateIncludesVat` is a property of the *product* — "the 113 on my price
//   list already has the VAT in it". It decides what is actually owed.
//
//   `separateVat` is a property of the *document* — "print the VAT in its own
//   column". It decides only how the same money is laid out. Switching it must
//   never change the grand total, and tools/test-money.js checks exactly that.
//
// With separateVat OFF, every price prints exactly as it was typed: a rate with
// no VAT in it, and a non-taxable product, are untouched, and a VAT-inclusive
// rate still prints as the full 113 the customer pays.
//
// With separateVat ON, a VAT-inclusive rate is split: 100 in the price column
// and 13 in the VAT column.
//
// Returns, for one line:
//   gross        what the customer pays for this line, always
//   unitPrinted  what the UNIT PRICE column shows
//   linePrinted  what the TOTAL AMOUNT column shows (qty x unitPrinted)
//   vatToAdd     VAT that still has to be added on top of linePrinted
//   vatInside    VAT already contained in linePrinted
//   net          the taxable value of the line, whichever way it is printed
const lineAmounts = (li, taxRatePct, separateVat) => {
  const qty = safeNum(li && li.qty);
  const rate = safeNum(li && li.rate);
  const r = safeNum(taxRatePct) / 100;
  const gross = round2(mulExact(qty, rate));
  const charged = !!(li && li.taxable) && r > 0;
  const inclusive = charged && !!li.rateIncludesVat;
  const net = inclusive ? round2(gross / (1 + r)) : gross;

  if (inclusive && separateVat) {
    // Split the VAT out of the price and show it in its own column.
    return {
      gross, net, inclusive,
      unitPrinted: round2(rate / (1 + r)),
      linePrinted: net,
      vatToAdd: round2(gross - net),
      vatInside: 0,
    };
  }
  if (inclusive) {
    // Print the price exactly as typed; the VAT is already inside it.
    return {
      gross, net, inclusive,
      unitPrinted: round2(rate),
      linePrinted: gross,
      vatToAdd: 0,
      vatInside: round2(gross - net),
    };
  }
  // A VAT-exclusive rate, or a product that carries no VAT: the price prints
  // unchanged either way, and any VAT is added underneath.
  return {
    gross, net, inclusive,
    unitPrinted: round2(rate),
    linePrinted: gross,
    vatToAdd: charged ? round2(mulExact(gross, r)) : 0,
    vatInside: 0,
  };
};

// What the discount column shows for a line: the percentage taken off and the
// list price it came off. Returns null when this line was not discounted.
const lineDiscount = (li, taxRatePct, separateVat) => {
  if (!li) return null;
  const list = li.listRate;
  if (list === undefined || list === null || list === "" || !Number.isFinite(Number(list))) return null;
  const pct = safeNum(li.discountPct);
  const listRate = safeNum(list);
  if (pct <= 0 || listRate <= safeNum(li.rate)) return null;
  // Show the list price on the same basis as the price column beside it, or the
  // two figures cannot be compared.
  const r = safeNum(taxRatePct) / 100;
  const splitting = separateVat && !!li.taxable && !!li.rateIncludesVat && r > 0;
  return { pct, listUnit: splitting ? round2(listRate / (1 + r)) : round2(listRate) };
};

// ---- A whole document's totals -------------------------------------------
//
// Writes into `doc.totals` (keeping taxRate, the extra charges and their
// labels) and returns it. Pure arithmetic — no DOM, no globals — so the same
// function serves the builder, the printed page and tools/test-money.js.
//
// `doc.separateVat` changes how the figures are *presented*, never what is
// owed: subtotal is whatever the printed price column adds up to, and the VAT
// still to be added moves in step with it, so `total` comes out the same
// either way. tools/test-money.js asserts that on every shape of document.
//
// The VAT to add is worked out once on the summed base rather than per line and
// added up, because that is how a tax return works and it avoids a stack of
// per-line rounding errors drifting the total.
const EXTRA_CHARGE_KEYS = ["delivery", "freight", "insurance", "legal", "inspection", "other1", "other2"];

const computeTotals = (doc) => {
  const t = (doc.totals && typeof doc.totals === "object") ? doc.totals : (doc.totals = {});
  const ratePct = safeNum(t.taxRate);
  const separateVat = !!doc.separateVat;
  const items = Array.isArray(doc.lineItems) ? doc.lineItems : [];

  let subtotal = 0;      // what the printed price column adds up to
  let taxableBase = 0;   // the value VAT applies to — always net of VAT
  let baseToTax = 0;     // the part of the subtotal that VAT is still owed on
  let taxIncluded = 0;   // VAT already sitting inside the printed prices
  let discountGiven = 0;

  items.forEach((li) => {
    const a = lineAmounts(li, ratePct, separateVat);
    subtotal = round2(subtotal + a.linePrinted);
    taxIncluded = round2(taxIncluded + a.vatInside);
    if (li && li.taxable) {
      taxableBase = round2(taxableBase + a.net);
      // VAT is owed on this line unless the printed price already contains it.
      if (a.vatInside === 0) baseToTax = round2(baseToTax + a.linePrinted);
    }
    // What this customer saved against the list price. Never negative: a rate
    // typed in above list price is a surcharge, not a negative discount.
    const list = li && li.listRate;
    if (list !== undefined && list !== null && list !== "" && Number.isFinite(Number(list))) {
      discountGiven = round2(discountGiven + round2(mulExact(safeNum(li.qty), Math.max(0, round2(safeNum(list) - safeNum(li.rate))))));
    }
  });

  const tax = round2(mulExact(baseToTax, ratePct) / 100);
  const charges = sum2(EXTRA_CHARGE_KEYS.map((k) => safeNum(t[k])));

  t.subtotal = subtotal;
  t.taxable = taxableBase;
  t.tax = tax;
  t.taxIncluded = taxIncluded;
  t.discountGiven = discountGiven;
  t.total = round2(round2(subtotal + tax) + charges);
  return t;
};

// Do a saved document's stored totals still match its own line items?
//
// Documents saved by an earlier build can disagree: VAT used to be added on top
// of prices that already contained it, so the stored total was too high. Those
// documents are left exactly as they were saved — they may already have been
// sent to a customer — but the app can at least notice and say so.
//
// Returns null when everything agrees, otherwise { stored, correct, difference }.
const totalsMismatch = (doc) => {
  if (!doc || !Array.isArray(doc.lineItems) || !doc.lineItems.length) return null;
  const stored = safeNum(doc.totals && doc.totals.total);
  // Work on a throwaway copy: nothing here may change what is saved.
  const probe = { lineItems: doc.lineItems, separateVat: doc.separateVat, totals: { ...(doc.totals || {}) } };
  const correct = computeTotals(probe).total;
  const difference = round2(stored - correct);
  return Math.abs(difference) < 0.01 ? null : { stored, correct, difference };
};

// Total weight of a document's lines, in kg.
const documentGrossWeight = (doc) =>
  round2((Array.isArray(doc.lineItems) ? doc.lineItems : [])
    .reduce((s, li) => s + mulExact(safeNum(li && li.qty), safeNum(li && li.weight)), 0));

// Exported for tools/test-money.js; harmless in the browser.
if (typeof module !== "undefined" && module.exports) {
  module.exports = { safeNum, round2, sum2, mulExact, lineAmounts, lineDiscount, computeTotals, totalsMismatch, documentGrossWeight };
}

#!/usr/bin/env node
/**
 * Tests for the money and VAT arithmetic — the part of BizDoc where a mistake
 * costs someone real money.
 *
 *   node tools/test-money.js
 *
 * No framework, no install; it exits 1 if anything is wrong.
 */
const { safeNum, round2, sum2, mulExact, lineAmounts, lineDiscount, computeTotals, totalsMismatch, documentGrossWeight } =
  require("../src/app/00-money.js");

let passed = 0;
const failures = [];

const is = (name, actual, expected) => {
  if (Object.is(actual, expected)) { passed++; return; }
  failures.push(`${name}\n    expected: ${expected}\n    actual:   ${actual}`);
};

const doc = (lines, totals = {}) => ({ lineItems: lines, totals: Object.assign({ taxRate: 13 }, totals) });
const item = (o) => Object.assign({ qty: 1, rate: 0, taxable: true, rateIncludesVat: false }, o);

/* ---- rounding ---------------------------------------------------------- */
is("round2 rounds a half up the way a person does", round2(1.005), 1.01);
is("round2 handles the classic 2.675", round2(2.675), 2.68);
is("round2 clears binary noise", round2(0.1 + 0.2), 0.3);
is("round2 rounds negatives away from zero", round2(-1.005), -1.01);
is("round2 turns rubbish into 0", round2("not a number"), 0);
is("round2 turns Infinity into 0", round2(Infinity), 0);
is("round2 never returns -0", Object.is(round2(-0), 0), true);
is("safeNum reads a numeric string", safeNum("12.5"), 12.5);
is("safeNum rejects an empty string", safeNum(""), 0);
is("safeNum rejects null", safeNum(null), 0);
is("sum2 adds without drift", sum2([0.1, 0.2, 0.3]), 0.6);

/* ---- exact decimal multiplication -------------------------------------- */
// Plain 2.5 * 33.33 is 83.32499999999999, which rounds *down* to 83.32 and
// quietly loses a paisa on every line like it.
is("2.5 x 33.33 keeps its half paisa", mulExact(2.5, 33.33), 83.325);
is("and so rounds up, not down", round2(mulExact(2.5, 33.33)), 83.33);
is("0.1 x 3 is exactly 0.3", mulExact(0.1, 3), 0.3);
is("whole numbers are untouched", mulExact(12, 250), 3000);
is("large values stay exact", mulExact(1e9, 999999), 999999000000000);
is("rubbish multiplies to 0", mulExact("x", 5), 0);

/* ---- one line ---------------------------------------------------------- */
// With "Separate VAT" OFF, every price prints exactly as it was typed.
const off = (li) => lineAmounts(li, 13, false);
const on = (li) => lineAmounts(li, 13, true);

is("a plain price prints as typed", off(item({ qty: 2, rate: 100 })).unitPrinted, 100);
is("and its VAT is added underneath", off(item({ qty: 2, rate: 100 })).vatToAdd, 26);
is("a VAT-inclusive price prints as typed too", off(item({ rate: 113, rateIncludesVat: true })).unitPrinted, 113);
is("with nothing further to add", off(item({ rate: 113, rateIncludesVat: true })).vatToAdd, 0);
is("because the VAT is already inside it", off(item({ rate: 113, rateIncludesVat: true })).vatInside, 13);
is("a non-taxable price prints as typed", off(item({ rate: 100, taxable: false })).unitPrinted, 100);
is("and is never taxed", off(item({ rate: 100, taxable: false })).vatToAdd, 0);

// With it ON, a VAT-inclusive price is split into price + VAT.
is("splitting shows the price without VAT", on(item({ rate: 113, rateIncludesVat: true })).unitPrinted, 100);
is("and the VAT beside it", on(item({ rate: 113, rateIncludesVat: true })).vatToAdd, 13);
is("splitting leaves a plain price alone", on(item({ qty: 2, rate: 100 })).unitPrinted, 100);
is("splitting leaves a non-taxable price alone", on(item({ rate: 100, taxable: false })).unitPrinted, 100);
is("either way the customer pays the same", on(item({ rate: 113, rateIncludesVat: true })).gross,
  off(item({ rate: 113, rateIncludesVat: true })).gross);

is("the taxable value is the same either way",
  on(item({ rate: 113, rateIncludesVat: true })).net, off(item({ rate: 113, rateIncludesVat: true })).net);
is("0% VAT leaves an inclusive rate alone", lineAmounts(item({ rate: 113, rateIncludesVat: true }), 0, true).net, 113);
is("decimal quantity", off(item({ qty: 2.5, rate: 33.33 })).linePrinted, 83.33);

/* ---- the discount column ----------------------------------------------- */
is("no list price means no discount to show", lineDiscount(item({ rate: 100 }), 13, false), null);
is("a rate equal to list is not a discount", lineDiscount(item({ rate: 100, listRate: 100, discountPct: 0 }), 13, false), null);
const disc = lineDiscount(item({ rate: 90, listRate: 100, discountPct: 10 }), 13, false);
is("the percentage is shown", disc && disc.pct, 10);
is("alongside the list price it came off", disc && disc.listUnit, 100);
// When the VAT is split out of the price, the list price has to be split too
// or the two figures in the same row cannot be compared.
const discSplit = lineDiscount(item({ rate: 101.7, listRate: 113, discountPct: 10, rateIncludesVat: true }), 13, true);
is("a split-out list price is also without VAT", discSplit && discSplit.listUnit, 100);

/* ---- whole documents --------------------------------------------------- */
let t = computeTotals(doc([item({ qty: 10, rate: 250 })]));
is("simple invoice subtotal", t.subtotal, 2500);
is("simple invoice VAT at 13%", t.tax, 325);
is("simple invoice total", t.total, 2825);

t = computeTotals(doc([]));
is("no items: subtotal is 0", t.subtotal, 0);
is("no items: total is 0", t.total, 0);

t = computeTotals(doc([item({ rate: 113, rateIncludesVat: true })]));
is("inclusive pricing is not taxed twice", t.total, 113);
is("inclusive pricing taxable amount", t.taxable, 100);

// The bug this suite exists for: an inclusive-rate product used to have 13%
// added on top of a price that already contained it.
is("inclusive pricing is never 127.69", computeTotals(doc([item({ rate: 113, rateIncludesVat: true })])).total !== 127.69, true);

// A mix of both kinds of price, laid out each way. The two layouts differ on
// every line of the totals block except the two that matter: the taxable value
// and the grand total.
const mixedLines = [item({ rate: 113, rateIncludesVat: true }), item({ rate: 100 })];
const asTyped = computeTotals({ separateVat: false, lineItems: mixedLines, totals: { taxRate: 13 } });
is("prices as typed: subtotal is what is printed", asTyped.subtotal, 213);
is("prices as typed: only the plain line still owes VAT", asTyped.tax, 13);
is("prices as typed: the rest of the VAT is already inside", asTyped.taxIncluded, 13);
is("prices as typed: total", asTyped.total, 226);

const split = computeTotals({ separateVat: true, lineItems: mixedLines, totals: { taxRate: 13 } });
is("VAT split out: subtotal is net of VAT", split.subtotal, 200);
is("VAT split out: all the VAT is in the VAT line", split.tax, 26);
is("VAT split out: nothing is left hidden in the prices", split.taxIncluded, 0);
is("VAT split out: total", split.total, 226);

is("the grand total is the same either way", asTyped.total, split.total);
is("the taxable value is the same either way", asTyped.taxable, split.taxable);

t = computeTotals(doc([item({ rate: 100 }), item({ rate: 100, taxable: false })]));
is("exempt line is in the subtotal", t.subtotal, 200);
is("exempt line is out of the taxable amount", t.taxable, 100);
is("exempt line is not taxed", t.tax, 13);

/* the printed columns must add up to the printed totals */
const awkward = doc([item({ qty: 3, rate: 33.33 }), item({ qty: 7, rate: 1.115 }), item({ qty: 1, rate: 0.005 })]);
t = computeTotals(awkward);
const columnSum = sum2(awkward.lineItems.map((li) => lineAmounts(li, 13).net));
is("the line column adds up to the subtotal", columnSum, t.subtotal);
is("subtotal + VAT + charges is the total", round2(t.subtotal + t.tax), t.total);

/* extra charges */
t = computeTotals(doc([item({ rate: 1000 })], { delivery: 100, freight: 50.5, insurance: 0, legal: 0, inspection: 0, other1: 9.99, other2: 0 }));
is("charges are added after VAT", t.total, round2(1000 + 130 + 100 + 50.5 + 9.99));
is("charges do not change the taxable amount", t.taxable, 1000);

/* discounts */
t = computeTotals(doc([item({ qty: 4, rate: 90, listRate: 100 })]));
is("discount given is recorded", t.discountGiven, 40);
is("discount is off the price charged", t.subtotal, 360);
t = computeTotals(doc([item({ qty: 1, rate: 120, listRate: 100 })]));
is("a rate above list is not a negative discount", t.discountGiven, 0);

/* rubbish in, sane out */
t = computeTotals(doc([item({ qty: "abc", rate: "xyz" }), item({ qty: null, rate: undefined })]));
is("unreadable quantities do not produce NaN", t.total, 0);
t = computeTotals({ lineItems: null, totals: { taxRate: "13" } });
is("a document with no items list still totals 0", t.total, 0);
t = computeTotals(doc([item({ qty: 1e9, rate: 999999 })]));
is("very large numbers stay exact to the paisa", t.subtotal, 999999000000000);

/* weight */
is("gross weight adds up", documentGrossWeight(doc([item({ qty: 3, weight: 1.5 }), item({ qty: 2, weight: 0.25 })])), 5);
is("missing weights count as zero", documentGrossWeight(doc([item({ qty: 3 })])), 0);

/* ---- the layout switch never moves the money ---------------------------- */
// The one rule that matters most: "Separate VAT from prices" is a layout
// choice. Run every awkward combination through both layouts and insist the
// customer owes the same.
const shapes = {
  "one plain line": [item({ qty: 3, rate: 99.99 })],
  "one VAT-inclusive line": [item({ qty: 7, rate: 113, rateIncludesVat: true })],
  "one exempt line": [item({ qty: 2, rate: 500, taxable: false })],
  "all three kinds at once": [
    item({ qty: 12, rate: 113, rateIncludesVat: true }),
    item({ qty: 4, rate: 100 }),
    item({ qty: 2, rate: 50, taxable: false }),
  ],
  "awkward decimals": [item({ qty: 2.5, rate: 33.33 }), item({ qty: 7, rate: 1.115, rateIncludesVat: true })],
  "no lines at all": [],
};
Object.keys(shapes).forEach((label) => {
  const charges = { taxRate: 13, delivery: 250, freight: 12.5, insurance: 0, legal: 0, inspection: 0, other1: 0, other2: 0 };
  const plain = computeTotals({ separateVat: false, lineItems: shapes[label], totals: { ...charges } });
  const shown = computeTotals({ separateVat: true, lineItems: shapes[label], totals: { ...charges } });
  is(`${label}: the total is the same whichever way it is laid out`, plain.total, shown.total);
  is(`${label}: the taxable value is the same either way`, plain.taxable, shown.taxable);
  // And each layout has to be internally consistent: what is printed, plus the
  // VAT stated underneath, plus the charges, is the total.
  is(`${label}: as typed, the printed figures add up`,
    round2(round2(plain.subtotal + plain.tax) + 262.5), plain.total);
  is(`${label}: split out, the printed figures add up`,
    round2(round2(shown.subtotal + shown.tax) + 262.5), shown.total);
});

/* ---- spotting documents saved by the old, wrong code -------------------- */
// 113 with the VAT already in it used to be taxed a second time, to 127.69.
const legacy = { lineItems: [item({ rate: 113, rateIncludesVat: true })],
  totals: { taxRate: 13, subtotal: 113, taxable: 113, tax: 14.69, total: 127.69 } };
const found = totalsMismatch(legacy);
is("an old double-taxed document is spotted", !!found, true);
is("and the correct figure is worked out", found && found.correct, 113);
is("and the overcharge is named", found && found.difference, 14.69);
is("checking does not change what was saved", legacy.totals.total, 127.69);

const fresh = doc([item({ rate: 113, rateIncludesVat: true })]);
computeTotals(fresh);
is("a correct document is not flagged", totalsMismatch(fresh), null);
is("a document with no items is not flagged", totalsMismatch(doc([])), null);

/* ---- report ------------------------------------------------------------ */
if (failures.length) {
  console.error(`\n${failures.length} of ${passed + failures.length} checks FAILED:\n`);
  failures.forEach((f) => console.error("  ✗ " + f));
  process.exit(1);
}
console.log(`All ${passed} money checks passed.`);

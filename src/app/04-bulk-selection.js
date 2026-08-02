// ==================== BULK SELECTION ====================
// One selection set per list kind. Entering select mode adds checkboxes to rows
// and shows an action bar; deletes route through deleteWithUndo so they're
// recoverable.
const bulkSel = { kind: null, ids: new Set() };

const bulkActive = (kind) => bulkSel.kind === kind;
const bulkToggleMode = (kind) => {
  if (bulkSel.kind === kind) { bulkSel.kind = null; bulkSel.ids.clear(); }
  else { bulkSel.kind = kind; bulkSel.ids.clear(); }
  render();
};
const bulkToggleId = (id) => {
  bulkSel.ids.has(id) ? bulkSel.ids.delete(id) : bulkSel.ids.add(id);
  updateBulkBar();
};
// Checkbox prepended to a row when its list is in select mode.
const bulkCheckbox = (kind, id) => {
  if (!bulkActive(kind)) return null;
  const cb = el("input", { type: "checkbox", class: "bulk-cb",
    onclick: (e) => { e.stopPropagation(); bulkToggleId(id); } });
  cb.checked = bulkSel.ids.has(id);
  return cb;
};

// Recomputes the count/label in the bar without a full re-render.
const updateBulkBar = () => {
  const lbl = document.getElementById("bulk-count");
  if (lbl) lbl.textContent = `${bulkSel.ids.size} selected`;
  const del = document.getElementById("bulk-delete");
  if (del) del.disabled = bulkSel.ids.size === 0;
  document.querySelectorAll(".bulk-cb").forEach(cb => {
    const row = cb.closest(".list-item");
    if (row) row.classList.toggle("row-selected", cb.checked);
  });
};

// The bar shown above a list while selecting. `onDelete` receives the ids.
const bulkBar = (kind, allIds, onDelete, extraActions) => {
  const bar = el("div", { class: "bulk-bar" });
  const left = el("div", { style: { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" } });
  left.appendChild(el("span", { id: "bulk-count", style: { fontSize: "12.5px", fontWeight: 700, color: "var(--primary)" } },
    `${bulkSel.ids.size} selected`));
  left.appendChild(el("button", { class: "btn btn-secondary bulk-mini", onclick: () => {
    const visible = allIds();
    const allOn = visible.every(id => bulkSel.ids.has(id));
    visible.forEach(id => allOn ? bulkSel.ids.delete(id) : bulkSel.ids.add(id));
    render();
  }}, "Select all"));
  bar.appendChild(left);
  const right = el("div", { style: { display: "flex", gap: "6px", flexWrap: "wrap" } });
  (extraActions || []).forEach(b => right.appendChild(b));
  const del = el("button", { class: "btn btn-danger bulk-mini", id: "bulk-delete",
    onclick: () => onDelete([...bulkSel.ids]) }, "🗑 Delete");
  del.disabled = bulkSel.ids.size === 0;
  right.appendChild(del);
  right.appendChild(el("button", { class: "btn btn-secondary bulk-mini", onclick: () => bulkToggleMode(kind) }, "Done"));
  bar.appendChild(right);
  return bar;
};

// Copy text to clipboard (so it can be pasted anywhere), then also open the
// device share sheet if available.
const shareText = async (text, title) => {
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; }
  catch (e) {
    // Fallback copy for browsers without clipboard API / non-secure contexts.
    try {
      const ta = document.createElement("textarea");
      ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.select();
      document.execCommand("copy"); ta.remove(); copied = true;
    } catch (_) {}
  }
  if (copied) toast("Copied — paste anywhere");
  try { if (navigator.share) await navigator.share({ text, title: title || "" }); }
  catch (e) { /* user dismissed share sheet — copy already done */ }
};
// Bulk-paste-compatible line formats (match the Bulk add parsers exactly).
const productToLine = (p) => [p.description, p.unit || "pcs", p.rate || 0, (Array.isArray(p.path) && p.path[0]) || p.category || "", p.partNumber || "", p.hsn || "", p.weight || "", p.taxable === false ? "no" : "yes", p.notes || ""].join(", ");
const customerToLine = (c) => [c.companyName, c.contactName || "", c.phone || "", c.addr1 || c.address1 || "", c.addr2 || c.address2 || "", c.vatNo || "", c.email || "", c.regNo || "", c.eximCode || "", c.country || ""].join(", ");

const toast = (msg, kind = "ok", ms = 1800) => {
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = el("div", { class: `toast ${kind}` }, msg);
  document.body.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity .25s ease, transform .25s ease";
    t.style.opacity = "0";
    t.style.transform = "translate(-50%, 8px)";
    setTimeout(() => t.remove(), 250);
  }, ms);
};

const fmt = (n) => Number(n || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Convert a number to words using the Indian numbering system (Lakh / Crore).
// Used for the "In words" line on documents.
const numToWordsIN = (num) => {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (n) => n < 20 ? ones[n] : (tens[Math.floor(n / 10)] + (n % 10 ? " " + ones[n % 10] : ""));
  const three = (n) => {
    const h = Math.floor(n / 100), r = n % 100;
    return (h ? ones[h] + " Hundred" + (r ? " " : "") : "") + (r ? two(r) : "");
  };
  if (num === 0) return "Zero";
  let words = "";
  const crore = Math.floor(num / 10000000); num %= 10000000;
  const lakh = Math.floor(num / 100000); num %= 100000;
  const thousand = Math.floor(num / 1000); num %= 1000;
  const hundred = num;
  if (crore) words += three(crore) + " Crore ";
  if (lakh) words += two(lakh) + " Lakh ";
  if (thousand) words += two(thousand) + " Thousand ";
  if (hundred) words += three(hundred);
  return words.trim();
};
// Full currency amount in words, incl. paisa/cents. e.g. "Nepalese Rupees One Thousand Only"
const amountToWords = (amount, currency) => {
  const names = { NPR: ["Nepalese Rupees", "Paisa"], INR: ["Indian Rupees", "Paisa"], USD: ["US Dollars", "Cents"], EUR: ["Euros", "Cents"] };
  const [main, sub] = names[currency] || [currency, "Cents"];
  const n = Math.round((Number(amount) || 0) * 100) / 100;
  const whole = Math.floor(n);
  const frac = Math.round((n - whole) * 100);
  let out = `${main} ${numToWordsIN(whole)}`;
  if (frac > 0) out += ` and ${numToWordsIN(frac)} ${sub}`;
  return out + " Only";
};

// Nepali bank codes (SWIFT/BIC) used by the payment-QR format. Matches the
// bank-QR generator these QRs are scanned by, so wallets recognise the account.
const NEPAL_BANK_CODES = [
  ["ADBLNPKA", "AGRICULTURAL DEVELOPMENT BANK LTD"],
  ["CTZNNPKA", "CITIZENS BANK INTERNATIONAL LIMITED"],
  ["EVBLNPKA", "EVEREST BANK LTD."],
  ["GLBBNPKA", "GLOBAL IME BANK LIMITED"],
  ["HIMANPKA", "HIMALAYAN BANK LTD."],
  ["KMBLNPKA", "KUMARI BANK LTD"],
  ["LXBLNPKA", "LAXMI SUNRISE BANK LIMITED"],
  ["MBLNNPKA", "MACHHAPUCHCHHRE BANK LIMITED"],
  ["NARBNPKA", "NABIL BANK LIMITED"],
  ["NEBLNPKA", "NEPAL BANK LIMITED"],
  ["NINFNPKA", "NEPAL INFRASTRUCTURE BANK LTD"],
  ["NIBLNPKT", "NEPAL INVESTMENT MEGA BANK LTD."],
  ["NRBLNPKA", "NEPAL RASTRA BANK"],
  ["NSBINPKA", "NEPAL SBI BANK LTD"],
  ["BOALNPKA", "NIC ASIA BANK LIMITED"],
  ["NMBBNPKA", "NMB BANK LTD"],
  ["PRVUNPKA", "PRABHU BANK LTD"],
  ["PCBLNPKA", "PRIME COMMERCIAL BANK LTD"],
  ["RBBANPKA", "RASTRIYA BANIJYA BANK LTD."],
  ["SNMANPKA", "SANIMA BANK LIMITED"],
  ["SIDDNPKA", "SIDDHARTHA BANK LIMITED"],
  ["SCBLNPKA", "STANDARD CHARTERED BANK NEPAL LIMITED"],
  ["SRDBNPKA", "Shine Resunga Development Bank Limited"]
];
const bankNameFromCode = (code) => (NEPAL_BANK_CODES.find(([c]) => c === code) || [])[1] || "";

// Build a QR-code <img> (data URL) for the given text. Uses the bundled
// qrcode-generator, so it works fully offline and renders into the PDF canvas.
// ecLevel matches the source generator ("L" for the bank payment format).
const makeQRImg = (text, px = 96, ecLevel = "L") => {
  try {
    const qr = window.__qrcode(0, ecLevel);
    qr.addData(text);
    qr.make();
    const count = qr.getModuleCount();
    const cell = Math.max(2, Math.floor(px / (count + 2)));
    const url = qr.createDataURL(cell, cell); // second arg = margin cells
    return el("img", { src: url, style: { width: px + "px", height: px + "px", display: "block" }, alt: "Banking QR" });
  } catch (e) { return null; }
};
// Payload encoded into a bank's payment QR. Exact JSON shape the wallet scanner
// expects: {accountNumber, accountName, bankCode}. bankCode is the SWIFT/BIC.
// Returns "" when the required fields aren't present, so no QR is drawn.
const bankQRText = (b) => {
  const bankCode = (b.bankCode || b.swift || "").trim();
  if (!b.accountNumber || !b.accountName || !bankCode) return "";
  return JSON.stringify({
    accountNumber: b.accountNumber,
    accountName: b.accountName,
    bankCode: bankCode
  });
};

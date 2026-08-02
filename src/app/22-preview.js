// ==================== PREVIEW ====================
// Print via an isolated window holding ONLY the document pages — instead of
// relying on @media print to hide the whole app shell around a fixed-position
// modal, which some mobile browsers/webviews don't reflow reliably (that path
// was producing blank pages). This window has nothing else in it to hide.
const printDoc = (pv) => {
  const w = window.open("", "_blank");
  if (!w) { toast("Popup blocked — allow popups for this page, then tap Print again", "err"); return; }
  const mainStyle = document.querySelector("style");
  w.document.open();
  w.document.write("<!DOCTYPE html><html><head><meta charset='UTF-8'><title>Print</title></head><body></body></html>");
  w.document.close();
  const style = w.document.createElement("style");
  style.textContent = (mainStyle ? mainStyle.textContent : "") + `
    html, body { margin: 0; padding: 0; background: #fff; }
    .pv-scaler { transform: none !important; height: auto !important; }
    .pv-book { display: flex; flex-direction: column; gap: 0; align-items: center; }
    .pv-page { box-shadow: none !important; page-break-after: always; break-after: page; overflow: visible !important; }
    .pv-page:last-child { page-break-after: auto; break-after: auto; }
    @page { size: A4; margin: 0; }
  `;
  w.document.head.appendChild(style);
  w.document.body.appendChild(pv.cloneNode(true));
  const doPrint = () => { w.focus(); w.print(); };
  // Give fonts/layout a moment to settle before printing.
  if (w.document.readyState === "complete") setTimeout(doPrint, 200);
  else w.addEventListener("load", () => setTimeout(doPrint, 200));
};

const openDocPreview = (d) => {
  const biz = activeBiz();
  const cust = db.customers.find(c => c.id === d.customerId);
  const cfg = DOC_TYPES[d.type];
  const wrap = el("div");

  let pv;
  try {
    pv = renderPreview(d, biz, cust);
  } catch (e) {
    console.error("Preview failed for", d.type, d.number, e);
    const errBox = el("div", { style: { padding: "24px" } });
    errBox.appendChild(el("div", { style: { fontWeight: 700, color: "#b91c1c", marginBottom: "8px" } }, "Couldn't build the preview."));
    errBox.appendChild(el("div", { style: { fontSize: "13px", color: "#555" } },
      `This document has bad/missing data (${e.message}). Try Edit → re-save it, or tell Deepesh's AI the error above so it can fix it.`));
    openModal(`${d.type} #${d.number}`, errBox, { wide: true });
    return;
  }

  // Chain link — if this doc was converted from another, show the source and
  // let the user jump to it.
  if (d.fromDoc) {
    const link = el("div", { class: "doc-chain-link", onclick: () => {
      const srcDoc = db.documents.find(x => x.id === d.fromDoc.id);
      if (srcDoc) { closeModal(); openDocPreview(srcDoc); }
      else toast("Source document no longer exists", "err");
    }});
    link.appendChild(el("span", {}, `\u21B3 Converted from ${DOC_TYPES[d.fromDoc.type].shortLabel} #${d.fromDoc.number}`));
    link.appendChild(el("span", { class: "doc-chain-go" }, "View \u2192"));
    wrap.appendChild(link);
  }
  // Documents converted FROM this one.
  const children = db.documents.filter(x => x.fromDoc && x.fromDoc.id === d.id);
  if (children.length) {
    const kids = el("div", { class: "doc-chain-link kids" });
    kids.appendChild(el("span", {}, "Converted into: " + children.map(k => `${DOC_TYPES[k.type].shortLabel} #${k.number}`).join(", ")));
    wrap.appendChild(kids);
  }

  // Preview — the page element keeps its true A4 width; a scaler shrinks it
  // to fit the viewport so phones show the whole document, not a slice.
  const pw = el("div", { class: "preview-wrap" });
  const scaler = el("div", { class: "pv-scaler" });
  scaler.appendChild(pv);
  pw.appendChild(scaler);
  wrap.appendChild(pw);
  attachPreviewScaler(pw, scaler, pv);

  // Actions — SVG icons, labels hide on narrow screens; WhatsApp keeps label
  const actions = el("div", { class: "action-bar no-print" });
  actions.appendChild(iconLabelBtn({ class: "btn btn-secondary", icon: "edit", label: "Edit", onclick: () => { closeModal(); editDoc(d); } }));
  const pdfBtn = iconLabelBtn({ class: "btn btn-primary", icon: "download", label: "PDF" });
  pdfBtn.addEventListener("click", () => downloadPDF(pv, d, pdfBtn));
  actions.appendChild(pdfBtn);
  actions.appendChild(iconLabelBtn({ class: "btn btn-secondary icon-only", icon: "print", label: "Print", title: "Print this document", onclick: () => printDoc(pv) }));
  actions.appendChild(iconLabelBtn({ class: "btn btn-secondary", icon: "image", label: "PNG", onclick: () => downloadPNG(pv, d) }));
  const waBtn = iconLabelBtn({ class: "btn btn-green keep-label", icon: "whatsapp", label: "WhatsApp", title: "Send the document image with details" });
  waBtn.addEventListener("click", () => shareWhatsAppImage(pv, d, cust, biz, waBtn));
  actions.appendChild(waBtn);
  // Convert buttons live inside the same bar (full-width row) so they're never
  // hidden behind the sticky action bar.
  const convertTargets = (cfg.convertsTo || []);
  if (d.id && convertTargets.length) {
    convertTargets.forEach(tt => {
      actions.appendChild(el("button", { class: "btn btn-secondary keep-label convert-btn", onclick: () => { closeModal(); convertDoc(d, tt); } },
        `Convert to ${DOC_TYPES[tt].shortLabel}`));
    });
  }
  wrap.appendChild(actions);

  openModal(`${d.type} #${d.number}`, wrap, { wide: true });
};

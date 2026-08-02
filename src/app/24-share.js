// ==================== SHARE ====================
// Auto short-code from a business name when none is set: initials of the
// significant words, e.g. "Deep Jyoti Plastic Industries" -> "DJPI".
const autoShortCode = (name) => {
  const skip = new Set(["pvt", "ltd", "private", "limited", "and", "&", "co", "company", "the", "industries"]);
  const words = (name || "").split(/[\s.,-]+/).filter(w => w && !skip.has(w.toLowerCase().replace(/\./g, "")));
  const code = words.map(w => w[0]).join("").toUpperCase().slice(0, 5);
  return code || "DOC";
};
// Strip characters that are illegal in filenames, collapse to underscores.
const safeFilePart = (s, max) => {
  let out = String(s || "").replace(/[\\/:*?"<>|]+/g, "").replace(/\s+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  if (max && out.length > max) out = out.slice(0, max).replace(/_$/, "");
  return out;
};
// {number}_{SHORTCODE}_{Full_Party_Name}.ext
const docBaseName = (d, ext) => {
  const biz = db.businesses.find(b => b.id === d.businessId) || activeBiz() || {};
  const code = safeFilePart((biz.shortCode || "").trim() || autoShortCode(biz.name), 12);
  const cust = db.customers.find(c => c.id === d.customerId);
  const party = safeFilePart(cust ? cust.companyName : "", 40);
  return [safeFilePart(d.number, 30), code, party].filter(Boolean).join("_") + "." + ext;
};
// Fallback subfolder-in-Downloads trick for browsers without the File System Access API
const docFileName = (d, ext) => {
  const base = docBaseName(d, ext);
  const folder = (activeBiz()?.saveFolder || "").trim().replace(/[\\/]+/g, "-").replace(/[:*?"<>|]/g, "");
  return folder ? `${folder}/${base}` : base;
};

// html2canvas mis-lays-out text if a captured element sits inside an
// ancestor with a CSS transform:scale() (used to fit the A4 preview to
// small screens) — it sizes for the shrunk box but keeps full font sizes,
// causing every line of text to overlap. Flipping the live scaler's
// transform off and back on isn't reliable across multiple sequential
// captures, so instead each page is deep-cloned into a fresh, untransformed
// container purely for the screenshot; the on-screen preview is never touched.
const captureBookPages = async (previewEl) => {
  const pages = previewEl.classList.contains("pv-book")
    ? Array.from(previewEl.querySelectorAll(".pv-page"))
    : [previewEl];
  const stage = el("div", { style: { position: "fixed", left: "-99999px", top: "0", transform: "none" } });
  document.body.appendChild(stage);
  try {
    const canvases = [];
    for (const p of pages) {
      const clone = p.cloneNode(true);
      stage.innerHTML = "";
      stage.appendChild(clone);
      canvases.push(await html2canvas(clone, { scale: 2, backgroundColor: "#fff", useCORS: true }));
    }
    return canvases;
  } finally {
    stage.remove();
  }
};

const withScalerReset = async (el, fn) => {
  const scaler = el.closest ? el.closest(".pv-scaler") : null;
  const prevTransform = scaler ? scaler.style.transform : null;
  const prevHeight = scaler ? scaler.style.height : null;
  if (scaler) { scaler.style.transform = "none"; scaler.style.height = ""; }
  try {
    return await fn();
  } finally {
    if (scaler) { scaler.style.transform = prevTransform || ""; scaler.style.height = prevHeight || ""; }
  }
};

// Captures each .pv-page and stitches into one tall PNG for sharing on
// WhatsApp/messaging. For single-page docs, output is identical to before.
const capturePreviewAsCanvas = async (previewEl) => {
  const pageCanvases = await captureBookPages(previewEl);
  if (pageCanvases.length === 1) return pageCanvases[0];
  // Stitch vertically with thin separators.
  const GAP = 20; // px between pages in stitched image
  const width = Math.max(...pageCanvases.map(c => c.width));
  const height = pageCanvases.reduce((s, c) => s + c.height, 0) + GAP * (pageCanvases.length - 1);
  const out = document.createElement("canvas");
  out.width = width; out.height = height;
  const ctx = out.getContext("2d");
  ctx.fillStyle = "#e5e7eb";
  ctx.fillRect(0, 0, width, height);
  let y = 0;
  pageCanvases.forEach((c, i) => {
    ctx.drawImage(c, (width - c.width) / 2, y);
    y += c.height + GAP;
  });
  return out;
};

const downloadPNG = async (previewEl, d) => {
  const canvas = await capturePreviewAsCanvas(previewEl);
  const filename = docBaseName(d, "png");
  const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
  const savedPng = blob && await writeToFolder(blob, filename);
  if (savedPng) {
    toast(`Saved to folder "${savedPng.name}" — ${filename}`, "ok", 6000);
    return;
  }
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.download = docFileName(d, "png");
  link.href = blobUrl;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
  toast(`Image saved to your Downloads folder as ${docFileName(d, "png")}`, "ok", 6000);
};

// Real PDF download (A4) — no browser print dialog. Falls back to print() if the
// PDF libraries can't be reached (e.g. fully offline with no cache yet).
// Multi-page PDF: screenshots each .pv-page independently so rows aren't cut
// mid-line at the page boundary. Falls back to the old single-image approach
// if the preview is a legacy single .preview element.
const downloadPDF = async (previewEl, d, btn) => {
  const original = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Generating…'; }
  try {
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();  // 210
    const pageH = pdf.internal.pageSize.getHeight(); // 297

    const pages = previewEl.classList.contains("pv-book")
      ? Array.from(previewEl.querySelectorAll(".pv-page"))
      : [previewEl];

    await withScalerReset(previewEl, async () => {
      for (let i = 0; i < pages.length; i++) {
        const pageEl = pages[i];
        const canvas = await html2canvas(pageEl, { scale: 2, backgroundColor: "#fff", useCORS: true });
        const imgData = canvas.toDataURL("image/jpeg", 0.95);
        // Each captured page is already A4 proportioned (794x1123). Fit edge-to-edge.
        if (i > 0) pdf.addPage();
        pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
      }
    });

    const filename = docBaseName(d, "pdf");
    const pdfBlob = pdf.output("blob");
    const savedPdf = await writeToFolder(pdfBlob, filename);
    if (savedPdf) {
      toast(`Saved to folder "${savedPdf.name}" — ${filename}`, "ok", 6000);
    } else {
      pdf.save(docFileName(d, "pdf"));
      toast(`PDF downloaded (${pages.length} ${pages.length === 1 ? "page" : "pages"})`);
    }
  } catch (e) {
    console.error(e);
    toast("Couldn't generate PDF — opening print dialog instead", "err");
    printDoc(previewEl);
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
};

// Message body shared alongside the document image.
const shareMessage = (d, cust, biz) => {
  const cfg = DOC_TYPES[d.type];
  const lines = [
    `Dear ${cust.contactName || cust.companyName},`,
    "",
    `Please find ${cfg.label} #${d.number} dated ${d.date}.`,
    ""
  ];
  lines.push(`Party: ${cust.companyName}`);
  if (cust.vatNo) lines.push(`VAT/PAN: ${cust.vatNo}`);
  const n = (d.lineItems || []).length;
  if (n) lines.push(`Items: ${n}`);
  lines.push(`Total: ${d.currency} ${fmt(d.totals.total)}`);
  if (d.totals && Number(d.totals.delivery) > 0) lines.push(`(incl. delivery ${fmt(d.totals.delivery)})`);
  if (cfg.hasExpiry && d.expiryDate) lines.push(`${cfg.expiryLabel}: ${d.expiryDate}`);
  lines.push("", `Thank you,`, biz.name);
  if (biz.phone) lines.push(biz.phone);
  return lines.join("\n");
};

// Share the document as a PNG image. Uses the Web Share API where available
// (Android/iOS) so the picture and text go together into WhatsApp; otherwise
// downloads the image and opens WhatsApp with the text for manual attach.
const shareWhatsAppImage = async (previewEl, d, cust, biz, btn) => {
  if (!cust || !cust.phone) { toast("Customer phone number is missing", "err"); return; }
  const original = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Preparing…'; }
  try {
    const canvas = await capturePreviewAsCanvas(previewEl);
    const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    const filename = docBaseName(d, "png");
    const msg = shareMessage(d, cust, biz);
    const file = blob ? new File([blob], docFileName(d, "png"), { type: "image/png" }) : null;

    // The file itself, with the message as its caption, in one step — the
    // only way a browser can attach a file to WhatsApp at all. Picking the
    // WhatsApp icon here on Android/iOS drops straight into the customer's
    // chat if it's already open, or the OS's contact/share list otherwise.
    if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], text: msg, title: `${d.type} #${d.number}` });
      if (d.status === "Draft") { d.status = "Sent"; saveDB(); }
      toast("Shared");
      return;
    }

    // No file-sharing support (typically desktop): save the image, then open
    // this exact customer's WhatsApp chat with the message ready — the image
    // needs a manual attach here, since wa.me links can't carry a file.
    const saved = blob && await writeToFolder(blob, filename);
    if (!saved && blob) {
      // A Blob URL (not canvas.toDataURL — that's unreliable for downloads on
      // mobile browsers, especially with large images) triggers a real save
      // to the device's Downloads folder.
      const blobUrl = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.download = docFileName(d, "png");
      a.href = blobUrl;
      document.body.appendChild(a);
      a.click();
      a.remove();
      // Free the object URL after the browser's had time to actually start
      // the download — revoking too early can cancel it on some browsers.
      setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
    }
    // Give the download a moment to register before navigating away — opening
    // WhatsApp immediately could interrupt a download that hadn't started yet.
    await new Promise(res => setTimeout(res, 500));
    const phone = cust.phone.replace(/[^0-9]/g, "");
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(msg)}`, "_blank");
    if (d.status === "Draft") { d.status = "Sent"; saveDB(); }
    toast(saved
      ? `Image saved to "${saved.name}" as ${docFileName(d, "png")} — attach it in the chat that just opened`
      : `Image saved to your Downloads folder as ${docFileName(d, "png")} — attach it in the chat that just opened`,
      "ok", 8000);
  } catch (e) {
    if (e && e.name === "AbortError") return; // user dismissed the share sheet
    console.error(e);
    toast("Couldn't prepare the image", "err");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
};

const shareWhatsApp = (d, cust, biz) => {
  if (!cust || !cust.phone) { toast("Customer phone number is missing", "err"); return; }
  const phone = cust.phone.replace(/[^0-9]/g, "");
  const url = `https://wa.me/${phone}?text=${encodeURIComponent(shareMessage(d, cust, biz))}`;
  window.open(url, "_blank");
  if (d.status === "Draft") { d.status = "Sent"; saveDB(); }
};

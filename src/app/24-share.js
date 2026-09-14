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

const downloadPNG = async (previewEl, d, btn) => {
  const busy = btnBusy(btn, "Saving…");
  try {
    if (!(await ensurePdfLibs())) return;
    const canvas = await capturePreviewAsCanvas(previewEl);
    const filename = docBaseName(d, "png");
    const blob = await new Promise(res => canvas.toBlob(res, "image/png"));
    if (!blob) throw new Error("the image could not be created");
    const savedPng = await writeToFolder(blob, filename);
    track("document.exported", { type: d.type, format: "png" });
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
  } catch (e) {
    track("export.failed", { type: d.type, format: "png" });
    console.error("PNG export failed:", e);
    toast("Couldn't save the image — " + (e.message || "please try again"), "err", 5000);
  } finally {
    busy.done();
  }
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
    if (!(await ensurePdfLibs())) return;
    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ unit: "mm", format: "a4", orientation: "portrait" });
    const pageW = pdf.internal.pageSize.getWidth();  // 210
    const pageH = pdf.internal.pageSize.getHeight(); // 297

    // Capture through captureBookPages, the same path the PNG export uses: it
    // clones each page onto an untransformed stage. Screenshotting the live
    // page instead leaves it inside the preview's transform:scale(), which
    // html2canvas renders with shrunk boxes but full-size text — every line
    // overlapping the next. It only showed up on small screens, where the
    // scaler is actually doing something.
    const canvases = await captureBookPages(previewEl);
    if (!canvases.length) throw new Error("there was nothing to put on the page");
    canvases.forEach((canvas, i) => {
      const imgData = canvas.toDataURL("image/jpeg", 0.95);
      // Each captured page is already A4 proportioned (794x1123). Fit edge-to-edge.
      if (i > 0) pdf.addPage();
      pdf.addImage(imgData, "JPEG", 0, 0, pageW, pageH);
    });
    const pages = canvases;

    const filename = docBaseName(d, "pdf");
    const pdfBlob = pdf.output("blob");
    const savedPdf = await writeToFolder(pdfBlob, filename);
    if (savedPdf) {
      toast(`Saved to folder "${savedPdf.name}" — ${filename}`, "ok", 6000);
    } else {
      pdf.save(docFileName(d, "pdf"));
      toast(`PDF downloaded (${pages.length} ${pages.length === 1 ? "page" : "pages"})`);
    }
    track("document.exported", { type: d.type, format: "pdf", pages: pages.length });
  } catch (e) {
    track("export.failed", { type: d.type, format: "pdf" });
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
// The desktop hand-off: the image is already saved, so all that is left is
// opening the right chat. This is a real link the user presses, which is the
// only reliable way — a window.open() after the image has been generated is no
// longer attached to the click that started it, and browsers silently block it.
const openWhatsAppHandoff = (d, cust, msg, fileName, folderName) => {
  const link = `https://wa.me/${waNumber(cust.phone)}?text=${encodeURIComponent(msg)}`;
  const wrap = el("div");

  const where = folderName
    ? `Saved to your "${folderName}" folder as ${fileName}.`
    : `Saved to your Downloads folder as ${fileName}.`;
  wrap.appendChild(el("div", { style: { fontSize: "13px", lineHeight: "1.55", marginBottom: "10px" } }, where));

  const steps = el("ol", { style: { fontSize: "12.5px", lineHeight: "1.6", margin: "0 0 16px 18px", color: "var(--muted)" } });
  steps.appendChild(el("li", {}, `Open ${cust.companyName}'s chat with the button below — the message is written for you.`));
  steps.appendChild(el("li", {}, "Attach the image you just saved, and send."));
  wrap.appendChild(steps);
  wrap.appendChild(el("div", { style: { fontSize: "11.5px", color: "var(--muted)", marginBottom: "14px", lineHeight: "1.5" } },
    "WhatsApp does not let a website attach the file for you on a computer. On a phone it does — tap WhatsApp there and the document goes along with the message."));

  const bar = el("div", { class: "action-bar" });
  bar.appendChild(el("button", { class: "btn btn-secondary", type: "button", onclick: closeModal }, "Not now"));
  // An <a> the user clicks, not a scripted window.open, so nothing blocks it.
  const go = el("a", {
    class: "btn btn-green keep-label", href: link, target: "_blank", rel: "noopener noreferrer",
    style: { textDecoration: "none", display: "inline-flex", alignItems: "center", gap: "8px", justifyContent: "center" },
    onclick: () => {
      if (d.status === "Draft") { d.status = "Sent"; saveDB(); }
      track("document.shared", { type: d.type, via: "wa.me" });
      closeModal();
    },
  });
  const icon = svgIcon("whatsapp");
  if (icon) go.appendChild(icon);
  go.appendChild(el("span", {}, "Open WhatsApp"));
  bar.appendChild(go);
  wrap.appendChild(bar);

  openModal(`Send ${DOC_TYPES[d.type].shortLabel} #${d.number} on WhatsApp`, wrap, { guard: false });
};

// wa.me needs a full international number with no plus sign. Most Nepali
// businesses save a customer as "9801234567" or "980-123 4567", which wa.me
// reads as a US number and fails on — so a bare ten-digit mobile starting with
// 9 gets Nepal's 977 in front of it. Anything already carrying a country code
// (a leading +, 00, or 977) is left exactly as typed, so overseas customers
// still work.
const waNumber = (raw) => {
  const typed = String(raw || "").trim();
  let digits = typed.replace(/[^0-9]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);          // 00977… -> 977…
  else if (typed.startsWith("+")) return digits;                   // already international
  if (digits.startsWith("977")) return digits;
  if (/^9\d{9}$/.test(digits)) return "977" + digits;              // Nepali mobile
  return digits;
};

const shareWhatsAppImage = async (previewEl, d, cust, biz, btn) => {
  if (!cust || !cust.phone) { toast("Customer phone number is missing", "err"); return; }
  const original = btn ? btn.innerHTML : null;
  if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spin"></span> Preparing…'; }
  try {
    if (!(await ensurePdfLibs())) return;
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
      track("document.shared", { type: d.type, via: "share-sheet" });
      toast("Shared");
      return;
    }

    // No file-sharing support — this is the desktop case. wa.me links cannot
    // carry a file, so the image is saved and the chat is opened for a manual
    // attach. Opening it automatically does not work: by the time the image has
    // been drawn and written, the browser no longer counts this as something
    // the user clicked, and it blocks the popup with no message. So save the
    // file, then hand over a real button for the user to press.
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
    openWhatsAppHandoff(d, cust, msg, docFileName(d, "png"), saved ? saved.name : "");
  } catch (e) {
    if (e && e.name === "AbortError") return; // user dismissed the share sheet
    track("export.failed", { type: d.type, format: "whatsapp" });
    console.error(e);
    toast("Couldn't prepare the image", "err");
  } finally {
    if (btn) { btn.disabled = false; btn.innerHTML = original; }
  }
};


// ==================== HELPERS ====================
const $ = (sel) => document.querySelector(sel);
const el = (tag, props = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === "class") e.className = v;
    else if (k === "style") Object.assign(e.style, v);
    else if (k.startsWith("on")) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === "html") e.innerHTML = v;
    // A textarea's text lives in its content, not a value attribute — setting
    // the attribute silently leaves the box empty. Assign the property instead.
    else if (k === "value" && tag === "textarea") e.value = v ?? "";
    else if (v !== null && v !== undefined) e.setAttribute(k, v);
  }
  for (const k of kids.flat()) {
    if (k == null || k === false) continue;
    e.appendChild(typeof k === "string" ? document.createTextNode(k) : k);
  }
  return e;
};
// ---- Busy / progress helpers ----
// Let the browser paint before we carry on. Bulk loops are synchronous, so
// without this the spinner never actually appears on screen.
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// Turn a button into a spinner + live label for the duration of an operation.
// Returns { set, done } — call done() to put the original button back.
const btnBusy = (btn, label) => {
  if (!btn) return { set: () => {}, done: () => {} };
  const orig = btn.innerHTML;
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  btn.innerHTML = "";
  btn.appendChild(el("span", { class: "spin" }));
  const txt = el("span", {}, label || "Working…");
  btn.appendChild(txt);
  return {
    set: (s) => { txt.textContent = s; },
    done: () => { btn.innerHTML = orig; btn.disabled = wasDisabled; },
  };
};

// Run `fn(item, i)` over a list in chunks so the button's spinner and its
// "12/340" counter stay live instead of the whole tab freezing. Small lists
// finish in one pass — the yield only costs a frame when it's worth it.
const runBulk = async (btn, label, items, fn, chunk = 40) => {
  const total = items.length;
  const busy = btnBusy(btn, total > chunk ? `${label} 0/${total}` : label);
  await nextFrame();
  try {
    for (let i = 0; i < total; i++) {
      fn(items[i], i);
      if (total > chunk && (i + 1) % chunk === 0) {
        busy.set(`${label} ${i + 1}/${total}`);
        await nextFrame();
      }
    }
  } finally { busy.done(); }
};

// Soft delete with an undo window. Removes the record immediately (so the UI
// updates) but keeps it in memory; the toast can put it straight back.
let undoTimer = null;
const deleteWithUndo = (label, removeFn, restoreFn, ms = 8000) => {
  removeFn();
  saveDB(); render();
  if (undoTimer) clearTimeout(undoTimer);
  document.querySelectorAll(".toast").forEach(t => t.remove());
  const t = el("div", { class: "toast undo-toast" });
  t.appendChild(el("span", {}, `${label} deleted`));
  t.appendChild(el("button", { class: "undo-btn", onclick: () => {
    restoreFn(); saveDB(); render();
    t.remove(); if (undoTimer) clearTimeout(undoTimer);
    toast("Restored");
  } }, "Undo"));
  document.body.appendChild(t);
  undoTimer = setTimeout(() => {
    t.style.transition = "opacity .25s ease, transform .25s ease";
    t.style.opacity = "0"; t.style.transform = "translate(-50%, 8px)";
    setTimeout(() => t.remove(), 250);
  }, ms);
};

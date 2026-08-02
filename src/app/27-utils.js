// ==================== UTILS ====================
const emptyState = (icon, title, sub) => {
  const e = el("div", { class: "empty" });
  e.appendChild(el("div", { class: "empty-icon" }, icon));
  e.appendChild(el("div", { style: { fontSize: 15, fontWeight: 600 } }, title));
  e.appendChild(el("div", { style: { fontSize: 13, marginTop: 4 } }, sub));
  return e;
};

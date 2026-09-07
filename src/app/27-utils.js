// ==================== UTILS ====================
// Empty-list placeholder. `action` is optional { label, onclick } — when given,
// the empty screen offers the obvious next step instead of being a dead end.
const emptyState = (icon, title, sub, action) => {
  const e = el("div", { class: "empty" });
  e.appendChild(el("div", { class: "empty-icon" }, icon));
  e.appendChild(el("div", { class: "empty-title" }, title));
  e.appendChild(el("div", { class: "empty-sub" }, sub));
  if (action) {
    e.appendChild(el("button", { class: "btn btn-primary", type: "button",
      style: { marginTop: "16px" }, onclick: action.onclick }, action.label));
  }
  return e;
};

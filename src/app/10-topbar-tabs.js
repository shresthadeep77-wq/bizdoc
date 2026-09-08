// ==================== TOPBAR & TABS ====================
const renderTopbar = () => {
  const bar = el("header", { class: "topbar" });
  // Branding, not a heading: the <h1> belongs to the section being shown, and a
  // page should not open with a heading that says the same thing on every view.
  bar.appendChild(el("div", { class: "brand-title" }, "PI & PO Maker"));
  const sw = el("select", { class: "biz-switcher", "aria-label": "Active business", onchange: (e) => {
    if (e.target.value === "__new__") { openBusinessModal(); return; }
    db.activeBusinessId = parseInt(e.target.value);
    saveDB();
    render();
  }});
  db.businesses.forEach(b => {
    const opt = el("option", { value: b.id }, b.name);
    if (b.id === db.activeBusinessId) opt.selected = true;
    sw.appendChild(opt);
  });
  sw.appendChild(el("option", { value: "__new__" }, "+ Add business…"));
  bar.appendChild(sw);
  return bar;
};

const renderTabs = () => {
  const tabs = el("nav", { class: "tabs", "aria-label": "Sections" });
  const items = [
    ["dashboard", "Home", "home"],
    ["customers", "Customers", "users"],
    ["products", "Products", "box"],
    ["documents", "Documents", "doc"],
    ["settings", "Settings", "settings"],
  ];
  items.forEach(([k, label, iconName]) => {
    const t = el("button", {
      class: "tab" + (currentTab === k ? " active" : ""),
      type: "button",
      "aria-current": currentTab === k ? "page" : undefined,
      onclick: () => {
        if (k === "settings") { openSettingsModal(); return; }
        navigateTo(k);
      }
    });
    const iconSpan = el("span", { class: "tab-icon" });
    iconSpan.appendChild(svgIcon(iconName));
    t.appendChild(iconSpan);
    t.appendChild(el("span", { class: "tab-label" }, label));
    tabs.appendChild(t);
  });
  return tabs;
};

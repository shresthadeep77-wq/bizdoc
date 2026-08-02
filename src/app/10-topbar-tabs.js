// ==================== TOPBAR & TABS ====================
const renderTopbar = () => {
  const bar = el("div", { class: "topbar" });
  bar.appendChild(el("h1", {}, "PI & PO Maker"));
  const sw = el("select", { class: "biz-switcher", onchange: (e) => {
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
  const tabs = el("div", { class: "tabs" });
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
      onclick: () => {
        if (k === "settings") { openSettingsModal(); return; }
        currentTab = k; bulkSel.kind = null; bulkSel.ids.clear(); render();
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

// ==================== ADMIN: SHELL & BOOT ====================
// Sidebar, date filter, hash routing, and the one render path everything goes
// through. Deliberately plain: this is a tool for reading numbers, so the
// interface should get out of the way.

const state = {
  page: "overview",
  range: "7d",
  customFrom: null,   // yyyy-mm-dd strings while the custom picker is open
  customTo: null,
};

const currentWindow = () => {
  if (state.range === "custom" && state.customFrom && state.customTo) {
    const from = startOfDay(new Date(state.customFrom + "T00:00:00"));
    const to = endOfDay(new Date(state.customTo + "T00:00:00"));
    if (isFinite(from) && isFinite(to) && to >= from) return { from, to };
  }
  const r = RANGES[state.range] || RANGES["7d"];
  return { from: r.from(), to: r.to() };
};

/* ---- routing ------------------------------------------------------------ */

const pageFromHash = () => {
  const h = (location.hash || "").replace(/^#\/?/, "").toLowerCase();
  return PAGES.some(p => p.id === h) ? h : "overview";
};

const go = (id) => {
  state.page = id;
  if (location.hash !== "#/" + id) location.hash = "#/" + id;
  render();
};

window.addEventListener("hashchange", () => {
  const p = pageFromHash();
  if (p === state.page) return;
  state.page = p;
  render();
});

/* ---- date filter -------------------------------------------------------- */

const renderRangePicker = () => {
  const wrap = el("div", { class: "rangebar" });
  const row = el("div", { class: "range-buttons", role: "group", "aria-label": "Date range" });
  Object.entries(RANGES).forEach(([key, r]) => {
    row.appendChild(el("button", {
      type: "button",
      class: "range-btn" + (state.range === key ? " active" : ""),
      "aria-pressed": state.range === key ? "true" : "false",
      onclick: () => {
        state.range = key;
        if (key === "custom" && !state.customFrom) {
          const w = currentWindow();
          state.customFrom = new Date(w.from).toISOString().slice(0, 10);
          state.customTo = new Date(w.to).toISOString().slice(0, 10);
        }
        render();
      },
    }, r.label));
  });
  wrap.appendChild(row);

  if (state.range === "custom") {
    const c = el("div", { class: "custom-range" });
    const mk = (which, value) => el("input", {
      type: "date", value: value || "", "aria-label": which === "from" ? "From date" : "To date",
      max: new Date().toISOString().slice(0, 10),
      onchange: (e) => { state[which === "from" ? "customFrom" : "customTo"] = e.target.value; render(); },
    });
    c.appendChild(el("label", {}, "From"));
    c.appendChild(mk("from", state.customFrom));
    c.appendChild(el("label", {}, "To"));
    c.appendChild(mk("to", state.customTo));
    wrap.appendChild(c);

    if (state.customFrom && state.customTo && new Date(state.customTo) < new Date(state.customFrom)) {
      wrap.appendChild(el("p", { class: "range-error" }, "The end date is before the start date — showing the last 7 days instead."));
    }
  }
  return wrap;
};

/* ---- shell -------------------------------------------------------------- */

const renderSidebar = () => {
  const aside = el("aside", { class: "sidebar" });
  const brand = el("a", { class: "admin-brand", href: "../", title: "Back to BizDoc" });
  brand.appendChild(el("span", { class: "admin-mark" }, "PI"));
  brand.appendChild(el("span", {}, [el("strong", {}, "BizDoc"), el("em", {}, "Admin")]));
  aside.appendChild(brand);

  const nav = el("nav", { class: "admin-nav", "aria-label": "Admin sections" });
  PAGES.forEach((p) => {
    nav.appendChild(el("a", {
      href: "#/" + p.id,
      class: state.page === p.id ? "active" : "",
      "aria-current": state.page === p.id ? "page" : null,
      onclick: (e) => { e.preventDefault(); go(p.id); },
    }, p.nav));
  });
  aside.appendChild(nav);

  aside.appendChild(el("a", { class: "back-link", href: "../" }, "← Back to the app"));
  return aside;
};

const render = () => {
  const page = PAGES.find(p => p.id === state.page) || PAGES[0];
  const root = $("#admin");
  root.innerHTML = "";

  const shell = el("div", { class: "admin-shell" });
  shell.appendChild(renderSidebar());

  const main = el("main", { class: "admin-main", id: "main" });
  const head = el("header", { class: "admin-head" });
  head.appendChild(el("h1", {}, page.title));
  if (!page.noRange) head.appendChild(renderRangePicker());
  main.appendChild(head);

  const body = el("div", { class: "admin-body" });
  main.appendChild(body);
  shell.appendChild(main);
  root.appendChild(shell);

  // Rendering reads localStorage and builds charts; on a big event log that is
  // long enough to be worth showing a state for rather than a frozen page.
  body.appendChild(loadingPanel());
  // setTimeout, not requestAnimationFrame: rAF only fires when the page is
  // actually painting, so in a background tab the dashboard would sit on
  // "Reading stored data…" forever. A macrotask always runs.
  setTimeout(() => {
    let content;
    try {
      const store = readStore();
      if (!store) {
        content = el("div");
        content.appendChild(errorPanel(
          "No analytics have been recorded in this browser yet. Open BizDoc, use it briefly, " +
          "then come back — or check that this page is on the same site as the app, since a browser " +
          "keeps storage separate per site."));
      } else if (store.enabled === false && page.id !== "settings") {
        content = el("div");
        const box = el("div", { class: "notice notice-strong" });
        box.appendChild(el("strong", {}, "Recording is turned off"));
        box.appendChild(el("p", {}, "Nothing new is being recorded on this device. Anything already " +
          "stored is still shown below."));
        box.appendChild(el("a", { class: "notice-link", href: "#/settings" }, "Turn it back on in Settings →"));
        content.appendChild(box);
        const w = currentWindow();
        content.appendChild(page.render(localSource.window(w.from, w.to), { rerender: render }));
      } else {
        const w = currentWindow();
        content = page.render(localSource.window(w.from, w.to), { rerender: render });
      }
    } catch (err) {
      content = errorPanel((err && err.message) || String(err));
      if (window.console) console.error("Admin render failed:", err);
    }
    body.innerHTML = "";
    body.appendChild(content);
  }, 0);
};

state.page = pageFromHash();
render();

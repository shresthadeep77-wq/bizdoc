// ==================== ADMIN: PAGES ====================
// Each page is a function returning a DOM node, given the current window.
// The rule throughout: if it was measured, show it; if it cannot be measured,
// say so and say what would be needed. Never a placeholder number.

/* ---- shared pieces ------------------------------------------------------ */

// The standing explanation of what this dashboard can and cannot see. It is on
// the overview rather than buried in settings, because every number below it
// has to be read in its light.
const scopeNotice = () => {
  const box = el("div", { class: "notice" });
  box.appendChild(el("strong", {}, "This dashboard measures one browser — this one."));
  box.appendChild(el("p", {}, "BizDoc is a static site with no server, so a visitor's browser " +
    "never reports back to anywhere. Everything below was recorded locally by the copy of the app " +
    "running on this device. It cannot tell you how many people use BizDoc, or what they do. " +
    "Those numbers are marked “Not available” and need a backend."));
  box.appendChild(el("a", { class: "notice-link", href: "#/settings" }, "What a backend would need to provide →"));
  return box;
};

const rangeSummary = (w) =>
  el("p", { class: "range-note" },
    `${dateShort(w.from)} – ${dateShort(w.to)} · ${num(w.events.length)} events recorded in this period`);

/* ---- 1. Overview -------------------------------------------------------- */

const pageOverview = (w) => {
  const root = el("div");
  root.appendChild(scopeNotice());

  const aud = audienceMetrics();

  // Audience — the questions that need a backend. Shown first, and shown as
  // gaps, because they are the questions most people open a dashboard to ask.
  const audGrid = el("div", { class: "tiles" });
  [["Total visitors", aud.totalVisitors], ["Unique visitors", aud.uniqueVisitors],
   ["Active users", aud.activeUsers], ["New users", aud.newUsers],
   ["Returning users", aud.returningUsers]]
    .forEach(([label, m]) => audGrid.appendChild(statTile(label, m)));
  root.appendChild(panel("Audience", audGrid));

  // Activity — real, measured, this device.
  const created = w.docsCreated.length;
  const createdPrev = w.docsCreatedPrev.length;
  const features = countBy(w.featureRows, r => r.e);
  const pages = countBy(w.pageRows, r => (r.p && r.p.section) || "");

  const grid = el("div", { class: "tiles" });
  grid.appendChild(statTile("Documents created", ok(created, {
    delta: delta(created, createdPrev), prevValue: createdPrev,
  }), { sub: "in the selected period" }));
  grid.appendChild(statTile("Documents on this device", ok(w.totalDocsNow), {
    sub: w.undatedDocs ? `${num(w.undatedDocs)} saved before dates were tracked` : "all time",
  }));
  grid.appendChild(statTile("App opened", ok(w.sessions.length, {
    delta: delta(w.sessions.length, w.sessionsPrev.length), prevValue: w.sessionsPrev.length,
  }), { sub: "times in this period" }));
  grid.appendChild(statTile("Most used feature",
    features.length ? ok(eventLabel(features[0][0])) : nope("Nothing recorded yet", "Use the app for a while and this fills in."),
    { sub: features.length ? num(features[0][1]) + " times" : null }));
  grid.appendChild(statTile("Most visited section",
    pages.length ? ok(SECTION_LABELS[pages[0][0]] || pages[0][0]) : nope("Nothing recorded yet", "Move between the app's tabs and this fills in."),
    { sub: pages.length ? num(pages[0][1]) + " views" : null }));
  grid.appendChild(statTile("Errors caught", ok(w.errors.length), {
    sub: w.errors.length ? "see the Errors page" : "none so far",
  }));
  root.appendChild(panel("Activity on this device", el("div", {}, [grid, rangeSummary(w)])));

  root.appendChild(panel("Activity over time",
    lineChart(dailyBuckets(w.events, w.from, w.to), { label: "Events" })));

  const two = el("div", { class: "cols-2" });
  two.appendChild(panel("Documents by type", donutChart(
    countBy(w.docsCreated, r => (r.p && r.p.type) || "?"),
    { emptyTitle: "No documents created in this period" })));
  two.appendChild(panel("Most used features", barChart(features, {
    label: eventLabel, emptyTitle: "No feature use recorded in this period",
  })));
  root.appendChild(two);

  return root;
};

/* ---- 2. Traffic --------------------------------------------------------- */

const pageTraffic = (w) => {
  const root = el("div");
  const aud = audienceMetrics();

  const grid = el("div", { class: "tiles" });
  grid.appendChild(statTile("Visitors over time", aud.totalVisitors));
  grid.appendChild(statTile("Sessions (all visitors)", aud.uniqueVisitors));
  grid.appendChild(statTile("New vs returning", aud.returningUsers));
  grid.appendChild(statTile("Traffic sources", aud.trafficSources));
  grid.appendChild(statTile("Country / region", aud.countries));
  root.appendChild(panel("Visitor analytics — needs a backend", el("div", {}, [
    grid,
    el("p", { class: "panel-note" },
      "These are the metrics a hosted analytics service or a small backend would provide. " +
      "They are left blank deliberately: there is no honest way to derive them from a single browser."),
  ])));

  // What this device genuinely knows about itself.
  const s = w.sessions;
  root.appendChild(panel("This device — app opens over time",
    lineChart(dailyBuckets(s, w.from, w.to), { label: "App opens" })));

  const two = el("div", { class: "cols-2" });

  const refs = countBy(s, r => r.ref || "");
  two.appendChild(panel("Where this browser arrived from", refs.length
    ? barChart(refs, { label: (r) => r || "Direct / typed in" })
    : emptyPanel("No referrers recorded",
        "Only visits that followed a link from another site have a referrer, and only this browser's own visits are known.")));

  // Environment is one data point — this browser. Presented as a description of
  // this device, never as a "device breakdown" across an audience.
  const ua = navigator.userAgent || "";
  const browser = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera"
    : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) && !/Chrome/.test(ua) ? "Safari"
    : /Firefox\//.test(ua) ? "Firefox" : "Other";
  const os = /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android"
    : /iPhone|iPad|iPod/.test(ua) ? "iOS" : /Mac OS X/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux" : "Other";
  const touch = (navigator.maxTouchPoints || 0) > 0;
  const rows = [
    ["Device type", touch ? "Touch (phone or tablet)" : "Desktop / laptop"],
    ["Browser", browser],
    ["Operating system", os],
    ["Screen size", `${screen.width} × ${screen.height}`],
    ["Window size", `${innerWidth} × ${innerHeight}`],
    ["Installed as an app", matchMedia("(display-mode: standalone)").matches ? "Yes" : "No"],
    ["Language", navigator.language || "unknown"],
    ["Online now", navigator.onLine ? "Yes" : "No"],
  ];
  const dl = el("dl", { class: "kv" });
  rows.forEach(([k, v]) => { dl.appendChild(el("dt", {}, k)); dl.appendChild(el("dd", {}, v)); });
  two.appendChild(panel("This device", el("div", {}, [
    dl, el("p", { class: "panel-note" }, "One device — this one. Not a breakdown of your audience."),
  ])));

  root.appendChild(two);

  root.appendChild(panel("Sections opened", barChart(
    countBy(w.pageRows, r => (r.p && r.p.section) || ""),
    { label: (k) => SECTION_LABELS[k] || k, emptyTitle: "No section views recorded in this period" })));

  return root;
};

/* ---- 3. Users ----------------------------------------------------------- */

const pageUsers = () => {
  const root = el("div");
  const db = readAppDB();

  const box = el("div", { class: "notice notice-strong" });
  box.appendChild(el("strong", {}, "BizDoc has no user accounts."));
  box.appendChild(el("p", {}, "There is no sign-up, no login and no user record anywhere in the app — " +
    "by design, so that nothing has to be trusted with your data. So “registered users”, " +
    "“active users” and “most active users” are not metrics that are missing; " +
    "they do not exist to be measured."));
  box.appendChild(el("p", {}, "If you ever add accounts, they would need a backend with an " +
    "authentication provider. That same backend is what would make the audience numbers on the " +
    "other pages possible."));
  root.appendChild(box);

  const grid = el("div", { class: "tiles" });
  ["Registered users", "New registrations", "Active users", "Most active users"].forEach((label) =>
    grid.appendChild(statTile(label, nope("BizDoc has no accounts",
      "Adding accounts requires a backend and an authentication provider such as Supabase or Firebase."))));
  root.appendChild(panel("User accounts", grid));

  // The nearest real thing: the businesses configured in this browser.
  if (db && db.businesses.length) {
    const cols = [
      { name: "Business", get: (b) => b.name || "Unnamed" },
      { name: "Customers", numeric: true, get: (b) => db.customers.filter(c => c.businessId === b.id).length },
      { name: "Products", numeric: true, get: (b) => db.products.filter(p => p.businessId === b.id).length },
      { name: "Documents", numeric: true, get: (b) => db.documents.filter(d => d.businessId === b.id).length },
    ];
    root.appendChild(panel("Businesses set up in this browser", el("div", {}, [
      dataTable(cols, db.businesses, { sort: 3 }),
      el("p", { class: "panel-note" }, "This is the closest thing BizDoc has to a “user”: " +
        "a business profile stored on this device. It is not an account and it exists nowhere else."),
    ])));
  } else {
    root.appendChild(panel("Businesses set up in this browser",
      emptyPanel("No business configured yet", "Set one up in the app and it will appear here.")));
  }

  return root;
};

/* ---- 4. Documents ------------------------------------------------------- */

const DOC_TYPE_NAMES = {
  PI: "Proforma invoice", PO: "Purchase order", QT: "Quotation",
  INV: "Tax invoice", DN: "Delivery note",
};

const pageDocuments = (w) => {
  const root = el("div");
  const db = w.db;

  if (!db) {
    root.appendChild(errorPanel("No BizDoc data found in this browser. Open the app first, then come back."));
    return root;
  }

  const ev = w.events;
  const byName = (n) => ev.filter(e => e.e === n).length;

  const grid = el("div", { class: "tiles" });
  grid.appendChild(statTile("Documents on this device", ok(db.documents.length), { sub: "all time" }));
  grid.appendChild(statTile("Created", ok(byName("document.created"), {
    delta: delta(byName("document.created"), w.docsCreatedPrev.length), prevValue: w.docsCreatedPrev.length,
  }), { sub: "in this period" }));
  grid.appendChild(statTile("Edited", ok(byName("document.edited")), { sub: "in this period" }));
  grid.appendChild(statTile("Deleted", ok(byName("document.deleted")), { sub: "in this period" }));
  grid.appendChild(statTile("Exported", ok(byName("document.exported")), { sub: "PDF and PNG" }));
  grid.appendChild(statTile("Printed", ok(byName("document.printed")), { sub: "in this period" }));
  root.appendChild(panel("Document activity", el("div", {}, [grid, rangeSummary(w)])));

  if (w.undatedDocs) {
    const n = el("div", { class: "notice notice-small" });
    n.appendChild(el("p", {}, `${num(w.undatedDocs)} of the ${num(db.documents.length)} documents ` +
      "on this device were saved before creation dates were recorded, so they cannot be placed on a " +
      "timeline. They are counted in the totals and left out of the charts. Documents saved from now " +
      "on carry a creation time."));
    root.appendChild(n);
  }

  const two = el("div", { class: "cols-2" });
  two.appendChild(panel("Documents held, by type", donutChart(
    countBy(db.documents, d => d.type), {
      label: (t) => DOC_TYPE_NAMES[t] || t,
      emptyTitle: "No documents saved yet",
    })));
  two.appendChild(panel("Export formats used", barChart(
    countBy(ev.filter(e => e.e === "document.exported"), r => (r.p && r.p.format) || "?"),
    { label: (f) => String(f).toUpperCase(), emptyTitle: "No exports in this period" })));
  root.appendChild(two);

  root.appendChild(panel("Documents created over time",
    lineChart(dailyBuckets(w.docsCreated, w.from, w.to), { label: "Documents created" })));

  // Aggregate only — status and type, never a customer or an amount.
  const statusRows = countBy(db.documents, d => d.status || "Draft");
  root.appendChild(panel("Documents by status", el("div", {}, [
    barChart(statusRows, { emptyTitle: "No documents saved yet" }),
    el("p", { class: "panel-note" }, "Counts only. This dashboard never shows document contents, " +
      "customer names or amounts."),
  ])));

  return root;
};

/* ---- 5. Features -------------------------------------------------------- */

const pageFeatures = (w) => {
  const root = el("div");
  const rows = countBy(w.featureRows, r => r.e);
  const total = w.featureRows.length;

  root.appendChild(panel("Feature usage", el("div", {}, [
    barChart(rows, { label: eventLabel, limit: 20,
      emptyTitle: "No feature use recorded in this period",
      emptyHint: "Events are recorded as you use the app. If you have just enabled tracking, use BizDoc for a bit and come back." }),
    rangeSummary(w),
  ])));

  if (rows.length) {
    const cols = [
      { name: "Feature", get: (r) => eventLabel(r[0]) },
      { name: "Event name", get: (r) => r[0] },
      { name: "Uses", numeric: true, get: (r) => r[1] },
      { name: "Share", numeric: true, sortValue: (r) => r[1],
        get: (r) => Math.round((r[1] / total) * 100) + "%" },
    ];
    root.appendChild(panel("All features used", dataTable(cols, rows, {
      sort: 2, search: "Search features…",
    }), el("button", {
      class: "btn btn-sm", type: "button",
      onclick: () => downloadCSV("bizdoc-feature-usage.csv", ["Feature", "Event", "Uses", "Share %"],
        rows.map(r => [eventLabel(r[0]), r[0], r[1], Math.round((r[1] / total) * 100)])),
    }, "Export CSV")));
  }

  // Features that exist in the app but have not been used in this window. This
  // is the drop-off question, answered honestly for one device.
  const used = new Set(rows.map(r => r[0]));
  const unused = FEATURE_EVENTS.filter(e => !used.has(e));
  root.appendChild(panel("Not used in this period", unused.length
    ? el("div", {}, [
        el("ul", { class: "plain-list" }, unused.map(e => el("li", {}, eventLabel(e)))),
        el("p", { class: "panel-note" }, "These are tracked, but were not used between the selected dates. " +
          "On one device that means little; across an audience it is where you would look for features " +
          "people never find."),
      ])
    : emptyPanel("Every tracked feature was used in this period")));

  return root;
};

/* ---- 6. Activity -------------------------------------------------------- */

const pageActivity = (w) => {
  const root = el("div");
  const rows = w.events.slice().sort((a, b) => b.t - a.t);

  const live = el("div", { class: "notice notice-small" });
  live.appendChild(el("p", {}, "This is a log of what happened in this browser, newest first. " +
    "It is not a live feed of other people using BizDoc — that would need a backend pushing " +
    "events in real time."));
  root.appendChild(live);

  const cols = [
    { name: "Time", get: (r) => r.t, sortValue: (r) => r.t, render: (r) => el("span", { title: dateTime(r.t) }, ago(r.t)) },
    { name: "Action", get: (r) => eventLabel(r.e) },
    { name: "Detail", sortable: false, get: (r) => r.p ? Object.entries(r.p).map(([k, v]) => `${k}: ${v}`).join(", ") : "" },
    { name: "Status", get: (r) => (r.e.indexOf("failed") >= 0 ? "Failed" : "OK"),
      render: (r) => el("span", { class: "pill " + (r.e.indexOf("failed") >= 0 ? "pill-bad" : "pill-ok") },
        r.e.indexOf("failed") >= 0 ? "Failed" : "OK") },
  ];

  root.appendChild(panel("Activity log", dataTable(cols, rows, {
    sort: 0, dir: "desc", search: "Search activity…", limit: 300,
    emptyTitle: "No activity recorded in this period",
    emptyHint: "Change the date range, or use the app and come back.",
  }), rows.length ? el("button", {
    class: "btn btn-sm", type: "button",
    onclick: () => downloadCSV("bizdoc-activity.csv", ["Time", "Event", "Detail"],
      rows.map(r => [new Date(r.t).toISOString(), r.e, r.p ? JSON.stringify(r.p) : ""])),
  }, "Export CSV") : null));

  return root;
};

/* ---- 7. Errors ---------------------------------------------------------- */

const pageErrors = (w) => {
  const root = el("div");
  const errs = w.errors.slice().sort((a, b) => b.last - a.last);
  const failedOps = w.events.filter(e => e.e.indexOf("failed") >= 0);

  const grid = el("div", { class: "tiles" });
  grid.appendChild(statTile("Distinct errors", ok(errs.length), { sub: "caught on this device" }));
  grid.appendChild(statTile("Total occurrences", ok(errs.reduce((s, e) => s + e.n, 0))));
  grid.appendChild(statTile("Failed operations", ok(failedOps.length), { sub: "exports, backups, in this period" }));
  grid.appendChild(statTile("Last error",
    errs.length ? ok(ago(errs[0].last)) : nope("None recorded", "Nothing has thrown an error on this device.")));
  root.appendChild(panel("Application health", grid));

  const cols = [
    { name: "Error", get: (r) => r.m },
    { name: "Source", get: (r) => r.src || "—" },
    { name: "Times", numeric: true, get: (r) => r.n },
    { name: "First seen", get: (r) => r.first, sortValue: (r) => r.first, render: (r) => el("span", { title: dateTime(r.first) }, ago(r.first)) },
    { name: "Last seen", get: (r) => r.last, sortValue: (r) => r.last, render: (r) => el("span", { title: dateTime(r.last) }, ago(r.last)) },
  ];
  root.appendChild(panel("JavaScript errors", dataTable(cols, errs, {
    sort: 4, dir: "desc", search: "Search errors…",
    emptyTitle: "No errors caught",
    emptyHint: "Uncaught errors and rejected promises are recorded automatically. None have happened on this device.",
  }), errs.length ? el("button", {
    class: "btn btn-sm", type: "button",
    onclick: () => downloadCSV("bizdoc-errors.csv", ["Message", "Source", "Occurrences", "First seen", "Last seen"],
      errs.map(r => [r.m, r.src, r.n, new Date(r.first).toISOString(), new Date(r.last).toISOString()])),
  }, "Export CSV") : null));

  const fcols = [
    { name: "Time", get: (r) => r.t, sortValue: (r) => r.t, render: (r) => el("span", { title: dateTime(r.t) }, ago(r.t)) },
    { name: "Operation", get: (r) => eventLabel(r.e) },
    { name: "Detail", sortable: false, get: (r) => r.p ? Object.entries(r.p).map(([k, v]) => `${k}: ${v}`).join(", ") : "" },
  ];
  root.appendChild(panel("Failed operations", dataTable(fcols, failedOps.slice().sort((a, b) => b.t - a.t), {
    sort: 0, dir: "desc",
    emptyTitle: "No failed operations in this period",
    emptyHint: "A PDF export or backup that fails is recorded here, even when it does not throw a JavaScript error.",
  })));

  root.appendChild(panel("Not tracked here", el("div", {}, [
    el("ul", { class: "plain-list" }, [
      el("li", {}, "Failed network requests — BizDoc makes almost none, and the ones it does (Google Drive) are recorded as failed operations above."),
      el("li", {}, "Authentication failures — there is no authentication to fail."),
      el("li", {}, "Broken routes — an unknown #/route falls back to the dashboard rather than erroring."),
      el("li", {}, "Errors on other people's devices — those would need a backend to receive them."),
    ]),
  ])));

  return root;
};

/* ---- 8. Settings -------------------------------------------------------- */

const pageSettings = (w, ctx) => {
  const root = el("div");
  const meta = localSource.meta();

  // Tracking on/off, and what is kept.
  const toggleWrap = el("div", { class: "setting-row" });
  const cb = el("input", {
    type: "checkbox", id: "track-toggle", checked: meta.enabled ? "checked" : null,
    onchange: (e) => { writeStore({ enabled: e.target.checked }); ctx.rerender(); },
  });
  toggleWrap.appendChild(cb);
  const lab = el("label", { for: "track-toggle" });
  lab.appendChild(el("strong", {}, "Record activity on this device"));
  lab.appendChild(el("span", {}, meta.enabled
    ? "On. Events stay in this browser and are never sent anywhere."
    : "Off. Nothing new is being recorded. Existing data is kept until you clear it."));
  toggleWrap.appendChild(lab);

  const retainWrap = el("div", { class: "setting-row" });
  const sel = el("select", {
    id: "retain", "aria-label": "Data retention",
    onchange: (e) => { writeStore({ retentionDays: Number(e.target.value) }); ctx.rerender(); },
  });
  [[30, "30 days"], [90, "90 days"], [180, "6 months"], [365, "1 year"]].forEach(([v, l]) => {
    const o = el("option", { value: v }, l);
    if (Number(meta.retentionDays) === v) o.selected = true;
    sel.appendChild(o);
  });
  const retLab = el("label", { for: "retain" });
  retLab.appendChild(el("strong", {}, "Keep events for"));
  retLab.appendChild(el("span", {}, "Anything older is deleted next time the app opens."));
  retainWrap.appendChild(sel);
  retainWrap.appendChild(retLab);

  root.appendChild(panel("Tracking", el("div", {}, [toggleWrap, retainWrap])));

  const dl = el("dl", { class: "kv" });
  [["First recorded", meta.firstSeen ? dateTime(meta.firstSeen) : "—"],
   ["App opened", num(meta.sessions) + " times"],
   ["Events stored", num(meta.events)],
   ["Distinct errors stored", num(meta.errors)],
   ["Stored under", "localStorage · pipomaker_analytics_v1"]]
    .forEach(([k, v]) => { dl.appendChild(el("dt", {}, k)); dl.appendChild(el("dd", {}, v)); });

  const danger = el("div", { class: "danger-row" });
  danger.appendChild(el("button", {
    class: "btn btn-danger btn-sm", type: "button",
    onclick: () => {
      if (!confirm("Delete all recorded analytics from this browser? Your BizDoc documents are not affected.")) return;
      try { localStorage.removeItem("pipomaker_analytics_v1"); } catch (e) {}
      ctx.rerender();
    },
  }, "Delete all analytics data"));
  danger.appendChild(el("span", {}, "Removes the event log and error log. Documents, customers and products are untouched."));

  root.appendChild(panel("Stored data", el("div", {}, [dl, danger])));

  // What is never recorded — the privacy contract, stated in the product.
  root.appendChild(panel("What is never recorded", el("div", {}, [
    el("ul", { class: "plain-list" }, [
      el("li", {}, "Document contents, line items or amounts"),
      el("li", {}, "Customer names, addresses, phone numbers or tax numbers"),
      el("li", {}, "Product names, descriptions or rates"),
      el("li", {}, "Business details, logos, signatures or bank accounts"),
      el("li", {}, "Anything typed into a search box — only that a search happened"),
      el("li", {}, "Passwords, tokens or payment details — BizDoc has none of these"),
    ]),
    el("p", { class: "panel-note" }, "Events carry an action name, a timestamp, and small non-identifying " +
      "properties such as a document type (“PI”) or a count."),
  ])));

  // The architecture answer, in the product rather than only in a chat reply.
  const arch = el("div");
  arch.appendChild(el("p", {}, "GitHub Pages can host the BizDoc frontend, but it cannot run a private " +
    "admin backend or store analytics centrally. It serves files; it does not run code or hold a database. " +
    "That is why the audience numbers on this dashboard are blank."));
  arch.appendChild(el("pre", { class: "arch" },
    "  Today\n" +
    "  ------------------------------------------\n" +
    "  Browser  →  localStorage  →  /admin\n" +
    "  (one device, real but local)\n" +
    "\n" +
    "  With a backend\n" +
    "  ------------------------------------------\n" +
    "  Browser  →  POST /api/events\n" +
    "                    ↓\n" +
    "             Database (Supabase / Firebase)\n" +
    "                    ↓\n" +
    "     /admin behind a real login  →  everyone's data"));
  arch.appendChild(el("p", {}, "The app already emits every event such a backend would need. " +
    "Connecting one means adding a send step and filling in the remote source — the pages above " +
    "would not have to change."));
  const cont = el("table", { class: "contract" });
  const thead = el("thead");
  thead.appendChild(el("tr", {}, [el("th", { scope: "col" }, "Endpoint"), el("th", { scope: "col" }, "Would provide")]));
  cont.appendChild(thead);
  const tb = el("tbody");
  remoteSource.contract.forEach(c => tb.appendChild(el("tr", {}, [
    el("td", {}, el("code", {}, c.name)), el("td", {}, c.gives),
  ])));
  cont.appendChild(tb);
  arch.appendChild(cont);
  root.appendChild(panel("Why some numbers are missing", arch));

  root.appendChild(panel("Admin access", el("div", {}, [
    el("p", {}, "This page is not protected by a password, and adding one to the frontend would not " +
      "protect anything. The code and any password in it are downloaded by every visitor, and the data " +
      "shown here is already in this browser — anyone at this device can read it with developer tools. " +
      "A login here would be decoration."),
    el("p", {}, "What it does have: the page is marked noindex so search engines skip it, and nothing " +
      "in the app links to it. Real protection starts when there is a backend to hold the data and check " +
      "a session — at which point the login belongs on the server, not in this file."),
  ])));

  return root;
};

/* ---- registry ----------------------------------------------------------- */

const PAGES = [
  { id: "overview", nav: "Dashboard", title: "Dashboard", render: pageOverview },
  { id: "traffic", nav: "Traffic", title: "Traffic", render: pageTraffic },
  { id: "users", nav: "Users", title: "Users", render: pageUsers, noRange: true },
  { id: "documents", nav: "Documents", title: "Documents", render: pageDocuments },
  { id: "features", nav: "Features", title: "Feature usage", render: pageFeatures },
  { id: "activity", nav: "Activity", title: "Activity", render: pageActivity },
  { id: "errors", nav: "Errors", title: "Errors & health", render: pageErrors },
  { id: "settings", nav: "Settings", title: "Settings", render: pageSettings, noRange: true },
];
